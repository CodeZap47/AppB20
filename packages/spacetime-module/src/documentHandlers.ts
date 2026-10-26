import { Identity } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { aiHash, aiRecord, type AiPreparation, type AiSourceRef, type AiSourceSnapshot } from '../../core/src/ai';
import { DOCUMENT_LIMITS, documentUuid, validateDocumentOcrInput, validateDocumentOcrResult, validateDocumentSegments,
  type DocumentFileMetadata, type DocumentOcrClaim, type DocumentOcrDraft, type DocumentTranscription } from '../../core/src/documentPreparation';
import { memberIdentityFor } from './authIdentity';
import { activeMember, expectVersion, isActive, targetVersion, type Ctx } from './moduleContext';
import { canReadTarget, withdrawn } from './delivery2Handlers';
import { isAiService } from './aiHandlers';
import { reserveAiQuota, settleAiQuota } from './aiQuota';

function fail(code: string, message: string): never { throw new SenderError(`${code}:${message}`); }
const now = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
function object(raw: unknown) { if (!aiRecord(raw)) fail('invalid', 'Se esperaba un objeto.'); return raw; }
function text(raw: unknown, max = 300): string { if (typeof raw !== 'string' || !raw.trim() || raw.length > max) fail('invalid', 'Referencia inválida.'); return raw; }
function actor(raw: unknown) { const value = text(raw, 66).replace(/^0x/u, ''); if (!/^[a-f\d]{64}$/iu.test(value)) fail('invalid', 'Identidad inválida.'); return Identity.fromString(value); }
function service(ctx: Ctx) { if (!isAiService(ctx)) fail('unauthorized', 'Solo el servicio puede verificar originales y registrar OCR.'); }
function fileRecord(ctx: Ctx, fileId: string, person: Identity) {
  let file = ctx.db.resourceFile.id.find(fileId);
  if (fileId.startsWith('legacy:')) {
    const suffix = fileId.slice(7); if (!/^[1-9]\d{0,19}$/u.test(suffix)) fail('invalid', 'Archivo heredado inválido.');
    const legacy = ctx.db.workFile.id.find(BigInt(suffix));
    if (!legacy) fail('unavailable', 'El adjunto ya no está disponible.');
    const duplicate = [...ctx.db.resourceFile.targetId.filter(legacy.workId)].find((f) => f.targetKind === 'work' && f.storageKey === legacy.storageKey);
    if (duplicate) file = duplicate;
    else file = { ...legacy, id: fileId, targetKind: 'work', targetId: legacy.workId, etag: '', removedAt: undefined };
  }
  if (!isActive(ctx.db, person) || !file || file.removedAt !== undefined || !['note', 'assignment', 'activity', 'work', 'evidence', 'question', 'answer'].includes(file.targetKind)
    || !canReadTarget(ctx.db, person, file.targetKind, file.targetId) || withdrawn(ctx.db, file.targetKind, file.targetId)) fail('unavailable', 'El documento no está disponible para esta cuenta.');
  if (file.size < 1n || file.size > BigInt(DOCUMENT_LIMITS.maxBytes)) fail('quota', 'Prepara documentos de hasta 10 MiB.');
  return file;
}
function stamp(file: ReturnType<typeof fileRecord>) { return aiHash({ id: file.id, storageKey: file.storageKey, etag: file.etag, size: String(file.size), kind: file.targetKind, targetId: String(file.targetId) }); }
function metadata(ctx: Ctx, fileId: string, person: Identity, requireHash = true): DocumentFileMetadata {
  const file = fileRecord(ctx, fileId, person);
  const native = file.storageKey.startsWith('stdb:') ? ctx.db.resourceUpload.id.find(file.storageKey.slice(5)) : undefined;
  const verified = ctx.db.documentFileVerification.fileId.find(fileId);
  const fileHash = native?.state === 'ready' ? native.sha256 : verified?.stamp === stamp(file) ? verified.sha256 : '';
  if (requireHash && !/^[a-f\d]{64}$/iu.test(fileHash)) fail('unavailable', 'Verifica el original almacenado antes de preparar su texto.');
  return { fileId, fileHash, targetKind: file.targetKind, targetId: String(file.targetId), targetVersion: targetVersion(ctx, file.targetKind, file.targetId), name: file.name, size: Number(file.size), contentType: file.contentType };
}
function sameFile(ctx: Ctx, stored: DocumentFileMetadata, person: Identity) {
  const current = metadata(ctx, stored.fileId, person);
  if (aiHash(current) !== aiHash(stored)) fail('conflict', 'El original o la fuente cambió. Vuelve a preparar el documento.');
  return current;
}
function fileAccess(ctx: Ctx, raw: Record<string, unknown>, person: Identity) {
  const fileId = text(raw.fileId); const file = fileRecord(ctx, fileId, person);
  const native = file.storageKey.startsWith('stdb:') ? ctx.db.resourceUpload.id.find(file.storageKey.slice(5)) : undefined;
  return { actor: person.toHexString(), ...metadata(ctx, fileId, person, false), storageKey: file.storageKey,
    etag: file.etag, stamp: stamp(file), chunkCount: native?.state === 'ready' ? native.chunkCount : 0 };
}
function ownDraft(ctx: Ctx, value: unknown, person: Identity) {
  const row = ctx.db.documentOcrDraft.id.find(documentUuid(value));
  if (!row || !row.actor.isEqual(person) || !isActive(ctx.db, person)) fail('unavailable', 'La preparación OCR no está disponible.');
  const draft = JSON.parse(row.json) as DocumentOcrDraft; sameFile(ctx, draft.file, person); return { row, draft };
}
function saveDraft(ctx: Ctx, draft: DocumentOcrDraft) {
  const row = ctx.db.documentOcrDraft.id.find(draft.id)!; const next = { ...draft, revision: row.revision + 1 };
  ctx.db.documentOcrDraft.id.update({ ...row, revision: next.revision, json: JSON.stringify(next) }); return next;
}

