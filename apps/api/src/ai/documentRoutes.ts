import { Hono } from 'hono';
import { sha256 } from '@noble/hashes/sha2.js';
import { AiError, DOCUMENT_LIMITS, documentUuid, validateDocumentOcrInput, validateDocumentOcrResult, type DocumentFileMetadata, type DocumentOcrClaim, type DocumentOcrDraft, type AiStatus } from '@b20/core';
import { AiApiError, type AiDatabase, type AiWorkerEnv } from './database.ts';
import { readAiBody } from './body.ts';
import { decryptAiKey, canEncrypt } from './crypto.ts';
import { AiProviderError, classifyProviderError } from './provider.ts';
import { createDocumentProvider, selectOcrMedia, type DocumentProvider } from './documentProvider.ts';
import type { AiRouteContext } from './routes.ts';

interface DocumentAccess extends DocumentFileMetadata { actor: string; storageKey: string; etag: string; stamp: string; chunkCount: number }
const digest = (bytes: Uint8Array) => Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
function model(env: AiWorkerEnv) { const name = env.GEMINI_MODEL?.trim(); if (!name || !/^[\w.-]{1,200}$/u.test(name)) throw new AiApiError(503, 'configuration', 'Configura el modelo de Gemini.'); return name; }
async function boundedBytes(stream: ReadableStream<Uint8Array>, expected: number) {
  if (!Number.isSafeInteger(expected) || expected < 1 || expected > DOCUMENT_LIMITS.maxBytes) throw new AiApiError(413, 'invalid', 'El documento supera 10 MiB.');
  const reader = stream.getReader(); const bytes = new Uint8Array(expected); let offset = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; if (offset + part.value.length > expected) { await reader.cancel(); throw new AiApiError(409, 'conflict', 'El tamaño del original cambió.'); } bytes.set(part.value, offset); offset += part.value.length; } }
  finally { reader.releaseLock(); }
  if (offset !== expected) throw new AiApiError(409, 'conflict', 'El original está incompleto.'); return bytes;
}
/** Only this authenticated server path may accredit a legacy file hash. Never accept client bytes. */
export async function readDocumentOriginal(db: AiDatabase, token: string, env: AiWorkerEnv, fileId: string) {
  const access = await db.user<DocumentAccess>(token, 'document_preparation', { action: 'fileAccess', fileId });
  let bytes: Uint8Array; let objectEtag = access.etag;
  if (!access.size || access.size > DOCUMENT_LIMITS.maxBytes) throw new AiApiError(413, 'invalid', 'El documento supera 10 MiB.');
  if (access.storageKey.startsWith('stdb:')) {
    if (!Number.isSafeInteger(access.chunkCount) || access.chunkCount < 1 || access.chunkCount > 10) throw new AiApiError(503, 'protocol', 'El original no tiene bloques válidos.');
    bytes = new Uint8Array(access.size); let offset = 0;
    for (let index = 0; index < access.chunkCount; index++) {
      const part = await db.service<{ index: number; base64: string; sha256: string }>('document_preparation', { action: 'readChunk', actor: access.actor, fileId, index });
      if (part.index !== index || typeof part.base64 !== 'string' || part.base64.length > 1_398_104) throw new AiApiError(503, 'protocol', 'Bloque documental inválido.');
      const chunk = Uint8Array.from(atob(part.base64), (c) => c.charCodeAt(0));
      if (digest(chunk) !== part.sha256 || offset + chunk.length > bytes.length) throw new AiApiError(409, 'conflict', 'La integridad del original cambió.');
      bytes.set(chunk, offset); offset += chunk.length;
    }
    if (offset !== access.size || digest(bytes) !== access.fileHash) throw new AiApiError(409, 'conflict', 'La huella del original no coincide.');
  } else {
    if (!env.FILES) throw new AiApiError(503, 'configuration', 'Configura el acceso a los archivos anteriores para preparar este documento.');
    const original = await env.FILES.get(access.storageKey, access.etag ? { onlyIf: { etagMatches: access.etag } } : undefined);
    if (!original || !('body' in original) || !original.body || original.size !== access.size) throw new AiApiError(409, 'conflict', 'El original cambió o ya no está disponible.');
    bytes = await boundedBytes(original.body, access.size); objectEtag = original.etag;
  }
  const file = await db.service<DocumentFileMetadata>('document_preparation', { action: 'accreditFile', actor: access.actor, fileId, fileHash: digest(bytes), stamp: access.stamp, objectEtag });
  return { file, bytes };
}
export async function revalidateDocumentOriginals(db: AiDatabase, token: string, env: AiWorkerEnv,
  selection: { examRequest: Record<string, unknown> } | { transcriptionIds: string[] },
  readOriginal = readDocumentOriginal) {
  const files = await db.user<DocumentFileMetadata[]>(token, 'document_preparation', 'examRequest' in selection
    ? { action: 'examFiles', request: selection.examRequest } : { action: 'selectionFiles', transcriptionIds: selection.transcriptionIds });
  if (!Array.isArray(files) || files.length > 512) throw new AiApiError(503, 'protocol', 'No pudimos comprobar los documentos de la selección.');
  for (const expected of files) {
    try {
      const actual = await readOriginal(db, token, env, expected.fileId);
      if (actual.file.fileHash !== expected.fileHash || actual.file.targetVersion !== expected.targetVersion) throw new AiApiError(409, 'conflict', 'El original cambió.');
    } catch (error) {
      if (error instanceof AiApiError && error.code === 'conflict') {
        const access = await db.user<DocumentAccess>(token, 'document_preparation', { action: 'fileAccess', fileId: expected.fileId });
        await db.service('document_preparation', { action: 'invalidateFile', actor: access.actor, fileId: expected.fileId, fileHash: expected.fileHash });
      }
      throw error;
    }
  }
}
export function documentRoutes(options: { provider?: DocumentProvider; readOriginal?: typeof readDocumentOriginal } = {}) {
  const app = new Hono<AiRouteContext>(); const readOriginal = options.readOriginal ?? readDocumentOriginal;
  app.get('/files/:fileId', async (c) => {
    const db = c.get('ai'), token = c.get('sessionToken'), fileId = c.req.param('fileId');
    try { return c.json(await db.user(token, 'document_preparation', { action: 'fileInfo', fileId })); }
    catch (error) { if (!(error instanceof AiApiError) || error.code !== 'unavailable') throw error; return c.json((await readOriginal(db, token, c.env, fileId)).file); }
  });
  app.get('/transcriptions', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'document_preparation', { action: 'listTranscriptions', ...(c.req.query('fileId') ? { fileId: c.req.query('fileId') } : {}) })));
  app.get('/transcriptions/:id', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'document_preparation', { action: 'getTranscription', id: documentUuid(c.req.param('id')) })));
  app.post('/transcriptions', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'document_preparation', { ...await readAiBody(c.req.raw, 1024 * 1024), action: 'saveTranscription' }), 201));
  app.post('/ocr/prepare', async (c) => {
    const body = await readAiBody(c.req.raw, 8192); const input = validateDocumentOcrInput(body.input);
    const original = await readOriginal(c.get('ai'), c.get('sessionToken'), c.env, input.fileId);
    if (original.file.fileHash !== input.fileHash || original.file.targetVersion !== input.targetVersion) throw new AiApiError(409, 'conflict', 'El documento cambió antes de preparar.');
    await selectOcrMedia(original.bytes, input.pages);
    return c.json(await c.get('ai').user(c.get('sessionToken'), 'document_preparation', { action: 'prepareOcr', id: documentUuid(body.id), input, model: model(c.env) }), 201);
  });
  app.get('/ocr/:id', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'document_preparation', { action: 'getOcr', id: documentUuid(c.req.param('id')) })));
  app.post('/ocr/:id/cancel', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'document_preparation', { ...await readAiBody(c.req.raw, 4096), action: 'cancelOcr', id: documentUuid(c.req.param('id')) })));
  app.post('/ocr/:id/run', async (c) => {
    const body = await readAiBody(c.req.raw, 4096); const id = documentUuid(c.req.param('id')); const generationId = documentUuid(body.generationId);
    const db = c.get('ai'), token = c.get('sessionToken'); const status = await db.user<AiStatus>(token, 'ai_status', {});
    const allowNew = c.env.AI_ENABLED === 'true' && status.enabled && !!c.env.AI_SERVICE_TOKEN && !!c.env.GEMINI_MODEL && await canEncrypt(c.env);
    const authorization = await db.user<{ actor: string; draft: DocumentOcrDraft }>(token, 'document_preparation', { ...body, action: 'authorizeOcr', id, generationId, allowNew, model: c.env.GEMINI_MODEL?.trim() ?? '' });
    if (!allowNew || authorization.draft.state !== 'prepared') return c.json(authorization.draft);
    const original = await readOriginal(db, token, c.env, authorization.draft.file.fileId); const media = await selectOcrMedia(original.bytes, authorization.draft.pages);
    const claim = await db.service<DocumentOcrClaim>('document_preparation', { action: 'claimOcr', actor: authorization.actor, id, generationId });
    if (!claim.claimed) return c.json(claim.draft);
    if (!claim.key) throw new AiApiError(503, 'protocol', 'Consulta el estado del OCR antes de continuar.');
    let terminal: { state: 'succeeded' | 'failed' | 'unknown'; result?: unknown; usage?: unknown; errorCode?: string };
    let apiKey: string | undefined;
    try { apiKey = await decryptAiKey(c.env, { actor: claim.actor, provider: 'gemini', keyId: claim.key.keyId }, claim.key); }
    catch { terminal = { state: 'failed', errorCode: 'key_unavailable' }; }
    if (apiKey !== undefined) {
      try { const output = await (options.provider ?? createDocumentProvider()).recognize({ apiKey, model: claim.draft.model, draft: claim.draft, media }); apiKey = undefined;
        if (new TextEncoder().encode(output.text).length > 256 * 1024) throw new AiProviderError('invalid_output', false, 'OCR demasiado grande.');
        let parsed: unknown; try { parsed = JSON.parse(output.text); } catch { throw new AiProviderError('invalid_output', false, 'OCR inválido.'); }
        terminal = { state: 'succeeded', result: validateDocumentOcrResult(parsed, claim.draft.pages), usage: output.usage };
      } catch (error) { const failure = error instanceof AiError ? new AiProviderError('invalid_output', false, error.message) : classifyProviderError(error); terminal = { state: failure.uncertain ? 'unknown' : 'failed', errorCode: failure.code }; }
      finally { apiKey = undefined; }
    }
    try { await db.service('document_preparation', { action: 'finishOcr', actor: claim.actor, id, generationId, ...terminal! }); } catch { /* Read the persisted claim; a lost acknowledgment cannot resubmit. */ }
    return c.json(await db.user(token, 'document_preparation', { action: 'getOcr', id }));
  });
  return app;
}
