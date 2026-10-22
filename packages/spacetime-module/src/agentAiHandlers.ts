import { memberIdentityFor } from './authIdentity';
import { Identity } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { AI_CONSENT_VERSION, AI_LIMITS, aiHash, aiUuid } from '../../core/src/ai';
import { AGENT_PREMISES_VERSION, agentName, agentOwnerName, cleanAgentSuggestions } from '../../core/src/agent';
import { agentAiStep, agentAiSystemInstruction, buildAgentAiPayload, estimateAgentAiTokens, validateAgentAiResult,
  type AgentAiPayload, type AgentAiReviewResult, type AgentAiStep, type AgentAiStyleResult } from '../../core/src/agentAi';
import { activeMember, isActive, type Ctx } from './moduleContext';
import { isAiService } from './aiHandlers';

/** Agente personal con Gemini (7.13, AG-4): autorizar, reservar, terminar y aplicar, siempre del dueño. */
type Person = Ctx['sender'];
type Run = NonNullable<ReturnType<Ctx['db']['agentAiRun']['id']['find']>>;
const RUNS_KEPT = 30;
const RUNNING_MICROS = 90_000_000n;

function fail(code: string, message: string): never { throw new SenderError(`${code}:${message}`); }
function check<T>(fn: () => T, code = 'invalid'): T { try { return fn(); } catch (error) { if (error instanceof SenderError) throw error; return fail(code, error instanceof Error ? error.message : 'Datos no válidos.'); } }
function uuid(value: unknown, field = 'El envío'): string { if (!aiUuid(value)) fail('invalid', `${field} no es válido.`); return value.toLowerCase(); }
function sessionId(value: unknown): bigint | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !/^[0-9]{1,20}$/.test(value) || BigInt(value) > 18446744073709551615n) fail('invalid', 'La sesión no es válida.');
  return BigInt(value);
}
function person(value: unknown): Person {
  if (typeof value !== 'string' || !/^(?:0x)?[0-9a-f]{64}$/i.test(value)) fail('invalid', 'La persona no es válida.');
  return Identity.fromString(value.replace(/^0x/i, ''));
}

/** El nombre del agente tal como lo ve la persona, con el mismo desempate que la app. */
function names(ctx: Ctx, owner: Person) {
  const members = [...ctx.db.member.iter()].filter((m) => m.status === 'active').map((m) => ({ id: m.identity.toHexString(), displayName: m.displayName, joinedAt: m.joinedAt ? new Date(Number(m.joinedAt.microsSinceUnixEpoch / 1000n)) : undefined }));
  const me = members.find((m) => m.id === owner.toHexString()) ?? { id: owner.toHexString(), displayName: 'Miembro' };
  return { owner: agentOwnerName(me.displayName), bot: agentName(me, members) };
}

function profile(ctx: Ctx, owner: Person) {
  const row = ctx.db.agentProfile.owner.find(owner);
  if (!row) fail('unavailable', 'Activa tu agente y acepta sus premisas antes de usarlo.');
  if (row.premisesVersion !== AGENT_PREMISES_VERSION) fail('consent', 'Las premisas cambiaron. Léelas y acéptalas de nuevo.');
  return row;
}
function latestStyle(ctx: Ctx, owner: Person, version: number) {
  const row = [...ctx.db.agentStyleSnapshot.owner.filter(owner)].find((s) => s.version === version);
  if (!row) fail('unavailable', 'Entrena el estilo de tu agente antes de usar Gemini.');
  return row;
}
function ownSession(ctx: Ctx, owner: Person, id: bigint | undefined) {
  if (id === undefined) fail('invalid', 'Este paso necesita una sesión de ayuda.');
  const row = ctx.db.agentSession.id.find(id);
  if (!row || !row.owner.isEqual(owner)) fail('unavailable', 'La sesión no existe.');
  return row;
}

