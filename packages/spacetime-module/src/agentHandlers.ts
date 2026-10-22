import { memberIdentityFor } from './authIdentity';
import { ScheduleAt } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { AGENT_LIMITS, AGENT_PREMISES_VERSION, applyAgentSuggestion, cleanAgentDraft, cleanAgentSources, cleanAgentStage, cleanAgentSuggestions } from '../../core/src/agent';
import { compareWithPublished, describeStyle, proseSentences, styleFeatures } from '../../core/src/agentStyle';
import { activeMember, expectVersion, isActive, requireText, targetVersion, type Ctx, type ViewDb } from './moduleContext';
import { withdrawn } from './delivery2Handlers';
import { purgeAgentAiRuns } from './agentAiHandlers';

/** Agente personal (7.13, AG-3): estilo, sesiones, sugerencias y originalidad, siempre del dueño. */
type Person = Ctx['sender'];
const DAY_MICROS = 86_400_000_000n;
const check = <T>(fn: () => T): T => { try { return fn(); } catch (error) { throw new SenderError(error instanceof Error ? error.message : 'Datos no válidos.'); } };
const json = <T>(value: string, max = 60_000): T => { if (value.length > max) throw new SenderError('La solicitud es demasiado grande.'); return check(() => JSON.parse(value) as T); };
const numericId = (value: string) => { if (!/^[0-9]+$/.test(value) || BigInt(value) > 18446744073709551615n) throw new SenderError('Una referencia no es válida.'); return BigInt(value); };

export function agentReadable(db: ViewDb, sender: Person, owner: Person) { return isActive(db, sender) && owner.isEqual(sender); }

function profileOf(ctx: Ctx) {
  activeMember(ctx); const profile = ctx.db.agentProfile.owner.find(memberIdentityFor(ctx));
  if (!profile) throw new SenderError('Activa tu agente y acepta sus premisas antes de usarlo.');
  return profile;
}
function sessionOf(ctx: Ctx, sessionId: bigint) {
  profileOf(ctx); const session = ctx.db.agentSession.id.find(sessionId);
  if (!session || !session.owner.isEqual(memberIdentityFor(ctx))) throw new SenderError('La sesión no existe.');
  return session;
}
function touch(ctx: Ctx, session: NonNullable<ReturnType<Ctx['db']['agentSession']['id']['find']>>, changes: Partial<typeof session>) {
  const next = { ...session, ...changes, generation: session.generation + 1, updatedAt: ctx.timestamp };
  ctx.db.agentSession.id.update(next);
  const expiresAt = ctx.timestamp.microsSinceUnixEpoch + BigInt(AGENT_LIMITS.sessionRetentionDays) * DAY_MICROS;
  for (const old of [...ctx.db.agentExpiry.sessionId.filter(session.id)]) ctx.db.agentExpiry.id.delete(old.id);
  ctx.db.agentExpiry.insert({ id: 0n, scheduledAt: ScheduleAt.time(expiresAt), sessionId: session.id, generation: next.generation });
  return next;
}

/** Texto propio que la persona puede usar para su estilo; nunca de otra persona. */
function ownText(ctx: Ctx, kind: string, refId: bigint): string {
  if (withdrawn(ctx.db, kind, refId)) throw new SenderError('Una fuente del estilo está retirada.');
  if (kind === 'work') {
    const row = ctx.db.work.id.find(refId);
    if (!row || ![...ctx.db.workAuthor.workId.filter(refId)].some((a) => a.author.isEqual(memberIdentityFor(ctx)))) throw new SenderError('Solo puedes usar trabajos de los que eres autor.');
    return row.description;
  }
  if (kind === 'evidence') {
    const row = ctx.db.evidence.id.find(refId);
    if (!row || !row.author.isEqual(memberIdentityFor(ctx))) throw new SenderError('Solo puedes usar evidencias que publicaste.');
    return row.content;
  }
  const row = ctx.db.note.id.find(refId);
  if (!row || !row.author.isEqual(memberIdentityFor(ctx)) || row.source !== 'student') throw new SenderError('Solo puedes usar notas que escribiste.');
  return row.body;
}

