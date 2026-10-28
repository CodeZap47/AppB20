import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';

let sources: DemoDataSource[];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T20:00:00Z')); sources = []; });
afterEach(() => { for (const source of sources) source.dispose(); vi.useRealTimers(); });
function group() {
  const state = createDemoState();
  const make = (id: string) => { const source = new DemoDataSource(state, id); sources.push(source); return source; };
  return { state, make };
}
it('separa pulsaciones del snapshot general y actualiza tres participantes sin crear mensajes', () => {
  const { make } = group(); const author = make('demo-2'); const peer = make('demo-3'); const owner = make('demo-1');
  const changed = vi.fn(); const global = vi.fn();
  const before = peer.getSnapshot(); peer.subscribe(global);
  peer.liveDrafts.subscribe('group', 'general', changed);
  author.liveDrafts.publish('group', 'general', 'Hola'); owner.liveDrafts.publish('group', 'general', 'Otra persona');
  peer.liveDrafts.publish('group', 'general', 'Tercera persona');
  expect(peer.liveDrafts.getSnapshot('group', 'general')).toHaveLength(3);
  expect(changed).toHaveBeenCalledTimes(3);
  expect(global).not.toHaveBeenCalled();
  expect(peer.getSnapshot()).toBe(before);
});
it('comparte preferencias entre sesiones de la misma cuenta y limpia todas sus conexiones', () => {
  const { make } = group(); const tab = make('demo-2'); const second = make('demo-2'); const peer = make('demo-3');
  peer.liveDrafts.subscribe('group', 'general', () => {});
  const cachedSecond = second.getSnapshot(); expect(cachedSecond.liveDraftSharingEnabled).toBe(true);
  tab.liveDrafts.publish('group', 'general', 'Primera pestaña'); second.liveDrafts.publish('group', 'general', 'Segunda pestaña');
  expect(peer.liveDrafts.getSnapshot('group', 'general')).toHaveLength(2);
  tab.setLiveDraftSharing(false);
  expect(peer.liveDrafts.getSnapshot('group', 'general')).toHaveLength(0);
  expect(second.getSnapshot().liveDraftSharingEnabled).toBe(false);
  second.liveDrafts.publish('group', 'general', 'No se comparte');
  expect(peer.liveDrafts.getSnapshot('group', 'general')).toHaveLength(0);
});
it('limita directos a sus participantes y revoca los borradores al bloquear', () => {
  const { make } = group(); const author = make('demo-2'); const peer = make('demo-3'); const admin = make('demo-1');
  const id = author.openDirectConversation('demo-3');
  peer.liveDrafts.subscribe('direct', id, () => {}); admin.liveDrafts.subscribe('direct', id, () => {});
  author.liveDrafts.publish('direct', id, 'Texto privado');
  expect(peer.liveDrafts.getSnapshot('direct', id)).toHaveLength(1);
  expect(admin.liveDrafts.getSnapshot('direct', id)).toHaveLength(0);
  peer.setMemberBlocked('demo-2', true);
  expect(peer.liveDrafts.getSnapshot('direct', id)).toHaveLength(0);
  expect(() => author.liveDrafts.publish('direct', id, 'Bloqueado')).toThrow('disponible');
});
it('caduca sin más pulsaciones y desconectar una sesión conserva las demás', () => {
  const { make } = group(); const first = make('demo-2'); const second = make('demo-2'); const peer = make('demo-3');
  peer.liveDrafts.subscribe('group', 'general', () => {});
  first.liveDrafts.publish('group', 'general', 'Uno'); second.liveDrafts.publish('group', 'general', 'Dos');
  first.dispose();
  expect(peer.liveDrafts.getSnapshot('group', 'general').map((row) => row.text)).toEqual(['Dos']);
  vi.advanceTimersByTime(7001);
  expect(peer.liveDrafts.getSnapshot('group', 'general')).toHaveLength(0);
});
