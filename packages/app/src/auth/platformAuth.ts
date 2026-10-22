import type { INavigator, NavigateParams, StateStore, UserManager } from 'oidc-client-ts';
import { matchesCallback } from './oidc';
import { rememberSession } from './persistence';

interface ChromeStorageArea {
  get(keys: string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, string>): Promise<void>;
  remove(keys: string): Promise<void>;
}
interface ChromeAuth {
  identity: {
    getRedirectURL(path: string): string;
    launchWebAuthFlow(options: { url: string; interactive: boolean; abortOnLoadForNonInteractive?: boolean;
      timeoutMsForNonInteractive?: number }): Promise<string | undefined>;
  };
  storage: { session: ChromeStorageArea; local?: ChromeStorageArea };
}

export function getChromeAuth(): ChromeAuth | undefined {
  const api = (globalThis as typeof globalThis & { chrome?: ChromeAuth }).chrome;
  return typeof api?.identity?.launchWebAuthFlow === 'function' && api.storage?.session ? api : undefined;
}

/** Chrome guarda la sesión solo en memoria del navegador y la comparte entre panel y pestaña. */
export class ChromeSessionStateStore implements StateStore {
  constructor(private readonly area: ChromeStorageArea, private readonly prefix: string) {}
  async set(key: string, value: string): Promise<void> { await this.area.set({ [this.prefix + key]: value }); }
  async get(key: string): Promise<string | null> {
    const value = (await this.area.get(this.prefix + key))[this.prefix + key];
    return typeof value === 'string' ? value : null;
  }
  async remove(key: string): Promise<string | null> {
    const value = await this.get(key);
    await this.area.remove(this.prefix + key);
    return value;
  }
  async getAllKeys(): Promise<string[]> {
    return Object.keys(await this.area.get(null)).filter((k) => k.startsWith(this.prefix)).map((k) => k.slice(this.prefix.length));
  }
}

export class ChromeRememberedUserStore implements StateStore {
  constructor(private session: ChromeStorageArea, private persistent?: ChromeStorageArea, private prefix = 'b20.oidc.user.') {}
  async get(key: string): Promise<string | null> {
    const local = this.persistent && await new ChromeSessionStateStore(this.persistent, this.prefix).get(key);
    return local ?? new ChromeSessionStateStore(this.session, this.prefix).get(key);
  }
  async set(key: string, value: string): Promise<void> {
    await this.remove(key);
    const area = rememberSession() && this.persistent ? this.persistent : this.session;
    await new ChromeSessionStateStore(area, this.prefix).set(key, value);
  }
  async remove(key: string): Promise<string | null> {
    const previous = await this.get(key);
    await new ChromeSessionStateStore(this.session, this.prefix).remove(key);
    if (this.persistent) await new ChromeSessionStateStore(this.persistent, this.prefix).remove(key);
    return previous;
  }
  async getAllKeys(): Promise<string[]> {
    return [...new Set([...await new ChromeSessionStateStore(this.session, this.prefix).getAllKeys(),
      ...this.persistent ? await new ChromeSessionStateStore(this.persistent, this.prefix).getAllKeys() : []])];
  }
}

/** El SDK conserva la comprobación de state, nonce y PKCE; este adaptador solo abre el navegador. */
export function createChromeNavigator(api: ChromeAuth, interactive: boolean): INavigator {
  return {
    async prepare() {
      return {
        async navigate(params: NavigateParams) {
          const response = await api.identity.launchWebAuthFlow({
            url: params.url,
            interactive,
            ...(!interactive ? { abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: 15_000 } : {}),
          });
          const request = new URL(params.url);
          const expected = request.searchParams.get('redirect_uri') || request.searchParams.get('post_logout_redirect_uri');
          if (!response || !expected || !matchesCallback(response, expected)) throw new Error('La entrada se canceló o su retorno no es válido.');
          return { url: response };
        },
        close() {},
      };
    },
    async callback() {},
  };
}

interface PendingAndroid {
  expected: string;
  resolve: (value: { url: string }) => void;
  reject: (reason: Error) => void;
  cleanup: () => void;
}

export class AndroidAuthNavigator implements INavigator {
  #pending: PendingAndroid | undefined;

  async prepare() {
    return {
      navigate: async (params: NavigateParams): Promise<{ url: string }> => {
        if (this.#pending) throw new Error('Ya hay una entrada en curso.');
        const { Browser } = await import('@capacitor/browser');
        const request = new URL(params.url);
        const expected = request.searchParams.get('redirect_uri') || request.searchParams.get('post_logout_redirect_uri');
        if (!expected) throw new Error('No se configuró la dirección de retorno de Android.');
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => this.cancel(), 10 * 60_000);
          this.#pending = { expected, resolve, reject, cleanup: () => clearTimeout(timeout) };
          void Browser.open({ url: params.url }).catch(() => this.cancel());
        });
      },
      close: () => this.cancel(),
    };
  }

  async callback(url: string): Promise<void> { this.receive(url); }

  receive(url: string): boolean {
    const pending = this.#pending;
    if (!pending || !matchesCallback(url, pending.expected)) return false;
    this.#pending = undefined;
    pending.cleanup();
    pending.resolve({ url });
    return true;
  }

  cancel(): void {
    const pending = this.#pending;
    this.#pending = undefined;
    pending?.cleanup();
    pending?.reject(new Error('La entrada se canceló. Vuelve a intentarlo.'));
  }
}

/** Android no intenta abrir un navegador sin interacción; usa refresh token si el proveedor lo emite. */
export const androidSilentNavigator: INavigator = {
  async prepare() { throw new Error('Vuelve a entrar para renovar tu sesión.'); },
  async callback() {},
};

const androidCallbacks = new WeakMap<UserManager, Set<string>>();

/** También recupera la devolución si Android cerró el proceso mientras estaba abierto el navegador. */
export async function attachAndroidCallbacks(
  manager: UserManager,
  navigator: AndroidAuthNavigator,
  onError: () => void,
): Promise<() => void> {
  const { App } = await import('@capacitor/app');
  const { Browser } = await import('@capacitor/browser');
  const seen = androidCallbacks.get(manager) ?? new Set<string>();
  androidCallbacks.set(manager, seen);
  const receive = async (url: string) => {
    const login = matchesCallback(url, manager.settings.redirect_uri);
    const logout = !!manager.settings.post_logout_redirect_uri && matchesCallback(url, manager.settings.post_logout_redirect_uri);
    if ((!login && !logout) || seen.has(url)) return;
    seen.add(url);
    if (seen.size > 32) seen.delete(seen.values().next().value!);
    try {
      if (!navigator.receive(url)) {
        if (login) await manager.signinRedirectCallback(url);
        else await manager.signoutRedirectCallback(url);
      }
      // Browser.close no está disponible en todas las versiones Android; el deep link ya devolvió la app al frente.
      await Browser.close().catch(() => {});
    } catch { onError(); }
  };
  const urlListener = await App.addListener('appUrlOpen', ({ url }) => { void receive(url); });
  const closeListener = await Browser.addListener('browserFinished', () => navigator.cancel());
  const launch = await App.getLaunchUrl();
  if (launch?.url) await receive(launch.url);
  return () => {
    navigator.cancel();
    void urlListener.remove();
    void closeListener.remove();
  };
}
