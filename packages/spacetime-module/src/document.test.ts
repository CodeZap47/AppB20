import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import { AI_CONSENT_VERSION, type AiSourceRef, type AiSourceSnapshot } from '../../core/src/ai';
import type { DocumentFileMetadata, DocumentOcrClaim, DocumentOcrDraft, DocumentTranscription } from '../../core/src/documentPreparation';

vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }),
    schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import { document_preparation, type Ctx } from './index';
import { appendDocumentTranscriptions, validateDocumentOrigins } from './documentHandlers';
const identity = (digit: string) => Identity.fromString(digit.repeat(64));
const alice = identity('a'), bob = identity('b'), service = identity('c'), admin = identity('d');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Row = Record<string, unknown>;
const key = (value: unknown) => value instanceof Identity ? value.toHexString() : String(value);
function store(primary: string, initial: Row[] = []) {
  const values = new Map(initial.map((row) => [key(row[primary]), row]));
  return new Proxy({ values, iter: () => values.values(), insert: (row: Row) => { if (values.has(key(row[primary]))) throw new Error('duplicate'); values.set(key(row[primary]), row); return row; } }, {
    get(target, name) { if (name in target) return target[name as keyof typeof target]; return {
      find: (id: unknown) => values.get(key(id)), update: (row: Row) => { values.set(key(row[primary]), row); return row; }, delete: (id: unknown) => values.delete(key(id)),
      filter: (id: unknown) => [...values.values()].filter((row) => key(row[String(name)]) === key(id)),
    }; },
  });
}
function setup() {
  const at = new Timestamp(1_790_000_000_000_000n); const hash = 'a'.repeat(64);
  const initial: Record<string, Row[]> = {
    appConfig: [{ id: 0, owner: admin }], authConfig: [{ id: 0, issuer: 'https://issuer.test', audiences: ['test'] }],
    member: [alice, bob, admin].map((identity) => ({ identity, status: 'active', isCreator: identity.isEqual(admin) })),
    subject: [{ id: 1n }], note: [{ id: 1n, title: 'Nota', topic: 'Tema', subjectId: 1n, body: 'Original', visibility: 'group', author: alice, version: 1 }],
    aiServiceConfig: [{ id: 0, identity: service, enabled: true, dailyTokenBudget: 100_000 }],
    aiConsent: [{ actor: alice, version: AI_CONSENT_VERSION, accepted: true, updatedAt: at }],
    aiKey: [{ actor: alice, keyId: uuid(99), ciphertext: 'encrypted', iv: 'iv', masterVersion: 'v1', provider: 'gemini' }],
    resourceFile: [{ id: 'native', targetKind: 'note', targetId: 1n, name: 'original.pdf', contentType: 'application/pdf', storageKey: 'stdb:native', etag: hash, size: 3n, uploadedBy: alice, createdAt: at }],
    resourceUpload: [{ id: 'native', state: 'ready', sha256: hash, chunkCount: 1 }],
    resourceChunk: [{ id: 'native:0', uploadId: 'native', index: 0, bytes: new Uint8Array([1, 2, 3]), sha256: 'chunk-hash' }],
  };
  const primary: Record<string, string> = { member: 'identity', aiConsent: 'actor', aiKey: 'actor', noteDetail: 'noteId', contentStatus: 'key', documentFileVerification: 'fileId' };
  const tables = new Map<string, ReturnType<typeof store>>();
  const db = new Proxy({}, { get: (_t, name: string) => { if (!tables.has(name)) tables.set(name, store(primary[name] ?? 'id', initial[name])); return tables.get(name); } });
  const state = { sender: alice, db, timestamp: at, env: {}, senderAuth: { jwt: { issuer: 'https://issuer.test', audience: ['test'], fullPayload: { email: 'fixture@example.test', email_verified: true } } } };
  const ctx = state as unknown as Ctx; const procedure = { withTx: (action: (ctx: Ctx) => unknown) => action(ctx) } as unknown as Parameters<typeof document_preparation>[0];
  const call = <T = unknown>(action: string, input: Record<string, unknown> = {}) => JSON.parse(document_preparation(procedure, { payload: JSON.stringify({ action, ...input }) })) as T;
  const rows = (name: string) => [...(db as Record<string, ReturnType<typeof store>>)[name].values.values()];
  const add = (name: string, row: Row) => (db as Record<string, ReturnType<typeof store>>)[name].insert(row);
  const as = (person: Identity) => { state.sender = person; };
  const input = { id: uuid(1), fileId: 'native', fileHash: hash, targetKind: 'note', targetId: '1', targetVersion: 1, reviewed: true,
    segments: [{ id: 'page-1', text: 'Texto revisado', locator: { kind: 'page', start: 1, end: 1 } }], omissions: [] };
  const prepare = () => call<DocumentOcrDraft>('prepareOcr', { id: uuid(2), input: { fileId: 'native', fileHash: hash, targetVersion: 1, pages: [1] }, model: 'gemini-test' });
  const authorize = (draft: DocumentOcrDraft) => call<{ draft: DocumentOcrDraft }>('authorizeOcr', { id: draft.id, generationId: uuid(3), expectedRevision: draft.revision, fingerprint: draft.fingerprint, model: draft.model, confirmed: true, allowNew: true }).draft;
  return { ctx, state, call, rows, add, as, input, prepare, authorize };
}
describe('documentos EX-3 privados, originales verificados y OCR persistente', () => {
  it('conserva texto y localizadores idempotentes; bloquea hash, versión y lectura de otra cuenta o administrador', () => {
    const s = setup(); const result = s.call<DocumentTranscription>('saveTranscription', s.input);
    expect(result.segments).toEqual(s.input.segments); expect(s.call('saveTranscription', s.input)).toEqual(result);
    expect(() => s.call('saveTranscription', { ...s.input, fileHash: 'b'.repeat(64) })).toThrow('original');
    s.as(bob); expect(s.call('listTranscriptions')).toEqual([]); expect(() => s.call('getTranscription', { id: result.id })).toThrow('privado');
    s.as(admin); expect(() => s.call('getTranscription', { id: result.id })).toThrow('privado');
    s.as(alice); s.rows('note')[0]!.version = 2; expect(() => s.call('getTranscription', { id: result.id })).toThrow('cambió');
  });
  it('revalida documentos compartidos dentro de una versión guardada sin abrir la API privada', () => {
    const s = setup(); const t = s.call<DocumentTranscription>('saveTranscription', s.input);
    const source: AiSourceRef = { kind: 'note', refId: '1', transcriptionIds: [t.id], topics: ['Tema'], includeUnplaced: true };
    const snapshot: AiSourceSnapshot = { kind: 'note', refId: '1', version: 1, subjectId: '1', title: 'Nota', visibility: 'group', fields: [] };
    s.as(bob); expect(() => appendDocumentTranscriptions(s.ctx, source, snapshot, bob)).toThrow('privado');
    const appended = appendDocumentTranscriptions(s.ctx, source, snapshot, bob, { reuseReviewed: true });
    expect(appended.fields[0]?.text).toBe('Texto revisado');
    const origin = { kind: 'note' as const, refId: '1', version: 1, field: 'archivo', startLine: 1, endLine: 1, transcriptionId: t.id, fileId: t.fileId, fileHash: t.fileHash, locator: t.segments[0]!.locator };
    expect(() => validateDocumentOrigins(s.ctx, { fragments: [{ id: 'fragment', text: 'Texto revisado', origins: [origin] }] }, bob)).not.toThrow();
    s.rows('note')[0]!.visibility = 'personal'; expect(() => appendDocumentTranscriptions(s.ctx, source, snapshot, bob, { reuseReviewed: true })).toThrow();
  });
  it('mantiene la cita histórica de B al retirar A, sin permitir una preparación nueva con la versión vieja', () => {
    const s = setup(); const first = s.call<DocumentTranscription>('saveTranscription', s.input);
    const secondHash = 'b'.repeat(64);
    s.add('resourceFile', { ...s.rows('resourceFile')[0]!, id: 'second', name: 'segundo.pdf', storageKey: 'stdb:second', etag: secondHash });
    s.add('resourceUpload', { ...s.rows('resourceUpload')[0]!, id: 'second', sha256: secondHash });
    const second = s.call<DocumentTranscription>('saveTranscription', { ...s.input, id: uuid(10), fileId: 'second', fileHash: secondHash });
    const fragment = (value: DocumentTranscription) => ({ id: value.id, text: value.segments[0]!.text, origins: [{
      kind: 'note' as const, refId: '1', version: value.targetVersion, field: 'archivo', startLine: 1, endLine: 1,
      transcriptionId: value.id, fileId: value.fileId, fileHash: value.fileHash, locator: value.segments[0]!.locator,
    }] });
    s.rows('resourceFile').find((row) => row.id === first.fileId)!.removedAt = s.state.timestamp;
    s.rows('note')[0]!.version = 2; s.as(bob);
    expect(() => validateDocumentOrigins(s.ctx, { fragments: [fragment(first)] }, bob)).toThrow('disponible');
    expect(() => validateDocumentOrigins(s.ctx, { fragments: [fragment(second)] }, bob)).not.toThrow();
    const changedOrigin = fragment(second); changedOrigin.origins[0]!.version = 2;
    expect(() => validateDocumentOrigins(s.ctx, { fragments: [changedOrigin] }, bob)).toThrow('procedencia');
    const source: AiSourceRef = { kind: 'note', refId: '1', transcriptionIds: [second.id], topics: ['Tema'], includeUnplaced: true };
    const snapshot: AiSourceSnapshot = { kind: 'note', refId: '1', version: 2, subjectId: '1', title: 'Nota', visibility: 'group', fields: [] };
    expect(() => appendDocumentTranscriptions(s.ctx, source, snapshot, bob, { reuseReviewed: true })).toThrow('cambió');
    s.as(alice); expect(() => s.call('getTranscription', { id: second.id })).toThrow('cambió');
    expect(() => s.call('saveTranscription', { ...s.input, id: uuid(11), fileId: 'second', fileHash: secondHash })).toThrow('vigente');
    s.rows('resourceFile').find((row) => row.id === second.fileId)!.removedAt = s.state.timestamp;
    expect(() => validateDocumentOrigins(s.ctx, { fragments: [fragment(second)] }, alice)).toThrow('disponible');
  });
  it('solo el servicio acredita archivos heredados y comprueba su identidad almacenada', () => {
    const s = setup(); s.rows('resourceFile')[0]!.storageKey = 'legacy/object'; s.rows('resourceFile')[0]!.etag = 'etag-original';
    expect(() => s.call('fileInfo', { fileId: 'native' })).toThrow('Verifica');
    const access = s.call<{ stamp: string }>('fileAccess', { fileId: 'native' });
    expect(() => s.call('accreditFile', { actor: alice.toHexString(), fileId: 'native', fileHash: s.input.fileHash, stamp: access.stamp })).toThrow('servicio');
    s.as(service); expect(() => s.call('accreditFile', { actor: alice.toHexString(), fileId: 'native', fileHash: s.input.fileHash, stamp: 'inventado' })).toThrow('cambió');
    expect(s.call<DocumentFileMetadata>('accreditFile', { actor: alice.toHexString(), fileId: 'native', fileHash: s.input.fileHash, stamp: access.stamp }).fileHash).toBe(s.input.fileHash);
    s.rows('resourceFile')[0]!.etag = 'etag-cambiado'; s.as(alice); expect(() => s.call('fileInfo', { fileId: 'native' })).toThrow('Verifica');
  });
  it('comparte cuotas, no vuelve a reclamar un envío y no resucita OCR cancelado con resultados tardíos', () => {
    const s = setup(); const draft = s.authorize(s.prepare()); s.as(service);
    const claim = s.call<DocumentOcrClaim>('claimOcr', { actor: alice.toHexString(), id: draft.id, generationId: uuid(3) }); expect(claim.claimed).toBe(true);
    expect(s.rows('aiReservation')).toHaveLength(1); expect(s.call<DocumentOcrClaim>('claimOcr', { actor: alice.toHexString(), id: draft.id, generationId: uuid(3) }).claimed).toBe(false);
    s.as(alice); const cancelled = s.call<DocumentOcrDraft>('cancelOcr', { id: draft.id, expectedRevision: claim.draft.revision }); s.as(service);
    const late = s.call<DocumentOcrDraft>('finishOcr', { actor: alice.toHexString(), id: draft.id, generationId: uuid(3), state: 'succeeded', result: { segments: s.input.segments, omissions: [] } });
    expect(late.state).toBe('cancelled'); expect(late.result).toBeUndefined(); expect(cancelled.state).toBe('cancelled'); expect(s.rows('aiReservation')[0]?.status).toBe('consumed');
  });
  it('revalida la clave al reclamar, evita selección >40k y protege originales por identidad activa', () => {
    const s = setup(); const draft = s.authorize(s.prepare()); s.rows('aiKey')[0]!.keyId = uuid(98); s.as(service);
    expect(() => s.call('claimOcr', { actor: alice.toHexString(), id: draft.id, generationId: uuid(3) })).toThrow('clave cambió');
    s.as(alice); const transcript = s.call<DocumentTranscription>('saveTranscription', { ...s.input, segments: [{ ...s.input.segments[0], text: 'x'.repeat(40_001) }] });
    const source: AiSourceRef = { kind: 'note', refId: '1', transcriptionIds: [transcript.id], topics: ['Tema'], includeUnplaced: true };
    expect(() => appendDocumentTranscriptions(s.ctx, source, { kind: 'note', refId: '1', version: 1, title: 'Nota', subjectId: '1', fields: [], visibility: 'group' }, alice)).toThrow('40 000');
    s.as(service); expect(s.call<{ base64: string }>('readChunk', { actor: alice.toHexString(), fileId: 'native', index: 0 }).base64).toBe('AQID');
    s.rows('member')[0]!.status = 'removed'; expect(() => s.call('readChunk', { actor: alice.toHexString(), fileId: 'native', index: 0 })).toThrow('disponible');
  });
});