/** Internal Worker preflight projects original IDs from authorized persisted records only. */
function examDocumentFiles(ctx: Ctx, request: Record<string, unknown>, person: Identity) {
  const values: { preparation?: AiPreparation }[] = [];
  const addVersion = (examId: string, number: number | undefined, attempt = false) => {
    const exam = ctx.db.studyExam.id.find(examId); if (!exam) return;
    const owner = exam.owner.isEqual(person);
    if (!owner && !(exam.visibility === 'group' && (!exam.archived || attempt))) return;
    const version = number ?? (owner ? exam.draftVersion ?? exam.readyVersion : exam.readyVersion);
    if (!version || !owner && !attempt && version !== exam.readyVersion) return;
    const row = ctx.db.examVersion.key.find(`${exam.id}:${version}`);
    if (row && (owner || row.state === 'ready')) values.push(JSON.parse(row.json) as { preparation?: AiPreparation });
  };
  if (typeof request.examId === 'string') addVersion(request.examId, Number.isSafeInteger(request.version) ? Number(request.version) : undefined);
  if (typeof request.attemptId === 'string') {
    const attempt = ctx.db.examAttempt.id.find(request.attemptId);
    if (attempt?.actor.isEqual(person)) addVersion(attempt.examId, attempt.version, true);
  }
  if (typeof request.generationId === 'string') {
    const generation = ctx.db.aiGeneration.id.find(request.generationId), prep = generation && ctx.db.aiPreparation.id.find(generation.preparationId);
    if (generation?.actor.isEqual(person) && prep?.actor.isEqual(person)) values.push({ preparation: JSON.parse(prep.json) as AiPreparation });
  }
  if (['listBank', 'previewVariant', 'createVariant', 'getBankQuestion', 'setBankVisibility'].includes(String(request.action))) {
    const plan = aiRecord(request.plan) ? request.plan : request;
    const selectedIds = Array.isArray(plan.bankIds) ? new Set(plan.bankIds) : undefined;
    for (const bank of ctx.db.examBankQuestion.iter()) {
      if (!(bank.owner.isEqual(person) || bank.visibility === 'group') || request.bankId !== undefined && request.bankId !== bank.id
        || selectedIds && !selectedIds.has(bank.id) || plan.subjectId !== undefined && String(bank.subjectId) !== plan.subjectId
        || plan.termId !== undefined && String(bank.termId) !== plan.termId) continue;
      const number = request.version !== undefined && Number.isSafeInteger(request.version) ? Number(request.version) : bank.version;
      const row = ctx.db.examBankVersion.key.find(`${bank.id}:${number}`); if (row) values.push(JSON.parse(row.json) as { preparation?: AiPreparation });
    }
  }
  const fileIds = new Set(values.flatMap((value) => value.preparation?.fragments.flatMap((f) => f.origins.flatMap((origin) => origin.fileId ? [origin.fileId] : [])) ?? []));
  return [...fileIds].flatMap((fileId) => {
    try { const file = fileRecord(ctx, fileId, person); if (file.storageKey.startsWith('stdb:')) return []; return [metadata(ctx, fileId, person)]; }
    catch { return []; } // The exam projection will hide inaccessible sources; do not open a historical copy here.
  });
}
export function resolveDocumentTranscription(ctx: Ctx, transcriptionId: string, person = memberIdentityFor(ctx), requireSame = true, reuseReviewed = false): DocumentTranscription {
  const row = ctx.db.documentTranscription.id.find(documentUuid(transcriptionId));
  if (!row || !isActive(ctx.db, person) || !reuseReviewed && !row.actor.isEqual(person)) fail('unavailable', 'El texto preparado es privado y no está disponible.');
  const value = JSON.parse(row.json) as DocumentTranscription;
  const current = metadata(ctx, value.fileId, person);
  if (!row.actor.isEqual(person) && current.targetKind === 'note' && ctx.db.note.id.find(BigInt(current.targetId))?.visibility !== 'group') fail('unauthorized', 'El documento personal no está compartido.');
  if (current.targetKind !== value.targetKind || current.targetId !== value.targetId || current.fileHash !== value.fileHash
    || fileRecord(ctx, value.fileId, person).etag !== value.fileEtag || requireSame && current.targetVersion !== value.targetVersion) fail('conflict', 'La fuente o el documento cambió. Conservamos tu texto; vuelve a prepararlo.');
  return value;
}
export function appendDocumentTranscriptions(ctx: Ctx, source: Pick<AiSourceRef, 'kind' | 'refId' | 'transcriptionIds' | 'segmentIds'>, snapshot: AiSourceSnapshot, person: Identity, options: { reuseReviewed?: boolean } = {}): AiSourceSnapshot {
  if (!source.transcriptionIds?.length) return snapshot;
  const values = source.transcriptionIds.map((id) => resolveDocumentTranscription(ctx, id, person, true, options.reuseReviewed));
  const selected = new Set(source.segmentIds ?? []);
  const validIds = new Set(values.flatMap((v) => v.segments.map((s) => s.id)));
  if ([...selected].some((id) => !validIds.has(id))) fail('invalid', 'Una sección no pertenece a los documentos preparados.');
  const fields = values.flatMap((value) => {
    if (value.targetKind !== source.kind || value.targetId !== source.refId) fail('invalid', 'El documento no pertenece a la fuente seleccionada.');
    return value.segments.filter((s) => !selected.size || selected.has(s.id)).map((segment) => ({ name: `archivo:${value.fileId}:${segment.id}`, text: segment.text,
      origin: { kind: source.kind, refId: source.refId, version: value.targetVersion, fileId: value.fileId, fileHash: value.fileHash, transcriptionId: value.id, locator: segment.locator } }));
  });
  if (fields.reduce((total, field) => total + field.text.length, 0) > DOCUMENT_LIMITS.maxSelectedCharacters) fail('quota', 'Selecciona hasta 40 000 caracteres del documento. No se ha recortado texto.');
  return { ...snapshot, fields: [...snapshot.fields, ...fields], context: aiHash([snapshot.context, values, [...selected]]), omissions: [...(snapshot.omissions ?? []), ...values.flatMap((v) => v.omissions)] };
}
export function validateDocumentOrigins(ctx: Ctx, preparation: Pick<AiPreparation, 'fragments'>, person: Identity, options: { sharing?: boolean } = {}) {
  for (const origin of preparation.fragments.flatMap((f) => f.origins)) {
    if (!origin.transcriptionId) continue;
    const value = resolveDocumentTranscription(ctx, origin.transcriptionId, person, false, true);
    if (origin.fileId !== value.fileId || origin.fileHash !== value.fileHash || origin.kind !== value.targetKind || origin.refId !== value.targetId || origin.version !== value.targetVersion
      || !value.segments.some((s) => aiHash(s.locator) === aiHash(origin.locator))) fail('conflict', 'La procedencia del documento ya no coincide.');
    if (options.sharing && value.targetKind === 'note' && ctx.db.note.id.find(BigInt(value.targetId))?.visibility !== 'group') fail('unauthorized', 'Un documento de una nota personal mantiene privado el examen.');
  }
}

