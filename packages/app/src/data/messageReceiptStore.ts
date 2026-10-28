import type { DbConnection } from '../module_bindings';
import type { Id, MessageScope } from './types';
import { EMPTY_RECEIPT_INFO, type MessageReceiptInfo, type MessageReceiptSource } from './messageReceiptTypes';

type Subscription = ReturnType<ReturnType<DbConnection['subscriptionBuilder']>['subscribe']>;
interface Watch { scope: MessageScope; id: Id; info: MessageReceiptInfo; listeners: Set<() => void>; handle?: Subscription; generation: number }
export class SpacetimeMessageReceiptStore implements MessageReceiptSource {
  private connection?: DbConnection;
  private watches = new Map<string, Watch>();
  private queued = false;
  private generation = 0;
  private inFlight = new Set<string>();
  private processed = new Set<string>();
  private memberId?: Id;
  private retry?: ReturnType<typeof setTimeout>;
  private readonly changed = () => {
    if (this.queued) return; this.queued = true;
    const generation = this.generation;
    queueMicrotask(() => { if (generation !== this.generation) return; this.queued = false; this.refresh(); void this.acknowledgeCached(); });
  };
  private tables(connection: DbConnection) { return [connection.db.groupMessages, connection.db.myDirectMessages, connection.db.channelMessages, connection.db.myMessageReceipts, connection.db.messageReceiptDetails, connection.db.messageReceiptTracking].filter(Boolean); }
  connect(connection: DbConnection, memberId?: Id) {
    this.disconnect(); this.connection = connection;
    this.memberId = memberId ?? [...(connection.db.myMember?.iter?.() ?? [])][0]?.identity.toHexString() ?? connection.identity?.toHexString();
    for (const table of this.tables(connection)) { table.onInsert(this.changed); table.onDelete(this.changed); table.onUpdate(this.changed); }
    for (const watch of this.watches.values()) this.start(watch);
    this.changed();
  }
  getSnapshot = (scope: MessageScope, id: Id) => this.watches.get(`${scope}:${id}`)?.info ?? EMPTY_RECEIPT_INFO;
  subscribe = (scope: MessageScope, id: Id, listener: () => void) => {
    const key = `${scope}:${id}`; let watch = this.watches.get(key);
    if (!watch) { watch = { scope, id, info: { ...EMPTY_RECEIPT_INFO, loading: true }, listeners: new Set(), generation: 0 }; this.watches.set(key, watch); }
    watch.listeners.add(listener); if (this.connection && !watch.handle) this.start(watch);
    return () => { watch!.listeners.delete(listener); if (!watch!.listeners.size) { this.stop(watch!); this.watches.delete(key); } };
  };
  private start(watch: Watch) {
    const connection = this.connection;
    if (!connection || !/^[1-9][0-9]{0,19}$/.test(watch.id)) { watch.info = { ...EMPTY_RECEIPT_INFO, unavailable: true }; return; }
    const generation = ++watch.generation;
    const current = () => this.connection === connection && watch.generation === generation && watch.listeners.size > 0;
    watch.handle = connection.subscriptionBuilder().onApplied(() => { if (current()) { watch.info = { ...watch.info, loading: false }; this.refresh(); for (const listener of watch.listeners) listener(); } })
      .onError(() => { if (current()) { watch.info = { ...EMPTY_RECEIPT_INFO, unavailable: true }; for (const listener of watch.listeners) listener(); } })
      .subscribe([`SELECT * FROM message_receipt_details WHERE scope = '${watch.scope}' AND message_id = ${watch.id}`,
        `SELECT * FROM message_receipt_tracking WHERE scope = '${watch.scope}' AND message_id = ${watch.id}`]);
  }
  private refresh() {
    const db = this.connection?.db;
    if (!db) return;
    for (const watch of this.watches.values()) {
      const receipts = [...db.messageReceiptDetails.iter()].filter(row => row.scope === watch.scope && row.messageId.toString() === watch.id)
        .map(row => ({ scope: watch.scope, conversationId: row.conversationId, messageId: row.messageId.toString(), recipientId: row.recipient.toHexString(), deliveredAt: row.deliveredAt?.toDate(), readAt: row.readAt?.toDate() }));
      const tracked = [...db.messageReceiptTracking.iter()].some(row => row.scope === watch.scope && row.messageId.toString() === watch.id);
      const next = { loading: watch.info.loading, unavailable: watch.info.unavailable, tracked, receipts };
      if (JSON.stringify(watch.info) === JSON.stringify(next)) continue;
      watch.info = next; for (const listener of watch.listeners) listener();
    }
  }
  private async acknowledgeCached() {
    const connection = this.connection; if (!connection?.db.myMessageReceipts) return;
    const generation = this.generation;
    const receipts = new Map([...connection.db.myMessageReceipts.iter()].map(row => [`${row.scope}:${row.messageId}`, row]));
    const cached = [
      ...[...connection.db.groupMessages.iter()].filter(row => !row.deletedAt).map(row => ({ scope: 'group', conversationId: 'general', id: row.id, sender: row.sender })),
      ...[...connection.db.myDirectMessages.iter()].filter(row => !row.deletedAt).map(row => ({ scope: 'direct', conversationId: row.conversationId.toString(), id: row.id, sender: row.sender })),
      ...[...connection.db.channelMessages.iter()].filter(row => !row.deletedAt).map(row => ({ scope: 'channel', conversationId: row.channelId.toString(), id: row.id, sender: row.sender })),
    ];
    const groups = new Map<string, { scope: string; conversationId: string; ids: bigint[]; keys: string[] }>();
    for (const row of cached) {
      const messageKey = `${row.scope}:${row.id}`; const previous = receipts.get(messageKey);
      if (previous?.deliveredAt || this.processed.has(messageKey) || this.inFlight.has(messageKey)) continue;
      // The authenticated member identity can differ from the transport identity.
      if ((this.memberId && row.sender?.toHexString() === this.memberId) || (!previous && (!this.memberId || !row.sender))) continue;
      const key = `${row.scope}:${row.conversationId}`; const group = groups.get(key) ?? { scope: row.scope, conversationId: row.conversationId, ids: [], keys: [] };
      group.ids.push(row.id); group.keys.push(messageKey); groups.set(key, group); this.inFlight.add(messageKey);
    }
    for (const group of groups.values()) for (let index = 0; index < group.ids.length; index += 100) {
      const keys = group.keys.slice(index, index + 100);
      try {
        if (connection !== this.connection || generation !== this.generation) return;
        await connection.reducers.acknowledgeMessageDelivery({ scope: group.scope, conversationId: group.conversationId, messageIds: group.ids.slice(index, index + 100) });
        if (generation === this.generation) for (const key of keys) this.processed.add(key);
      } catch (error) {
        if (connection === this.connection && generation === this.generation) {
          // A revoked or removed cached message must not cause an endless acknowledgement loop.
          if (error instanceof Error && /No participas/.test(error.message)) for (const key of keys) this.processed.add(key);
          else { clearTimeout(this.retry); this.retry = setTimeout(this.changed, 5000); }
        }
      } finally { if (generation === this.generation) for (const key of keys) this.inFlight.delete(key); }
    }
  }
  async markSeen(scope: MessageScope, conversationId: Id, ids: Id[]) {
    const connection = this.connection; if (!ids.length) return; if (!connection) throw new Error('Se perdió la conexión.');
    for (let index = 0; index < ids.length; index += 100) await connection.reducers.markMessagesSeen({ scope, conversationId, messageIds: ids.slice(index, index + 100).map(BigInt) });
  }
  private stop(watch: Watch) {
    ++watch.generation;
    try { if (watch.handle && !watch.handle.isEnded()) watch.handle.unsubscribe(); } catch { /* Closing connection. */ }
    watch.handle = undefined; watch.info = EMPTY_RECEIPT_INFO;
  }
  disconnect() {
    ++this.generation; this.queued = false; clearTimeout(this.retry); this.inFlight.clear(); this.processed.clear(); this.memberId = undefined;
    if (this.connection) for (const table of this.tables(this.connection)) { table.removeOnInsert(this.changed); table.removeOnDelete(this.changed); table.removeOnUpdate(this.changed); }
    for (const watch of this.watches.values()) { this.stop(watch); for (const listener of watch.listeners) listener(); }
    this.connection = undefined;
  }
}
