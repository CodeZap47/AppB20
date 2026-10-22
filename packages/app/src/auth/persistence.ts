import type { StateStore } from 'oidc-client-ts';

const REMEMBER_KEY = 'b20.auth.remember';
export function rememberSession(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== 'false';
  } catch {
    return false;
  }
}
export function setRememberSession(value: boolean): void {
  try {
    localStorage.setItem(REMEMBER_KEY, String(value));
  } catch {
    /* Storage may be disabled. */
  }
}

/** Persist only OIDC's user envelope. The library still validates expiry and renews tokens. */
export class RememberedUserStore implements StateStore {
  constructor(private prefix = 'b20.oidc.user.') {}
  async set(key: string, value: string): Promise<void> {
    const name = this.prefix + key;
    const persistent = rememberSession();
    // A newly saved session must never leave a second, older account behind.
    localStorage.removeItem(name);
    sessionStorage.removeItem(name);
    (persistent ? localStorage : sessionStorage).setItem(name, value);
  }
  async get(key: string): Promise<string | null> {
    return localStorage.getItem(this.prefix + key) ?? sessionStorage.getItem(this.prefix + key);
  }
  async remove(key: string): Promise<string | null> {
    const value = await this.get(key);
    localStorage.removeItem(this.prefix + key);
    sessionStorage.removeItem(this.prefix + key);
    return value;
  }
  async getAllKeys(): Promise<string[]> {
    return [...new Set([...Object.keys(localStorage), ...Object.keys(sessionStorage)])]
      .filter((key) => key.startsWith(this.prefix))
      .map((key) => key.slice(this.prefix.length));
  }
}
