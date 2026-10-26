import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbConnection } from '../module_bindings';
import { createSpacetimeDataSource, SpacetimeDataSource, type ConnectionCallbacks, type ConnectionFactory } from './spacetime';
import { emptySnapshot, PUBLIC_VIEWS, readSnapshot } from './spacetimeSnapshot';

vi.mock('./spacetimeSnapshot', async (original) => {
  const actual = await original<typeof import('./spacetimeSnapshot')>();
  return { ...actual, readSnapshot: vi.fn() };
});
vi.mock('../config', () => ({ config: {
  apiUrl: '', aiApiUrl: 'https://dedicated.example', invitationApiUrl: 'https://dedicated.example',
} }));
afterEach(() => vi.unstubAllGlobals());

function transport() {
  let callbacks!: ConnectionCallbacks;
  let applied!: () => void;
  let subscriptionError!: () => void;
  let inserted!: () => void;
  const query = vi.fn();
  const builder = {
    onApplied: (callback: () => void) => { applied = callback; return builder; },
    onError: (callback: () => void) => { subscriptionError = callback; return builder; },
    subscribe: query,
  };
  const connection = {
    db: { myMember: {
      onInsert: (callback: () => void) => { inserted = callback; },
      onDelete: vi.fn(), onUpdate: vi.fn(),
    } },
    subscriptionBuilder: () => builder,
    disconnect: vi.fn(),
  } as unknown as DbConnection;
  const factory: ConnectionFactory = vi.fn((_options, handlers) => { callbacks = handlers; return connection; });
  return {
    factory, connection, query,
    connected: () => callbacks.connected(connection, 'member-1'),
    applied: () => applied(),
    failed: () => callbacks.failed(),
    subscriptionError: () => subscriptionError(),
    inserted: () => inserted(),
  };
}
const options = { uri: 'ws://localhost:3000', database: 'app-b20', token: 'test-token' };

describe('authenticated group connection', () => {
  beforeEach(() => vi.mocked(readSnapshot).mockReturnValue(emptySnapshot('ready')));

  it('waits for subscriptions before allowing actions and never invents a member', () => {
    const wire = transport();
    const source = new SpacetimeDataSource(options, wire.factory);
    source.connect();
    wire.connected();
    expect(source.getSnapshot().connection).toBe('connecting');
    expect(() => source.getConnection()).toThrow();
    wire.applied();
    expect(source.getSnapshot().connection).toBe('ready');
    expect(source.getSnapshot().me).toBeUndefined();
    expect(source.getConnection()).toBe(wire.connection);
    expect(wire.query).toHaveBeenCalledWith(PUBLIC_VIEWS.map((view) => `SELECT * FROM ${view}`));
    source.disconnect();
  });

  it('purges personal data immediately on disconnect and ignores queued changes', async () => {
    const wire = transport();
    const source = new SpacetimeDataSource(options, wire.factory);
    const privateSnapshot = emptySnapshot('ready');
    privateSnapshot.directMessages = [{ id: 'private-message' } as never];
    vi.mocked(readSnapshot).mockReturnValue(privateSnapshot);
    source.connect(); wire.connected(); wire.applied();
    expect(source.getSnapshot().directMessages).toHaveLength(1);
    wire.inserted();
    source.disconnect();
    await Promise.resolve();
    expect(source.getSnapshot().directMessages).toEqual([]);
    expect(source.getIdentity()).toBe('');
    expect(() => source.getConnection()).toThrow();
  });

  it('fails closed on a subscription error without displaying transport credentials', () => {
    const wire = transport();
    const source = new SpacetimeDataSource(options, wire.factory);
    source.connect(); wire.connected(); wire.subscriptionError();
    expect(source.getSnapshot().connection).toBe('offline');
    expect(source.getSnapshot().me).toBeUndefined();
    expect(JSON.stringify(source.getSnapshot())).not.toContain(options.token);
    expect(wire.connection.disconnect).toHaveBeenCalled();
  });

  it('discards callbacks from a previous connection after reconnecting', () => {
    const first = transport();
    const second = transport();
    let calls = 0;
    const source = new SpacetimeDataSource(options, (opts, callbacks) =>
      (calls++ === 0 ? first : second).factory(opts, callbacks));
    source.connect(); first.connected(); first.applied();
    source.connect(); second.connected(); second.applied();
    first.failed();
    first.connected();
    expect(source.getSnapshot().connection).toBe('ready');
    expect(source.getConnection()).toBe(second.connection);
    source.disconnect();
  });

  it('does not open an anonymous transport when the session token is absent', () => {
    const wire = transport();
    const source = new SpacetimeDataSource({ ...options, token: '' }, wire.factory);
    source.connect();
    expect(wire.factory).not.toHaveBeenCalled();
    expect(source.getSnapshot().connection).toBe('offline');
  });

  it.each([
    [{}, 'https://dedicated.example'],
    [{ invitationApiUrl: 'https://invitations.example' }, 'https://invitations.example'],
    [{ apiUrl: 'https://single-worker.example' }, 'https://single-worker.example'],
  ])('routes invitation operations to their configured service (%j)', async (overrides, expectedUrl) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'link', url: 'https://app.example/#/invitacion?token=secret' })));
    vi.stubGlobal('fetch', fetcher);
    const wire = transport();
    const source = createSpacetimeDataSource({ ...options, ...overrides }, wire.factory);
    source.connect(); wire.connected(); wire.applied();
    await source.copyInvitationLink('link');
    expect(fetcher).toHaveBeenCalledWith(`${expectedUrl}/admin/invitation-links/link/copy`, expect.objectContaining({ method: 'POST' }));
    source.disconnect();
  });
});
