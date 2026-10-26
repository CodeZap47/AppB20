import { Hono } from 'hono';
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it, vi } from 'vitest';
import { AiError, type DocumentFileMetadata, type DocumentOcrDraft } from '@b20/core';
import { documentRoutes, readDocumentOriginal, revalidateDocumentOriginals } from './documentRoutes.ts';
import { AiApiError, type AiDatabase, type AiWorkerEnv } from './database.ts';
import { encryptAiKey } from './crypto.ts';
import type { AiRouteContext } from './routes.ts';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = 'a'.repeat(64), digest = (bytes: Uint8Array) => Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
const bytes = new Uint8Array([255, 216, 255, 0]);
const file: DocumentFileMetadata = { fileId: 'file', fileHash: digest(bytes), targetKind: 'note', targetId: '1', targetVersion: 2, size: bytes.length, name: 'scan.jpg', contentType: 'image/jpeg' };
const environment = { AI_ENABLED: 'true', GEMINI_MODEL: 'gemini-test', AI_SERVICE_TOKEN: 'service-fixture', AI_MASTER_VERSION: 'v1', AI_MASTER_KEYS_JSON: JSON.stringify({ v1: btoa('m'.repeat(32)) }) } as AiWorkerEnv;
function fixture(scenario: 'success' | 'invalid' | 'timeout' | 'lost' = 'success') {
  let draft: DocumentOcrDraft = { id: uid(1), revision: 1, state: 'prepared', pages: [1], file, model: 'gemini-test', fingerprint: 'a'.repeat(64), estimatedInputTokens: 2600, estimatedOutputTokens: 8000, createdAt: 1, expiresAt: Date.now() + 100_000 };
  let calls = 0, claims = 0;
  const db: AiDatabase = {
    async user<T>(_token: string, procedure: string, value: unknown) {
      if (procedure === 'ai_status') return { enabled: true } as T;
      const raw = value as Record<string, unknown>; expect(procedure).toBe('document_preparation');
      if (raw.action === 'getOcr') return structuredClone(draft) as T;
      if (raw.action === 'prepareOcr') return structuredClone(draft) as T;
      if (raw.action === 'authorizeOcr') { if (raw.confirmed !== true) throw new AiApiError(409, 'consent', 'Confirma el envío.'); draft.generationId = String(raw.generationId); return { actor, draft: structuredClone(draft) } as T; }
      throw new Error('Unexpected user action');
    },
    async service<T>(_procedure: string, value: unknown) {
      const raw = value as Record<string, unknown>;
      if (raw.action === 'claimOcr') { claims++; if (draft.state !== 'prepared') return { claimed: false, actor, draft } as T;
        draft = { ...draft, state: 'running' }; const keyId = uid(3), key = await encryptAiKey(environment, { actor, provider: 'gemini', keyId }, 'synthetic-not-a-real-api-key');
        return { claimed: true, actor, draft: structuredClone(draft), key: { ...key, keyId, provider: 'gemini' } } as T;
      }
      if (raw.action === 'finishOcr') { if (scenario === 'lost') throw new Error('Lost acknowledgment'); draft.state = raw.state === 'succeeded' ? 'ready' : raw.state as 'failed' | 'unknown'; draft.result = raw.result as DocumentOcrDraft['result']; return structuredClone(draft) as T; }
      throw new Error('Unexpected service action');
    },
  };
  const app = new Hono<AiRouteContext>();
  app.use('*', async (c, next) => { c.set('ai', db); c.set('sessionToken', 'student-fixture'); await next(); });
  app.onError((error, c) => c.json({ code: error instanceof AiApiError || error instanceof AiError ? error.code : 'failed' }, error instanceof AiApiError ? error.status : 400));
  app.route('/documents', documentRoutes({ readOriginal: async () => ({ file, bytes }), provider: { async recognize(input) { calls++; expect(input.apiKey).toBe('synthetic-not-a-real-api-key'); expect(input.media.bytes).toEqual(bytes);
    if (scenario === 'timeout') throw new DOMException('Private provider text', 'TimeoutError');
    return { text: scenario === 'invalid' ? 'invalid JSON' : JSON.stringify({ segments: [{ id: 'page-1', text: 'Texto reconocido para revisar.', locator: { kind: 'page', start: 1, end: 1 } }], omissions: [] }) };
  } } }));
  const run = () => app.request(`/documents/ocr/${uid(1)}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 1, generationId: uid(2), fingerprint: draft.fingerprint, confirmed: true }) }, environment);
  return { app, run, calls: () => calls, claims: () => claims };
}
describe('API documental: confirmación, original y un único envío', () => {
  it('prepara sin consumir modelo y pide confirmar antes del envío', async () => {
    const s = fixture();
    expect((await s.app.request('/documents/ocr/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: uid(1), input: { fileId: file.fileId, fileHash: file.fileHash, targetVersion: file.targetVersion, pages: [1] } }) }, environment)).status).toBe(201);
    expect(s.calls()).toBe(0);
    const absent = await s.app.request(`/documents/ocr/${uid(1)}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ generationId: uid(2) }) }, environment);
    expect(absent.status).toBe(409); expect(s.calls()).toBe(0);
  });
  it.each(['success', 'invalid', 'timeout', 'lost'] as const)('conserva operación %s y nunca reenvía el mismo UUID', async (scenario) => {
    const s = fixture(scenario); const first = await s.run(); expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ state: scenario === 'success' ? 'ready' : scenario === 'invalid' ? 'failed' : scenario === 'timeout' ? 'unknown' : 'running' });
    expect((await s.run()).status).toBe(200); expect(s.calls()).toBe(1); expect(s.claims()).toBe(1);
  });
  it('reconstruye y acredita bytes nativos autenticados, comprobando cada bloque', async () => {
    const calls: Record<string, unknown>[] = [];
    const db: AiDatabase = { async user<T>() { return { ...file, actor, storageKey: 'stdb:file', stamp: 'stamp', etag: file.fileHash, chunkCount: 1 } as T; },
      async service<T>(_procedure: string, value: unknown) { const raw = value as Record<string, unknown>; calls.push(raw);
        if (raw.action === 'readChunk') return { index: 0, base64: btoa(String.fromCharCode(...bytes)), sha256: digest(bytes) } as T;
        expect(raw.action).toBe('accreditFile'); expect(raw.fileHash).toBe(file.fileHash); return file as T;
      } };
    expect((await readDocumentOriginal(db, 'student-fixture', environment, file.fileId)).bytes).toEqual(bytes);
    expect(calls.map((call) => call.action)).toEqual(['readChunk', 'accreditFile']);
    const denied: AiDatabase = { ...db, async user() { throw new AiApiError(403, 'forbidden', 'Sin acceso.'); } };
    await expect(readDocumentOriginal(denied, 'student-fixture', environment, file.fileId)).rejects.toThrow('Sin acceso'); expect(calls).toHaveLength(2);
  });
  it('invalida la acreditación heredada si el objeto remoto cambió antes de publicar', async () => {
    const services = vi.fn(async () => ({ invalidated: true }));
    const db: AiDatabase = { async user<T>(_token: string, _procedure: string, value: unknown) { return ((value as Record<string, unknown>).action === 'examFiles' ? [file] : { actor }) as T; },
      async service<T>() { return await services() as T; } };
    await expect(revalidateDocumentOriginals(db, 'student-fixture', environment, { examRequest: { action: 'approveVersion' } }, async () => { throw new AiApiError(409, 'conflict', 'Original cambiado.'); })).rejects.toThrow('Original cambiado');
    expect(services).toHaveBeenCalledOnce();
  });
});
