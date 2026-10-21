import { describe, expect, it, vi } from 'vitest';
import { ChromeSessionStateStore, createChromeNavigator } from './platformAuth';

function chromeApi(response = 'https://abc.chromiumapp.org/auth/callback?code=code&state=state') {
  const storage: Record<string, string> = {};
  return {
    identity: { getRedirectURL: (path: string) => `https://abc.chromiumapp.org/${path}`,
      launchWebAuthFlow: vi.fn(async () => response) },
    storage: { session: {
      get: vi.fn(async (key: string | null): Promise<Record<string, unknown>> => key ? { [key]: storage[key] } : { ...storage }),
      set: vi.fn(async (values: Record<string, string>) => { Object.assign(storage, values); }),
      remove: vi.fn(async (key: string) => { delete storage[key]; }),
    } },
  };
}

describe('navegador OIDC de extensión', () => {
  const request = 'https://auth.spacetimedb.com/oidc/auth?redirect_uri=https%3A%2F%2Fabc.chromiumapp.org%2Fauth%2Fcallback&code_challenge=pkce&state=state';
  it('usa Chrome identity y devuelve el código al cliente OIDC, sin crear una sesión por su cuenta', async () => {
    const api = chromeApi();
    const handle = await createChromeNavigator(api, true).prepare({});
    const result = await handle.navigate({ url: request });
    expect(api.identity.launchWebAuthFlow).toHaveBeenCalledWith({ url: request, interactive: true });
    expect(result.url).toContain('code=code&state=state');
  });
  it('la renovación nunca abre una pantalla interactiva', async () => {
    const api = chromeApi();
    await (await createChromeNavigator(api, false).prepare({})).navigate({ url: request });
    expect(api.identity.launchWebAuthFlow).toHaveBeenCalledWith(expect.objectContaining({ interactive: false, timeoutMsForNonInteractive: 15_000 }));
  });
  it('rechaza una respuesta que llega a otra ruta u origen', async () => {
    const handle = await createChromeNavigator(chromeApi('https://evil.example/auth/callback?code=x'), true).prepare({});
    await expect(handle.navigate({ url: request })).rejects.toThrow('retorno');
  });
});

describe('credenciales de la extensión', () => {
  it('comparte el almacenamiento de sesión de Chrome y elimina sus propias claves al salir', async () => {
    const api = chromeApi();
    const store = new ChromeSessionStateStore(api.storage.session, 'b20.oidc.');
    await api.storage.session.set({ unrelated: 'keep' });
    await store.set('user', 'token');
    expect(await new ChromeSessionStateStore(api.storage.session, 'b20.oidc.').get('user')).toBe('token');
    expect(await store.getAllKeys()).toEqual(['user']);
    expect(await store.remove('user')).toBe('token');
    expect(await store.get('user')).toBeNull();
    expect(await api.storage.session.get('unrelated')).toEqual({ unrelated: 'keep' });
  });
});
