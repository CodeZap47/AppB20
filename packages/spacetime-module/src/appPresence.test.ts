import { Identity, Timestamp } from 'spacetimedb';
import { describe, expect, it, vi } from 'vitest';

vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }),
    schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, clientDisconnected: handler, view: handler }) };
});

import { on_connect, on_disconnect, online_members, type Ctx } from './index';
import { APP_PRESENCE_TTL_MICROS, disconnectAppPresence, expireAppPresence, onlineMembers, setAppPresence } from './appPresenceHandlers';

const author = Identity.fromString('a'.repeat(64)), peer = Identity.fromString('b'.repeat(64));
const alias = Identity.fromString('c'.repeat(64)), outsider = Identity.fromString('d'.repeat(64)), internal = Identity.fromString('e'.repeat(64));
type Row = Record<string, unknown>;
const key = (value: unknown) => value instanceof Identity ? value.toHexString() : String(value);

function table(primary: string, initial: Row[] = []) {
  const rows = new Map(initial.map(row => [key(row[primary]), row])); let next = 1n;
  return new Proxy({ rows, iter: () => rows.values(), insert(input: Row) {
    const row: Row = { ...input, ...(input.id === 0n ? { id: next++ } : {}) };
    rows.set(key(row[primary]), row); return row;
  } }, { get(target, field: string) {
    if (field in target) return target[field as keyof typeof target];
    return { find: (value: unknown) => rows.get(key(value)), update: (row: Row) => rows.set(key(row[primary]), { ...row }),
      delete: (value: unknown) => rows.delete(key(value)), filter: (value: unknown) => [...rows.values()].filter(row => key(row[field]) === key(value)) };
  } });
}

function setup() {
  const initial: Record<string, Row[]> = {
    authConfig: [{ id: 0, issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['test'] }],
    member: [author, peer].map(identity => ({ identity, status: 'active', isCreator: false })),
    authIdentityLink: [{ sessionIdentity: alias, memberIdentity: author }],
  };
  const primary: Record<string, string> = { member: 'identity', authIdentityLink: 'sessionIdentity', appPresenceSession: 'connectionId', chatLiveDraft: 'key', chatTyping: 'key' };
  const stores = new Map<string, ReturnType<typeof table>>();
  const db = new Proxy({}, { get: (_, name: string) => { if (!stores.has(name)) stores.set(name, table(primary[name] ?? 'id', initial[name])); return stores.get(name); } });
  const mutable = { db, sender: author, identity: internal, connectionId: { toHexString: () => 'connection-one' } as { toHexString(): string } | undefined,
    timestamp: new Timestamp(1_800_000_000_000_000n), env: {},
    senderAuth: { jwt: { issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'synthetic@example.test', email_verified: true } } } };
  const ctx = mutable as unknown as Ctx;
  const rows = (name: string) => [...(db as Record<string, ReturnType<typeof table>>)[name]!.rows.values()];
  const online = (viewer = author) => onlineMembers(ctx.db, viewer).map(row => row.memberId.toHexString());
  const publish = (active: boolean, revision: bigint) => setAppPresence(ctx, { active, revision });
  const expire = () => {
    const event = rows('appPresenceExpiry')[0] as unknown as Parameters<typeof expireAppPresence>[1];
    mutable.sender = internal;
    expireAppPresence(ctx, event);
  };
  return { ctx, mutable, rows, online, publish, expire };
}

