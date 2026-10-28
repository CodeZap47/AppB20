import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DbConnection } from '../module_bindings';
import { SpacetimeMessageReceiptStore } from './messageReceiptStore';
const stores: SpacetimeMessageReceiptStore[] = [];
afterEach(() => { stores.forEach(store => store.disconnect()); stores.length = 0; vi.useRealTimers(); });
function transport() {
  const table = () => { const rows: Record<string, unknown>[] = []; const listeners = new Set<() => void>(); return { rows, iter: () => rows.values(), onInsert: (fn: () => void) => listeners.add(fn), onDelete: (fn: () => void) => listeners.add(fn), onUpdate: (fn: () => void) => listeners.add(fn), removeOnInsert: (fn: () => void) => listeners.delete(fn), removeOnDelete: (fn: () => void) => listeners.delete(fn), removeOnUpdate: (fn: () => void) => listeners.delete(fn), change: () => listeners.forEach(fn => fn()) }; };
  const db = { groupMessages: table(), myDirectMessages: table(), channelMessages: table(), myMessageReceipts: table(), messageReceiptDetails: table(), messageReceiptTracking: table() };
  let apply = () => {}; const handle = { isEnded: () => false, unsubscribe: vi.fn() }; const query = vi.fn(() => handle); const builder = { onApplied(fn: () => void) { apply = fn; return builder; }, onError() { return builder; }, subscribe: query };
  const delivery = vi.fn(async (_input: unknown) => {}); const seen = vi.fn(async (_input: unknown) => {});
  const connection = { db, reducers: { acknowledgeMessageDelivery: delivery, markMessagesSeen: seen }, subscriptionBuilder: () => builder } as unknown as DbConnection;
  const store = new SpacetimeMessageReceiptStore(); stores.push(store);
  return { db, connection, store, delivery, seen, query, apply: () => apply(), handle };
}
describe('caché del cliente y suscripciones privadas de recibos', () => {
  it('solo confirma entrega después de aplicar el mensaje a la caché, incluso si el recibo llegó primero', async () => {
    const s = transport(); s.db.myMessageReceipts.rows.push({ key: 'group:42:me', scope: 'group', conversationId: 'general', messageId: 42n });
    s.store.connect(s.connection); await Promise.resolve(); expect(s.delivery).not.toHaveBeenCalled();
    s.db.groupMessages.rows.push({ id: 42n }); s.db.groupMessages.change(); await Promise.resolve();
    expect(s.delivery).toHaveBeenCalledExactlyOnceWith({ scope: 'group', conversationId: 'general', messageIds: [42n] });
  });
  it('reintenta errores de entrega al reconectar y descarta trabajos de conexiones cerradas', async () => {
    const s = transport(); s.db.groupMessages.rows.push({ id: 1n }); s.db.myMessageReceipts.rows.push({ key: 'group:1:me', scope: 'group', conversationId: 'general', messageId: 1n });
    s.store.connect(s.connection); s.store.disconnect(); await Promise.resolve(); expect(s.delivery).not.toHaveBeenCalled();
    s.store.connect(s.connection); await Promise.resolve(); expect(s.delivery).toHaveBeenCalledTimes(1);
  });
  it('confirma entregas históricas reales, omite mensajes propios y procesados y limita cada lote a cien', async () => {
    const s = transport(); const identity = (id: string) => ({ toHexString: () => id });
    for (let id = 1n; id <= 201n; id++) s.db.groupMessages.rows.push({ id, sender: identity('peer') });
    s.db.groupMessages.rows.push({ id: 300n, sender: identity('me') }, { id: 301n, sender: identity('peer'), deletedAt: new Date() });
    s.store.connect(s.connection, 'me');
    for (let index = 0; index < 5; index++) await Promise.resolve();
    expect(s.delivery).toHaveBeenCalledTimes(3);
    expect(s.delivery.mock.calls.map(call => (call[0] as { messageIds: bigint[] }).messageIds.length)).toEqual([100, 100, 1]);
    s.db.groupMessages.change(); for (let index = 0; index < 5; index++) await Promise.resolve(); expect(s.delivery).toHaveBeenCalledTimes(3);
  });
  it('respeta un recibo histórico ya entregado y reintenta una confirmación transitoria sin alterar la caché', async () => {
    vi.useFakeTimers(); const s = transport(); const peer = { toHexString: () => 'peer' };
    s.db.groupMessages.rows.push({ id: 1n, sender: peer }, { id: 2n, sender: peer });
    s.db.myMessageReceipts.rows.push({ scope: 'group', messageId: 1n, tracked: false, deliveredAt: new Date() });
    s.delivery.mockRejectedValueOnce(new Error('Interrupción temporal'));
    s.store.connect(s.connection, 'me'); await vi.advanceTimersByTimeAsync(0);
    expect(s.delivery).toHaveBeenCalledExactlyOnceWith({ scope: 'group', conversationId: 'general', messageIds: [2n] });
    await vi.advanceTimersByTimeAsync(5000); expect(s.delivery).toHaveBeenCalledTimes(2);
    s.db.groupMessages.change(); await vi.advanceTimersByTimeAsync(0); expect(s.delivery).toHaveBeenCalledTimes(2);
  });
  it('consulta detalles únicamente al abrir información y cierra su suscripción al salir', async () => {
    const s = transport(); s.store.connect(s.connection); await Promise.resolve(); expect(s.query).not.toHaveBeenCalled();
    const notify = vi.fn(); const stop = s.store.subscribe('direct', '42', notify);
    expect(s.query).toHaveBeenCalledWith(["SELECT * FROM message_receipt_details WHERE scope = 'direct' AND message_id = 42", "SELECT * FROM message_receipt_tracking WHERE scope = 'direct' AND message_id = 42"]);
    expect(s.store.getSnapshot('direct', '42').loading).toBe(true); s.apply(); expect(s.store.getSnapshot('direct', '42')).toMatchObject({ loading: false, tracked: false, receipts: [] }); expect(notify).toHaveBeenCalled();
    stop(); expect(s.handle.unsubscribe).toHaveBeenCalledTimes(1);
  });
  it('fragmenta lotes de visualización y conserva IDs u64 sin redondear', async () => {
    const s = transport(); s.store.connect(s.connection); const ids = Array.from({ length: 201 }, (_, n) => (9007199254740993n + BigInt(n)).toString());
    await s.store.markSeen('channel', '8', ids); expect(s.seen).toHaveBeenCalledTimes(3); expect(s.seen.mock.calls[0]![0]).toMatchObject({ messageIds: [9007199254740993n, ...ids.slice(1, 100).map(BigInt)] });
  });
});
