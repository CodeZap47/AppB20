import { Identity, Timestamp } from 'spacetimedb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DbConnection } from '../module_bindings';
import { SpacetimeLiveDraftStore } from './liveDraftStore';

type Row = { key: string; memberId: Identity; scope: string; conversationId: string; text: string; revision: bigint; updatedAt: Timestamp; expiresAt: Timestamp };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T20:00:00Z')); });
afterEach(() => vi.useRealTimers());
function wire() {
  const rows = new Map<string, Row>();
  const inserted = new Set<() => void>(); const deleted = new Set<() => void>(); const updated = new Set<() => void>();
  let applied = () => {}; const unsubscribe = vi.fn(); const reducer = vi.fn();
  const scopeEq = vi.fn(() => ({ and: vi.fn(() => ({})) })); const idEq = vi.fn(() => ({}));
  const query = vi.fn((build: (tables: unknown) => unknown) => {
    build({ liveDrafts: { where: (predicate: (row: unknown) => unknown) => predicate({ scope: { eq: scopeEq }, conversationId: { eq: idEq } }) } });
    return { unsubscribe, isEnded: () => false };
  });
  const builder = { onApplied(fn: () => void) { applied = fn; return builder; }, onError() { return builder; }, subscribe: query };
  const table = { iter: () => rows.values(), onInsert: (fn: () => void) => inserted.add(fn), onDelete: (fn: () => void) => deleted.add(fn), onUpdate: (fn: () => void) => updated.add(fn),
    removeOnInsert: (fn: () => void) => inserted.delete(fn), removeOnDelete: (fn: () => void) => deleted.delete(fn), removeOnUpdate: (fn: () => void) => updated.delete(fn) };
  const connection = { db: { liveDrafts: table }, subscriptionBuilder: () => builder, reducers: { setLiveDraft: reducer } } as unknown as DbConnection;
  const row = (text: string, revision: bigint): Row => ({ key: 'connection:group:general', memberId: Identity.fromString('a'.repeat(64)), scope: 'group', conversationId: 'general', text, revision,
    updatedAt: new Timestamp(BigInt(Date.now()) * 1000n), expiresAt: new Timestamp(BigInt(Date.now() + 7000) * 1000n) });
  return { rows, inserted, deleted, updated, connection, row, query, unsubscribe, scopeEq, idEq, reducer, applied: () => applied() };
}
it('usa una suscripción filtrada y recibe actualizaciones de una fila existente', async () => {
  const w = wire(); const store = new SpacetimeLiveDraftStore(); store.connect(w.connection); const listener = vi.fn();
  store.subscribe('group', 'general', listener); w.applied(); expect(w.scopeEq).toHaveBeenCalledWith('group'); expect(w.idEq).toHaveBeenCalledWith('general');
  w.rows.set('draft', w.row('Uno', 1n)); for (const fn of w.inserted) fn(); await Promise.resolve();
  expect(store.getSnapshot('group', 'general')[0]?.text).toBe('Uno');
  w.rows.set('draft', w.row('Dos', 2n)); for (const fn of w.updated) fn(); await Promise.resolve();
  expect(store.getSnapshot('group', 'general')[0]?.text).toBe('Dos'); expect(listener).toHaveBeenCalledTimes(2);
  store.disconnect(); expect(w.updated.size).toBe(0); expect(w.inserted.size).toBe(0); expect(w.deleted.size).toBe(0);
});
it('caduca localmente y descarta onApplied tardío después de desmontar', async () => {
  const w = wire(); const store = new SpacetimeLiveDraftStore(); store.connect(w.connection); const listener = vi.fn();
  const cleanup = store.subscribe('group', 'general', listener);
  w.rows.set('draft', w.row('Temporal', 1n)); w.applied(); expect(store.getSnapshot('group', 'general')).toHaveLength(1);
  vi.advanceTimersByTime(7001); expect(store.getSnapshot('group', 'general')).toHaveLength(0);
  cleanup(); const calls = listener.mock.calls.length; w.applied(); expect(listener).toHaveBeenCalledTimes(calls); expect(w.unsubscribe).toHaveBeenCalledOnce();
  store.disconnect();
});
it('conserva revisiones crecientes entre conversaciones y al vaciar el texto', async () => {
  const w = wire(); const store = new SpacetimeLiveDraftStore(); store.connect(w.connection);
  await store.publish('group', 'general', 'Uno'); await store.publish('group', 'general', ''); await store.publish('direct', '1', 'Otro chat');
  expect(w.reducer.mock.calls.map(([input]) => input.revision)).toEqual([1n, 2n, 3n]); store.disconnect();
});
