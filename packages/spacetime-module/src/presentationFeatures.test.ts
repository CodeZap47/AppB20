import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import { sha256 } from '@noble/hashes/sha2.js';
import { AI_CONSENT_VERSION } from '../../core/src/ai';
import type { PresentationAiDraft } from '../../core/src/presentationAi';
import type { PresentationAudio } from '../../core/src/presentationMedia';
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import { presentation_ai, presentation_media, complete_presentation_attempt, set_presentation_reviewer, archive_presentation_practice, type Ctx } from './index';
import { purgePresentationAiSource } from './presentationAiHandlers';
const person = (digit: string) => Identity.fromString(digit.repeat(64));
const alice = person('a'); const bob = person('b'); const admin = person('c'); const service = person('d');
const uid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Row = Record<string, unknown>;
const keyOf = (value: unknown) => typeof value === 'object' && value !== null && 'toHexString' in value ? (value as Identity).toHexString() : String(value);
function tableStore(key: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [keyOf(row[key]), row])); let next = 1n;
  return new Proxy({ rows, iter: () => rows.values(), insert: (input: Row) => { const row: Row = { ...input, ...(input.id === 0n ? { id: next++ } : {}) }; if (rows.has(keyOf(row[key]))) throw new Error('Duplicate'); rows.set(keyOf(row[key]), row); return row; } }, {
    get(target, name) { if (name in target) return target[name as keyof typeof target]; return { find: (value: unknown) => rows.get(keyOf(value)), update: (row: Row) => { rows.set(keyOf(row[key]), row); return row; }, delete: (value: unknown) => rows.delete(keyOf(value)), filter: (value: unknown) => [...rows.values()].filter((row) => keyOf(row[String(name)]) === keyOf(value)) }; },
  });
}
function setup() {
  const at = new Timestamp(1_790_000_000_000_000n); const configuration = { title: 'Exposición', topic: 'Ciclos', audience: 'Clase', targetMinutes: 5, keyPoints: ['Condiciones'] };
  const initial: Record<string, Row[]> = {
    appConfig: [{ id: 0, owner: admin }], authConfig: [{ id: 0, issuer: 'https://issuer.test', audiences: ['test'] }], member: [alice, bob, admin].map((identity) => ({ identity, status: 'active', isCreator: identity.isEqual(admin) })),
    aiServiceConfig: [{ id: 0, identity: service, enabled: true, dailyTokenBudget: 100_000 }],
    aiConsent: [{ actor: alice, version: AI_CONSENT_VERSION, accepted: true }], aiKey: [{ actor: alice, keyId: uid(99), provider: 'gemini', ciphertext: 'secret', iv: 'iv', masterVersion: 'v1' }],
    presentationPractice: [{ id: 1n, ownerId: alice, reviewerId: bob, subjectId: 1n, archived: false, version: 1, ...configuration }],
    presentationAttempt: [{ id: 1n, practiceId: 1n, number: 1, status: 'draft', body: '', version: 1, subjectId: 1n, ...configuration }],
    presentationPersonal: [{ attemptId: 1n, clarity: 'SECRETO', examples: '', decisions: '', limitations: '', nextSteps: 'SECRETO' }],
  };
  const keys: Record<string, string> = { member: 'identity', aiConsent: 'actor', aiKey: 'actor', presentationPersonal: 'attemptId', presentationAudioChunk: 'key', presentationAudioGrant: 'uploadId' };
  const tables = new Map<string, ReturnType<typeof tableStore>>(); const db = new Proxy({}, { get: (_target, name: string) => { if (!tables.has(name)) tables.set(name, tableStore(keys[name] ?? 'id', initial[name])); return tables.get(name); } });
  const state = { db, sender: alice, timestamp: at, env: {}, senderAuth: { jwt: { issuer: 'https://issuer.test', audience: ['test'], fullPayload: { email: 'test@example.test', email_verified: true } } } };
  const ctx = state as unknown as Ctx; const proc = { withTx: (fn: (value: Ctx) => unknown) => fn(ctx) } as unknown as Parameters<typeof presentation_ai>[0];
  const rows = (name: string) => [...(db as Record<string, ReturnType<typeof tableStore>>)[name].rows.values()];
  const media = <T = PresentationAudio>(action: string, input: Record<string, unknown> = {}) => JSON.parse(presentation_media(proc, { payload: JSON.stringify({ action, ...input }) })) as T;
  const ai = <T = PresentationAiDraft>(action: string, input: Record<string, unknown> = {}) => JSON.parse(presentation_ai(proc, { payload: JSON.stringify({ action, ...input }) })) as T;
  const as = (person: Identity) => { state.sender = person; };
  const digest = (bytes: Uint8Array) => Array.from(sha256(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
  const begin = (n = 1) => media('begin', { id: uid(n), attemptId: '1', expectedVersion: 1, name: 'ensayo.wav', mime: 'audio/wav', bytes: 4, sha256: digest(Uint8Array.from([1, 2, 3, 4])) });
  const readyAudio = (n = 1) => { begin(n); media('putChunk', { id: uid(n), index: 0, bytes: [1, 2, 3, 4], sha256: digest(Uint8Array.from([1, 2, 3, 4])) }); as(service); const value = media('serviceValidate', { id: uid(n), sha256: digest(Uint8Array.from([1, 2, 3, 4])), mime: 'audio/wav', durationSeconds: 30 }); as(alice); return value; };
  const prepare = (purpose = 'outline', n = 10) => ai('prepare', { id: uid(n), purpose, attemptId: '1', expectedVersion: rows('presentationAttempt')[0]!.version, model: 'gemini-test' });
  const authorize = (draft: PresentationAiDraft, n = 20) => ai<{ draft: PresentationAiDraft }>('authorize', { id: draft.id, generationId: uid(n), expectedRevision: draft.revision, fingerprint: draft.fingerprint, model: draft.model, allowNew: true, confirmed: true }).draft;
  const claim = (draft: PresentationAiDraft, n = 20) => { as(service); const value = ai<{ claimed: boolean; draft: PresentationAiDraft }>('claim', { id: draft.id, actor: alice.toHexString(), generationId: uid(n) }); as(alice); return value; };
  const finish = (draft: PresentationAiDraft, result: unknown, n = 20) => { as(service); const value = ai('finish', { id: draft.id, actor: alice.toHexString(), generationId: uid(n), state: 'succeeded', result }); as(alice); return value; };
  return { ctx, state, rows, as, media, ai, begin, readyAudio, prepare, authorize, claim, finish };
}
describe('Exposiciones IA y audio privados', () => {
  it('reserva en la cuota existente, comprueba bloques y limita a un audio por intento', () => {
    const s = setup(); const audio = s.begin(); expect(s.rows('resourceCapacity')[0]?.reservedBytes).toBe(4n);
    expect(() => s.begin(2)).toThrow(/un audio/); expect(() => s.media('putChunk', { id: audio.id, index: 0, bytes: [1, 2, 3, 5], sha256: audio.sha256 })).toThrow(/integridad/);
    s.media('cancel', { id: audio.id }); expect(s.rows('resourceCapacity')[0]?.reservedBytes).toBe(0n); expect(s.rows('presentationAudioChunk')).toHaveLength(0);
  });
  it('permite concluir solo con audio y exige compartir expresamente; el administrador queda excluido', () => {
    const s = setup(); const audio = s.readyAudio(); complete_presentation_attempt(s.ctx, { attemptId: 1n, expectedVersion: 1 });
    s.as(bob); expect(s.media('list', { attemptId: '1' })).toEqual([]); expect(() => s.media('get', { id: audio.id })).toThrow(/compartido/);
    s.as(admin); expect(() => s.media('get', { id: audio.id })).toThrow(); s.as(alice); s.media('share', { id: audio.id, shared: true });
    s.as(bob); expect(s.media('get', { id: audio.id })).toMatchObject({ state: 'ready' });
    s.as(alice); set_presentation_reviewer(s.ctx, { practiceId: 1n, reviewerId: undefined, expectedVersion: 1 });
    s.as(bob); expect(() => s.media('get', { id: audio.id })).toThrow();
  });
  it('archivar revoca permisos y borrar elimina bytes, libera cuota y deja marcador', () => {
    const s = setup(); const audio = s.readyAudio(); complete_presentation_attempt(s.ctx, { attemptId: 1n, expectedVersion: 1 }); s.media('share', { id: audio.id, shared: true });
    archive_presentation_practice(s.ctx, { practiceId: 1n, archived: true, expectedVersion: 1 });
    expect(s.rows('presentationAudioGrant')).toHaveLength(0); s.media('delete', { id: audio.id });
    expect(s.rows('presentationAudioChunk')).toHaveLength(0); expect(s.rows('resourceCapacity')[0]?.reservedBytes).toBe(0n); expect(s.rows('presentationAudioUpload')[0]?.state).toBe('deleted');
    expect(s.rows('changeLog')).toHaveLength(0);
  });
  it('no envía autoobservaciones y reserva una sola llamada ante replay', () => {
    const s = setup(); const draft = s.prepare(); expect(JSON.stringify(draft)).not.toContain('SECRETO'); s.as(bob); expect(() => s.ai('get', { id: draft.id })).toThrow(); s.as(alice);
    const authorized = s.authorize(draft); expect(s.claim(authorized).claimed).toBe(true); expect(s.claim(authorized).claimed).toBe(false); expect(s.rows('aiReservation')).toHaveLength(1);
    const finished = s.finish(authorized, { outline: 'Introducción, ejemplo y cierre.' }); const accepted = s.ai('accept', { id: draft.id, expectedRevision: finished.revision, reviewed: true, result: finished.result });
    expect(accepted.state).toBe('accepted'); expect(s.rows('presentationAttempt')[0]?.body).toBe('Introducción, ejemplo y cierre.'); expect(s.rows('presentationPersonal')[0]?.clarity).toBe('SECRETO');
    s.ai('accept', { id: draft.id, expectedRevision: finished.revision, reviewed: true, result: finished.result }); expect(s.rows('presentationAttempt')[0]?.version).toBe(2);
  });
  it('acepta transcripción revisada, la conserva tras borrar y descarta resultados tardíos no aceptados', () => {
    const s = setup(); const audio = s.readyAudio(); complete_presentation_attempt(s.ctx, { attemptId: 1n, expectedVersion: 1 });
    const draft = s.authorize(s.prepare('transcription')); s.claim(draft); const result = { segments: [{ startSeconds: 0, endSeconds: 15, text: 'Explico los ciclos.' }] };
    const finished = s.finish(draft, result); s.ai('accept', { id: draft.id, expectedRevision: finished.revision, reviewed: true, result });
    const later = s.authorize(s.prepare('transcription', 11), 21); s.claim(later, 21); s.media('delete', { id: audio.id }); s.finish(later, result, 21);
    expect(s.ai('get', { id: draft.id }).result).toEqual(result); expect(s.rows('presentationAiDraft').map((row) => JSON.parse(String(row.json))).find((row) => row.id === later.id)).toMatchObject({ state: 'cancelled' });
    expect(s.rows('aiReservation')).toHaveLength(2);
  });
  it('consulta envíos inciertos sin duplicar y comparte presupuesto con otras herramientas', () => {
    const s = setup(); const draft = s.authorize(s.prepare()); s.claim(draft); s.state.timestamp = new Timestamp(s.state.timestamp.microsSinceUnixEpoch + 91_000_000n);
    expect(s.ai('get', { id: draft.id }).state).toBe('unknown'); expect(s.claim(draft).claimed).toBe(false); expect(s.rows('aiReservation')).toHaveLength(1);
    const second = s.authorize(s.prepare('outline', 12), 22); expect(() => s.claim(second, 22)).toThrow(/incierto/);
  });
  it('purga la copia privada del material y no conserva un resultado tardío en el registro de consumo', () => {
    const s = setup();
    s.ctx.db.note.insert({ id: 7n, subjectId: 1n, title: 'Referencia', topic: 'Ciclos', body: 'ORIGINAL_PRIVADO_PARA_PURGAR', version: 1, author: alice, visibility: 'personal', source: 'student' } as never);
    s.ctx.db.presentationAttempt.id.update({ ...s.ctx.db.presentationAttempt.id.find(1n)!, sourceKind: 'note', sourceId: 7n, sourceVersion: 1 });
    const draft = s.authorize(s.prepare()); s.claim(draft);
    expect(s.rows('presentationAiDraft').map((row) => row.json).join('')).toContain('ORIGINAL_PRIVADO_PARA_PURGAR');
    purgePresentationAiSource(s.ctx, 'note', 7n); s.ctx.db.note.id.delete(7n);
    expect(s.rows('presentationAiDraft').map((row) => row.json).join('')).not.toContain('ORIGINAL_PRIVADO_PARA_PURGAR');
    const late = s.finish(draft, { outline: 'Resultado con ORIGINAL_PRIVADO_PARA_PURGAR' });
    expect(late.state).toBe('cancelled'); expect(late.result).toBeUndefined();
    expect(s.rows('aiGeneration')[0]).toMatchObject({ status: 'succeeded', resultJson: '' });
    expect(s.rows('presentationAiDraft').map((row) => row.json).join('')).not.toContain('ORIGINAL_PRIVADO_PARA_PURGAR');
    expect(s.rows('aiReservation')[0]?.status).toBe('consumed');
  });
  it('purga un resultado no aceptado ya recibido y conserva un esquema aceptado como trabajo independiente', () => {
    const s = setup();
    s.ctx.db.note.insert({ id: 7n, subjectId: 1n, title: 'Referencia', topic: 'Ciclos', body: 'ORIGINAL_PRIVADO_PARA_PURGAR', version: 1, author: alice, visibility: 'personal', source: 'student' } as never);
    s.ctx.db.presentationAttempt.id.update({ ...s.ctx.db.presentationAttempt.id.find(1n)!, sourceKind: 'note', sourceId: 7n, sourceVersion: 1 });
    const acceptedDraft = s.authorize(s.prepare()); s.claim(acceptedDraft);
    const finished = s.finish(acceptedDraft, { outline: 'Esquema propio revisado.' });
    s.ai('accept', { id: acceptedDraft.id, expectedRevision: finished.revision, reviewed: true, result: finished.result });
    const pending = s.authorize(s.prepare('outline', 11), 21); s.claim(pending, 21);
    s.finish(pending, { outline: 'Resultado sin aceptar ORIGINAL_PRIVADO_PARA_PURGAR' }, 21);
    purgePresentationAiSource(s.ctx, 'note', 7n); s.ctx.db.note.id.delete(7n);
    const accepted = s.ai('get', { id: acceptedDraft.id });
    expect(accepted.state).toBe('accepted'); expect(accepted.result).toMatchObject({ outline: 'Esquema propio revisado.', orientative: false });
    expect(s.rows('presentationAttempt')[0]?.body).toBe('Esquema propio revisado.');
    expect(s.rows('presentationAiDraft').map((row) => row.json).join('')).not.toContain('ORIGINAL_PRIVADO_PARA_PURGAR');
    expect(s.rows('aiGeneration').find((row) => row.id === uid(21))?.resultJson).toBe('');
    const revision = accepted.revision; purgePresentationAiSource(s.ctx, 'note', 7n);
    expect(s.ai('get', { id: acceptedDraft.id }).revision).toBe(revision);
    expect(s.ai('accept', { id: acceptedDraft.id, expectedRevision: finished.revision, reviewed: true, result: finished.result }).state).toBe('accepted');
  });
});