/** Arma el payload en el servidor con datos del dueño; el navegador nunca lo dicta. */
function prepare(ctx: Ctx, owner: Person, step: AgentAiStep, rawSession: unknown) {
  const agent = profile(ctx, owner); const snapshot = latestStyle(ctx, owner, agent.styleVersion);
  const refs = (JSON.parse(snapshot.sources) as { kind: string; refId: string }[]).map((s) => `${s.kind}:${s.refId}`);
  const style = { features: JSON.parse(snapshot.features), examples: JSON.parse(snapshot.examples) as string[] };
  const input: Omit<AgentAiPayload, 'purpose' | 'step'> = { ...names(ctx, owner), style };
  let session: ReturnType<typeof ownSession> | undefined;
  if (step !== 'style') {
    session = ownSession(ctx, owner, sessionId(rawSession));
    const assignment = ctx.db.assignment.id.find(session.assignmentId);
    if (!assignment) fail('unavailable', 'La tarea ya no existe.');
    input.assignment = { title: assignment.title, instructions: assignment.instructions }; input.draft = session.draft;
    if (step === 'originality') {
      const latest = [...ctx.db.agentOriginalityCheck.sessionId.filter(session.id)].sort((a, b) => Number(b.id - a.id))[0];
      if (!latest || latest.draftVersion !== session.draftVersion) fail('conflict', 'Compara tu borrador actual antes de pedir la explicación.');
      const matches = (JSON.parse(latest.matches) as AgentAiPayload['matches'] & object).filter((m) => !latest.acknowledged.includes(m.refKey));
      input.matches = matches; refs.push(...matches.map((m) => m.refKey));
    }
  }
  const payload = check(() => buildAgentAiPayload(step, input));
  return { agent, snapshot, session, payload, refs, estimatedTokens: estimateAgentAiTokens(payload) };
}

function dto(row: Run) {
  return { id: row.id, step: row.step, sessionId: row.sessionId?.toString(), draftVersion: row.draftVersion, styleVersion: row.styleVersion,
    state: row.state, estimatedTokens: row.estimatedTokens, applied: row.applied,
    ...(row.result ? { result: JSON.parse(row.result) as unknown } : {}), ...(row.error ? { error: row.error } : {}),
    createdAt: Number(row.createdAt.microsSinceUnixEpoch / 1000n), finishedAt: row.finishedAt ? Number(row.finishedAt.microsSinceUnixEpoch / 1000n) : undefined };
}

/** Un envío sin respuesta en 90 s queda incierto y nunca se reenvía solo. */
function expire(ctx: Ctx, owner: Person) {
  for (const row of [...ctx.db.agentAiRun.owner.filter(owner)]) {
    if (row.state !== 'running' || !row.startedAt || row.startedAt.microsSinceUnixEpoch + RUNNING_MICROS > ctx.timestamp.microsSinceUnixEpoch) continue;
    const error = 'unknown:No se conoce el resultado del envío. No se reenviará automáticamente.';
    ctx.db.agentAiRun.id.update({ ...row, state: 'unknown', error, finishedAt: ctx.timestamp });
    const generation = ctx.db.aiGeneration.id.find(row.id);
    if (generation?.status === 'running') ctx.db.aiGeneration.id.update({ ...generation, status: 'unknown', errorCode: 'unknown', errorMessage: error.slice(8) });
  }
}
function prune(ctx: Ctx, owner: Person) {
  const done = [...ctx.db.agentAiRun.owner.filter(owner)].filter((r) => !['pending', 'running'].includes(r.state))
    .sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch));
  for (const old of done.slice(RUNS_KEPT)) ctx.db.agentAiRun.id.delete(old.id);
}
const recentUnknown = (ctx: Ctx, owner: Person) => [...ctx.db.aiGeneration.actor.filter(owner)]
  .some((g) => g.status === 'unknown' && g.createdAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch - 86_400_000_000n);

/** Vista previa: lo que se enviaría y su consumo estimado. No guarda ni reserva nada. */
function preview(ctx: Ctx, raw: Record<string, unknown>) {
  activeMember(ctx); const step = check(() => agentAiStep(raw.step));
  const { payload, estimatedTokens } = prepare(ctx, memberIdentityFor(ctx), step, raw.sessionId);
  return { step, payload, systemInstruction: agentAiSystemInstruction(payload), estimatedTokens };
}

