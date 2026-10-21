import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeIdToken, SessionStore } from './session';

function token(extra: Record<string, unknown> = {}): string {
  const part = (v: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(v))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${part({ alg: 'RS256' })}.${part({ sub: 'user_123', email: 'Ana@Ejemplo.MX',
    email_verified: true, name: 'Ana Pérez', exp: 3600, ...extra })}.firma`;
}

afterEach(() => vi.useRealTimers());

describe('perfil de SpacetimeAuth', () => {
  it('lee la cuenta y el correo verificado sin confundirlo con una autorización del grupo', () => {
    expect(decodeIdToken(token())).toEqual({ subject: 'user_123', email: 'ana@ejemplo.mx',
      name: 'Ana Pérez', picture: undefined, expiresAt: 3_600_000 });
  });
  it('rechaza datos corruptos y cuentas sin correo verificado', () => {
    for (const value of ['no-es-token', 'a.%%%.c', token({ email_verified: false }), token({ email: '' }),
      token({ sub: '' }), token({ exp: '3600' })]) expect(decodeIdToken(value)).toBeNull();
  });
});

describe('estado de sesión OIDC', () => {
  function setup() {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const onSignOut = vi.fn(async () => {});
    const store = new SessionStore({ onSignOut });
    return { store, onSignOut };
  }

  it('solo recibe el ID token restaurado por el cliente OIDC, sin recuperar credenciales antiguas', () => {
    const { store } = setup();
    expect(store.getSnapshot()).toEqual({ status: 'loading' });
    store.signedOut();
    expect(store.token).toBeUndefined();
    store.receiveToken(token());
    expect(store.getSnapshot()).toMatchObject({ status: 'signedIn', profile: { email: 'ana@ejemplo.mx' } });
  });

  it('invalida una cuenta que no entregó correo verificado', () => {
    const { store } = setup();
    store.receiveToken(token());
    expect(store.receiveToken(token({ email_verified: false }))).toBe(false);
    expect(store.token).toBeUndefined();
    expect(store.getSnapshot()).toMatchObject({ status: 'signedOut', error: expect.stringContaining('correo verificado') });
  });

  it('no utiliza el token después de vencer aunque el proveedor no envíe ningún evento', () => {
    const { store } = setup();
    store.receiveToken(token());
    vi.advanceTimersByTime(3_600_000);
    expect(store.token).toBeUndefined();
    expect(store.getSnapshot()).toEqual({ status: 'signedOut', error: 'Tu sesión venció. Vuelve a entrar.' });
  });

  it('una renovación fallida respeta la vigencia actual y una renovación exitosa amplía la sesión', () => {
    const { store } = setup();
    store.receiveToken(token());
    store.renewalFailed();
    expect(store.token).toBe(token());
    vi.advanceTimersByTime(3_500_000);
    store.receiveToken(token({ exp: 7200 }));
    vi.advanceTimersByTime(100_000);
    expect(store.getSnapshot().status).toBe('signedIn');
    expect(store.token).toBe(token({ exp: 7200 }));
  });

  it('salir elimina inmediatamente la sesión local y solicita cerrar la sesión del proveedor', async () => {
    const { store, onSignOut } = setup();
    store.receiveToken(token());
    store.signOut();
    expect(store.token).toBeUndefined();
    expect(store.getSnapshot()).toEqual({ status: 'signedOut' });
    expect(onSignOut).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('si falla el cierre remoto conserva el cierre local y ofrece volver a intentarlo', async () => {
    const store = new SessionStore({ onSignOut: async () => { throw new Error('sin red'); }, now: () => 0 });
    store.receiveToken(token());
    store.signOut();
    await Promise.resolve();
    expect(store.token).toBeUndefined();
    expect(store.getSnapshot()).toMatchObject({ status: 'signedOut', error: expect.stringContaining('SpacetimeAuth') });
  });
});
