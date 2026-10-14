/**
 * Sesión con Google (OIDC). Guarda el *ID token* que usan SpacetimeDB y el backend, y pide uno
 * nuevo antes de que venza (Google los emite por una hora). No depende de React ni del
 * navegador para poder probarse; `google.ts` conecta Google Identity Services.
 */

export interface SessionProfile {
  /** `sub` del token: identifica a la cuenta de Google. */
  subject: string;
  email: string;
  name: string;
  picture?: string;
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut'; error?: string }
  | { status: 'signedIn'; token: string; profile: SessionProfile; expiresAt: number };

interface IdTokenClaims {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  picture?: unknown;
  exp?: unknown;
}

/**
 * Lee los datos del token para mostrarlos. No valida la firma: eso lo hacen el módulo y el
 * backend, que son quienes confían en él.
 */
export function decodeIdToken(token: string): (SessionProfile & { expiresAt: number }) | null {
  const part = token.split('.')[1];
  if (!part) return null;
  let claims: IdTokenClaims;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    claims = JSON.parse(new TextDecoder().decode(bytes)) as IdTokenClaims;
  } catch {
    return null;
  }
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') return null;
  if (claims.email_verified !== true || typeof claims.exp !== 'number') return null;
  return {
    subject: claims.sub,
    email: claims.email.toLowerCase(),
    name: typeof claims.name === 'string' ? claims.name : claims.email,
    picture: typeof claims.picture === 'string' ? claims.picture : undefined,
    expiresAt: claims.exp * 1000,
  };
}

/** Se pide un token nuevo este tiempo antes de que venza el actual. */
export const RENEW_BEFORE_MS = 5 * 60_000;
const STORAGE_KEY = 'b20.idToken';

export interface SessionDeps {
  /** Pide a Google un token nuevo sin mostrar nada; si no puede, la sesión se cierra. */
  renewSilently: () => void;
  /** Avisa a Google que no vuelva a elegir la cuenta sola al salir. */
  disableAutoSelect: () => void;
  /** `sessionStorage`: el token sobrevive a recargar, no a cerrar la pestaña. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class SessionStore {
  #state: SessionState = { status: 'loading' };
  readonly #listeners = new Set<() => void>();
  readonly #deps: Required<SessionDeps>;
  #timer: unknown;

  constructor(deps: SessionDeps) {
    this.#deps = {
      storage: deps.storage ?? noStorage,
      now: deps.now ?? Date.now,
      setTimer: deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
      ...deps,
    } as Required<SessionDeps>;
  }

  getSnapshot = (): SessionState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Token vigente, o `undefined` si no hay sesión. */
  get token(): string | undefined {
    return this.#state.status === 'signedIn' ? this.#state.token : undefined;
  }

  /** Recupera el token de la pestaña si sigue vigente; si no, queda sin sesión. */
  restore(): void {
    const saved = safe(() => this.#deps.storage.getItem(STORAGE_KEY));
    if (saved && this.#accept(saved)) return;
    this.#set({ status: 'signedOut' });
  }

  /** Token recibido de Google (botón, elección automática o renovación). */
  receiveToken(token: string): void {
    if (!this.#accept(token)) {
      this.#set({
        status: 'signedOut',
        error: 'Google no entregó una cuenta con correo verificado.',
      });
    }
  }

  /** La renovación silenciosa no fue posible: hay que volver a entrar con el botón. */
  renewalFailed(): void {
    if (this.#state.status === 'signedIn' && this.#state.expiresAt > this.#deps.now()) return;
    this.#clear();
    this.#set({ status: 'signedOut', error: 'Tu sesión venció. Vuelve a entrar.' });
  }

  signOut(): void {
    this.#clear();
    this.#deps.disableAutoSelect();
    this.#set({ status: 'signedOut' });
  }

  #accept(token: string): boolean {
    const decoded = decodeIdToken(token);
    if (!decoded || decoded.expiresAt <= this.#deps.now()) return false;
    const { expiresAt, ...profile } = decoded;
    safe(() => this.#deps.storage.setItem(STORAGE_KEY, token));
    this.#schedule(expiresAt);
    this.#set({ status: 'signedIn', token, profile, expiresAt });
    return true;
  }

  #schedule(expiresAt: number) {
    if (this.#timer !== undefined) this.#deps.clearTimer(this.#timer);
    const renewIn = Math.max(0, expiresAt - RENEW_BEFORE_MS - this.#deps.now());
    this.#timer = this.#deps.setTimer(() => {
      this.#timer = this.#deps.setTimer(
        () => this.renewalFailed(),
        Math.max(0, expiresAt - this.#deps.now()),
      );
      this.#deps.renewSilently();
    }, renewIn);
  }

  #clear() {
    if (this.#timer !== undefined) this.#deps.clearTimer(this.#timer);
    this.#timer = undefined;
    safe(() => this.#deps.storage.removeItem(STORAGE_KEY));
  }

  #set(state: SessionState) {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}

const noStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

/** `sessionStorage` puede no existir o lanzar (modo privado, extensión sin permiso). */
function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