function authorize(ctx: Ctx, raw: Record<string, unknown>) {
  activeMember(ctx); expire(ctx, memberIdentityFor(ctx));
  const id = uuid(raw.generationId); const prior = ctx.db.agentAiRun.id.find(id);
  if (prior) { if (!prior.owner.isEqual(memberIdentityFor(ctx))) fail('conflict', 'El envío pertenece a otra persona.'); return { actor: memberIdentityFor(ctx).toHexString(), run: dto(prior) }; }
  if (ctx.db.aiGeneration.id.find(id)) fail('conflict', 'El identificador ya se usó con otra solicitud.');
  const step = check(() => agentAiStep(raw.step));
  if (raw.confirmed !== true) fail('consent', 'Revisa la vista previa y confirma el envío.');
  if (raw.allowNew !== true) fail('disabled', 'Este paso del agente todavía no está habilitado.');
  if (typeof raw.model !== 'string' || !/^[\w.-]{1,200}$/.test(raw.model)) fail('invalid', 'El modelo no es válido.');
  const consent = ctx.db.aiConsent.actor.find(memberIdentityFor(ctx));
  if (!consent?.accepted || consent.version !== AI_CONSENT_VERSION) fail('consent_required', 'Acepta el consentimiento vigente antes de generar.');
  const key = ctx.db.aiKey.actor.find(memberIdentityFor(ctx)); if (!key) fail('key_required', 'Configura tu clave de Gemini primero.');
  if ([...ctx.db.agentAiRun.owner.filter(memberIdentityFor(ctx))].some((r) => r.state === 'pending' || r.state === 'running')) fail('quota', 'Tu agente ya tiene un envío en curso.');
  if (recentUnknown(ctx, memberIdentityFor(ctx)) && raw.acknowledgeUnknown !== true) fail('unknown_confirmation_required', 'Confirma el posible consumo adicional del envío de resultado incierto.');
  const prepared = prepare(ctx, memberIdentityFor(ctx), step, raw.sessionId);
  if (raw.expectedTokens !== undefined && raw.expectedTokens !== prepared.estimatedTokens) fail('source_changed', 'El material cambió desde la vista previa. Revísalo de nuevo.');
  const row = ctx.db.agentAiRun.insert({ id, owner: memberIdentityFor(ctx), step, sessionId: prepared.session?.id, draftVersion: prepared.session?.draftVersion ?? 0,
    styleVersion: prepared.agent.styleVersion, model: raw.model, keyId: key.keyId, acknowledgeUnknown: raw.acknowledgeUnknown === true,
    payload: JSON.stringify(prepared.payload), refs: prepared.refs, estimatedTokens: prepared.estimatedTokens, state: 'pending', result: '', error: '',
    applied: false, createdAt: ctx.timestamp, startedAt: undefined, finishedAt: undefined });
  return { actor: memberIdentityFor(ctx).toHexString(), run: dto(row) };
}

