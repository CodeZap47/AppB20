import { describe, expect, it, vi } from 'vitest';
import { decodeIdToken, RENEW_BEFORE_MS, SessionStore } from './session';

const HOUR = 3_600_000;

function token(claims: Record<string, unknown>): string {
  const part = (v: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(v))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${part({ alg: 'RS256' })}.${part(claims)}.firma`;
}

function googleToken(expSeconds: number, extra: Record<string, unknown> = {}) {
  return token({
    sub: '123',
    email: 'Ana@Ejemplo.MX',
    email_verified: true,
    name: 'Ana Pérez',
    exp: expSeconds,
    ...extra,
  });
}

function setup(now = 0) {
  let clock = now;
  const timers: { fn: () => void; at: number; handle: number }[] = [];
  let next = 1;
  const storage = new Map<string, string>();
  const renewSilently = vi.fn();
  const disableAutoSelect = vi.fn();
  const store = new SessionStore({
    renewSilently,
    disableAutoSelect,
    storage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => void storage.set(k, v),
      removeItem: (k) => void storage.delete(k),
    },
    now: () => clock,
    setTimer: (fn, ms) => {
      const handle = next++;
      timers.push({ fn, at: clock + ms, handle });
      return handle;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.handle === h);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const advance = (ms: number) => {
    clock += ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= clock).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      due.fn();
    }
  };
  return { store, storage, renewSilently, disableAutoSelect, advance, timers };
}

describe('decodeIdToken', () => {
  it('lee correo, nombre y vencimiento', () => {
    expect(decodeIdToken(googleToken(3600))).toEqual({
      subject: '123',
      email: 'ana@ejemplo.mx',
      name: 'Ana Pérez',
      picture: undefined,
      expiresAt: HOUR,
    });
  });

  it('rechaza correos sin verificar y tokens mal formados', () => {
    expect(decodeIdToken(googleToken(3600, { email_verified: false }))).toBeNull();
    expect(decodeIdToken('no-es-un-token')).toBeNull();
    expect(decodeIdToken('a.%%%.c')).toBeNull();
  });
});

describe('SessionStore', () => {
  it('sin token guardado queda sin sesión', () => {
    const { store } = setup();
    expect(store.getSnapshot().status).toBe('loading');
    store.restore();
    expect(store.getSnapshot()).toEqual({ status: 'signedOut' });
  });

  it('entra con el token de Google y lo recupera al recargar', () => {
    const first = setup();
    first.store.restore();
    first.store.receiveToken(googleToken(3600));
    expect(first.store.token).toBe(googleToken(3600));
    expect(first.store.getSnapshot()).toMatchObject({
      status: 'signedIn',
      profile: { email: 'ana@ejemplo.mx' },
    });

    const reloaded = setup();
    for (const [k, v] of first.storage) reloaded.storage.set(k, v);
    reloaded.store.restore();
    expect(reloaded.store.getSnapshot().status).toBe('signedIn');
  });

  it('no recupera un token vencido', () => {
    const { store, storage } = setup(2 * HOUR);
    storage.set('b20.idToken', googleToken(3600));
    store.restore();
    expect(store.getSnapshot().status).toBe('signedOut');
  });

  it('pide un token nuevo antes de que venza y sigue con él', () => {
    const { store, renewSilently, advance } = setup();
    store.receiveToken(googleToken(3600));
    advance(HOUR - RENEW_BEFORE_MS - 1);
    expect(renewSilently).not.toHaveBeenCalled();
    advance(1);
    expect(renewSilently).toHaveBeenCalledTimes(1);
    store.receiveToken(googleToken(2 * 3600));
    advance(RENEW_BEFORE_MS + 1);
    expect(store.getSnapshot().status).toBe('signedIn');
    expect(store.token).toBe(googleToken(2 * 3600));
  });

  it('si la renovación no llega, cierra la sesión al vencer', () => {
    const { store, storage, advance } = setup();
    store.receiveToken(googleToken(3600));
    advance(HOUR);
    expect(store.getSnapshot()).toEqual({
      status: 'signedOut',
      error: 'Tu sesión venció. Vuelve a entrar.',
    });
    expect(storage.size).toBe(0);
  });

  it('un aviso de renovación fallida no saca a quien aún tiene token vigente', () => {
    const { store } = setup();
    store.receiveToken(googleToken(3600));
    store.renewalFailed();
    expect(store.getSnapshot().status).toBe('signedIn');
  });

  it('salir borra el token y desactiva la elección automática', () => {
    const { store, storage, disableAutoSelect, timers } = setup();
    store.receiveToken(googleToken(3600));
    store.signOut();
    expect(store.getSnapshot()).toEqual({ status: 'signedOut' });
    expect(storage.size).toBe(0);
    expect(timers).toHaveLength(0);
    expect(disableAutoSelect).toHaveBeenCalled();
  });

  it('avisa a quien escucha en cada cambio', () => {
    const { store } = setup();
    const listener = vi.fn();
    store.subscribe(listener);
    store.restore();
    store.receiveToken(googleToken(3600));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