describe('presencia de la aplicación: sesiones privadas', () => {
  it('conectar no cuenta; registrar la sesión devuelve únicamente la identidad pública del integrante', () => {
    const s = setup(); on_connect(s.ctx, {});
    expect(s.online()).toEqual([]);
    s.publish(false, 1n); expect(s.online()).toEqual([]);
    s.publish(true, 2n);
    expect(s.online()).toEqual([author.toHexString()]);
    const exposed = online_members(s.ctx as never);
    expect(exposed).toEqual([{ memberId: author }]);
    expect(Object.keys(exposed[0]!)).toEqual(['memberId']);
    expect(s.rows('notification')).toEqual([]); expect(s.rows('groupMessage')).toEqual([]); expect(s.rows('changeLog')).toEqual([]);
  });

  it('deduplica pestañas e identidades vinculadas y solo retira la conexión que se cierra', () => {
    const s = setup(); s.publish(true, 1n);
    s.mutable.sender = alias; s.mutable.connectionId = { toHexString: () => 'connection-two' }; s.publish(true, 1n);
    expect(s.online()).toEqual([author.toHexString()]);
    expect(s.rows('appPresenceSession')).toHaveLength(2);
    expect(online_members(s.ctx as never)).toEqual([{ memberId: author }]);
    s.mutable.sender = peer; s.mutable.connectionId = { toHexString: () => 'connection-three' }; s.publish(true, 1n);
    expect(s.online()).toEqual([author.toHexString(), peer.toHexString()]);
    s.mutable.sender = alias; s.mutable.connectionId = { toHexString: () => 'connection-two' }; disconnectAppPresence(s.ctx);
    expect(s.online()).toEqual([author.toHexString(), peer.toHexString()]);
    s.mutable.sender = author; s.mutable.connectionId = { toHexString: () => 'connection-one' };
    s.ctx.db.chatLiveDraft.insert({ key: 'connection-one:group:general', connectionId: 'connection-one', text: 'Temporal' } as never);
    s.ctx.db.chatTyping.insert({ key: 'connection-one:group:general' } as never);
    on_disconnect(s.ctx, {});
    expect(s.online()).toEqual([peer.toHexString()]);
    expect(s.rows('chatLiveDraft')).toEqual([]); expect(s.rows('chatTyping')).toEqual([]);
  });

  it('conserva la revisión al ocultarse y después de caducar para impedir reactivaciones atrasadas', () => {
    const s = setup(); s.publish(true, 2n); s.publish(false, 3n); s.publish(true, 2n);
    expect(s.online()).toEqual([]); expect(s.rows('appPresenceExpiry')).toEqual([]);
    s.publish(true, 4n);
    s.mutable.timestamp = new Timestamp(s.ctx.timestamp.microsSinceUnixEpoch + APP_PRESENCE_TTL_MICROS);
    s.expire(); expect(s.online()).toEqual([]);
    expect(s.rows('appPresenceSession')).toHaveLength(1);
    expect(s.rows('appPresenceSession')[0]).toMatchObject({ active: false, revision: 4n });
    expect(s.rows('appPresenceExpiry')).toEqual([]);
    s.mutable.sender = author; s.publish(true, 3n); s.publish(true, 4n); expect(s.online()).toEqual([]);
    s.publish(true, 5n); expect(s.online()).toEqual([author.toHexString()]);
    disconnectAppPresence(s.ctx); expect(s.rows('appPresenceSession')).toEqual([]); expect(s.rows('appPresenceExpiry')).toEqual([]);
  });

  it('renueva la caducidad con el reloj del servidor y mantiene un único trabajo para el próximo vencimiento', () => {
    const s = setup(); const first = s.ctx.timestamp.microsSinceUnixEpoch;
    s.publish(true, 1n);
    const oldEvent = s.rows('appPresenceExpiry')[0] as unknown as Parameters<typeof expireAppPresence>[1];
    expect(s.rows('appPresenceSession')[0]?.expiresAt).toEqual(new Timestamp(first + APP_PRESENCE_TTL_MICROS));
    s.mutable.timestamp = new Timestamp(first + 5_000_000n); s.publish(true, 2n);
    expect(s.rows('appPresenceExpiry')).toHaveLength(1);
    expect(s.rows('appPresenceSession')[0]?.expiresAt).toEqual(new Timestamp(first + 20_000_000n));
    s.mutable.sender = internal; s.mutable.timestamp = new Timestamp(first + 16_000_000n); expireAppPresence(s.ctx, oldEvent);
    expect(s.online()).toEqual([author.toHexString()]); expect(s.rows('appPresenceExpiry')).toHaveLength(1);
    s.mutable.timestamp = new Timestamp(first + 20_000_000n); s.expire();
    expect(s.online()).toEqual([]); expect(s.rows('appPresenceExpiry')).toEqual([]);
  });

  it('rechaza invitados, cuentas dadas de baja, servicios técnicos y operaciones sin sesión de aplicación', () => {
    const s = setup(); s.mutable.sender = outsider;
    expect(() => s.publish(true, 1n)).toThrow('activo'); expect(s.online(outsider)).toEqual([]);
    s.ctx.db.member.insert({ identity: outsider, status: 'invited' } as never); expect(() => s.publish(true, 1n)).toThrow('activo');
    s.ctx.db.member.identity.update({ identity: outsider, status: 'removed' } as never); expect(() => s.publish(true, 1n)).toThrow('activo');
    s.mutable.sender = internal; expect(() => s.publish(true, 1n)).toThrow('activo'); expect(s.online(internal)).toEqual([]);
    s.mutable.sender = author; s.mutable.connectionId = undefined; expect(() => s.publish(true, 1n)).toThrow('conexión');
    expect(s.rows('appPresenceSession')).toEqual([]);
  });

  it('retira inmediatamente las bajas y protege la limpieza programada de llamadas externas', () => {
    const s = setup(); s.publish(true, 1n);
    const event = s.rows('appPresenceExpiry')[0] as unknown as Parameters<typeof expireAppPresence>[1];
    expect(() => expireAppPresence(s.ctx, event)).toThrow('interno');
    s.ctx.db.member.identity.update({ ...s.ctx.db.member.identity.find(author)!, status: 'removed' });
    expect(s.online(peer)).toEqual([]); expect(s.online()).toEqual([]); expect(() => s.publish(true, 2n)).toThrow('activo');
    s.mutable.sender = internal;
    expireAppPresence(s.ctx, { ...event, expiresAt: new Timestamp(event.expiresAt.microsSinceUnixEpoch + 1n) });
    expect(s.rows('appPresenceExpiry')).toHaveLength(1);
    disconnectAppPresence(s.ctx); expect(s.rows('appPresenceSession')).toEqual([]); expect(s.rows('appPresenceExpiry')).toEqual([]);
  });

  it('permite apagar la propia sesión tras una baja y no reaparece al reingresar hasta una nueva confirmación visible', () => {
    const s = setup(); s.publish(true, 1n);
    const member = s.ctx.db.member.identity.find(author)!;
    s.ctx.db.member.identity.update({ ...member, status: 'removed' });
    expect(s.online(peer)).toEqual([]);
    s.publish(false, 2n);
    expect(s.rows('appPresenceSession')[0]).toMatchObject({ memberId: author, active: false, revision: 2n });
    expect(s.rows('appPresenceExpiry')).toEqual([]);
    expect(() => s.publish(true, 3n)).toThrow('activo');
    s.ctx.db.member.identity.update({ ...member, status: 'active' });
    expect(s.online(peer)).toEqual([]);
    s.publish(true, 1n); expect(s.online(peer)).toEqual([]);
    s.publish(true, 3n); expect(s.online(peer)).toEqual([author.toHexString()]);
    s.mutable.sender = outsider; s.mutable.connectionId = { toHexString: () => 'unregistered-connection' };
    expect(() => s.publish(false, 1n)).toThrow('activo');
    expect(s.rows('appPresenceSession')).toHaveLength(1);
  });
});
