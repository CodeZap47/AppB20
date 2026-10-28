import { Identity, Timestamp } from 'spacetimedb';
import { describe, expect, it, vi } from 'vitest';
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }),
    schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, clientDisconnected: handler, view: handler }) };
});
import type { Ctx } from './index';
import './index';
import { disconnectLiveDrafts, expireLiveDrafts, liveDraftVisible, setLiveDraft, setLiveDraftSharing } from './liveDraftHandlers';

type Row = Record<string, unknown>;
const author = Identity.fromString('a'.repeat(64)); const peer = Identity.fromString('b'.repeat(64));
const admin = Identity.fromString('c'.repeat(64)); const stranger = Identity.fromString('d'.repeat(64)); const internal = Identity.fromString('e'.repeat(64));
const key = (value: unknown) => value instanceof Identity ? value.toHexString() : String(value);
function table(primary: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [key(row[primary]), row])); let next = 1n;
  return new Proxy({ rows, iter: () => rows.values(), insert(input: Row) {
    const row: Row = { ...input, ...(input.id === 0n ? { id: next++ } : {}) }; rows.set(key(row[primary]), row); return row;
  } }, { get(target, field: string) {
    if (field in target) return target[field as keyof typeof target];
    return { find: (value: unknown) => rows.get(key(value)), update: (row: Row) => rows.set(key(row[primary]), { ...row }),
      delete: (value: unknown) => rows.delete(key(value)), filter: (value: unknown) => [...rows.values()].filter((row) => key(row[field]) === key(value)) };
  } });
}
function setup() {
  const initial: Record<string, Row[]> = { authConfig: [{ id: 0, issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['test'] }],
    member: [author, peer, admin].map((identity) => ({ identity, status: 'active', isCreator: identity === admin })),
    directConversation: [{ id: 1n, userA: author, userB: peer }], chatChannel: [{ id: 2n, name: 'Canal' }] };
  const primary: Record<string, string> = { member: 'identity', authIdentityLink: 'sessionIdentity', memberBlock: 'key', chatLiveDraft: 'key', chatLivePreference: 'memberId', chatTyping: 'key' };
  const stores = new Map<string, ReturnType<typeof table>>();
  const db = new Proxy({}, { get: (_, name: string) => { if (!stores.has(name)) stores.set(name, table(primary[name] ?? 'id', initial[name])); return stores.get(name); } });
  const mutable = { db, sender: author, identity: internal, connectionId: { toHexString: () => 'connection-one' }, timestamp: new Timestamp(1_800_000_000_000_000n), env: {},
    senderAuth: { jwt: { issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'synthetic@example.test', email_verified: true } } } };
  const ctx = mutable as unknown as Ctx;
  const rows = (name: string) => [...(db as Record<string, ReturnType<typeof table>>)[name]!.rows.values()];
  const publish = (text: string, revision: bigint, scope = 'group', conversationId = 'general') => setLiveDraft(ctx, { scope, conversationId, text, revision });
  return { mutable, ctx, rows, publish };
}

describe('borradores temporales: servidor', () => {
  it('rechaza revisiones atrasadas y no resucita texto después de vaciarlo', () => {
    const s = setup(); s.publish('Vigente', 2n); s.publish('Viejo', 1n);
    expect(s.rows('chatLiveDraft')[0]?.text).toBe('Vigente');
    s.publish('', 3n); s.publish('Atrasado', 2n);
    expect(s.rows('chatLiveDraft')[0]?.text).toBe('');
    expect(s.rows('chatLiveDraftExpiry')).toHaveLength(1);
    expect(() => s.publish('x'.repeat(4001), 4n)).toThrow('4000');
  });
  it('protege directos, bloqueos, canales archivados y miembros inactivos', () => {
    const s = setup(); s.publish('Privado', 1n, 'direct', '1');
    const row = s.rows('chatLiveDraft')[0] as unknown as Parameters<typeof liveDraftVisible>[2];
    expect(liveDraftVisible(s.ctx.db, peer, row)).toBe(true);
    expect(liveDraftVisible(s.ctx.db, admin, row)).toBe(false);
    expect(liveDraftVisible(s.ctx.db, stranger, row)).toBe(false);
    s.ctx.db.memberBlock.insert({ key: `${peer.toHexString()}:${author.toHexString()}`, owner: peer, memberId: author } as never);
    expect(liveDraftVisible(s.ctx.db, peer, row)).toBe(false);
    expect(() => s.publish('Bloqueado', 2n, 'direct', '1')).toThrow();
    s.mutable.sender = stranger; expect(() => s.publish('Intruso', 2n)).toThrow();
  });
  it('desactiva todas las sesiones de una cuenta sin borrar otras personas', () => {
    const s = setup(); s.publish('Uno', 1n); s.mutable.connectionId = { toHexString: () => 'connection-two' }; s.publish('Dos', 2n);
    s.mutable.sender = peer; s.publish('Otro autor', 3n);
    s.mutable.sender = author; setLiveDraftSharing(s.ctx, { enabled: false });
    expect(s.rows('chatLiveDraft').filter((row) => row.text).map((row) => row.text)).toEqual(['Otro autor']);
    s.publish('No publicar', 4n); expect(s.rows('chatLiveDraft').filter((row) => row.text)).toHaveLength(1);
  });
  it('limpia por conexión y caduca aunque no haya más pulsaciones', () => {
    const s = setup(); s.publish('Uno', 1n); s.mutable.connectionId = { toHexString: () => 'connection-two' }; s.publish('Dos', 2n);
    disconnectLiveDrafts(s.ctx); expect(s.rows('chatLiveDraft').map((row) => row.text)).toEqual(['Uno']);
    const event = s.rows('chatLiveDraftExpiry')[0] as unknown as Parameters<typeof expireLiveDrafts>[1];
    expect(() => expireLiveDrafts(s.ctx, event)).toThrow('interno');
    s.mutable.sender = internal; s.mutable.timestamp = new Timestamp(s.ctx.timestamp.microsSinceUnixEpoch + 8_000_000n);
    expireLiveDrafts(s.ctx, event); expect(s.rows('chatLiveDraft')).toHaveLength(0); expect(s.rows('chatLiveDraftExpiry')).toHaveLength(0);
  });
});
