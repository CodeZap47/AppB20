// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { disableBrowserPush, enableBrowserPush } from './browserPush';

const publicKey = btoa(String.fromCharCode(4, ...new Array<number>(64).fill(1))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function browser(permission: NotificationPermission = 'granted') {
  const unsubscribe = vi.fn().mockResolvedValue(true);
  const subscription = { toJSON: () => ({ endpoint: 'https://web.push.apple.com/example', keys: { p256dh: 'public-key', auth: 'auth-secret' } }), unsubscribe };
  const subscribe = vi.fn().mockResolvedValue(subscription);
  const worker = { pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe } };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: vi.fn().mockResolvedValue(worker), ready: Promise.resolve(worker) } });
  vi.stubGlobal('Notification', { permission, requestPermission: vi.fn().mockResolvedValue(permission) });
  return { subscribe, unsubscribe, worker, subscription };
}
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'serviceWorker'); });

describe('registro Web Push solicitado por la persona', () => {
  it('registra un dispositivo con id estable y no guarda claves ni endpoint en almacenamiento local', async () => {
    const { subscribe } = browser(); const register = vi.fn();
    const first = await enableBrowserPush('member', publicKey, register);
    expect(await enableBrowserPush('member', publicKey, register)).toBe(first);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ id: first, label: 'Web/PWA' }));
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(JSON.stringify(localStorage)).not.toContain('auth-secret');
    expect(JSON.stringify(localStorage)).not.toContain('web.push.apple.com');
  });
  it('conserva la bandeja sin registrar un dispositivo al denegar permiso', async () => {
    const { subscribe } = browser('denied'); const register = vi.fn();
    await expect(enableBrowserPush('member', publicKey, register)).rejects.toThrow('no autorizó');
    expect(register).not.toHaveBeenCalled(); expect(subscribe).not.toHaveBeenCalled();
  });
  it('revierte una suscripción nueva si el servidor rechaza el registro', async () => {
    const { unsubscribe } = browser();
    await expect(enableBrowserPush('member', publicKey, () => Promise.reject(new Error('Cuenta dada de baja')))).rejects.toThrow('dada de baja');
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it('retira la instalación autenticada antes de abandonar la suscripción del navegador', async () => {
    browser(); const id = await enableBrowserPush('member', publicKey, vi.fn()); const remove = vi.fn();
    await disableBrowserPush('member', remove);
    expect(remove).toHaveBeenCalledWith(id); expect(localStorage.length).toBe(0);
  });
  it('cambia de suscripción antes de registrar otra cuenta en el mismo navegador', async () => {
    const { worker, subscription, unsubscribe, subscribe } = browser();
    await enableBrowserPush('first-member', publicKey, vi.fn());
    worker.pushManager.getSubscription.mockResolvedValue(subscription);
    const register = vi.fn();
    await enableBrowserPush('second-member', publicKey, register);
    expect(unsubscribe).toHaveBeenCalledOnce(); expect(subscribe).toHaveBeenCalledTimes(2);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ label: 'Web/PWA' }));
  });
});
