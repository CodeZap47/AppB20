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
