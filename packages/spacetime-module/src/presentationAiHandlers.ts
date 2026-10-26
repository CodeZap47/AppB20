import { Identity } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { aiHash, sanitizeAiText } from '../../core/src/ai';
import { presentationAiFingerprint, estimatePresentationAiTokens, validatePresentationAiPurpose, validatePresentationAiResult,
  type PresentationAiDraft, type PresentationAiContext, type PresentationAiTranscript, type PresentationAiResult } from '../../core/src/presentationAi';
import { activeMember, expectVersion, isActive, type Ctx } from './moduleContext';
import { memberIdentityFor } from './authIdentity';
import { isAiService, resolveAiSource } from './aiHandlers';
import { reserveAiQuota, settleAiQuota } from './aiQuota';
import { presentationAudioForAi, presentationOwnedAttempt, presentationDecimal, presentationFailure as fail,
  presentationId as uuid, presentationRecord as record } from './presentationMediaHandlers';

const now = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
function actor(value: unknown) { if (typeof value !== 'string' || !/^(0x)?[a-f0-9]{64}$/i.test(value)) fail('invalid', 'Identidad inválida.'); return Identity.fromString(value); }
function service(ctx: Ctx) { if (!isAiService(ctx)) fail('unauthorized', 'Operación exclusiva del servicio de IA.'); }
function parse(row: { json: string }): PresentationAiDraft { return JSON.parse(row.json) as PresentationAiDraft; }
function owned(ctx: Ctx, id: unknown, person = memberIdentityFor(ctx), archived = false) {
  const row = ctx.db.presentationAiDraft.id.find(uuid(id)); if (!row || !row.actor.isEqual(person) || !isActive(ctx.db, person)) fail('unauthorized', 'El borrador no está disponible.');
  const draft = parse(row); presentationOwnedAttempt(ctx, presentationDecimal(draft.context.attemptId), person, archived); return { row, draft };
}
function save(ctx: Ctx, draft: PresentationAiDraft) {
  const next = { ...draft, revision: draft.revision + 1 }; const row = ctx.db.presentationAiDraft.id.find(draft.id)!;
  ctx.db.presentationAiDraft.id.update({ ...row, json: JSON.stringify(next) }); return next;
}
function context(ctx: Ctx, attemptId: bigint, person: Identity): PresentationAiContext {
  const { attempt } = presentationOwnedAttempt(ctx, attemptId, person);
  let material: PresentationAiContext['material'];
  if (attempt.sourceKind && attempt.sourceId) {
    const source = resolveAiSource(ctx, attempt.sourceKind, String(attempt.sourceId), person);
    if (source.subjectId !== String(attempt.subjectId) || source.version !== attempt.sourceVersion) fail('source_changed', 'La referencia cambió; crea un nuevo intento para usar su versión actual.');
    const text = source.fields.map((field) => sanitizeAiText(field.text)).join('\n');
    if (text.length > 40_000) fail('quota', 'La referencia supera 40 000 caracteres; elige un material más breve.');
    material = { kind: attempt.sourceKind as 'note' | 'guide', id: String(attempt.sourceId), version: source.version, text, hash: aiHash(source) };
  }
  const transcript = [...ctx.db.presentationAiDraft.attemptId.filter(attemptId)].map(parse).filter((draft) => draft.purpose === 'transcription' && draft.state === 'accepted')
    .sort((a, b) => (b.acceptedAt ?? 0) - (a.acceptedAt ?? 0))[0]?.result as PresentationAiTranscript | undefined;
  return { practiceId: String(attempt.practiceId), attemptId: String(attemptId), attemptVersion: attempt.version,
    title: attempt.title, topic: attempt.topic, audience: attempt.audience, targetMinutes: attempt.targetMinutes, keyPoints: [...attempt.keyPoints],
    body: sanitizeAiText(attempt.body), material, transcript, audio: presentationAudioForAi(ctx, attemptId, person) };
}
function valid(ctx: Ctx, draft: PresentationAiDraft, person: Identity, exact = true) {
  const { attempt } = presentationOwnedAttempt(ctx, presentationDecimal(draft.context.attemptId), person, draft.state === 'accepted');
  if (draft.state === 'accepted') return;
  if (exact) expectVersion(attempt.version, draft.context.attemptVersion);
  if (draft.context.audio) {
    const audio = ctx.db.presentationAudioUpload.id.find(draft.context.audio.id);
    if (!audio || audio.state !== 'ready' || audio.sha256 !== draft.context.audio.sha256) fail('source_changed', 'El audio fue eliminado o cambió.');
  }
  if (draft.context.material) {
    const source = resolveAiSource(ctx, draft.context.material.kind, draft.context.material.id, person);
    if (aiHash(source) !== draft.context.material.hash) fail('source_changed', 'La referencia cambió; prepara nuevamente.');
  }
}
function readableDraft(ctx: Ctx, draft: PresentationAiDraft): PresentationAiDraft {
  if (!draft.context.material) return draft;
  try { resolveAiSource(ctx, draft.context.material.kind, draft.context.material.id, memberIdentityFor(ctx)); return draft; }
  catch { return { ...draft, context: { ...draft.context, material: { ...draft.context.material, text: '[Fuente no disponible]' } },
    ...(draft.state === 'accepted' ? {} : { result: undefined }), error: 'La referencia ya no está disponible. Crea una preparación con material accesible.' }; }
}
function expire(ctx: Ctx, draft: PresentationAiDraft): PresentationAiDraft {
  if (draft.state === 'running' && draft.startedAt !== undefined && draft.startedAt + 90_000 <= now(ctx)) {
    if (draft.generationId) settleAiQuota(ctx, actor(draft.actor), draft.generationId, undefined, 'unknown');
    return save(ctx, { ...draft, state: 'unknown', error: 'No se conoce el resultado. Consulta el estado antes de crear otro envío.' });
  }
  return draft;
}
function dispatch(ctx: Ctx, raw: Record<string, unknown>): unknown {
  if (raw.action === 'claim') {
    service(ctx); const person = actor(raw.actor); const { draft } = owned(ctx, raw.id, person); valid(ctx, draft, person);
    const generationId = uuid(raw.generationId); const existing = ctx.db.aiGeneration.id.find(generationId);
    if (existing) {
      if (!existing.actor.isEqual(person) || existing.preparationId !== draft.id) fail('conflict', 'El envío pertenece a otra operación.');
      return { claimed: false, draft: expire(ctx, draft) };
    }
    if (draft.state !== 'prepared' || draft.generationId !== generationId) fail('conflict', 'El envío no está autorizado.');
    const key = ctx.db.aiKey.actor.find(person); if (!key || key.keyId !== draft.keyId) fail('key_changed', 'La clave cambió; vuelve a preparar.');
    const claim = reserveAiQuota(ctx, person, generationId, draft.estimatedTokens, { preparationId: draft.id, model: draft.model,
      purpose: `presentation_${draft.purpose}`, requestHash: draft.fingerprint, acknowledgeUnknown: draft.acknowledgeUnknown });
    if (!claim.claimed) return { claimed: false, draft };
    return { claimed: true, key: { keyId: claim.key.keyId, provider: 'gemini', ciphertext: claim.key.ciphertext, iv: claim.key.iv, masterVersion: claim.key.masterVersion }, draft: save(ctx, { ...draft, state: 'running', startedAt: now(ctx) }) };
  }
  if (raw.action === 'finish') {
    service(ctx); const person = actor(raw.actor); const { row, draft } = owned(ctx, raw.id, person, true); const generationId = uuid(raw.generationId);
    const generation = ctx.db.aiGeneration.id.find(generationId);
    if (!generation || !generation.actor.isEqual(person) || generation.preparationId !== draft.id || draft.generationId !== generationId) fail('conflict', 'El envío no corresponde a este borrador.');
    if (!['succeeded', 'failed', 'unknown'].includes(String(raw.state))) fail('invalid', 'Estado final inválido.');
    if (generation.status !== 'running') return draft;
    let state = raw.state as 'succeeded' | 'failed' | 'unknown'; let result: PresentationAiResult | undefined;
    let error = state === 'succeeded' ? undefined : typeof raw.errorMessage === 'string' ? raw.errorMessage.slice(0, 500) : 'El envío no terminó.';
    if (state === 'succeeded' && draft.state !== 'cancelled') {
      try { valid(ctx, draft, person); result = validatePresentationAiResult(raw.result, draft.purpose, draft.context); }
      catch { state = 'failed'; error = 'El resultado no es válido o el material ya no está disponible.'; }
    }
    let usage: PresentationAiDraft['usage'];
    if (raw.usage !== undefined) { const value = record(raw.usage); if (![value.inputTokens, value.outputTokens].every((count) => Number.isInteger(count) && Number(count) >= 0 && Number(count) <= 10_000_000)) fail('invalid', 'Consumo inválido.'); usage = { inputTokens: Number(value.inputTokens), outputTokens: Number(value.outputTokens) }; }
    settleAiQuota(ctx, person, generationId, usage, state);
    ctx.db.aiGeneration.id.update({ ...ctx.db.aiGeneration.id.find(generationId)!, resultJson: result ? JSON.stringify(result) : '', errorCode: state === 'succeeded' ? '' : state, errorMessage: error ?? '' });
    if (parse(ctx.db.presentationAiDraft.id.find(row.id)!).state === 'cancelled') return draft;
    return save(ctx, { ...draft, state, result, error, usage });
  }
  activeMember(ctx);
  if (raw.action === 'prepare') {
    const id = uuid(raw.id); const attemptId = presentationDecimal(raw.attemptId); const purpose = validatePresentationAiPurpose(raw.purpose);
    const previous = ctx.db.presentationAiDraft.id.find(id);
    if (previous) {
      if (!previous.actor.isEqual(memberIdentityFor(ctx)) || previous.attemptId !== attemptId || parse(previous).purpose !== purpose) fail('conflict', 'Este envío ya pertenece a otra operación.');
      const draft = parse(previous); valid(ctx, draft, memberIdentityFor(ctx), false); return draft;
    }
    const { attempt } = presentationOwnedAttempt(ctx, attemptId); expectVersion(attempt.version, Number(raw.expectedVersion));
    if ((purpose === 'outline' && attempt.status !== 'draft') || (purpose !== 'outline' && attempt.status !== 'completed')) fail('conflict', purpose === 'outline' ? 'El esquema se aplica a un borrador.' : 'Concluye el intento antes de pedir esta ayuda.');
    if ([...ctx.db.presentationAiDraft.actor.filter(memberIdentityFor(ctx))].length >= 200) fail('quota', 'Se alcanzó el límite de borradores privados de exposiciones.');
    const input = context(ctx, attemptId, memberIdentityFor(ctx));
    if (purpose === 'transcription' && !input.audio) fail('invalid', 'Este intento no tiene audio confirmado.');
    if (purpose !== 'outline' && purpose !== 'transcription' && !input.body.trim() && !input.transcript) fail('invalid', 'Acepta primero la transcripción o utiliza una explicación escrita.');
    // Only transcription uses raw audio. Feedback can cite timestamps using the accepted transcript.
    if (purpose !== 'transcription' && purpose !== 'feedback') input.audio = undefined;
    if (purpose === 'feedback' && !input.transcript) input.audio = undefined;
    if (typeof raw.model !== 'string' || !/^[a-zA-Z0-9._-]{1,200}$/.test(raw.model)) fail('invalid', 'Modelo inválido.');
    const draft: PresentationAiDraft = { id, actor: memberIdentityFor(ctx).toHexString(), purpose, state: 'prepared', revision: 1,
      context: input, fingerprint: presentationAiFingerprint(input, purpose), model: raw.model, estimatedTokens: estimatePresentationAiTokens(input), createdAt: now(ctx), expiresAt: now(ctx) + 30 * 60_000 };
    ctx.db.presentationAiDraft.insert({ id, actor: memberIdentityFor(ctx), attemptId, json: JSON.stringify(draft) }); return draft;
  }
  if (raw.action === 'list') {
    const attemptId = presentationDecimal(raw.attemptId); presentationOwnedAttempt(ctx, attemptId, memberIdentityFor(ctx), true);
    return [...ctx.db.presentationAiDraft.attemptId.filter(attemptId)].map(parse).map((draft) => expire(ctx, draft)).filter((draft) => draft.state !== 'cancelled')
      .map(({ id, purpose, state, revision, createdAt }) => ({ id, purpose, state, revision, createdAt }));
  }
  const { draft: original } = owned(ctx, raw.id, memberIdentityFor(ctx), raw.action === 'get' || raw.action === 'cancel'); const draft = expire(ctx, original);
  if (raw.action === 'get') { valid(ctx, draft, memberIdentityFor(ctx), false); return readableDraft(ctx, draft); }
  if (raw.action === 'cancel') {
    if (draft.state === 'accepted') fail('conflict', 'El resultado ya fue aceptado.');
    if (draft.state === 'cancelled') return draft;
    expectVersion(draft.revision, Number(raw.expectedRevision)); return save(ctx, { ...draft, state: 'cancelled', result: undefined });
  }
  if (raw.action === 'authorize') {
    if (draft.generationId === raw.generationId && ['prepared', 'running', 'succeeded', 'failed', 'unknown'].includes(draft.state)) { valid(ctx, draft, memberIdentityFor(ctx), false); return { actor: draft.actor, draft }; }
    expectVersion(draft.revision, Number(raw.expectedRevision));
    valid(ctx, draft, memberIdentityFor(ctx));
    if (draft.state !== 'prepared' || draft.generationId) fail('conflict', 'Consulta este envío; una operación no se vuelve a enviar.');
    if (raw.allowNew !== true) fail('disabled', 'La generación todavía no está habilitada.');
    if (raw.confirmed !== true || raw.fingerprint !== draft.fingerprint || raw.model !== draft.model) fail('consent', 'Revisa y confirma esta vista previa.');
    if (draft.expiresAt <= now(ctx)) fail('expired', 'La vista previa venció.');
    const key = ctx.db.aiKey.actor.find(memberIdentityFor(ctx)); if (!key) fail('key_required', 'Configura tu clave personal.');
    return { actor: draft.actor, draft: save(ctx, { ...draft, generationId: uuid(raw.generationId), keyId: key.keyId, acknowledgeUnknown: raw.acknowledgeUnknown === true }) };
  }
  if (raw.action === 'accept') {
    const result = validatePresentationAiResult(raw.result ?? draft.result, draft.purpose, draft.context); const acceptanceHash = aiHash(result);
    if (draft.state === 'accepted') { if (draft.acceptanceHash !== acceptanceHash) fail('conflict', 'El resultado ya fue aceptado con otro contenido.'); return draft; }
    expectVersion(draft.revision, Number(raw.expectedRevision)); valid(ctx, draft, memberIdentityFor(ctx));
    if (raw.reviewed !== true || draft.state !== 'succeeded') fail('consent', 'Revisa el resultado antes de aceptarlo.');
    const { attempt } = presentationOwnedAttempt(ctx, presentationDecimal(draft.context.attemptId));
    if (draft.purpose === 'outline') {
      if (attempt.status !== 'draft') fail('conflict', 'El intento ya está concluido.');
      ctx.db.presentationAttempt.id.update({ ...attempt, body: (result as { outline: string }).outline, version: attempt.version + 1, updatedAt: ctx.timestamp });
    }
    if (draft.purpose === 'questions') {
      const questions = (result as { questions: string[] }).questions;
      if ([...ctx.db.presentationQuestion.attemptId.filter(attempt.id)].length + questions.length > 100) fail('quota', 'El intento admite hasta 100 preguntas.');
      for (const text of questions) ctx.db.presentationQuestion.insert({ id: 0n, attemptId: attempt.id, authorId: memberIdentityFor(ctx), kind: 'personal', text, answer: '', version: 1,
        requestId: `gemini:${draft.id}`, createdAt: ctx.timestamp, answeredAt: undefined });
    }
    return save(ctx, { ...draft, result, state: 'accepted', acceptedAt: now(ctx), acceptanceHash });
  }
  return fail('invalid', 'Operación de Exposiciones no admitida.');
}
export function presentationAiResponse(ctx: Ctx, payload: string): string {
  if (payload.length > 512 * 1024) fail('invalid', 'Solicitud demasiado grande.');
  try { return JSON.stringify(dispatch(ctx, record(JSON.parse(payload)))); }
  catch (error) { if (error instanceof SenderError) throw error; if (error instanceof Error) return fail('invalid', error.message); throw error; }
}

/** Purging an original removes its private snapshot without undoing accepted work. */
export function purgePresentationAiSource(ctx: Ctx, kind: string, id: bigint): void {
  for (const row of ctx.db.presentationAiDraft.iter()) {
    const draft = parse(row);
    if (draft.context.material?.kind !== kind || draft.context.material.id !== String(id)) continue;
    const accepted = draft.state === 'accepted';
    if (accepted && !draft.context.material.text) continue;
    const contextWithoutOriginal = { ...draft.context, material: accepted ? { ...draft.context.material, text: '' } : undefined };
    save(ctx, { ...draft, context: contextWithoutOriginal,
      ...(accepted ? {} : { state: 'cancelled', result: undefined, error: 'La referencia fue eliminada definitivamente. Prepara otro envío con material accesible.' }) });
    if (!accepted && draft.generationId) {
      const generation = ctx.db.aiGeneration.id.find(draft.generationId);
      if (generation?.actor.isEqual(row.actor)) ctx.db.aiGeneration.id.update({ ...generation, resultJson: '' });
    }
  }
}
