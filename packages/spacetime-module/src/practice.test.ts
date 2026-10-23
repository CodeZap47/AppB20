import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
vi.mock('spacetimedb/server', () => { const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1); return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) }; });
import { practice_create_challenge, practice_unlock_hint, practice_save_solution, practice_add_challenge_comment, practice_close_challenge, practice_create_code_review, practice_add_code_version, practice_add_code_comment, practice_resolve_code_comment, practice_close_code_review, coding_challenges, challenge_hints, my_challenge_progress, code_reviews, code_review_versions, code_review_comments, type Ctx } from './index';
type Row = Record<string, unknown>;
const owner = Identity.fromString('a'.repeat(64)), peer = Identity.fromString('b'.repeat(64)), outsider = Identity.fromString('c'.repeat(64));
const keyOf = (value: unknown) => value instanceof Identity ? value.toHexString() : String(value);
function tableStore(primary: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [keyOf(row[primary]), row])); let next = 1n;
  return new Proxy({ rows, iter: () => rows.values(), insert(input: Row) { const row: Row = { ...input, ...(input.id === 0n ? { id: next++ } : {}) }; rows.set(keyOf(row[primary]), row); return row; } }, { get(target, field: string) { if (field in target) return target[field as keyof typeof target]; return { find: (value: unknown) => rows.get(keyOf(value)), update: (row: Row) => { rows.set(keyOf(row[primary]), { ...row }); return row; }, delete: (value: unknown) => rows.delete(keyOf(value)), filter: (value: unknown) => [...rows.values()].filter((row) => keyOf(row[field]) === keyOf(value)) }; } });
}
function setup() {
  const initial: Record<string, Row[]> = { appConfig: [{ id: 0, owner }], authConfig: [{ id: 0, issuer: 'https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1', audiences: ['test'] }], member: [owner, peer].map((identity) => ({ identity, status: 'active' })), subject: [{ id: 1n }] };
  const primary: Record<string, string> = { member: 'identity', challengeHint: 'key', challengeProgress: 'key', codeReviewVersion: 'key' }; const tables = new Map<string, ReturnType<typeof tableStore>>();
  const db = new Proxy({}, { get: (_, name: string) => { if (!tables.has(name)) tables.set(name, tableStore(primary[name] ?? 'id', initial[name])); return tables.get(name); } });
  const state = { db, sender: owner, timestamp: new Timestamp(1_790_000_000_000_000n), env: {}, senderAuth: { jwt: { issuer: 'https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'student@example.test', email_verified: true } } } };
  const ctx = state as unknown as Ctx & Parameters<typeof coding_challenges>[0]; const payload = (value: unknown) => ({ payload: JSON.stringify(value) });
  const challenge = (changes = {}) => practice_create_challenge(ctx, payload({ requestId: 'challenge', subjectId: '1', title: 'Suma', topic: 'Listas', difficulty: 'basic', objective: 'Acumular', instructions: 'Suma la lista', examples: '[1,2] → 3', hints: ['Recorre', 'Acumula'], ...changes }));
  const review = (changes = {}) => practice_create_code_review(ctx, payload({ requestId: 'review', subjectId: '1', title: 'Bucle', language: 'TS', summary: 'Límites', code: 'a()\nb()', repositoryUrl: '', ...changes }));
  const as = (sender: Identity) => { state.sender = sender; }; const rows = (name: string) => [...(db as Record<string, ReturnType<typeof tableStore>>)[name].rows.values()];
  return { ctx, state, payload, challenge, review, as, rows };
}
describe('Servidor Retos y revisión', () => {
  it('separa pistas/progreso de cada miembro y no entrega nada después de una baja', () => {
    const s = setup(); s.challenge(); expect(challenge_hints(s.ctx)).toHaveLength(2); s.as(peer); expect(challenge_hints(s.ctx)).toHaveLength(0);
    practice_unlock_hint(s.ctx, s.payload({ challengeId: '1', expectedUnlocked: 0 })); practice_unlock_hint(s.ctx, s.payload({ challengeId: '1', expectedUnlocked: 0 })); expect(challenge_hints(s.ctx)).toHaveLength(1); expect(my_challenge_progress(s.ctx)[0]?.unlockedHints).toBe(1);
    s.as(owner); expect(my_challenge_progress(s.ctx)).toHaveLength(0); s.ctx.db.member.identity.update({ ...s.ctx.db.member.identity.find(owner)!, status: 'removed' }); expect(coding_challenges(s.ctx)).toHaveLength(0); expect(challenge_hints(s.ctx)).toHaveLength(0); expect(() => s.challenge({ requestId: 'new' })).toThrow(/activo/);
  });
  it('rechaza extraños y valida materia y payload sin insertar contenido', () => {
    const s = setup(); s.as(outsider); expect(() => s.challenge()).toThrow(/activo/); expect(code_reviews(s.ctx)).toHaveLength(0); s.as(owner); expect(() => s.challenge({ subjectId: '2' })).toThrow(/materia/); expect(() => practice_create_challenge(s.ctx, { payload: '[]' })).toThrow(/válido/); expect(s.rows('codingChallenge')).toHaveLength(0);
  });
  it('creación y envío de solución son idempotentes; no permite pisar cambios concurrentes', () => {
    const s = setup(); s.challenge(); s.challenge(); expect(() => s.challenge({ title: 'Otra cosa' })).toThrow(/otro contenido/); expect(s.rows('codingChallenge')).toHaveLength(1); s.as(peer); const input = { challengeId: '1', body: 'sum()', explanation: 'Acumula cada elemento', expectedVersion: 0, requestId: 'solution' };
    practice_save_solution(s.ctx, s.payload(input)); practice_save_solution(s.ctx, s.payload(input)); expect(s.rows('challengeSolution')).toHaveLength(1); expect(() => practice_save_solution(s.ctx, s.payload({ ...input, requestId: 'other' }))).toThrow(/cambió/);
  });
  it('el cierre exige autor y conclusión, y detiene comentarios y soluciones', () => {
    const s = setup(); s.challenge(); s.as(peer); expect(() => practice_close_challenge(s.ctx, s.payload({ challengeId: '1', closure: 'Listo', expectedVersion: 1 }))).toThrow(/autor/); s.as(owner); practice_close_challenge(s.ctx, s.payload({ challengeId: '1', closure: 'Aprendimos a sumar', expectedVersion: 1 }));
    expect(() => practice_add_challenge_comment(s.ctx, s.payload({ challengeId: '1', body: 'x', requestId: 'comment' }))).toThrow(/cerrada/); expect(() => practice_save_solution(s.ctx, s.payload({ challengeId: '1', body: 'x', explanation: 'x', requestId: 'solution', expectedVersion: 0 }))).toThrow(/cerrada/);
  });
  it('mantiene código antiguo y comentarios de línea aunque una nueva versión sea más corta', () => {
    const s = setup(); s.review(); s.review(); s.as(peer); practice_add_code_comment(s.ctx, s.payload({ reviewId: '1', versionNumber: 1, lineStart: 2, lineEnd: 2, kind: 'error', body: 'Revisar este paso', requestId: 'c' })); s.as(owner);
    const input = { reviewId: '1', code: 'new()', repositoryUrl: '', summary: 'Corregido', expectedVersion: 1, requestId: 'v2' }; practice_add_code_version(s.ctx, s.payload(input)); practice_add_code_version(s.ctx, s.payload(input)); expect(code_review_versions(s.ctx)).toHaveLength(2); expect(code_review_versions(s.ctx)[0]?.code).toBe('a()\nb()'); expect(code_review_comments(s.ctx)[0]?.versionNumber).toBe(1);
    expect(() => practice_add_code_comment(s.ctx, s.payload({ reviewId: '1', versionNumber: 2, lineStart: 2, lineEnd: 2, kind: 'error', body: 'Inexistente', requestId: 'c2' }))).toThrow(/líneas/); expect(() => practice_add_code_version(s.ctx, s.payload({ ...input, requestId: 'stale' }))).toThrow(/cambió/);
  });
  it('solo el dueño responde estados con explicación y puede cerrar', () => {
    const s = setup(); s.review(); s.as(peer); practice_add_code_comment(s.ctx, s.payload({ reviewId: '1', versionNumber: 1, lineStart: 0, lineEnd: 0, kind: 'suggestion', body: 'Nombres claros', requestId: 'c' })); const resolution = { commentId: '1', status: 'applied', resolution: 'Corregí los nombres', expectedVersion: 1 };
    expect(() => practice_resolve_code_comment(s.ctx, s.payload(resolution))).toThrow(/autor/); expect(() => practice_close_code_review(s.ctx, s.payload({ reviewId: '1', expectedVersion: 1 }))).toThrow(/autor/); s.as(owner); expect(() => practice_resolve_code_comment(s.ctx, s.payload({ ...resolution, resolution: '' }))).toThrow(/obligatorio/); practice_resolve_code_comment(s.ctx, s.payload(resolution)); expect(code_review_comments(s.ctx)[0]?.status).toBe('applied');
    practice_close_code_review(s.ctx, s.payload({ reviewId: '1', expectedVersion: 1 })); expect(() => practice_add_code_version(s.ctx, s.payload({ reviewId: '1', code: 'x', repositoryUrl: '', summary: 'x', expectedVersion: 2, requestId: 'later' }))).toThrow(/cerrada/);
  });
  it('un repo externo acepta solo comentario general y nunca descarga contenido', () => {
    const s = setup(); expect(() => s.review({ repositoryUrl: 'javascript:alert(1)' })).toThrow(/HTTPS/); s.review({ code: '', repositoryUrl: 'https://github.com/group/repo/tree/hash' }); practice_add_code_comment(s.ctx, s.payload({ reviewId: '1', versionNumber: 1, lineStart: 0, lineEnd: 0, kind: 'question', body: '¿Por qué esta decisión?', requestId: 'general' })); expect(code_review_comments(s.ctx)).toHaveLength(1);
    expect(() => practice_add_code_comment(s.ctx, s.payload({ reviewId: '1', versionNumber: 1, lineStart: 1, lineEnd: 1, kind: 'error', body: 'x', requestId: 'line' }))).toThrow(/líneas/);
  });
  it('el reintento no puede cambiar silenciosamente el contenido original', () => {
    const s = setup(); s.challenge(); s.review(); expect(() => s.review({ code: 'changed()' })).toThrow(/otro contenido/);
    const solution = { challengeId: '1', body: 'sum()', explanation: 'Acumula', expectedVersion: 0, requestId: 's' }; practice_save_solution(s.ctx, s.payload(solution)); expect(() => practice_save_solution(s.ctx, s.payload({ ...solution, body: 'different()' }))).toThrow(/otro contenido/);
    const version = { reviewId: '1', code: 'new()', repositoryUrl: '', summary: 'Cambio', expectedVersion: 1, requestId: 'v2' }; practice_add_code_version(s.ctx, s.payload(version)); expect(() => practice_add_code_version(s.ctx, s.payload({ ...version, summary: 'Otro contexto' }))).toThrow(/otro contenido/);
    const comment = { reviewId: '1', versionNumber: 1, lineStart: 0, lineEnd: 0, kind: 'question', body: '¿Por qué?', requestId: 'c' }; practice_add_code_comment(s.ctx, s.payload(comment)); practice_add_code_comment(s.ctx, s.payload(comment)); expect(() => practice_add_code_comment(s.ctx, s.payload({ ...comment, body: '¿Distinto?' }))).toThrow(/otro contenido/); expect(code_review_comments(s.ctx)).toHaveLength(1);
  });
});