export function documentPreparationAction(ctx: Ctx, value: unknown): unknown {
  const raw = object(value); const action = text(raw.action, 80);
  const restricted = ['accreditFile', 'invalidateFile', 'readChunk', 'claimOcr', 'finishOcr'].includes(action);
  if (restricted) service(ctx); else activeMember(ctx);
  const person = restricted ? actor(raw.actor) : memberIdentityFor(ctx);
  if (action === 'fileInfo') return metadata(ctx, text(raw.fileId), person);
  if (action === 'fileAccess') return fileAccess(ctx, raw, person);
  if (action === 'examFiles') return examDocumentFiles(ctx, object(raw.request), person);
  if (action === 'selectionFiles') {
    if (!Array.isArray(raw.transcriptionIds) || raw.transcriptionIds.length > 512) fail('invalid', 'Selección de documentos inválida.');
    return [...new Set(raw.transcriptionIds.map((id) => resolveDocumentTranscription(ctx, text(id), person).fileId))]
      .flatMap((fileId) => fileRecord(ctx, fileId, person).storageKey.startsWith('stdb:') ? [] : [metadata(ctx, fileId, person)]);
  }
  if (action === 'invalidateFile') {
    const fileId = text(raw.fileId); const file = fileRecord(ctx, fileId, person);
    if (file.storageKey.startsWith('stdb:')) fail('invalid', 'El archivo nativo ya tiene una huella inmutable.');
    const row = ctx.db.documentFileVerification.fileId.find(fileId);
    if (row && row.sha256 === raw.fileHash) ctx.db.documentFileVerification.fileId.update({ ...row, stamp: `invalid:${row.stamp}`, verifiedAt: ctx.timestamp });
    return { invalidated: true };
  }
  if (action === 'accreditFile') {
    const fileId = text(raw.fileId); const file = fileRecord(ctx, fileId, person); const hash = text(raw.fileHash, 64).toLowerCase();
    if (!/^[a-f\d]{64}$/u.test(hash) || raw.stamp !== stamp(file)) fail('conflict', 'El original cambió durante su verificación.');
    const entry = { fileId, stamp: stamp(file), sha256: hash, objectEtag: typeof raw.objectEtag === 'string' ? raw.objectEtag : '', verifiedAt: ctx.timestamp };
    const prior = ctx.db.documentFileVerification.fileId.find(fileId);
    if (prior && prior.stamp === entry.stamp && prior.sha256 !== hash) fail('conflict', 'El archivo almacenado cambió; vuelve a adjuntarlo.');
    if (prior) ctx.db.documentFileVerification.fileId.update(entry); else ctx.db.documentFileVerification.insert(entry);
    return metadata(ctx, fileId, person);
  }
  if (action === 'readChunk') {
    const file = fileRecord(ctx, text(raw.fileId), person);
    if (!file.storageKey.startsWith('stdb:') || !Number.isSafeInteger(raw.index) || Number(raw.index) < 0) fail('invalid', 'Bloque inválido.');
    const upload = ctx.db.resourceUpload.id.find(file.storageKey.slice(5));
    if (upload?.state !== 'ready' || Number(raw.index) >= upload.chunkCount) fail('unavailable', 'El original no está completo.');
    const chunk = ctx.db.resourceChunk.id.find(`${upload.id}:${raw.index}`); if (!chunk) fail('unavailable', 'Falta un bloque del original.');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let encoded = '';
    for (let i = 0; i < chunk.bytes.length; i += 3) { const a = chunk.bytes[i], b = chunk.bytes[i + 1], c = chunk.bytes[i + 2]; const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0); encoded += alphabet[n >>> 18] + alphabet[n >>> 12 & 63] + (b === undefined ? '=' : alphabet[n >>> 6 & 63]) + (c === undefined ? '=' : alphabet[n & 63]); }
    return { index: Number(raw.index), base64: encoded, sha256: chunk.sha256 };
  }
  if (action === 'saveTranscription') {
    const id = documentUuid(raw.id); const file = metadata(ctx, text(raw.fileId), person);
    if (raw.reviewed !== true) fail('consent', 'Revisa y confirma el texto antes de utilizarlo.');
    if (file.fileHash !== raw.fileHash || file.targetKind !== raw.targetKind || file.targetId !== raw.targetId || file.targetVersion !== raw.targetVersion) fail('conflict', 'La selección no coincide con el original vigente.');
    const segments = validateDocumentSegments(raw.segments);
    if (!Array.isArray(raw.omissions) || raw.omissions.length > 100 || raw.omissions.some((o) => typeof o !== 'string' || o.length > 500)) fail('invalid', 'Omisiones inválidas.');
    if (raw.ocrDraftId) { const { draft } = ownDraft(ctx, raw.ocrDraftId, person); if (draft.state !== 'ready' || draft.file.fileId !== file.fileId || segments.some((s) => !draft.pages.includes(s.locator.start))) fail('invalid', 'El OCR no corresponde a estas páginas.'); }
    const prior = ctx.db.documentTranscription.id.find(id);
    const result: DocumentTranscription = { id, fileId: file.fileId, fileHash: file.fileHash, targetKind: file.targetKind, targetId: file.targetId, targetVersion: file.targetVersion,
      reviewed: true, segments, omissions: raw.omissions as string[], ...(raw.ocrDraftId ? { ocrDraftId: documentUuid(raw.ocrDraftId) } : {}),
      fileEtag: fileRecord(ctx, file.fileId, person).etag, createdAt: prior ? Number(prior.createdAt.microsSinceUnixEpoch / 1000n) : now(ctx), label: 'Texto preparado y revisado por el alumno' };
    if (prior) { if (!prior.actor.isEqual(person) || aiHash(JSON.parse(prior.json)) !== aiHash(result)) fail('conflict', 'El identificador ya contiene otro texto revisado.'); return result; }
    ctx.db.documentTranscription.insert({ id, actor: person, fileId: file.fileId, json: JSON.stringify(result), createdAt: ctx.timestamp }); return result;
  }
  if (action === 'getTranscription') return resolveDocumentTranscription(ctx, text(raw.id), person);
  if (action === 'listTranscriptions') return [...ctx.db.documentTranscription.actor.filter(person)].filter((row) => raw.fileId === undefined || row.fileId === raw.fileId).map((row) => { const value = JSON.parse(row.json) as DocumentTranscription; return { id: value.id, fileId: value.fileId, createdAt: value.createdAt, targetKind: value.targetKind, targetId: value.targetId, characters: value.segments.reduce((n, s) => n + s.text.length, 0) }; });
  if (action === 'prepareOcr') {
    const id = documentUuid(raw.id); const input = validateDocumentOcrInput(raw.input); const file = metadata(ctx, input.fileId, person);
    if (file.fileHash !== input.fileHash || file.targetVersion !== input.targetVersion) fail('conflict', 'El original cambió.');
    const model = text(raw.model, 200); const fingerprint = aiHash({ input, model });
    const prior = ctx.db.documentOcrDraft.id.find(id); if (prior) { const { draft } = ownDraft(ctx, id, person); if (draft.fingerprint !== fingerprint) fail('conflict', 'La preparación pertenece a otras páginas.'); return draft; }
    const draft: DocumentOcrDraft = { id, revision: 1, state: 'prepared', file, pages: input.pages, model, fingerprint,
      estimatedInputTokens: input.pages.length * 1600 + 1024, estimatedOutputTokens: DOCUMENT_LIMITS.maxOcrOutputTokens, createdAt: now(ctx), expiresAt: now(ctx) + 30 * 60_000 };
    ctx.db.documentOcrDraft.insert({ id, actor: person, revision: 1, json: JSON.stringify(draft), createdAt: ctx.timestamp }); return draft;
  }
  if (action === 'getOcr') {
    const { draft } = ownDraft(ctx, raw.id, person);
    if (draft.state === 'running' && draft.startedAt! + 90_000 <= now(ctx)) { draft.state = 'unknown'; draft.error = 'Resultado incierto. Consulta este envío antes de crear otro.'; return saveDraft(ctx, draft); } return draft;
  }
  if (action === 'cancelOcr') { const { draft } = ownDraft(ctx, raw.id, person); expectVersion(draft.revision, Number(raw.expectedRevision)); draft.state = 'cancelled'; draft.result = undefined; return saveDraft(ctx, draft); }
  if (action === 'authorizeOcr') {
    const { draft } = ownDraft(ctx, raw.id, person); const generationId = documentUuid(raw.generationId);
    if (draft.generationId === generationId) {
      if (draft.state === 'prepared' && raw.acknowledgeUnknown === true && draft.authorization && !draft.authorization.acknowledgeUnknown) {
        if (raw.confirmed !== true || raw.allowNew !== true || raw.fingerprint !== draft.fingerprint || raw.model !== draft.model) fail('consent', 'Confirma de nuevo el posible consumo adicional.');
        draft.authorization.acknowledgeUnknown = true;
        return { actor: person.toHexString(), draft: saveDraft(ctx, draft) };
      }
      return { actor: person.toHexString(), draft };
    }
    if (draft.generationId || draft.state !== 'prepared') fail('conflict', 'Consulta el estado existente. Crea otra preparación y confirma de nuevo para otro envío.');
    expectVersion(draft.revision, Number(raw.expectedRevision));
    if (raw.confirmed !== true || raw.allowNew !== true) fail('consent', 'Revisa el consumo y confirma el envío a Gemini.');
    if (raw.fingerprint !== draft.fingerprint || raw.model !== draft.model || now(ctx) >= draft.expiresAt) fail('conflict', 'La vista previa cambió o venció.');
    const key = ctx.db.aiKey.actor.find(person); if (!key) fail('key_required', 'Configura tu clave personal.');
    draft.generationId = generationId; draft.authorization = { generationId, keyId: key.keyId, acknowledgeUnknown: raw.acknowledgeUnknown === true };
    return { actor: person.toHexString(), draft: saveDraft(ctx, draft) };
  }
  if (action === 'claimOcr') {
    const { draft } = ownDraft(ctx, raw.id, person); const generationId = documentUuid(raw.generationId);
    if (draft.generationId !== generationId) fail('conflict', 'El OCR no está autorizado.');
    if (draft.state !== 'prepared') return { claimed: false, actor: person.toHexString(), draft } satisfies DocumentOcrClaim;
    if (ctx.db.aiKey.actor.find(person)?.keyId !== draft.authorization?.keyId) fail('conflict', 'La clave cambió después de confirmar.');
    const claim = reserveAiQuota(ctx, person, generationId, draft.estimatedInputTokens + draft.estimatedOutputTokens,
      { preparationId: draft.id, model: draft.model, purpose: 'document_ocr', requestHash: draft.fingerprint, acknowledgeUnknown: draft.authorization?.acknowledgeUnknown });
    if (!claim.claimed) return { claimed: false, actor: person.toHexString(), draft };
    draft.state = 'running'; draft.startedAt = now(ctx);
    return { claimed: true, actor: person.toHexString(), draft: saveDraft(ctx, draft), key: { keyId: claim.key.keyId, provider: 'gemini', ciphertext: claim.key.ciphertext, iv: claim.key.iv, masterVersion: claim.key.masterVersion } } satisfies DocumentOcrClaim;
  }
  if (action === 'finishOcr') {
    const row = ctx.db.documentOcrDraft.id.find(documentUuid(raw.id)); if (!row || !row.actor.isEqual(person)) fail('unavailable', 'El envío no está disponible.');
    const draft = JSON.parse(row.json) as DocumentOcrDraft; if (draft.generationId !== raw.generationId) fail('conflict', 'El resultado pertenece a otro envío.');
    if (!['succeeded', 'failed', 'unknown'].includes(String(raw.state))) fail('invalid', 'Estado inválido.');
    if (draft.state !== 'running' && draft.state !== 'cancelled') return draft;
    const state = raw.state as 'succeeded' | 'failed' | 'unknown';
    const usage = raw.usage === undefined ? undefined : object(raw.usage) as { inputTokens: number; outputTokens: number };
    settleAiQuota(ctx, person, draft.generationId!, usage, state);
    if (draft.state !== 'cancelled') {
      try { sameFile(ctx, draft.file, person); if (state === 'succeeded') draft.result = validateDocumentOcrResult(raw.result, draft.pages); draft.state = state === 'succeeded' ? 'ready' : state; }
      catch { draft.state = 'failed'; draft.error = 'El original cambió o la respuesta no conserva sus páginas. No se aceptó el OCR.'; }
      if (state !== 'succeeded') draft.error = state === 'unknown' ? 'No se conoce el resultado. No se reenviará automáticamente.' : 'No se pudo completar el OCR. Se conserva el documento.';
      draft.usage = usage;
    }
    return saveDraft(ctx, draft);
  }
  return fail('invalid', 'Operación documental desconocida.');
}