export function enableAgent(ctx: Ctx, input: { premisesVersion: number }) {
  activeMember(ctx);
  if (input.premisesVersion !== AGENT_PREMISES_VERSION) throw new SenderError('Las premisas cambiaron. Léelas de nuevo antes de aceptar.');
  const current = ctx.db.agentProfile.owner.find(memberIdentityFor(ctx));
  if (current) { ctx.db.agentProfile.owner.update({ ...current, premisesVersion: input.premisesVersion, consentAt: ctx.timestamp, version: current.version + 1, updatedAt: ctx.timestamp }); return; }
  ctx.db.agentProfile.insert({ owner: memberIdentityFor(ctx), premisesVersion: input.premisesVersion, consentAt: ctx.timestamp, styleVersion: 0, version: 1, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
}

export function trainAgent(ctx: Ctx, input: { sources: string; expectedStyleVersion: number }) {
  const profile = profileOf(ctx); expectVersion(profile.styleVersion, input.expectedStyleVersion);
  const refs = check(() => cleanAgentSources(json(input.sources)));
  const used = refs.map((ref) => { const refId = numericId(ref.refId); const text = ownText(ctx, ref.kind, refId); return { kind: ref.kind, refId, text, refVersion: targetVersion(ctx, ref.kind, refId) }; });
  for (const row of [...ctx.db.agentStyleSource.owner.filter(memberIdentityFor(ctx))]) ctx.db.agentStyleSource.key.delete(row.key);
  for (const ref of used) ctx.db.agentStyleSource.insert({ key: `${memberIdentityFor(ctx).toHexString()}:${ref.kind}:${ref.refId}`, owner: memberIdentityFor(ctx), kind: ref.kind, refId: ref.refId, refVersion: ref.refVersion, addedAt: ctx.timestamp });
  const texts = used.map((ref) => ref.text); const features = styleFeatures(texts); const version = profile.styleVersion + 1;
  ctx.db.agentStyleSnapshot.insert({ id: 0n, owner: memberIdentityFor(ctx), version, features: JSON.stringify({ ...features, ...describeStyle(features) }),
    examples: JSON.stringify(texts.flatMap((text) => proseSentences(text)).slice(0, 2)), sources: JSON.stringify(used.map((ref) => ({ kind: ref.kind, refId: ref.refId.toString(), refVersion: ref.refVersion }))), createdAt: ctx.timestamp });
  const snapshots = [...ctx.db.agentStyleSnapshot.owner.filter(memberIdentityFor(ctx))].sort((a, b) => b.version - a.version);
  for (const old of snapshots.slice(AGENT_LIMITS.snapshotsKept)) ctx.db.agentStyleSnapshot.id.delete(old.id);
  ctx.db.agentProfile.owner.update({ ...profile, styleVersion: version, version: profile.version + 1, updatedAt: ctx.timestamp });
}

export function startAgentSession(ctx: Ctx, input: { assignmentId: bigint; requestId: string }) {
  profileOf(ctx); const requestId = requireText(input.requestId, 'La solicitud', 128);
  const prior = [...ctx.db.agentSession.owner.filter(memberIdentityFor(ctx))].find((row) => row.requestId === requestId);
  if (prior) { if (prior.assignmentId !== input.assignmentId) throw new SenderError('Este envío ya se utilizó para otra tarea.'); return; }
  if (!ctx.db.assignment.id.find(input.assignmentId)) throw new SenderError('La tarea no existe.');
  const row = ctx.db.agentSession.insert({ id: 0n, owner: memberIdentityFor(ctx), assignmentId: input.assignmentId, requestId, stage: 'understand', draft: '', draftVersion: 0, generation: 0, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
  touch(ctx, row, {});
}

export function saveAgentDraft(ctx: Ctx, input: { sessionId: bigint; expectedDraftVersion: number; stage: string; draft: string }) {
  const session = sessionOf(ctx, input.sessionId); expectVersion(session.draftVersion, input.expectedDraftVersion);
  const stage = check(() => cleanAgentStage(input.stage)); const draft = check(() => cleanAgentDraft(input.draft));
  if (draft === session.draft && stage === session.stage) return;
  touch(ctx, session, { stage, draft, draftVersion: draft === session.draft ? session.draftVersion : session.draftVersion + 1 });
}

export function proposeAgentSuggestions(ctx: Ctx, input: { sessionId: bigint; draftVersion: number; suggestions: string }) {
  const session = sessionOf(ctx, input.sessionId); expectVersion(session.draftVersion, input.draftVersion);
  const suggestions = check(() => cleanAgentSuggestions(json(input.suggestions), session.draft));
  for (const old of [...ctx.db.agentSuggestion.sessionId.filter(session.id)]) if (old.state === 'proposed') ctx.db.agentSuggestion.id.delete(old.id);
  for (const s of suggestions) ctx.db.agentSuggestion.insert({ id: 0n, sessionId: session.id, owner: memberIdentityFor(ctx), draftVersion: session.draftVersion, ...s, state: 'proposed', createdAt: ctx.timestamp, resolvedAt: undefined });
  touch(ctx, session, {});
}

export function resolveAgentSuggestion(ctx: Ctx, input: { suggestionId: bigint; accept: boolean }) {
  activeMember(ctx); const row = ctx.db.agentSuggestion.id.find(input.suggestionId);
  if (!row || !row.owner.isEqual(memberIdentityFor(ctx))) throw new SenderError('La sugerencia no existe.');
  if (row.state !== 'proposed') return;
  const session = sessionOf(ctx, row.sessionId);
  const accept = input.accept && !!row.original;
  if (accept) {
    if (row.draftVersion !== session.draftVersion) throw new SenderError('El borrador cambió y la sugerencia ya no aplica.');
    touch(ctx, session, { draft: check(() => applyAgentSuggestion(session.draft, row)), draftVersion: session.draftVersion + 1 });
  }
  ctx.db.agentSuggestion.id.update({ ...row, state: accept ? 'accepted' : 'rejected', resolvedAt: ctx.timestamp });
}

/** Lo que el grupo ya puede leer y no es de la persona: trabajos y evidencias no retirados. */
function publishedForComparison(ctx: Ctx) {
  const name = (person: Person) => ctx.db.member.identity.find(person)?.displayName ?? 'Compañero';
  const works = [...ctx.db.work.iter()].flatMap((row) => {
    const authors = [...ctx.db.workAuthor.workId.filter(row.id)].map((a) => a.author);
    if (!row.description.trim() || withdrawn(ctx.db, 'work', row.id) || authors.some((a) => a.isEqual(memberIdentityFor(ctx)))) return [];
    return [{ refKey: `work:${row.id}`, title: row.title || ctx.db.assignment.id.find(row.assignmentId)?.title || 'Trabajo', authorName: authors.map(name).join(', '), text: row.description }];
  });
  const evidences = [...ctx.db.evidence.iter()].flatMap((row) => {
    if (!row.content.trim() || withdrawn(ctx.db, 'evidence', row.id) || row.author.isEqual(memberIdentityFor(ctx)) || row.participants.some((p) => p.isEqual(memberIdentityFor(ctx)))) return [];
    return [{ refKey: `evidence:${row.id}`, title: 'Evidencia', authorName: name(row.author), text: row.content }];
  });
  return [...works, ...evidences];
}

export function checkAgentOriginality(ctx: Ctx, input: { sessionId: bigint; draftVersion: number }) {
  const session = sessionOf(ctx, input.sessionId); expectVersion(session.draftVersion, input.draftVersion);
  if (!session.draft.trim()) throw new SenderError('Escribe tu borrador antes de compararlo.');
  const assignment = ctx.db.assignment.id.find(session.assignmentId);
  const matches = compareWithPublished(session.draft, publishedForComparison(ctx), { ignore: assignment ? [assignment.title, assignment.instructions] : [] })
    .map(({ refKey, title, authorName, result }) => ({ refKey, title, authorName, status: result.status, score: result.score, level: result.level, pairs: result.pairs, excluded: result.excluded }));
  ctx.db.agentOriginalityCheck.insert({ id: 0n, sessionId: session.id, owner: memberIdentityFor(ctx), draftVersion: session.draftVersion, matches: JSON.stringify(matches), acknowledged: [], createdAt: ctx.timestamp });
  const checks = [...ctx.db.agentOriginalityCheck.sessionId.filter(session.id)].sort((a, b) => Number(b.id - a.id));
  for (const old of checks.slice(AGENT_LIMITS.checksKept)) ctx.db.agentOriginalityCheck.id.delete(old.id);
  touch(ctx, session, {});
}

export function acknowledgeAgentMatch(ctx: Ctx, input: { checkId: bigint; refKey: string }) {
  activeMember(ctx); const row = ctx.db.agentOriginalityCheck.id.find(input.checkId);
  if (!row || !row.owner.isEqual(memberIdentityFor(ctx))) throw new SenderError('La comparación no existe.');
  const matches = JSON.parse(row.matches) as { refKey: string }[];
  if (!matches.some((m) => m.refKey === input.refKey)) throw new SenderError('Esa coincidencia no está en la comparación.');
  if (!row.acknowledged.includes(input.refKey)) ctx.db.agentOriginalityCheck.id.update({ ...row, acknowledged: [...row.acknowledged, input.refKey] });
}

function deleteSession(db: Ctx['db'], sessionId: bigint) {
  for (const row of [...db.agentSuggestion.sessionId.filter(sessionId)]) db.agentSuggestion.id.delete(row.id);
  for (const row of [...db.agentOriginalityCheck.sessionId.filter(sessionId)]) db.agentOriginalityCheck.id.delete(row.id);
  for (const row of [...db.agentExpiry.sessionId.filter(sessionId)]) db.agentExpiry.id.delete(row.id);
  purgeAgentAiRuns(db, { sessionId });
  db.agentSession.id.delete(sessionId);
}

export function deleteAgentSession(ctx: Ctx, input: { sessionId: bigint }) { sessionOf(ctx, input.sessionId); deleteSession(ctx.db, input.sessionId); }

/** Borra todo lo del agente de una persona: al desactivarlo o al darla de baja. */
export function purgeAgentOwner(db: Ctx['db'], owner: Person) {
  if (!db.agentProfile) return;
  for (const row of [...db.agentSession.owner.filter(owner)]) deleteSession(db, row.id);
  for (const row of [...db.agentStyleSource.owner.filter(owner)]) db.agentStyleSource.key.delete(row.key);
  for (const row of [...db.agentStyleSnapshot.owner.filter(owner)]) db.agentStyleSnapshot.id.delete(row.id);
  purgeAgentAiRuns(db, { owner });
  db.agentProfile.owner.delete(owner);
}
export function disableAgent(ctx: Ctx) { activeMember(ctx); purgeAgentOwner(ctx.db, memberIdentityFor(ctx)); }

/** Al purgar contenido retirado se olvida como fuente y se quita de las comparaciones guardadas. */
export function purgeAgentSource(db: Ctx['db'], kind: string, id: bigint) {
  if (!['work', 'evidence', 'note'].includes(kind) || !db.agentStyleSource) return;
  for (const row of [...db.agentStyleSource.iter()]) if (row.kind === kind && row.refId === id) db.agentStyleSource.key.delete(row.key);
  const refKey = `${kind}:${id}`;
  purgeAgentAiRuns(db, { refKey });
  for (const row of [...db.agentOriginalityCheck.iter()]) {
    const matches = JSON.parse(row.matches) as { refKey: string }[];
    if (matches.some((m) => m.refKey === refKey)) db.agentOriginalityCheck.id.update({ ...row, matches: JSON.stringify(matches.filter((m) => m.refKey !== refKey)), acknowledged: row.acknowledged.filter((key) => key !== refKey) });
  }
}

export function expireAgentSession(ctx: Ctx, event: { sessionId: bigint; generation: number }) {
  if (!memberIdentityFor(ctx).isEqual(ctx.identity)) throw new SenderError('Solo el programador interno puede vencer sesiones.');
  const session = ctx.db.agentSession.id.find(event.sessionId);
  if (session?.generation === event.generation) deleteSession(ctx.db, session.id);
}
