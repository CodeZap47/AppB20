import { Identity, Timestamp } from 'spacetimedb';
import { describe, expect, it, vi } from 'vitest';
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, clientDisconnected: handler, view: handler }) };
});
import { my_message_receipts, type Ctx } from './index';
import { acknowledgeMessages, purgeMessageReceipts, receiptVisible, trackMessageRecipients, trackingVisible } from './messageReceiptHandlers';
const author = Identity.fromString('a'.repeat(64)), peer = Identity.fromString('b'.repeat(64)), admin = Identity.fromString('c'.repeat(64)), later = Identity.fromString('d'.repeat(64));
type Row = Record<string, unknown>;
const key = (value: unknown) => value instanceof Identity ? value.toHexString() : String(value);
function table(primary: string, initial: Row[] = []) {
  const rows = new Map(initial.map(row => [key(row[primary]), row]));
  return new Proxy({ rows, iter: () => rows.values(), insert(input: Row) { rows.set(key(input[primary]), { ...input }); return input; } }, { get(target, field: string) {
    if (field in target) return target[field as keyof typeof target];
    return { find: (value: unknown) => rows.get(key(value)), update: (row: Row) => rows.set(key(row[primary]), { ...row }), delete: (value: unknown) => rows.delete(key(value)), filter: (value: unknown) => [...rows.values()].filter(row => key(row[field]) === key(value)) };
  } });
}
function setup() {
  const initial: Record<string, Row[]> = { authConfig: [{ id: 0, issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['test'] }], member: [author, peer, admin].map(identity => ({ identity, status: 'active', isCreator: identity === admin })),
    directConversation: [{ id: 1n, userA: author, userB: peer }], chatChannel: [{ id: 2n }], groupMessage: [{ id: 3n, sender: author, text: 'Salón' }], channelMessage: [{ id: 4n, channelId: 2n, sender: author }], directMessage: [{ id: 5n, conversationId: 1n, sender: author }] };
  const primary: Record<string, string> = { member: 'identity', authIdentityLink: 'sessionIdentity', memberBlock: 'key', messageReceipt: 'key', messageReceiptTracking: 'key', contentStatus: 'key' };
  const stores = new Map<string, ReturnType<typeof table>>(); const db = new Proxy({}, { get: (_, name: string) => { if (!stores.has(name)) stores.set(name, table(primary[name] ?? 'id', initial[name])); return stores.get(name); } });
  const mutable = { db, sender: author, timestamp: new Timestamp(1_800_000_000_000_000n), env: {}, senderAuth: { jwt: { issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'test@example.test', email_verified: true } } } };
  const ctx = mutable as unknown as Ctx; const rows = (name: string) => [...(db as Record<string, ReturnType<typeof table>>)[name]!.rows.values()];
  const ack = (scope = 'direct', conversationId = '1', messageIds = [5n], seen = false) => acknowledgeMessages(ctx, { scope, conversationId, messageIds }, seen);
  return { ctx, mutable, rows, ack };
}
describe('recibos privados por mensaje y destinatario', () => {
  it('fija destinatarios al enviar y no declara entrega hasta la confirmación de la app', () => {
    const s = setup(); trackMessageRecipients(s.ctx, 'group', 'general', 3n);
    expect(s.rows('messageReceipt')).toHaveLength(2); expect(s.rows('messageReceipt').every(row => !row.deliveredAt && !row.readAt)).toBe(true);
    s.ctx.db.member.insert({ identity: later, status: 'active' } as never); s.mutable.sender = later;
    s.ack('group', 'general', [3n], true); expect(s.rows('messageReceipt')).toHaveLength(2);
    s.mutable.sender = peer; s.ack('group', 'general', [3n]); expect(s.rows('messageReceipt').find(row => row.recipient === peer)?.deliveredAt).toBe(s.ctx.timestamp);
    expect(my_message_receipts(s.ctx as never)[0]?.tracked).toBe(true);
  });
  it('conserva las primeras horas frente a reintentos, lectura adelantada y varias sesiones', () => {
    const s = setup(); trackMessageRecipients(s.ctx, 'direct', '1', 5n); s.mutable.sender = peer;
    const first = s.ctx.timestamp; s.ack('direct', '1', [5n], true);
    s.mutable.timestamp = new Timestamp(first.microsSinceUnixEpoch + 5_000_000n); s.ack(); s.ack('direct', '1', [5n], true);
    expect(s.rows('messageReceipt')[0]).toMatchObject({ deliveredAt: first, readAt: first });
    s.ctx.db.directMessage.id.update({ ...s.ctx.db.directMessage.id.find(5n)!, text: 'Editado' });
    s.ack(); expect(s.rows('messageReceipt')[0]?.readAt).toBe(first);
  });
  it('separa entrega y lectura e impide consultar estados ajenos incluso a administradores', () => {
    const s = setup(); trackMessageRecipients(s.ctx, 'direct', '1', 5n); s.mutable.sender = peer; s.ack();
    const delivered = s.ctx.timestamp; s.mutable.timestamp = new Timestamp(delivered.microsSinceUnixEpoch + 4_000_000n); s.ack('direct', '1', [5n], true);
    const row = s.rows('messageReceipt')[0] as unknown as Parameters<typeof receiptVisible>[2]; const cohort = s.rows('messageReceiptTracking')[0] as unknown as Parameters<typeof trackingVisible>[2];
    expect(row).toMatchObject({ deliveredAt: delivered, readAt: s.ctx.timestamp });
    expect(receiptVisible(s.ctx.db, author, row, true)).toBe(true); expect(receiptVisible(s.ctx.db, peer, row, false)).toBe(true);
    expect(receiptVisible(s.ctx.db, peer, row, true)).toBe(false); expect(receiptVisible(s.ctx.db, admin, row, true)).toBe(false); expect(trackingVisible(s.ctx.db, admin, cohort)).toBe(false);
    s.mutable.sender = admin; expect(() => s.ack()).toThrow();
  });
  it('registra la nueva entrega histórica sin inventar cohorte, conserva su hora al leer y distingue su cursor anterior', () => {
    const s = setup(); s.mutable.sender = peer; const delivery = s.ctx.timestamp;
    s.ack(); expect(s.rows('messageReceiptTracking')).toEqual([]); expect(s.rows('messageReceipt')[0]).toMatchObject({ deliveredAt: delivery }); expect(s.rows('messageReceipt')[0]?.readAt).toBeUndefined();
    expect(my_message_receipts(s.ctx as never)[0]?.tracked).toBe(false);
    s.mutable.timestamp = new Timestamp(delivery.microsSinceUnixEpoch + 5_000_000n); s.ack('direct', '1', [5n], true);
    expect(s.rows('messageReceipt')[0]).toMatchObject({ deliveredAt: delivery, readAt: s.ctx.timestamp });
    s.mutable.sender = author; s.ack(); expect(s.rows('messageReceipt')).toHaveLength(1);
    purgeMessageReceipts(s.ctx, 'direct', 5n); expect(s.rows('messageReceipt')).toEqual([]);
  });
  it('rechaza bloqueos, mensajes retirados, inactivos, otra conversación y lotes fuera de límites', () => {
    const s = setup(); trackMessageRecipients(s.ctx, 'direct', '1', 5n); s.mutable.sender = peer;
    expect(() => s.ack('direct', '2')).toThrow(); expect(() => s.ack('direct', '1', [])).toThrow('100');
    s.ctx.db.memberBlock.insert({ key: 'block', owner: author, memberId: peer } as never); expect(() => s.ack()).toThrow(); s.ctx.db.memberBlock.key.delete('block');
    s.ctx.db.directMessage.id.update({ ...s.ctx.db.directMessage.id.find(5n)!, deletedAt: s.ctx.timestamp }); expect(() => s.ack()).toThrow();
    s.ctx.db.member.identity.update({ ...s.ctx.db.member.identity.find(peer)!, status: 'left' }); expect(() => s.ack()).toThrow();
  });
});