export function documentPreparationResponse(ctx: Ctx, payload: string): string {
  try {
    if (payload.length > 2 * 1024 * 1024) fail('invalid', 'La preparación supera el límite permitido.');
    return JSON.stringify(documentPreparationAction(ctx, JSON.parse(payload)));
  } catch (error) {
    if (error instanceof SenderError) throw error;
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') return fail(error.code, error.message);
    throw error;
  }
}

/** Erase copied text when its original target is permanently purged. */
export function purgeDocumentSource(ctx: Ctx, kind: string, targetId: bigint) {
  const refId = String(targetId);
  for (const row of [...ctx.db.documentTranscription.iter()]) {
    const value = JSON.parse(row.json) as DocumentTranscription;
    if (value.targetKind === kind && value.targetId === refId) ctx.db.documentTranscription.id.delete(row.id);
  }
  for (const row of [...ctx.db.documentOcrDraft.iter()]) {
    const value = JSON.parse(row.json) as DocumentOcrDraft;
    if (value.file.targetKind === kind && value.file.targetId === refId) ctx.db.documentOcrDraft.id.delete(row.id);
  }
  for (const file of ctx.db.resourceFile.targetId.filter(targetId)) if (file.targetKind === kind) ctx.db.documentFileVerification.fileId.delete(file.id);
}