/** Solo el servicio de IA: vuelve a comprobar todo, reserva presupuesto y entrega la clave cifrada. */
function claim(ctx: Ctx, raw: Record<string, unknown>) {
  if (!isAiService(ctx)) fail('forbidden', 'Solo el servicio de IA puede reclamar un envío.');
  const owner = person(raw.actor); const id = uuid(raw.generationId);
  if (!isActive(ctx.db, owner)) fail('unauthorized', 'La persona ya no es miembro activo.');
  expire(ctx, owner); const run = ctx.db.agentAiRun.id.find(id);
  if (!run || !run.owner.isEqual(owner)) fail('unavailable', 'El envío no está disponible.');
  if (run.state !== 'pending' || ctx.db.aiGeneration.id.find(id)) return { claimed: false, run: dto(run) };
  if (!ctx.db.aiServiceConfig.id.find(0)?.enabled) fail('disabled', 'La IA real todavía no está habilitada.');
  const consent = ctx.db.aiConsent.actor.find(owner);
  if (!consent?.accepted || consent.version !== AI_CONSENT_VERSION) fail('consent', 'Confirma el consentimiento vigente.');
  const key = ctx.db.aiKey.actor.find(owner);
  if (!key || key.keyId !== run.keyId) fail('key_changed', 'La clave cambió después de confirmar. Vuelve a revisar el envío.');
  const agent = profile(ctx, owner);
  if (agent.styleVersion !== run.styleVersion) fail('source_changed', 'El estilo cambió después de confirmar. Revisa el envío de nuevo.');
  if (run.sessionId !== undefined && ownSession(ctx, owner, run.sessionId).draftVersion !== run.draftVersion) fail('source_changed', 'El borrador cambió después de confirmar. Revisa el envío de nuevo.');
  for (const generation of ctx.db.aiGeneration.actor.filter(owner)) if (generation.status === 'queued' || generation.status === 'running') fail('quota', 'Ya tienes una generación en curso.');
  if (recentUnknown(ctx, owner) && !run.acknowledgeUnknown) fail('unknown_confirmation_required', 'Confirma el riesgo de consumo adicional antes del nuevo envío.');
  const sinceHour = ctx.timestamp.microsSinceUnixEpoch - 3_600_000_000n; const sinceDay = ctx.timestamp.microsSinceUnixEpoch - 86_400_000_000n;
  const reservations = [...ctx.db.aiReservation.actor.filter(owner)];
  if (reservations.filter((r) => r.createdAt.microsSinceUnixEpoch > sinceHour).length >= AI_LIMITS.requestsPerHour
    || reservations.filter((r) => r.createdAt.microsSinceUnixEpoch > sinceDay).length >= AI_LIMITS.requestsPerDay) fail('quota', 'Alcanzaste el límite compartido de solicitudes de IA.');
  const spent = reservations.filter((r) => r.createdAt.microsSinceUnixEpoch > sinceDay && r.status !== 'released').reduce((total, r) => total + r.estimatedTokens, 0);
  if (spent + run.estimatedTokens > (ctx.db.aiServiceConfig.id.find(0)?.dailyTokenBudget ?? AI_LIMITS.dailyEstimatedTokens)) fail('quota', 'No queda presupuesto diario para este paso.');
  ctx.db.aiReservation.insert({ id, actor: owner, estimatedTokens: run.estimatedTokens, status: 'reserved', createdAt: ctx.timestamp });
  ctx.db.aiGeneration.insert({ id, actor: owner, preparationId: `agent:${id}`, requestHash: aiHash({ step: run.step, payload: run.payload }),
    configJson: JSON.stringify({ purpose: 'agent', step: run.step }), keyId: key.keyId, model: run.model, status: 'running', createdAt: ctx.timestamp, claimedAt: ctx.timestamp,
    inputTokens: undefined, outputTokens: undefined, resultJson: '', errorCode: '', errorMessage: '' });
  const next = ctx.db.agentAiRun.id.update({ ...run, state: 'running', startedAt: ctx.timestamp });
  const payload = JSON.parse(run.payload) as AgentAiPayload;
  return { claimed: true, run: dto(next), model: run.model, payload, systemInstruction: agentAiSystemInstruction(payload),
    key: { keyId: key.keyId, provider: 'gemini', ciphertext: key.ciphertext, iv: key.iv, masterVersion: key.masterVersion } };
}

/** Aplica el resultado solo si lo que lo originó no cambió; si cambió, se conserva para leerlo. */
function apply(ctx: Ctx, run: Run, payload: AgentAiPayload, result: unknown): boolean {
  if (run.step === 'review') {
    const session = run.sessionId === undefined ? undefined : ctx.db.agentSession.id.find(run.sessionId);
    if (!session || session.draftVersion !== run.draftVersion) return false;
    const suggestions = cleanAgentSuggestions((result as AgentAiReviewResult).suggestions, session.draft);
    for (const old of [...ctx.db.agentSuggestion.sessionId.filter(session.id)]) if (old.state === 'proposed') ctx.db.agentSuggestion.id.delete(old.id);
    for (const s of suggestions) ctx.db.agentSuggestion.insert({ id: 0n, sessionId: session.id, owner: run.owner, draftVersion: session.draftVersion, ...s,
      reason: `${s.reason} (generado con ${payload.bot})`, state: 'proposed', createdAt: ctx.timestamp, resolvedAt: undefined });
    return true;
  }
  if (run.step === 'style') {
    const snapshot = [...ctx.db.agentStyleSnapshot.owner.filter(run.owner)].find((s) => s.version === run.styleVersion);
    if (!snapshot) return false;
    ctx.db.agentStyleSnapshot.id.update({ ...snapshot, features: JSON.stringify({ ...JSON.parse(snapshot.features), ai: { ...(result as AgentAiStyleResult), runId: run.id } }) });
    return true;
  }
  return false;
}

