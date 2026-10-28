// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppPresenceController, SpacetimeAppPresenceStore, browserAppPresenceEnvironment, type AppPresenceEnvironment } from './appPresenceStore';
import type { DbConnection } from '../module_bindings';

function foreground(initial = true) {
  let active = initial; const listeners = new Set<() => void>();
  const environment: AppPresenceEnvironment = { isForeground: () => active, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  return { environment, listeners, change(value: boolean) { active = value; listeners.forEach(listener => listener()); } };
}
const stores: { disconnect(): void }[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { stores.forEach(store => store.disconnect()); stores.length = 0; vi.useRealTimers(); vi.restoreAllMocks(); });

describe('presencia del cliente', () => {
  it('espera una membresía, renueva cada cinco segundos y retira inmediatamente al ocultar', async () => {
    const focus = foreground(); const publish = vi.fn(async () => {});
    const store = new SpacetimeAppPresenceStore(focus.environment); stores.push(store);
    store.connect({ reducers: { setAppPresence: publish } } as unknown as Pick<DbConnection, 'reducers'>);
    expect(publish).not.toHaveBeenCalled();
    store.setMember('member-a'); expect(publish).toHaveBeenLastCalledWith({ active: true, revision: 1n });
    await vi.advanceTimersByTimeAsync(4999); expect(publish).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(publish).toHaveBeenLastCalledWith({ active: true, revision: 2n });
    focus.change(false); expect(publish).toHaveBeenLastCalledWith({ active: false, revision: 3n });
    await vi.advanceTimersByTimeAsync(20000); expect(publish).toHaveBeenCalledTimes(3);
    focus.change(true); expect(publish).toHaveBeenLastCalledWith({ active: true, revision: 4n });
    store.setMember(undefined); expect(publish).toHaveBeenLastCalledWith({ active: false, revision: 5n });
  });
  it('conserva revisiones crecientes al reiniciar y limpia listeners y renovaciones', async () => {
    const focus = foreground(); const publish = vi.fn(async (_input: { active: boolean; revision: bigint }) => {});
    const controller = new AppPresenceController(focus.environment); stores.push(controller);
    controller.connect(publish, 'one'); controller.connect(publish, 'one');
    expect(publish.mock.calls.map(call => call[0])).toEqual([{ active: true, revision: 1n }, { active: false, revision: 2n }, { active: true, revision: 3n }]);
    expect(focus.listeners.size).toBe(1); controller.disconnect(); expect(focus.listeners.size).toBe(0);
    expect(publish).toHaveBeenLastCalledWith({ active: false, revision: 4n });
    focus.change(true); await vi.advanceTimersByTimeAsync(20000); expect(publish).toHaveBeenCalledTimes(4);
  });
  it('reintenta una renovación fallida y no reactiva una sesión al completarse un envío viejo', async () => {
    const focus = foreground(); let release!: () => void;
    const publish = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const controller = new AppPresenceController(focus.environment); stores.push(controller); controller.connect(publish, 'one');
    await vi.advanceTimersByTimeAsync(5000); focus.change(false); release(); await Promise.resolve();
    expect(publish).toHaveBeenLastCalledWith({ active: false, revision: 3n });
    await vi.advanceTimersByTimeAsync(10000); expect(publish).toHaveBeenCalledTimes(3);
    focus.change(true); await vi.advanceTimersByTimeAsync(5000); expect(publish).toHaveBeenLastCalledWith({ active: true, revision: 5n });
  });
  it('usa foco, visibilidad y pagehide sin depender de la conversación', () => {
    let hidden = false; vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible');
    const controller = new AppPresenceController(browserAppPresenceEnvironment()); stores.push(controller); const publish = vi.fn(); controller.connect(publish, 'one');
    window.dispatchEvent(new Event('blur')); expect(publish).toHaveBeenLastCalledWith({ active: false, revision: 2n });
    window.dispatchEvent(new Event('focus')); expect(publish).toHaveBeenLastCalledWith({ active: true, revision: 3n });
    hidden = true; document.dispatchEvent(new Event('visibilitychange')); expect(publish).toHaveBeenLastCalledWith({ active: false, revision: 4n });
    hidden = false; document.dispatchEvent(new Event('visibilitychange')); expect(publish).toHaveBeenLastCalledWith({ active: true, revision: 5n });
    window.dispatchEvent(new Event('pagehide')); expect(publish).toHaveBeenLastCalledWith({ active: false, revision: 6n });
  });
  it('Android usa el estado nativo, tolera el teclado y descarta una respuesta nativa atrasada', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    let update!: (state: { isActive: boolean }) => void; let initial!: (state: { isActive: boolean }) => void;
    const remove = vi.fn(async () => {});
    const environment = browserAppPresenceEnvironment(true, async () => ({ addListener: async (_event, listener) => { update = listener; return { remove }; }, getState: () => new Promise(resolve => { initial = resolve; }) }));
    const controller = new AppPresenceController(environment); stores.push(controller); const publish = vi.fn(); controller.connect(publish, 'one');
    await Promise.resolve(); await Promise.resolve(); expect(publish).not.toHaveBeenCalled();
    update({ isActive: true }); expect(publish).toHaveBeenLastCalledWith({ active: true, revision: 1n });
    window.dispatchEvent(new Event('blur')); expect(publish).toHaveBeenCalledTimes(1);
    update({ isActive: false }); initial({ isActive: true }); await Promise.resolve();
    expect(publish).toHaveBeenLastCalledWith({ active: false, revision: 2n });
    controller.disconnect(); expect(remove).toHaveBeenCalledOnce();
  });
  it('retira el listener nativo que termina de registrarse después de salir', async () => {
    let resolveListener!: (value: { remove(): Promise<void> }) => void;
    const remove = vi.fn(async () => {}); const getState = vi.fn(async () => ({ isActive: true }));
    const controller = new AppPresenceController(browserAppPresenceEnvironment(true, async () => ({ addListener: () => new Promise(resolve => { resolveListener = resolve; }), getState })));
    stores.push(controller); controller.connect(vi.fn(), 'one'); await Promise.resolve(); controller.disconnect();
    resolveListener({ remove }); await Promise.resolve(); expect(remove).toHaveBeenCalledOnce(); expect(getState).not.toHaveBeenCalled();
  });
});
