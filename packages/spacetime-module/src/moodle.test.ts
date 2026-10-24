import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import './index';
import { moodleResponse, setMoodleSync, type MoodleDeps } from './moodleHandlers';
import type { Ctx } from './moduleContext';
const person = (digit: string) => Identity.fromString(digit.repeat(64));
const owner = person('a'), student = person('b'), service = person('d'), outsider = person('e');
type Row = Record<string, unknown>;
const keyOf = (value: unknown): string => value && typeof value === 'object' && 'toHexString' in value ? (value as Identity).toHexString() : String(value);
function setup() {
  const initial: Record<string, Row[]> = { member: [owner, student].map((identity) => ({ identity, status: 'active', isCreator: identity === owner })),
    appConfig: [{ id: 0, owner }], subject: [{ id: 1n, name: 'Lógica de Programación' }, { id: 2n, name: 'Programación' }, { id: 3n, name: 'Vida Digital' }] };
  const keys: Record<string, string> = { member: 'identity', moodleAssignmentLink: 'moodleId', notificationEvent: 'key' };
  const all = new Map<string, Row[]>(); let next = 10n;
  const rows = (name: string) => { if (!all.has(name)) all.set(name, initial[name] ?? []); return all.get(name)!; };
  const db = new Proxy({}, { get(_target, name: string) { const table = rows(name); const primary = keys[name] ?? 'id'; return new Proxy({ iter: () => table.values(), insert: (value: Row) => { const row = { ...value, ...(value.id === 0n ? { id: next++ } : {}) }; table.push(row); return row; } }, { get(target, field: string) {
    if (field in target) return target[field as keyof typeof target];
    return { find: (value: unknown) => table.find((row) => keyOf(row[field]) === keyOf(value)), filter: (value: unknown) => table.filter((row) => keyOf(row[field]) === keyOf(value)), update: (row: Row) => { const index = table.findIndex((old) => keyOf(old[primary]) === keyOf(row[primary])); if (index < 0) throw new Error(`Missing ${name}`); table[index] = { ...row }; return row; }, delete: (value: unknown) => { const index = table.findIndex((row) => keyOf(row[field]) === keyOf(value)); if (index >= 0) table.splice(index, 1); } };
  } }); } });
  const state = { db, sender: owner, timestamp: new Timestamp(BigInt(Date.parse('2026-10-22T16:00:00Z')) * 1000n), env: {} as Record<string, string> };
  const ctx = state as unknown as Ctx;
  const deps: MoodleDeps = { saveRevision: vi.fn(), savePageSnapshot: vi.fn(), setAssignmentTopic: vi.fn() };
  const ingest = (items: unknown[]) => JSON.parse(moodleResponse(ctx, JSON.stringify({ items }), deps));
  return { ctx, rows, deps, ingest, as: (sender: Identity) => { state.sender = sender; } };
}
const item = (over: Record<string, unknown> = {}) => ({ moodleId: 'cesun:assign:42', course: 'LOGICA DE PROGRAMACION - B20', title: 'Diagrama de flujo',
  description: 'Entregar en PDF', url: 'https://cursos.cesun.edu.mx/mod/assign/view.php?id=7', dueDate: '2026-10-30', ...over });
function configured() {
  const state = setup(); setMoodleSync(state.ctx, { identity: service, actor: student, enabled: true }); state.as(service); return state;
}

describe('sincronización Moodle → calendario', () => {
  it('solo el propietario configura y exige una identidad técnica exclusiva', () => {
    const { ctx, as, rows } = setup();
    expect(() => setMoodleSync(ctx, { identity: student, actor: student, enabled: true })).toThrow('exclusiva');
    rows('aiServiceConfig').push({ id: 0, identity: service });
    expect(() => setMoodleSync(ctx, { identity: service, actor: student, enabled: true })).toThrow('exclusiva');
    expect(() => setMoodleSync(ctx, { identity: outsider, actor: person('f'), enabled: true })).toThrow('miembro activo');
    as(student); expect(() => setMoodleSync(ctx, { identity: outsider, actor: student, enabled: true })).toThrow('propietario');
  });
  it('rechaza a quien no es el servicio configurado', () => {
    const { ingest, as } = configured(); as(student);
    expect(ingest([item()])).toMatchObject({ ok: false, code: 'unauthorized' });
  });
  it('crea la tarea en la materia más específica, a nombre del miembro, y no la duplica', () => {
    const { ingest, rows, deps } = configured();
    expect(ingest([item()])).toEqual({ ok: true, created: 1, updated: 0, unchanged: 0, skipped: [] });
    const [task] = rows('assignment');
    expect(task).toMatchObject({ subjectId: 1n, kind: 'tarea', title: 'Diagrama de flujo', dueDate: '2026-10-30', createdBy: student, version: 1 });
    expect(String(task!.instructions)).toContain('Importada de Moodle: https://cursos.cesun.edu.mx/');
    expect(deps.saveRevision).toHaveBeenCalledOnce();
    expect(ingest([item()])).toMatchObject({ created: 0, unchanged: 1 });
    expect(rows('assignment')).toHaveLength(1);
  });
  it('aplica cambios de fecha de Moodle sin pisar las instrucciones del grupo', () => {
    const { ingest, rows } = configured(); ingest([item()]);
    rows('assignment')[0]!.instructions = 'Editado por el grupo';
    expect(ingest([item({ dueDate: '2026-11-02' })])).toMatchObject({ updated: 1 });
    expect(rows('assignment')[0]).toMatchObject({ dueDate: '2026-11-02', title: 'Diagrama de flujo', instructions: 'Editado por el grupo', version: 2 });
    expect(rows('notificationEvent')).toHaveLength(1);
  });
  it('conserva un título que el grupo cambió si Moodle solo movió la fecha', () => {
    const { ingest, rows } = configured(); ingest([item()]);
    rows('assignment')[0]!.title = 'Diagrama (equipo 3)';
    ingest([item({ dueDate: '2026-11-03' })]);
    expect(rows('assignment')[0]).toMatchObject({ title: 'Diagrama (equipo 3)', dueDate: '2026-11-03' });
  });
  it('omite cursos sin materia y tareas borradas, y valida la entrada', () => {
    const { ingest, rows } = configured();
    expect(ingest([item({ moodleId: 'cesun:assign:1', course: 'Inglés I' })]).skipped).toEqual([{ moodleId: 'cesun:assign:1', reason: 'subject' }]);
    ingest([item()]); rows('assignment').splice(0, 1);
    expect(ingest([item({ dueDate: '2026-12-01' })]).skipped).toEqual([{ moodleId: 'cesun:assign:42', reason: 'deleted' }]);
    expect(ingest([item({ url: 'https://evil.example/x' })])).toMatchObject({ ok: false, code: 'invalid' });
    expect(ingest([item(), item()])).toMatchObject({ ok: false, code: 'invalid' });
    expect(ingest([item({ dueDate: '30/10/2026' })])).toMatchObject({ ok: false, code: 'invalid' });
  });
  it('no importa nada si la sincronización está desactivada', () => {
    const { ctx, ingest, as, rows } = setup(); setMoodleSync(ctx, { identity: service, actor: student, enabled: false }); as(service);
    expect(ingest([item()])).toMatchObject({ ok: false, code: 'disabled' }); expect(rows('assignment')).toHaveLength(0);
  });
});
