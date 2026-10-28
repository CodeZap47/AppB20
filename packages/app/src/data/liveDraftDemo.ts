import type { Id, MessageScope, Snapshot } from './types';
import { EMPTY_LIVE_DRAFTS, type LiveDraft, type LiveDraftSource } from './liveDraftTypes';

interface Context {
  state: object;
  current(): Snapshot;
  now(): Date;
  emit(): void;
  subscribe(listener: () => void): () => void;
  visible(viewer: Id, row: LiveDraft): boolean;
}
interface Shared {
  rows: Map<string, LiveDraft>;
  preferences: Map<Id, boolean>;
  stores: Set<DemoLiveDraftStore>;
}
const sharedByState = new WeakMap<object, Shared>();
let session = 0;

export class DemoLiveDraftStore implements LiveDraftSource {
  private shared: Shared;
  private sessionId = `live-demo-${++session}`;
  private revision = 0n;
  private watches = new Map<string, { scope: MessageScope; id: Id; rows: readonly LiveDraft[]; listeners: Set<() => void> }>();
  private expiry?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private unsubscribe: () => void;

  constructor(private ctx: Context) {
    this.shared = sharedByState.get(ctx.state) ?? { rows: new Map(), preferences: new Map(), stores: new Set() };
    sharedByState.set(ctx.state, this.shared);
    this.shared.stores.add(this);
    this.unsubscribe = ctx.subscribe(() => this.refresh());
  }

  sharingEnabled(memberId: Id) { return this.shared.preferences.get(memberId) !== false; }

  setSharingEnabled(enabled: boolean) {
    const me = this.ctx.current().me;
    if (this.disposed || me?.status !== 'active') throw new Error('Necesitas ser integrante activo.');
    this.shared.preferences.set(me.id, enabled);
    if (!enabled) for (const [key, row] of this.shared.rows) if (row.memberId === me.id) this.shared.rows.delete(key);
    this.ctx.emit();
    this.notify();
  }

  getSnapshot = (scope: MessageScope, id: Id): readonly LiveDraft[] => this.watches.get(`${scope}:${id}`)?.rows ?? EMPTY_LIVE_DRAFTS;

  subscribe = (scope: MessageScope, id: Id, listener: () => void) => {
    if (this.disposed) return () => {};
    const key = `${scope}:${id}`;
    let watch = this.watches.get(key);
    if (!watch) { watch = { scope, id, rows: EMPTY_LIVE_DRAFTS, listeners: new Set() }; this.watches.set(key, watch); }
    watch.listeners.add(listener);
    this.refresh();
    return () => { watch!.listeners.delete(listener); if (!watch!.listeners.size) this.watches.delete(key); };
  };

  publish(scope: MessageScope, conversationId: Id, text: string) {
    if (this.disposed) return;
    const snapshot = this.ctx.current();
    const me = snapshot.me;
    if (me?.status !== 'active') throw new Error('Necesitas ser integrante activo.');
    if (text.length > 4000) throw new Error('El borrador admite hasta 4000 caracteres.');
    const id = `${this.sessionId}:${scope}:${conversationId}`;
    if (!text) { this.shared.rows.delete(id); this.notify(); return; }
    if (!this.sharingEnabled(me.id)) return;
    const now = this.ctx.now();
    const row: LiveDraft = { id, memberId: me.id, scope, conversationId, text, revision: ++this.revision,
      updatedAt: now, expiresAt: new Date(now.getTime() + 7000) };
    const direct = scope === 'direct' ? snapshot.directConversations.find((chat) => chat.id === conversationId) : undefined;
    if (!this.ctx.visible(me.id, row) || (scope === 'direct' && !direct?.participantIds.every((id) => this.ctx.visible(id, row))))
      throw new Error('La conversación no está disponible.');
    this.shared.rows.set(id, row);
    this.notify();
  }

  private notify() { for (const store of this.shared.stores) store.refresh(); }

  private refresh() {
    clearTimeout(this.expiry);
    if (this.disposed) return;
    const now = this.ctx.now().getTime();
    for (const [key, row] of this.shared.rows) if (row.expiresAt.getTime() <= now) this.shared.rows.delete(key);
    const viewer = this.watches.size ? this.ctx.current().me : undefined;
    let deadline = Math.min(Infinity, ...[...this.shared.rows.values()].map((row) => row.expiresAt.getTime()));
    for (const watch of this.watches.values()) {
      const rows = viewer?.status === 'active' ? [...this.shared.rows.values()]
        .filter((row) => row.scope === watch.scope && row.conversationId === watch.id && this.sharingEnabled(row.memberId) && this.ctx.visible(viewer.id, row))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id)) : [];
      for (const row of rows) deadline = Math.min(deadline, row.expiresAt.getTime());
      if (rows.length === watch.rows.length && rows.every((row, index) => row === watch.rows[index])) continue;
      watch.rows = rows.length ? rows : EMPTY_LIVE_DRAFTS;
      for (const listener of watch.listeners) listener();
    }
    if (deadline !== Infinity) this.expiry = setTimeout(() => this.refresh(), Math.max(1, deadline - now));
  }

  clearSession() {
    for (const [key] of this.shared.rows) if (key.startsWith(`${this.sessionId}:`)) this.shared.rows.delete(key);
    this.notify();
  }

  dispose() {
    this.clearSession();
    this.disposed = true;
    this.unsubscribe(); clearTimeout(this.expiry);
    this.shared.stores.delete(this);
    for (const watch of this.watches.values()) { watch.rows = EMPTY_LIVE_DRAFTS; for (const listener of watch.listeners) listener(); }
    this.watches.clear();
  }
}
