// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { RememberedUserStore, rememberSession, setRememberSession } from './persistence';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
describe('sesión recordada', () => {
  it('recupera una sesión recordada tras cerrar el almacenamiento de la pestaña', async () => {
    expect(rememberSession()).toBe(true);
    await new RememberedUserStore().set('account', 'oidc-envelope');
    sessionStorage.clear();
    expect(await new RememberedUserStore().get('account')).toBe('oidc-envelope');
  });
  it('respeta la elección de no conservar la sesión al cerrar la pestaña', async () => {
    setRememberSession(false);
    await new RememberedUserStore().set('account', 'temporary-envelope');
    expect(localStorage.getItem('b20.oidc.user.account')).toBeNull();
    sessionStorage.clear();
    expect(await new RememberedUserStore().get('account')).toBeNull();
  });
  it('al cambiar la preferencia elimina la copia anterior, sin resucitar otra cuenta', async () => {
    const store = new RememberedUserStore();
    await store.set('account', 'old-account');
    setRememberSession(false);
    await store.set('account', 'new-account');
    expect(localStorage.getItem('b20.oidc.user.account')).toBeNull();
    expect(await store.remove('account')).toBe('new-account');
    expect(await store.get('account')).toBeNull();
  });
  it('el cierre descarta ambas copias y conserva preferencias ajenas', async () => {
    localStorage.setItem('b20.oidc.user.account', 'persisted');
    sessionStorage.setItem('b20.oidc.user.account', 'legacy');
    localStorage.setItem('another-app', 'keep');
    const store = new RememberedUserStore();
    expect(await store.getAllKeys()).toEqual(['account']);
    await store.remove('account');
    expect(await store.getAllKeys()).toEqual([]);
    expect(localStorage.getItem('another-app')).toBe('keep');
  });
});
