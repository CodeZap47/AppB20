import type { DbConnection } from '../module_bindings';
import type { Id, MessageScope } from './types';
import { EMPTY_LIVE_DRAFTS, type LiveDraft, type LiveDraftSource } from './liveDraftTypes';

type Subscription = ReturnType<ReturnType<DbConnection['subscriptionBuilder']>['subscribe']>;
interface Watch {
  scope: MessageScope;
  id: Id;
  listeners: Set<() => void>;
  rows: readonly LiveDraft[];
  handle?: Subscription;
  generation: number;
}

/** Shares the authenticated connection, but never its coarse application refresh events. */
export class SpacetimeLiveDraftStore implements LiveDraftSource {
  private connection?: DbConnection;
  private watches = new Map<string, Watch>();
  private revision = 0n;
  private generation = 0;
  private queued = false;
  private expiry?: ReturnType<typeof setTimeout>;
  private readonly changed = () => {
    if (this.queued) return;
    this.queued = true;
    const generation = this.generation;
    queueMicrotask(() => {
      if (generation !== this.generation) return;
      this.queued = false;
      this.refresh();
    });
  };

  getSnapshot = (scope: MessageScope, conversationId: Id): readonly LiveDraft[] =>
    this.watches.get(`${scope}:${conversationId}`)?.rows ?? EMPTY_LIVE_DRAFTS;

  subscribe = (scope: MessageScope, id: Id, listener: () => void) => {
    const key = `${scope}:${id}`;
    let watch = this.watches.get(key);
    if (!watch) {
      watch = { scope, id, listeners: new Set(), rows: EMPTY_LIVE_DRAFTS, generation: 0 };
      this.watches.set(key, watch);
    }
    watch.listeners.add(listener);
    if (!watch.handle && this.connection) this.start(watch);
    return () => {
      watch!.listeners.delete(listener);
      if (!watch!.listeners.size) {
        this.stop(watch!);
        this.watches.delete(key);
        this.refresh();
      }
    };
  };

  connect(connection: DbConnection) {
    this.disconnect();
    this.connection = connection;
    connection.db.liveDrafts?.onInsert(this.changed);
    connection.db.liveDrafts?.onDelete(this.changed);
    connection.db.liveDrafts?.onUpdate(this.changed);
    for (const watch of this.watches.values()) this.start(watch);
  }

  private start(watch: Watch) {
    const connection = this.connection;
    if (!connection?.db.liveDrafts) return;
    const generation = ++watch.generation;
    const current = () => this.connection === connection && watch.generation === generation && watch.listeners.size > 0;
    // Both values come from validated routes; typed queries also escape string values.
    watch.handle = connection.subscriptionBuilder()
      .onApplied(() => { if (current()) this.refresh(); })
      .onError(() => {
        if (!current()) return;
        watch.rows = EMPTY_LIVE_DRAFTS;
        for (const listener of watch.listeners) listener();
      })
      .subscribe((tables) => tables.liveDrafts!.where((row) => row.scope!.eq(watch.scope).and(row.conversationId!.eq(watch.id))));
  }

  private stop(watch: Watch) {
    watch.generation++;
    if (watch.handle && !watch.handle.isEnded()) {
      try { watch.handle.unsubscribe(); } catch { /* A closing connection already dropped its cache. */ }
    }
    watch.handle = undefined;
    watch.rows = EMPTY_LIVE_DRAFTS;
  }

  private refresh() {
    clearTimeout(this.expiry);
    const now = Date.now();
    const all = [...(this.connection?.db.liveDrafts?.iter() ?? [])];
    let deadline = Infinity;
    for (const watch of this.watches.values()) {
      const rows: LiveDraft[] = all.filter((row) => row.scope === watch.scope && row.conversationId === watch.id && row.text && row.expiresAt.toDate().getTime() > now)
        .map((row) => ({ id: row.key, memberId: row.memberId.toHexString(), scope: watch.scope, conversationId: watch.id,
          text: row.text, revision: row.revision, updatedAt: row.updatedAt.toDate(), expiresAt: row.expiresAt.toDate() }))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id));
      for (const row of rows) deadline = Math.min(deadline, row.expiresAt.getTime());
      if (rows.length === watch.rows.length && rows.every((row, index) => {
        const old = watch.rows[index]!;
        return row.id === old.id && row.revision === old.revision && row.text === old.text && row.expiresAt.getTime() === old.expiresAt.getTime();
      })) continue;
      watch.rows = rows.length ? rows : EMPTY_LIVE_DRAFTS;
      for (const listener of watch.listeners) listener();
    }
    if (deadline !== Infinity) this.expiry = setTimeout(() => this.refresh(), Math.max(1, deadline - now));
  }

  async publish(scope: MessageScope, conversationId: Id, text: string) {
    const connection = this.connection;
    if (!connection) return;
    await connection.reducers.setLiveDraft({ scope, conversationId, text, revision: ++this.revision });
  }

  disconnect() {
    ++this.generation;
    this.queued = false;
    clearTimeout(this.expiry);
    const table = this.connection?.db.liveDrafts;
    table?.removeOnInsert(this.changed);
    table?.removeOnDelete(this.changed);
    table?.removeOnUpdate(this.changed);
    for (const watch of this.watches.values()) {
      this.stop(watch);
      for (const listener of watch.listeners) listener();
    }
    this.connection = undefined;
  }
}
