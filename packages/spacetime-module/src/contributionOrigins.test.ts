import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';

vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }),
    schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, clientDisconnected: handler, view: handler }) };
});
import { contribution_origins } from './index';

const person = (letter: string) => Identity.fromString(letter.repeat(64));
const author = person('a'); const peer = person('b'); const removed = person('c');
const first = new Timestamp(1_700_000_000_000_000n); const later = new Timestamp(first.microsSinceUnixEpoch + 1_000_000n);
type Row = Record<string, unknown>;
const keyOf = (value: unknown): string => value && typeof value === 'object' && 'toHexString' in value ? (value as Identity).toHexString() : String(value);
function setup() {
  const note = (id: bigint, visibility: string, createdAt = first) => ({ id, subjectId: 1n, topic: 'Tema', title: 'Título', body: 'El mismo contenido', author, visibility, createdAt });
  const initial: Record<string, Row[]> = {
    member: [{ identity: author, status: 'active' }, { identity: peer, status: 'active' }, { identity: removed, status: 'removed' }],
    note: [note(1n, 'group'), note(2n, 'personal', new Timestamp(1n)), note(3n, 'group', later)],
    noteDetail: [{ noteId: 1n, termId: 11n }, { noteId: 2n, termId: 11n }, { noteId: 3n, termId: 11n }],
    contentStatus: [{ key: 'note:1', kind: 'note', targetId: 1n, withdrawnAt: first, withdrawnBy: author }],
  };
  const tables = new Map<string, Row[]>();
  const db = new Proxy({}, { get: (_target, name: string) => {
    if (!tables.has(name)) tables.set(name, [...(initial[name] ?? [])]); const rows = tables.get(name)!;
    return new Proxy({ iter: () => rows.values() }, { get: (target, property: string) => property in target ? target[property as keyof typeof target]
      : { find: (id: unknown) => rows.find((row) => keyOf(row[property]) === keyOf(id)), filter: (id: unknown) => rows.filter((row) => keyOf(row[property]) === keyOf(id)) } });
  } });
  const state = { db, sender: peer };
  return { ctx: state as unknown as Parameters<typeof contribution_origins>[0], as: (sender: Identity) => { state.sender = sender; },
    add: (name: string, ...rows: Row[]) => { if (!tables.has(name)) tables.set(name, [...(initial[name] ?? [])]); tables.get(name)!.push(...rows); },
    clear: (name: string) => { tables.set(name, []); } };
}

describe('vista de procedencia sin contenido privado', () => {
  it('un clon del original retirado conserva fecha y referencia canónica sin devolver el original oculto ni la nota personal', () => {
    const { ctx, as } = setup();
    const rows = contribution_origins(ctx);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ kind: 'apunte', refId: 3n, duplicateOf: 1n, creditedAt: first });
    expect(rows[0].memberId.isEqual(author)).toBe(true);
    expect(Object.keys(rows[0]).sort()).toEqual(['creditedAt', 'duplicateOf', 'kind', 'memberId', 'refId']);
    as(author); expect(contribution_origins(ctx).some((row) => row.refId === 2n)).toBe(false);
    as(removed); expect(contribution_origins(ctx)).toEqual([]);
  });
  it('restaurar el original recupera su origen sin promover el clon posterior', () => {
    const { ctx, clear } = setup(); clear('contentStatus');
    const rows = contribution_origins(ctx);
    expect(rows.find((row) => row.refId === 1n)?.duplicateOf).toBeUndefined(); expect(rows.find((row) => row.refId === 3n)?.duplicateOf).toBe(1n);
    expect(rows.every((row) => row.creditedAt.microsSinceUnixEpoch === first.microsSinceUnixEpoch)).toBe(true);
  });
  it('un archivo recargado con el mismo SHA256 no vuelve a sumar, y archivos distintos de igual nombre sí se distinguen', () => {
    const { ctx, add, clear } = setup(); clear('note'); clear('contentStatus');
    add('work', ...[10n, 11n, 12n].map((id) => ({ id, assignmentId: 20n, title: 'Trabajo', description: '', createdAt: id === 10n ? first : later })));
    add('workAuthor', ...[10n, 11n, 12n].map((workId) => ({ workId, author })));
    add('resourceFile', ...[10n, 11n, 12n].map((targetId) => ({ id: `file-${targetId}`, targetKind: 'work', targetId, name: 'datos.pdf', size: 4n, contentType: 'application/pdf', storageKey: `stdb:file-${targetId}`, removedAt: undefined })));
    add('resourceUpload', ...[10n, 11n, 12n].map((id) => ({ id: `file-${id}`, state: 'ready', sha256: (id === 12n ? 'b' : 'a').repeat(64) })));
    const rows = contribution_origins(ctx);
    expect(rows.find((row) => row.refId === 11n)?.duplicateOf).toBe(10n); expect(rows.find((row) => row.refId === 12n)?.duplicateOf).toBeUndefined();
  });
  it('la evidencia cuenta por autor y participante únicos, y una respuesta por autor y pregunta aunque cambie el texto', () => {
    const { ctx, add, clear } = setup(); clear('note'); clear('contentStatus');
    add('activity', { id: 20n }); add('question', { id: 30n, author: peer });
    add('evidence', { id: 10n, activityId: 20n, author, participants: [author, peer, peer], content: 'Práctica', createdAt: first });
    add('answer', { id: 11n, questionId: 30n, author, body: 'Primera redacción', createdAt: first }, { id: 12n, questionId: 30n, author, body: 'Otra redacción', createdAt: later });
    const rows = contribution_origins(ctx);
    expect(rows.filter((row) => row.kind === 'evidencia')).toHaveLength(2);
    expect(rows.find((row) => row.refId === 12n)?.duplicateOf).toBe(11n);
  });
  it('un borrador nunca puntuado no bloquea una publicación final legítima', () => {
    const { ctx, add, clear } = setup(); clear('note'); clear('contentStatus');
    add('work', { id: 10n, assignmentId: 20n, title: 'Trabajo', description: 'Contenido', createdAt: first }, { id: 11n, assignmentId: 20n, title: 'Trabajo', description: 'Contenido', createdAt: later });
    add('workAuthor', { workId: 10n, author }, { workId: 11n, author });
    add('workDetail', { workId: 10n, status: 'draft', topic: '' }, { workId: 11n, status: 'final', topic: '' });
    const rows = contribution_origins(ctx);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ refId: 11n, creditedAt: later, duplicateOf: undefined });
  });
});
