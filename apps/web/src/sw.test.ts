import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('workbox-precaching', () => ({ precacheAndRoute: vi.fn(), cleanupOutdatedCaches: vi.fn() }));

type WorkerEvent = {
  waitUntil(promise: Promise<unknown>): void;
  data?: { json(): unknown };
  notification?: { close(): void; data?: unknown };
};
const handlers = new Map<string, (event: WorkerEvent) => void>();
const fallback = 'https://app-b20.pages.dev/#/m/avisos';
const showNotification = vi.fn().mockResolvedValue(undefined);
const navigate = vi.fn().mockResolvedValue(undefined);
const focus = vi.fn().mockResolvedValue(undefined);
const matchAll = vi.fn();
const openWindow = vi.fn().mockResolvedValue(undefined);

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); handlers.clear();
  matchAll.mockResolvedValue([]);
  vi.stubGlobal('self', {
    __WB_MANIFEST: [], location: new URL('https://app-b20.pages.dev/sw.js'),
    registration: { showNotification }, clients: { matchAll, openWindow },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    addEventListener: (name: string, handler: (event: WorkerEvent) => void) => handlers.set(name, handler),
  });
  await import('./sw');
});
afterEach(() => vi.unstubAllGlobals());

async function dispatch(name: string, fields: Omit<WorkerEvent, 'waitUntil'>) {
  const pending: Promise<unknown>[] = [];
  const waitUntil = vi.fn((promise: Promise<unknown>) => { pending.push(promise); });
  const handler = handlers.get(name); expect(handler, `${name} registrado`).toBeTypeOf('function');
  handler!({ ...fields, waitUntil }); await Promise.all(pending);
  expect(waitUntil).toHaveBeenCalledOnce();
}
const push = (payload: unknown) => dispatch('push', { data: { json: () => payload } });

describe('handlers reales de Web Push', () => {
  it('muestra una bandeja segura con JSON malformado o campos de tipos incorrectos', async () => {
    await dispatch('push', { data: { json: () => { throw new SyntaxError('JSON sintético incompleto'); } } });
    await push({ title: 123, body: {}, url: { href: 'https://example.com' } });
    for (const call of showNotification.mock.calls) {
      expect(call).toEqual(['B20', expect.objectContaining({ body: 'Tienes novedades en el grupo.', data: { url: fallback }, tag: undefined })]);
    }
    expect(showNotification).toHaveBeenCalledTimes(2);
  });
  it('conserva el tag estable del aviso repetido y descarta etiquetas arbitrarias', async () => {
    const payload = { title: 'Aviso sintético', body: 'Contenido genérico', url: '/m/avisos', tag: 'b20:18446744073709551615' };
    await push(payload); await push(payload);
    // El mismo tag permite que el navegador sustituya el aviso previo del mismo evento.
    expect(showNotification.mock.calls.slice(0, 2).map((call) => call[1]?.tag)).toEqual([payload.tag, payload.tag]);
    for (const tag of ['otra:123', 'b20:-1', 'b20:abc', 'b20:123456789012345678901', { id: 123 }]) await push({ ...payload, tag });
    expect(showNotification.mock.calls.slice(2).every((call) => call[1]?.tag === undefined)).toBe(true);
    expect(showNotification.mock.calls.every((call) => call[1]?.data?.url === fallback)).toBe(true);
  });
  it('revalida un destino externo al pulsar y navega una ventana propia a la bandeja', async () => {
    matchAll.mockResolvedValue([{ url: 'https://app-b20.pages.dev/#/m/inicio', navigate, focus }]);
    const close = vi.fn();
    await dispatch('notificationclick', { notification: { close, data: { url: 'https://example.com/#/m/mensajes' } } });
    expect(close).toHaveBeenCalledOnce();
    expect(matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
    expect(navigate).toHaveBeenCalledWith(fallback); expect(focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });
  it('abre solamente la ruta interna validada cuando no existe una ventana propia', async () => {
    matchAll.mockResolvedValue([{ url: 'https://example.com/#/m/inicio', navigate, focus }]);
    const close = vi.fn();
    await dispatch('notificationclick', { notification: { close, data: { url: '/m/mensajes/directos/123' } } });
    expect(close).toHaveBeenCalledOnce();
    expect(openWindow).toHaveBeenCalledWith('https://app-b20.pages.dev/#/m/mensajes/directos/123');
    expect(navigate).not.toHaveBeenCalled(); expect(focus).not.toHaveBeenCalled();
  });
});
