import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
vi.mock('spacetimedb/server', () => { const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1); return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, clientDisconnected: handler, view: handler }) }; });
import { create_teaching_practice, save_teaching_practice, set_teaching_reviewer, start_teaching_practice, complete_teaching_practice, reopen_teaching_practice, answer_teaching_question, teaching_save_v2, teaching_read_history, my_teaching_versions, type Ctx } from './index';
type Row = Record<string, unknown>;
const owner = Identity.fromString('a'.repeat(64)), reviewer = Identity.fromString('b'.repeat(64)), admin = Identity.fromString('c'.repeat(64));
const keyOf = (value: unknown) => value instanceof Identity ? value.toHexString() : String(value);
function tableStore(primary: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [keyOf(row[primary]), row])); let next = 1n;
  return new Proxy({ rows, iter: () => rows.values(), insert(input: Row) { const row: Row = { ...input, ...(input.id === 0n ? { id: next++ } : {}) }; rows.set(keyOf(row[primary]), row); return row; } }, { get(target, field: string) { if (field in target) return target[field as keyof typeof target]; return { find: (value: unknown) => rows.get(keyOf(value)), update: (row: Row) => { rows.set(keyOf(row[primary]), { ...row }); return row; }, delete: (value: unknown) => rows.delete(keyOf(value)), filter: (value: unknown) => [...rows.values()].filter((row) => keyOf(row[field]) === keyOf(value)) }; } });
}
function setup() {
  const initial: Record<string, Row[]> = { appConfig: [{ id: 0, owner: admin }], authConfig: [{ id: 0, issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['test'] }], member: [owner, reviewer, admin].map((identity) => ({ identity, status: 'active', isCreator: identity.isEqual(admin) })), subject: [{ id: 1n }] };
  const primary: Record<string, string> = { member: 'identity', teachingPersonal: 'practiceId', teachingHead: 'practiceId', teachingRevision: 'key', teachingIntent: 'key' }; const tables = new Map<string, ReturnType<typeof tableStore>>();
  const db = new Proxy({}, { get: (_, name: string) => { if (!tables.has(name)) tables.set(name, tableStore(primary[name] ?? 'id', initial[name])); return tables.get(name); } });
  const state = { db, sender: owner, timestamp: new Timestamp(1_790_000_000_000_000n), env: {}, senderAuth: { jwt: { issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'student@example.test', email_verified: true } } } };
  const ctx = state as unknown as Ctx & Parameters<typeof my_teaching_versions>[0]; const procedure = { withTx: (fn: (tx: typeof ctx) => unknown) => fn(ctx) } as unknown as Parameters<typeof teaching_save_v2>[0];
  create_teaching_practice(ctx, { subjectId: 1n, topic: 'Listas', concept: 'Concepto original', example: 'Ejemplo original', limits: 'Límites originales' });
  let counter = 0; const requestId = () => `00000000-0000-4000-8000-${(++counter).toString().padStart(12, '0')}`;
  const input = (patch = {}) => ({ practiceId: '1', expectedVersion: 1, requestId: requestId(), initial: { concept: 'Concepto guardado', example: 'Ejemplo guardado', limits: 'Límites guardados' }, revised: { concept: 'Concepto revisado', example: 'Ejemplo revisado', limits: 'Límites revisados' }, reflection: 'Reflexión personal privada', topicsToReview: 'Revisar casos vacíos', ...patch });
  const save = (value: ReturnType<typeof input>) => JSON.parse(teaching_save_v2(procedure, { payload: JSON.stringify(value) })) as { ok: boolean; message?: string; data?: { id: string; version: number } };
  const history = () => JSON.parse(teaching_read_history(procedure as Parameters<typeof teaching_read_history>[0], { practiceId: 1n })) as { ok: boolean; message?: string; data?: { version: number; reflection: string; status: string }[] };
  const as = (sender: Identity) => { state.sender = sender; }; const rows = (name: string) => [...(db as Record<string, ReturnType<typeof tableStore>>)[name].rows.values()];
  return { ctx, save, history, input, as, rows };
}
describe('Versiones manuales de Aprende enseñando', () => {
  it('siembra v1 y captura v2; una pestaña obsoleta no sobrescribe la primera edición', () => {
    const s = setup(); expect(s.save(s.input())).toMatchObject({ ok: true, data: { id: '1', version: 2 } }); expect(s.save(s.input({ reflection: 'Edición de otra pestaña' }))).toMatchObject({ ok: false });
    expect(s.history().data?.map((row) => row.version)).toEqual([2, 1]); expect(s.history().data?.[0]?.reflection).toBe('Reflexión personal privada'); expect(s.rows('teachingPractice')[0]?.concept).toBe('Concepto guardado');
  });
  it('reintenta una intención sin duplicar y rechaza reutilizarla para contenido diferente', () => {
    const s = setup(); const input = s.input(); const first = s.save(input); expect(s.save(input)).toEqual(first); expect(s.save({ ...input, reflection: 'Otro texto' })).toMatchObject({ ok: false }); expect(s.history().data).toHaveLength(2);
    expect(s.save(s.input({ expectedVersion: 2 }))).toMatchObject({ ok: true, data: { version: 2 } }); expect(s.history().data).toHaveLength(2);
  });
  it('sólo el autor consulta versiones y reflexiones; un administrador o revisor no reciben el historial', () => {
    const s = setup(); s.save(s.input()); start_teaching_practice(s.ctx, { practiceId: 1n }); set_teaching_reviewer(s.ctx, { practiceId: 1n, reviewer });
    expect(my_teaching_versions(s.ctx)[0]?.version).toBe(3);
    for (const person of [reviewer, admin]) { s.as(person); expect(s.history()).toMatchObject({ ok: false }); expect(my_teaching_versions(s.ctx)).toEqual([]); expect(s.save(s.input({ expectedVersion: 3 }))).toMatchObject({ ok: false }); }
  });
  it('bloquea la escritura legacy también antes de que exista una cabecera de versión', () => {
    const s = setup(); expect(() => save_teaching_practice(s.ctx, { practiceId: 1n, concept: 'No permitido', example: '', limits: '', revisedConcept: '', revisedExample: '', revisedLimits: '', reflection: '', topicsToReview: '' })).toThrow(/actualiza|versión/i); expect(s.rows('teachingPractice')[0]?.concept).toBe('Concepto original');
  });
  it('inicio, conclusión y reapertura invalidan borradores anteriores y conservan la secuencia histórica', () => {
    const s = setup(); s.save(s.input()); start_teaching_practice(s.ctx, { practiceId: 1n }); expect(my_teaching_versions(s.ctx)[0]?.version).toBe(3); expect(s.save(s.input({ expectedVersion: 2 }))).toMatchObject({ ok: false });
    const questionId = s.rows('teachingQuestion')[0]!.id as bigint; answer_teaching_question(s.ctx, { questionId, answer: 'Un ejemplo concreto' }); complete_teaching_practice(s.ctx, { practiceId: 1n }); expect(my_teaching_versions(s.ctx)[0]?.version).toBe(4); reopen_teaching_practice(s.ctx, { practiceId: 1n }); expect(my_teaching_versions(s.ctx)[0]?.version).toBe(5); expect(s.history().data?.map((row) => row.version)).toEqual([5, 4, 3, 2, 1]);
  });
  it('una baja elimina lectura y escritura de versiones', () => {
    const s = setup(); s.save(s.input()); s.ctx.db.member.identity.update({ ...s.ctx.db.member.identity.find(owner)!, status: 'removed' }); expect(my_teaching_versions(s.ctx)).toEqual([]); expect(s.history()).toMatchObject({ ok: false }); expect(s.save(s.input({ expectedVersion: 2 }))).toMatchObject({ ok: false });
  });
});
