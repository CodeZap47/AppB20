import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';

vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }),
    table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, clientDisconnected: handler, view: handler }) };
});
import { member_upload_stats } from './index';

const person = (value: string) => Identity.fromString(value.repeat(64));
const author = person('a'), peer = person('b'), removed = person('c'), outsider = person('d'), session = person('e');
const at = new Timestamp(1_700_000_000_000_000n);
type Row = Record<string, unknown>;
const keyOf = (value: unknown) => value && typeof value === 'object' && 'toHexString' in value ? (value as Identity).toHexString() : String(value);
function setup(extra: Record<string, Row[]> = {}) {
  const rows: Record<string, Row[]> = {
    member: [{ identity: author, status: 'active' }, { identity: peer, status: 'active' }, { identity: removed, status: 'removed' }],
    ...extra,
  };
  const db = new Proxy({}, { get(_target, name: string) {
    const entries = rows[name] ?? [];
    return new Proxy({ iter: () => entries.values() }, { get(target, key: string) {
      if (key === 'iter') return target.iter;
      return { find: (value: unknown) => entries.find((row) => keyOf(row[key]) === keyOf(value)) };
    } });
  } });
  const state = { db, sender: peer };
  const ctx = state as unknown as Parameters<typeof member_upload_stats>[0];
  return { ctx, as: (identity: Identity) => { state.sender = identity; } };
}

describe('totales de archivos en perfiles', () => {
  it('suma adjuntos vigentes de todos los ámbitos y descarta duplicados legacy y bajas', () => {
    const { ctx } = setup({
      resourceFile: [
        { id: 'personal', targetKind: 'note', targetId: 11n, name: 'Privado', storageKey: 'secreto', uploadedBy: author, size: 2048n },
        { id: 'direct', targetKind: 'direct_message', targetId: 12n, uploadedBy: author, size: 17n },
        { id: 'legacy:1', uploadedBy: author, size: 512n },
        { id: 'legacy:2', uploadedBy: author, size: 100n, removedAt: at },
        { id: 'removed-member', uploadedBy: removed, size: 4096n },
      ],
      workFile: [{ id: 1n, uploadedBy: author, size: 512n }, { id: 2n, uploadedBy: author, size: 100n },
        { id: 3n, uploadedBy: author, size: 23n }],
    });
    expect(member_upload_stats(ctx)).toEqual([
      { memberId: author, bytes: 2600n, fileCount: 4n }, { memberId: peer, bytes: 0n, fileCount: 0n },
    ]);
    expect(Object.keys(member_upload_stats(ctx)[0]!)).toEqual(['memberId', 'bytes', 'fileCount']);
  });

  it('reutiliza identidad vinculada y solo permite consultar con membresía activa', () => {
    const { ctx, as } = setup({ authIdentityLink: [{ sessionIdentity: session, memberIdentity: peer }] });
    as(session); expect(member_upload_stats(ctx)).toHaveLength(2);
    as(outsider); expect(member_upload_stats(ctx)).toEqual([]);
    as(removed); expect(member_upload_stats(ctx)).toEqual([]);
  });
});
