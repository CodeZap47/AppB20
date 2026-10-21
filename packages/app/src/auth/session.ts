/** Estado de presentación de la sesión OIDC. La biblioteca OIDC administra las credenciales. */
export interface SessionProfile {
  /** `sub` estable de SpacetimeAuth. */
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
  preferred_username?: unknown;
  picture?: unknown;
  exp?: unknown;
}

/** Solo lee datos para mostrarlos. La verificación de seguridad corresponde al servidor. */
export function decodeIdToken(token: string): (SessionProfile & { expiresAt: number }) | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const part = parts[1];
  if (!part) return null;
  let claims: IdTokenClaims;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    claims = JSON.parse(new TextDecoder().decode(bytes)) as IdTokenClaims;
  } catch { return null; }
  if (!claims || typeof claims.sub !== 'string' || !claims.sub ||
      typeof claims.email !== 'string' || !claims.email.trim() || claims.email_verified !== true ||
      typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return null;
  return {
    subject: claims.sub,
    email: claims.email.trim().toLowerCase(),
    name: typeof claims.name === 'string' ? claims.name :
      typeof claims.preferred_username === 'string' ? claims.preferred_username : claims.email,
    picture: typeof claims.picture === 'string' ? claims.picture : undefined,
    expiresAt: claims.exp * 1000,
  };
}

export interface SessionDeps {
  onSignOut: () => Promise<void>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Adaptador para los consumidores existentes; jamás recupera tokens GIS ni los guarda aparte. */
export class SessionStore {
  #state: SessionState = { status: 'loading' };
  readonly #listeners = new Set<() => void>();
  readonly #deps: Required<SessionDeps>;
  #timer: unknown;

  constructor(deps: SessionDeps) {
    this.#deps = {
      now: Date.now,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...deps,
    };
  }

  getSnapshot = (): SessionState => this.#state;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  get token(): string | undefined {
    return this.#state.status === 'signedIn' ? this.#state.token : undefined;
  }

  loading(): void { this.#set({ status: 'loading' }); }

  receiveToken(token: string): boolean {
    const decoded = decodeIdToken(token);
    if (!decoded || decoded.expiresAt <= this.#deps.now()) {
      this.signedOut('SpacetimeAuth no entregó una sesión vigente con correo verificado.');
      return false;
    }
    if (this.#state.status === 'signedIn' && this.#state.token === token && this.#timer !== undefined) return true;
    const { expiresAt, ...profile } = decoded;
    this.#clearTimer();
    this.#timer = this.#deps.setTimer(() => this.renewalFailed(), Math.max(0, expiresAt - this.#deps.now()));
    this.#set({ status: 'signedIn', token, profile, expiresAt });
    return true;
  }

  signedOut(error?: string): void {
    this.#clearTimer();
    this.#set(error ? { status: 'signedOut', error } : { status: 'signedOut' });
  }

  renewalFailed(): void {
    if (this.#state.status === 'signedIn' && this.#state.expiresAt > this.#deps.now()) return;
    this.signedOut('Tu sesión venció. Vuelve a entrar.');
  }

  signOut(): void {
    this.signedOut();
    void this.#deps.onSignOut().catch(() => {
      this.signedOut('Saliste de B20, pero no se pudo cerrar la sesión de SpacetimeAuth. Vuelve a intentarlo.');
    });
  }

  dispose(): void { this.#clearTimer(); }

  #clearTimer(): void {
    if (this.#timer !== undefined) this.#deps.clearTimer(this.#timer);
    this.#timer = undefined;
  }
  #set(state: SessionState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}
