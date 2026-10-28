import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';
import type { AppPresenceEnvironment } from './appPresenceStore';
const sources: DemoDataSource[] = [];
const visible: AppPresenceEnvironment = { isForeground: () => true, subscribe: () => () => {} };
const hidden: AppPresenceEnvironment = { isForeground: () => false, subscribe: () => () => {} };
function source(state: ReturnType<typeof createDemoState>, id: string, environment = hidden) { const value = new DemoDataSource(state, id, undefined, environment); sources.push(value); return value; }
afterEach(() => { sources.forEach(item => item.dispose()); sources.length = 0; vi.useRealTimers(); });
describe('presencia de sesiones en la demo', () => {
  it('cuenta identidades únicas, al propio usuario y conserva otra sesión del mismo miembro', () => {
    const state = createDemoState(); const viewer = source(state, 'demo-1', visible); const first = source(state, 'demo-2', visible); const second = source(state, 'demo-2', visible);
    expect(viewer.getSnapshot().onlineMemberIds).toEqual(['demo-1', 'demo-2']);
    first.dispose(); expect(viewer.getSnapshot().onlineMemberIds).toEqual(['demo-1', 'demo-2']);
    second.dispose(); expect(viewer.getSnapshot().onlineMemberIds).toEqual(['demo-1']);
    viewer.appPresence.setForeground(false); expect(viewer.getSnapshot().onlineMemberIds).toEqual([]);
  });
  it('actualiza observadores, retira bajas y cambia de perfil sin arrastrar la conexión anterior', () => {
    const state = createDemoState(); const viewer = source(state, 'demo-1'); const actor = source(state, 'demo-2'); const changed = vi.fn(); viewer.subscribe(changed);
    actor.appPresence.setForeground(true); expect(viewer.getSnapshot().onlineMemberIds).toEqual(['demo-2']); expect(changed).toHaveBeenCalled();
    actor.setViewer('demo-3'); expect(viewer.getSnapshot().onlineMemberIds).toEqual(['demo-3']);
    viewer.removeMember('demo-3'); expect(viewer.getSnapshot().onlineMemberIds).toEqual([]); expect(actor.getSnapshot().onlineMemberIds).toEqual([]);
  });
  it('la renovación conserva presencia sin provocar nuevas instantáneas generales', async () => {
    vi.useFakeTimers(); const state = createDemoState(); const viewer = source(state, 'demo-1', visible); const changed = vi.fn(); viewer.subscribe(changed);
    viewer.getSnapshot(); await Promise.resolve(); const before = viewer.getSnapshot(); changed.mockClear(); await vi.advanceTimersByTimeAsync(10000);
    expect(viewer.getSnapshot()).toBe(before); expect(changed).not.toHaveBeenCalled(); expect(before.onlineMemberIds).toEqual(['demo-1']);
  });
});
