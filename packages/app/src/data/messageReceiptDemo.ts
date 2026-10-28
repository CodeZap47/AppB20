import type { Id, Member, MessageFields, MessageScope, Snapshot } from './types';
import { EMPTY_RECEIPT_INFO, type MessageReceipt, type MessageReceiptInfo, type MessageReceiptSource } from './messageReceiptTypes';

interface Context {
  state: object; active(): Member; members(): Member[]; now(): Date; emit(): void;
  subscribe(listener: () => void): () => void;
  lookup(scope: MessageScope, id: Id, viewer: Id): { message: MessageFields; conversationId: Id; recipients: Id[] } | undefined;
}
interface Shared { tracked: Set<string>; rows: Map<string, MessageReceipt>; }
const groups = new WeakMap<object, Shared>();
export class DemoMessageReceiptStore implements MessageReceiptSource {
  private shared: Shared;
  private watches = new Map<string, { scope: MessageScope; id: Id; info: MessageReceiptInfo; listeners: Set<() => void> }>();
  private queued = false;
  private disposed = false;
  private unsubscribe: () => void;
  constructor(private ctx: Context) {
    this.shared = groups.get(ctx.state) ?? { tracked: new Set(), rows: new Map() }; groups.set(ctx.state, this.shared);
    this.unsubscribe = ctx.subscribe(() => this.refresh());
  }
  track(scope: MessageScope, conversationId: Id, messageId: Id) {
    const sender = this.ctx.active(); const target = this.ctx.lookup(scope, messageId, sender.id);
    if (!target) return;
    const key = `${scope}:${messageId}`; this.shared.tracked.add(key);
    for (const recipientId of target.recipients) if (recipientId !== sender.id && this.ctx.members().some(member => member.id === recipientId && member.status === 'active')) {
      this.shared.rows.set(`${key}:${recipientId}`, { scope, conversationId, messageId, recipientId, tracked: true });
    }
  }
  own(): MessageReceipt[] {
    let actor: Member; try { actor = this.ctx.active(); } catch { return []; }
    return [...this.shared.rows.values()].filter(row => row.recipientId === actor.id && this.ctx.lookup(row.scope, row.messageId, actor.id));
  }
  /** Called after the caller has obtained its visible cache, never during snapshot construction. */
  cacheApplied(snapshot: Pick<Snapshot, 'me' | 'groupMessages' | 'directMessages' | 'channelMessages'>) {
    if (this.queued || this.disposed || snapshot.me?.status !== 'active') return; this.queued = true;
    const viewer = snapshot.me.id;
    const cached = [
      ...snapshot.groupMessages.map(message => ({ scope: 'group' as const, conversationId: 'general', message })),
      ...snapshot.directMessages.map(message => ({ scope: 'direct' as const, conversationId: message.conversationId, message })),
      ...snapshot.channelMessages.map(message => ({ scope: 'channel' as const, conversationId: message.channelId, message })),
    ];
    queueMicrotask(() => {
      this.queued = false; if (this.disposed) return;
      let actor: Member; try { actor = this.ctx.active(); } catch { return; } if (actor.id !== viewer) return;
      let changed = false;
      for (const { scope, conversationId, message } of cached) {
        if (message.senderId === viewer || message.deletedAt || !this.ctx.lookup(scope, message.id, viewer)) continue;
        const messageKey = `${scope}:${message.id}`; const key = `${messageKey}:${viewer}`;
        const previous = this.shared.rows.get(key); const tracked = this.shared.tracked.has(messageKey);
        if (previous?.deliveredAt || (!previous && tracked)) continue;
        this.shared.rows.set(key, { scope, conversationId, messageId: message.id, recipientId: viewer, tracked,
          ...previous, deliveredAt: this.ctx.now() }); changed = true;
      }
      if (changed) this.ctx.emit();
    });
  }
  markSeen(scope: MessageScope, conversationId: Id, ids: Id[]) {
    const actor = this.ctx.active(); let changed = false;
    for (const id of new Set(ids)) {
      const target = this.ctx.lookup(scope, id, actor.id);
      if (!target || target.conversationId !== conversationId) throw new Error('El mensaje no está disponible en esta conversación.');
      if (target.message.senderId === actor.id) continue;
      const messageKey = `${scope}:${id}`; const key = `${messageKey}:${actor.id}`; const previous = this.shared.rows.get(key);
      if (!previous && this.shared.tracked.has(messageKey)) continue;
      if (previous?.readAt) continue;
      this.shared.rows.set(key, { scope, conversationId, messageId: id, recipientId: actor.id,
        deliveredAt: previous?.deliveredAt ?? this.ctx.now(), readAt: this.ctx.now(), tracked: this.shared.tracked.has(messageKey) }); changed = true;
    }
    if (changed) this.ctx.emit();
  }
  getSnapshot = (scope: MessageScope, id: Id): MessageReceiptInfo => this.watches.get(`${scope}:${id}`)?.info ?? EMPTY_RECEIPT_INFO;
  subscribe = (scope: MessageScope, id: Id, listener: () => void) => {
    const key = `${scope}:${id}`; let watch = this.watches.get(key);
    if (!watch) { watch = { scope, id, info: EMPTY_RECEIPT_INFO, listeners: new Set() }; this.watches.set(key, watch); }
    watch.listeners.add(listener); this.refresh();
    return () => { watch!.listeners.delete(listener); if (!watch!.listeners.size) this.watches.delete(key); };
  };
  private refresh() {
    for (const watch of this.watches.values()) {
      let actor: Member | undefined; try { actor = this.ctx.active(); } catch { /* Signed out. */ }
      const target = actor && this.ctx.lookup(watch.scope, watch.id, actor.id);
      const authorized = !!actor && target?.message.senderId === actor.id;
      const info: MessageReceiptInfo = { loading: false, unavailable: !authorized,
        tracked: authorized && this.shared.tracked.has(`${watch.scope}:${watch.id}`),
        receipts: authorized ? [...this.shared.rows.values()].filter(row => row.scope === watch.scope && row.messageId === watch.id) : [] };
      if (JSON.stringify(info) === JSON.stringify(watch.info)) continue;
      watch.info = info; for (const listener of watch.listeners) listener();
    }
  }
  purge(scope: MessageScope, id: Id) {
    this.shared.tracked.delete(`${scope}:${id}`);
    for (const [key, row] of this.shared.rows) if (row.scope === scope && row.messageId === id) this.shared.rows.delete(key);
  }
  dispose() { this.disposed = true; this.unsubscribe(); this.watches.clear(); }
}
