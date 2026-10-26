import { sha256 } from '@noble/hashes/sha2.js';
import { Timestamp, type Identity } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { aiRecord, aiUuid } from '../../core/src/ai';
import { PRESENTATION_AUDIO_LIMITS, presentationAudioMime, validatePresentationAudioDuration, validatePresentationAudioSize, type PresentationAudio } from '../../core/src/presentationMedia';
import { activeMember, isActive, expectVersion, type Ctx } from './moduleContext';
import { memberIdentityFor } from './authIdentity';
import { isAiService } from './aiHandlers';

export function presentationFailure(code: string, message: string): never { throw new SenderError(`${code}:${message}`); }
export function presentationRecord(value: unknown): Record<string, unknown> { if (!aiRecord(value)) presentationFailure('invalid', 'Solicitud inválida.'); return value; }
export function presentationId(value: unknown): string { if (!aiUuid(value)) presentationFailure('invalid', 'Identificador inválido.'); return value.toLowerCase(); }
export function presentationDecimal(value: unknown): bigint {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value) || BigInt(value) > 0xffffffffffffffffn) presentationFailure('invalid', 'Referencia inválida.'); return BigInt(value);
}
export function presentationOwnedAttempt(ctx: Ctx, attemptId: bigint, person = memberIdentityFor(ctx), archived = false) {
  const attempt = ctx.db.presentationAttempt.id.find(attemptId); const practice = attempt && ctx.db.presentationPractice.id.find(attempt.practiceId);
  if (!attempt || !practice || !isActive(ctx.db, person) || !practice.ownerId.isEqual(person) || (!archived && practice.archived)) presentationFailure('unauthorized', 'El intento no está disponible.');
  return { attempt, practice };
}
function quota(ctx: Ctx) {
  return ctx.db.resourceCapacity.id.find(0) ?? ctx.db.resourceCapacity.insert({ id: 0, limitBytes: 256n * 1024n * 1024n, reservedBytes: 0n });
}
function hash(bytes: Uint8Array): string { return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''); }
function upload(ctx: Ctx, id: unknown) { const row = ctx.db.presentationAudioUpload.id.find(presentationId(id)); if (!row) presentationFailure('unavailable', 'El audio no está disponible.'); return row; }
function owner(ctx: Ctx, row: ReturnType<typeof upload>, archived = false) { return presentationOwnedAttempt(ctx, row.attemptId, memberIdentityFor(ctx), archived); }
function readable(ctx: Ctx, row: ReturnType<typeof upload>, person = memberIdentityFor(ctx)) {
  if (!isActive(ctx.db, person) || !isActive(ctx.db, row.actor)) presentationFailure('unauthorized', 'El audio no está disponible.');
  const attempt = ctx.db.presentationAttempt.id.find(row.attemptId); const practice = attempt && ctx.db.presentationPractice.id.find(attempt.practiceId);
  if (!attempt || !practice) presentationFailure('unavailable', 'El intento ya no está disponible.');
  if (practice.ownerId.isEqual(person)) return;
  const grant = ctx.db.presentationAudioGrant.uploadId.find(row.id);
  if (!grant || !grant.reviewer.isEqual(person) || !practice.reviewerId?.isEqual(person) || practice.archived || attempt.status !== 'completed' || row.state !== 'ready') presentationFailure('unauthorized', 'El audio no fue compartido contigo.');
}
function dto(ctx: Ctx, row: ReturnType<typeof upload>): PresentationAudio {
  const practice = ctx.db.presentationAttempt.id.find(row.attemptId); const reviewer = practice && ctx.db.presentationPractice.id.find(practice.practiceId)?.reviewerId;
  return { id: row.id, attemptId: String(row.attemptId), name: row.name, mime: row.mime, bytes: Number(row.bytes), sha256: row.sha256,
    state: row.state as PresentationAudio['state'], chunkCount: row.chunkCount, durationSeconds: row.durationSeconds,
    received: [...ctx.db.presentationAudioChunk.uploadId.filter(row.id)].map((chunk) => chunk.index).sort((a, b) => a - b),
    shared: !!reviewer && ctx.db.presentationAudioGrant.uploadId.find(row.id)?.reviewer.isEqual(reviewer) === true };
}
function discard(ctx: Ctx, row: ReturnType<typeof upload>, state: 'deleted' | 'cancelled' | 'expired') {
  if (['pending', 'ready'].includes(row.state)) {
    const capacity = quota(ctx); ctx.db.resourceCapacity.id.update({ ...capacity, reservedBytes: capacity.reservedBytes >= row.bytes ? capacity.reservedBytes - row.bytes : 0n });
    for (const chunk of ctx.db.presentationAudioChunk.uploadId.filter(row.id)) ctx.db.presentationAudioChunk.key.delete(chunk.key);
  }
  ctx.db.presentationAudioGrant.uploadId.delete(row.id);
  ctx.db.presentationAudioUpload.id.update({ ...row, state });
  // Retain accepted independent transcripts/comments; unaccepted results copied from deleted audio are removed.
  for (const stored of ctx.db.presentationAiDraft.attemptId.filter(row.attemptId)) {
    const draft = JSON.parse(stored.json) as { state: string; context: { audio?: { id: string } }; result?: unknown };
    if (draft.context.audio?.id === row.id && draft.state !== 'accepted') ctx.db.presentationAiDraft.id.update({ ...stored, json: JSON.stringify({ ...draft, state: 'cancelled', result: undefined }) });
  }
}
export function expirePresentationAudio(ctx: Ctx): void {
  for (const row of ctx.db.presentationAudioUpload.iter()) if (row.state === 'pending' && row.expiresAt.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) discard(ctx, row, 'expired');
}
export function revokePresentationAudio(ctx: Ctx, practiceId: bigint): void {
  // Optional lookup preserves compatibility of test harnesses with the additive migration.
  if (!ctx.db.presentationAudioUpload) return;
  for (const attempt of ctx.db.presentationAttempt.practiceId.filter(practiceId)) for (const row of ctx.db.presentationAudioUpload.attemptId.filter(attempt.id)) ctx.db.presentationAudioGrant.uploadId.delete(row.id);
}
export function presentationHasReadyAudio(ctx: Ctx, attemptId: bigint): boolean {
  return !!ctx.db.presentationAudioUpload && [...ctx.db.presentationAudioUpload.attemptId.filter(attemptId)].some((row) => row.state === 'ready');
}
export function presentationAudioForAi(ctx: Ctx, attemptId: bigint, person: Identity) {
  presentationOwnedAttempt(ctx, attemptId, person); const row = [...ctx.db.presentationAudioUpload.attemptId.filter(attemptId)].find((audio) => audio.state === 'ready');
  return row ? { id: row.id, sha256: row.sha256, durationSeconds: row.durationSeconds!, mime: row.mime, bytes: Number(row.bytes) } : undefined;
}
export function presentationAudioBytes(ctx: Ctx, id: string, person: Identity): { bytes: Uint8Array; mime: string } {
  const row = upload(ctx, id); readable(ctx, row, person);
  if (row.state !== 'ready' && row.state !== 'pending') presentationFailure('unavailable', 'El audio fue eliminado.');
  const bytes = new Uint8Array(Number(row.bytes)); let offset = 0;
  for (let index = 0; index < row.chunkCount; index++) {
    const chunk = ctx.db.presentationAudioChunk.key.find(`${row.id}:${index}`); if (!chunk) presentationFailure('conflict', 'La subida todavía está incompleta.');
    bytes.set(chunk.bytes, offset); offset += chunk.bytes.byteLength;
  }
  if (offset !== bytes.byteLength || hash(bytes) !== row.sha256) presentationFailure('invalid', 'El audio no supera la comprobación de integridad.');
  return { bytes, mime: row.mime };
}
function dispatch(ctx: Ctx, raw: Record<string, unknown>): unknown {
  if (raw.action === 'serviceValidate') {
    if (!isAiService(ctx)) presentationFailure('unauthorized', 'Se requiere el validador de audio.');
    const row = upload(ctx, raw.id); if (raw.sha256 !== row.sha256) presentationFailure('conflict', 'El archivo cambió.');
    presentationOwnedAttempt(ctx, row.attemptId, row.actor); if (row.state === 'ready') return dto(ctx, row);
    if (row.state !== 'pending') presentationFailure('conflict', 'La subida ya no está disponible.');
    if (ctx.db.presentationAttempt.id.find(row.attemptId)?.status !== 'draft') presentationFailure('conflict', 'El intento ya está concluido.');
    presentationAudioBytes(ctx, row.id, row.actor); validatePresentationAudioDuration(Number(raw.durationSeconds));
    const mime = presentationAudioMime(String(raw.mime));
    ctx.db.presentationAudioUpload.id.update({ ...row, state: 'ready', mime, durationSeconds: Number(raw.durationSeconds) });
    return dto(ctx, ctx.db.presentationAudioUpload.id.find(row.id)!);
  }
  activeMember(ctx); expirePresentationAudio(ctx);
  if (raw.action === 'list') {
    const attemptId = presentationDecimal(raw.attemptId); const attempt = ctx.db.presentationAttempt.id.find(attemptId);
    const practice = attempt && ctx.db.presentationPractice.id.find(attempt.practiceId);
    if (!attempt || !practice || !isActive(ctx.db, practice.ownerId) || (!practice.ownerId.isEqual(memberIdentityFor(ctx)) && (!practice.reviewerId?.isEqual(memberIdentityFor(ctx)) || practice.archived || attempt.status !== 'completed'))) presentationFailure('unauthorized', 'El intento no está disponible.');
    return [...ctx.db.presentationAudioUpload.attemptId.filter(attemptId)].filter((row) => {
      if (practice.ownerId.isEqual(memberIdentityFor(ctx))) return row.state !== 'cancelled' && row.state !== 'expired';
      try { readable(ctx, row); return true; } catch { return false; }
    }).map((row) => dto(ctx, row));
  }
  if (raw.action === 'begin') {
    const id = presentationId(raw.id); const attemptId = presentationDecimal(raw.attemptId); const { attempt } = presentationOwnedAttempt(ctx, attemptId);
    validatePresentationAudioSize(Number(raw.bytes)); const mime = presentationAudioMime(String(raw.mime));
    if (typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256) || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 200) presentationFailure('invalid', 'Nombre o huella inválidos.');
    const previous = ctx.db.presentationAudioUpload.id.find(id);
    if (previous) {
      if (!previous.actor.isEqual(memberIdentityFor(ctx)) || previous.attemptId !== attemptId || previous.bytes !== BigInt(Number(raw.bytes)) || previous.sha256 !== raw.sha256 || previous.name !== raw.name.trim() || previous.mime !== mime) presentationFailure('conflict', 'El envío ya pertenece a otro audio.');
      return dto(ctx, previous);
    }
    if (attempt.status !== 'draft') presentationFailure('conflict', 'Un intento concluido no admite reemplazar el audio.');
    expectVersion(attempt.version, Number(raw.expectedVersion));
    if ([...ctx.db.presentationAudioUpload.attemptId.filter(attemptId)].some((row) => row.state === 'ready' || row.state === 'pending')) presentationFailure('conflict', 'Solo se admite un audio por intento; elimina o descarta el anterior.');
    const capacity = quota(ctx); const bytes = BigInt(Number(raw.bytes));
    if (capacity.reservedBytes + bytes > capacity.limitBytes) presentationFailure('quota', 'No queda espacio compartido para este audio.');
    ctx.db.resourceCapacity.id.update({ ...capacity, reservedBytes: capacity.reservedBytes + bytes });
    return dto(ctx, ctx.db.presentationAudioUpload.insert({ id, actor: memberIdentityFor(ctx), attemptId, name: raw.name.trim(), mime, bytes, sha256: raw.sha256,
      state: 'pending', chunkCount: Math.ceil(Number(bytes) / PRESENTATION_AUDIO_LIMITS.chunkBytes), durationSeconds: undefined,
      createdAt: ctx.timestamp, expiresAt: new Timestamp(ctx.timestamp.microsSinceUnixEpoch + BigInt(PRESENTATION_AUDIO_LIMITS.ttlMs) * 1000n) }));
  }
  const row = upload(ctx, raw.id);
  if (raw.action === 'chunk' || raw.action === 'validationChunk' || raw.action === 'get' || raw.action === 'validateInfo') {
    readable(ctx, row); if (raw.action === 'get' || raw.action === 'validateInfo') return dto(ctx, row);
    if (raw.action === 'validationChunk') owner(ctx, row);
    if (row.state !== 'ready' && !(raw.action === 'validationChunk' && row.state === 'pending')) presentationFailure('unavailable', 'El audio no está listo.');
    if (!Number.isInteger(raw.index) || Number(raw.index) < 0 || Number(raw.index) >= row.chunkCount) presentationFailure('invalid', 'Bloque inválido.');
    const chunk = ctx.db.presentationAudioChunk.key.find(`${row.id}:${raw.index}`); if (!chunk) presentationFailure('unavailable', 'Falta un bloque del audio.');
    return { index: chunk.index, bytes: Array.from(chunk.bytes), sha256: chunk.sha256 };
  }
  const { attempt, practice } = owner(ctx, row, raw.action === 'delete');
  if (raw.action === 'delete' || raw.action === 'cancel') { if (raw.action === 'cancel' && (attempt.status !== 'draft' || row.state !== 'pending')) presentationFailure('conflict', 'Solo se descartan subidas pendientes.'); discard(ctx, row, raw.action === 'delete' ? 'deleted' : 'cancelled'); return dto(ctx, ctx.db.presentationAudioUpload.id.find(row.id)!); }
  if (raw.action === 'share') {
    if (row.state !== 'ready' || attempt.status !== 'completed' || !practice.reviewerId || !isActive(ctx.db, practice.reviewerId)) presentationFailure('conflict', 'Concluye el intento e invita a un revisor antes de compartir el audio.');
    ctx.db.presentationAudioGrant.uploadId.delete(row.id);
    if (raw.shared === true) ctx.db.presentationAudioGrant.insert({ uploadId: row.id, reviewer: practice.reviewerId, grantedAt: ctx.timestamp });
    return dto(ctx, row);
  }
  if (attempt.status !== 'draft' || row.state !== 'pending') presentationFailure('conflict', 'El audio ya quedó conservado.');
  if (raw.action === 'putChunk') {
    if (!Number.isInteger(raw.index) || Number(raw.index) < 0 || Number(raw.index) >= row.chunkCount || !Array.isArray(raw.bytes)) presentationFailure('invalid', 'Bloque inválido.');
    const expected = Math.min(PRESENTATION_AUDIO_LIMITS.chunkBytes, Number(row.bytes) - Number(raw.index) * PRESENTATION_AUDIO_LIMITS.chunkBytes);
    if (raw.bytes.length !== expected || raw.bytes.some((value) => !Number.isInteger(value) || Number(value) < 0 || Number(value) > 255)) presentationFailure('invalid', 'Tamaño de bloque inválido.');
    const bytes = Uint8Array.from(raw.bytes as number[]); if (hash(bytes) !== raw.sha256) presentationFailure('invalid', 'El bloque no supera la comprobación de integridad.');
    const key = `${row.id}:${raw.index}`; const previous = ctx.db.presentationAudioChunk.key.find(key);
    if (previous && previous.sha256 !== raw.sha256) presentationFailure('conflict', 'Un bloque recibido no puede cambiar.');
    if (!previous) ctx.db.presentationAudioChunk.insert({ key, uploadId: row.id, index: Number(raw.index), bytes, sha256: String(raw.sha256) });
    return dto(ctx, row);
  }
  return presentationFailure('invalid', 'Operación de audio no admitida.');
}
export function presentationMediaResponse(ctx: Ctx, payload: string): string {
  if (payload.length > 5 * 1024 * 1024) presentationFailure('invalid', 'Solicitud demasiado grande.');
  try { return JSON.stringify(dispatch(ctx, presentationRecord(JSON.parse(payload)))); }
  catch (error) { if (error instanceof SenderError) throw error; if (error instanceof Error) return presentationFailure('invalid', error.message); throw error; }
}
