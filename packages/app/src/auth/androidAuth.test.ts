import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserManager } from 'oidc-client-ts';
import { ANDROID_LOGOUT_URI, ANDROID_REDIRECT_URI } from './oidc';
import { AndroidAuthNavigator, androidSilentNavigator, attachAndroidCallbacks } from './platformAuth';

const mocks = vi.hoisted(() => ({ open: vi.fn(async () => {}), close: vi.fn(async () => {}),
  getLaunchUrl: vi.fn<() => Promise<{ url: string } | undefined>>(async () => undefined),
  appListener: undefined as undefined | ((data: { url: string }) => void),
  closeListener: undefined as undefined | (() => void),
  remove: vi.fn(async () => {}),
}));
vi.mock('@capacitor/browser', () => ({ Browser: { open: mocks.open, close: mocks.close,
  addListener: vi.fn(async (_event, callback) => { mocks.closeListener = callback; return { remove: mocks.remove }; }),
} }));
vi.mock('@capacitor/app', () => ({ App: { getLaunchUrl: mocks.getLaunchUrl,
  addListener: vi.fn(async (_event, callback) => { mocks.appListener = callback; return { remove: mocks.remove }; }),
} }));

beforeEach(() => { vi.clearAllMocks(); mocks.getLaunchUrl.mockResolvedValue(undefined); });

function manager() {
  const signinRedirectCallback = vi.fn(async () => {});
  const signoutRedirectCallback = vi.fn(async () => {});
  const value = { settings: { redirect_uri: ANDROID_REDIRECT_URI, post_logout_redirect_uri: ANDROID_LOGOUT_URI },
    signinRedirectCallback, signoutRedirectCallback };
  return { value: value as unknown as UserManager, signinRedirectCallback, signoutRedirectCallback };
}

describe('navegador de autenticación Android', () => {
  it('abre el navegador del sistema y solo devuelve al cliente OIDC la ruta configurada', async () => {
    const navigator = new AndroidAuthNavigator();
    const mgr = manager();
    const cleanup = await attachAndroidCallbacks(mgr.value, navigator, vi.fn());
    const handle = await navigator.prepare();
    const url = `https://auth.spacetimedb.com/oidc/auth?redirect_uri=${encodeURIComponent(ANDROID_REDIRECT_URI)}`;
    const response = handle.navigate({ url });
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledWith({ url }));
    expect(navigator.receive('mx.b20.app://evil/callback?code=x')).toBe(false);
    mocks.appListener?.({ url: `${ANDROID_REDIRECT_URI}?code=abc&state=xyz` });
    await expect(response).resolves.toEqual({ url: `${ANDROID_REDIRECT_URI}?code=abc&state=xyz` });
    // El SDK que inició la navegación procesa PKCE; no se procesa una segunda vez aquí.
    expect(mgr.signinRedirectCallback).not.toHaveBeenCalled();
    cleanup();
  });

  it('recupera una devolución al arrancar de nuevo y no consume dos veces el mismo código', async () => {
    const mgr = manager();
    const url = `${ANDROID_REDIRECT_URI}?code=abc&state=xyz`;
    mocks.getLaunchUrl.mockResolvedValue({ url });
    const navigator = new AndroidAuthNavigator();
    (await attachAndroidCallbacks(mgr.value, navigator, vi.fn()))();
    (await attachAndroidCallbacks(mgr.value, navigator, vi.fn()))();
    expect(mgr.signinRedirectCallback).toHaveBeenCalledOnce();
    expect(mgr.signinRedirectCallback).toHaveBeenCalledWith(url);
  });

  it('un cierre de ventana no admitido por Android no convierte un acceso válido en error', async () => {
    const mgr = manager();
    const onError = vi.fn();
    mocks.close.mockRejectedValueOnce(new Error('not implemented'));
    mocks.getLaunchUrl.mockResolvedValue({ url: `${ANDROID_REDIRECT_URI}?code=abc&state=xyz` });
    (await attachAndroidCallbacks(mgr.value, new AndroidAuthNavigator(), onError))();
    expect(mgr.signinRedirectCallback).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('el cierre del navegador cancela la entrada sin fabricar una sesión', async () => {
    const navigator = new AndroidAuthNavigator();
    const cleanup = await attachAndroidCallbacks(manager().value, navigator, vi.fn());
    const response = (await navigator.prepare()).navigate({ url: `https://auth.spacetimedb.com/oidc/auth?redirect_uri=${encodeURIComponent(ANDROID_REDIRECT_URI)}` });
    const rejection = expect(response).rejects.toThrow('canceló');
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalled());
    mocks.closeListener?.();
    await rejection;
    cleanup();
  });

  it('no abre el navegador del sistema para una renovación que requiere interacción', async () => {
    await expect(androidSilentNavigator.prepare({})).rejects.toThrow('renovar');
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