function finish(ctx: Ctx, raw: Record<string, unknown>) {
  if (!isAiService(ctx)) fail('forbidden', 'Solo el servicio de IA puede registrar este resultado.');
  const owner = person(raw.actor); const id = uuid(raw.generationId);
  const run = ctx.db.agentAiRun.id.find(id); const generation = ctx.db.aiGeneration.id.find(id);
  if (!run || !run.owner.isEqual(owner) || !generation || !generation.actor.isEqual(owner)) fail('unavailable', 'El envío no está disponible.');
  if (!['succeeded', 'failed', 'unknown'].includes(String(raw.state))) fail('invalid', 'Estado final inválido.');
  let state = raw.state as 'succeeded' | 'failed' | 'unknown';
  const short = (value: unknown, fallback: string, max: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
  let error = state === 'succeeded' ? '' : `${short(raw.errorCode, state, 80)}:${short(raw.errorMessage, 'La solicitud no terminó correctamente.', 500)}`;
  const payload = JSON.parse(run.payload) as AgentAiPayload; let result = '';
  if (state === 'succeeded') {
    try { result = JSON.stringify(validateAgentAiResult(run.step as AgentAiStep, raw.result, payload)); }
    catch (cause) { state = 'failed'; error = `invalid:${cause instanceof Error ? cause.message : 'Gemini devolvió un resultado inválido.'} No se aplicó nada.`; }
  }
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  if (raw.usage !== undefined) {
    const value = raw.usage as Record<string, unknown>;
    if (!value || ![value.inputTokens, value.outputTokens].every((n) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 10_000_000)) fail('invalid', 'El consumo reportado no es válido.');
    usage = { inputTokens: Number(value.inputTokens), outputTokens: Number(value.outputTokens) };
  }
  if (run.state !== 'running' || generation.status !== 'running') {
    // Una confirmación repetida devuelve lo mismo; un resultado distinto nunca reemplaza al primero.
    if (run.state === state && run.result === result) return dto(run);
    fail('conflict', 'El envío ya terminó; su resultado no puede cambiar.');
  }
  ctx.db.aiGeneration.id.update({ ...generation, status: state, resultJson: result, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
    errorCode: error ? error.split(':')[0]! : '', errorMessage: error ? error.slice(error.indexOf(':') + 1) : '' });
  const reservation = ctx.db.aiReservation.id.find(id);
  if (reservation) ctx.db.aiReservation.id.update({ ...reservation, status: state === 'unknown' ? 'reserved' : 'consumed',
    estimatedTokens: Math.max(reservation.estimatedTokens, (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)) });
  const applied = state === 'succeeded' && check(() => apply(ctx, run, payload, JSON.parse(result)));
  const next = ctx.db.agentAiRun.id.update({ ...run, state, result, error, applied, finishedAt: ctx.timestamp });
  prune(ctx, owner);
  return dto(next);
}

function get(ctx: Ctx, raw: Record<string, unknown>) {
  activeMember(ctx); expire(ctx, memberIdentityFor(ctx)); const row = ctx.db.agentAiRun.id.find(uuid(raw.generationId));
  if (!row || !row.owner.isEqual(memberIdentityFor(ctx))) fail('unavailable', 'El envío no está disponible.');
  return dto(row);
}
function list(ctx: Ctx, raw: Record<string, unknown>) {
  activeMember(ctx); expire(ctx, memberIdentityFor(ctx)); const session = sessionId(raw.sessionId);
  return [...ctx.db.agentAiRun.owner.filter(memberIdentityFor(ctx))].filter((r) => session === undefined || r.sessionId === session)
    .sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch)).map(dto);
}

export function agentAiDispatch(ctx: Ctx, raw: Record<string, unknown>): unknown {
  if (raw.action === 'preview') return preview(ctx, raw);
  if (raw.action === 'authorize') return authorize(ctx, raw);
  if (raw.action === 'claim') return claim(ctx, raw);
  if (raw.action === 'finish') return finish(ctx, raw);
  if (raw.action === 'get') return get(ctx, raw);
  if (raw.action === 'list') return list(ctx, raw);
  return fail('invalid', 'Operación del agente no admitida.');
}

/** Retención: los envíos siguen al dueño, a su sesión y a las fuentes que contienen. */
export function purgeAgentAiRuns(db: Ctx['db'], match: { owner?: Person; sessionId?: bigint; refKey?: string }) {
  if (!db.agentAiRun) return;
  for (const row of [...db.agentAiRun.iter()]) {
    if ((match.owner && row.owner.isEqual(match.owner)) || (match.sessionId !== undefined && row.sessionId === match.sessionId)
      || (match.refKey && row.refs.includes(match.refKey))) db.agentAiRun.id.delete(row.id);
  }
}
