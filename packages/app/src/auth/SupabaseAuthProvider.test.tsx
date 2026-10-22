// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';

const state = vi.hoisted(() => ({
  listener: undefined as ((event: string, session: Session | null) => void) | undefined,
  getSession: vi.fn(), signOut: vi.fn(), exchange: vi.fn(), remove: vi.fn(),
  start: vi.fn(), stop: vi.fn(), unsubscribe: vi.fn(),
}));
vi.mock('../config', () => ({ config: { supabaseUrl: 'https://example.supabase.co', supabasePasskeysEnabled: false } }));
vi.mock('./supabaseClient', () => ({
  createB20Supabase: () => ({ auth: {
    getSession: state.getSession, signOut: state.signOut,
    startAutoRefresh: state.start, stopAutoRefresh: state.stop,
    exchangeCodeForSession: state.exchange,
    onAuthStateChange: (listener: typeof state.listener) => { state.listener = listener; return { data: { subscription: { unsubscribe: state.unsubscribe } } }; },
  } }),
  supabaseRedirect: () => `${window.location.origin}/auth/callback`,
  supabaseStorage: () => ({ removeItem: state.remove }),
}));
import { SupabaseAuthProvider, useSupabaseAuth } from './SupabaseAuthProvider';
import { useSession, useSessionStore } from './AuthContext';

let root: Root;
let container: HTMLDivElement;
function session(subject = 'one', verified: boolean | undefined = true): Session {
  const payload = btoa(JSON.stringify({ sub: subject, email: 'student@b20.invalid', email_verified: verified, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return { access_token: `header.${payload}.signature` } as Session;
}
function Consumer() {
  const value = useSession();
  const store = useSessionStore();
  const auth = useSupabaseAuth();
  return <><output>{value?.status === 'signedIn' ? value.profile.subject : value?.status}</output>
    <span>{auth?.recovery ? 'recovering' : 'normal'}</span><button onClick={() => store?.signOut()}>Salir</button></>;
}
async function render() {
  await act(async () => root.render(<SupabaseAuthProvider platform="web"><Consumer /></SupabaseAuthProvider>));
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  state.getSession.mockResolvedValue({ data: { session: null }, error: null });
  state.signOut.mockResolvedValue({ error: null });
  state.exchange.mockResolvedValue({ error: null });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('sesiones de Supabase', () => {
  it('restaura y renueva la sesión del SDK; una salida remota elimina el acceso', async () => {
    state.getSession.mockResolvedValue({ data: { session: session() }, error: null });
    await render(); expect(container.querySelector('output')?.textContent).toBe('one');
    await act(async () => state.listener?.('TOKEN_REFRESHED', session('two')));
    expect(container.querySelector('output')?.textContent).toBe('two');
    await act(async () => state.listener?.('SIGNED_OUT', null));
    expect(container.querySelector('output')?.textContent).toBe('signedOut');
  });

  it('una restauración tardía no pisa un evento de autenticación más reciente', async () => {
    let restore!: (value: unknown) => void;
    state.getSession.mockReturnValue(new Promise((resolve) => { restore = resolve; }));
    await render();
    await act(async () => state.listener?.('SIGNED_IN', session('new')));
    await act(async () => restore({ data: { session: session('stale') }, error: null }));
    expect(container.querySelector('output')?.textContent).toBe('new');
  });

  it('al salir borra credenciales locales y no restaura una renovación ya iniciada', async () => {
    state.getSession.mockResolvedValue({ data: { session: session() }, error: null });
    await render();
    await act(async () => container.querySelector('button')!.click());
    await act(async () => state.listener?.('TOKEN_REFRESHED', session('late')));
    expect(container.querySelector('output')?.textContent).toBe('signedOut');
    expect(state.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(state.remove).toHaveBeenCalledWith('b20.supabase.example.supabase.co');
  });

  it('requiere el correo verificado del hook y muestra recuperación de contraseña', async () => {
    state.getSession.mockResolvedValue({ data: { session: session('unverified', false) }, error: null });
    await render(); expect(container.querySelector('output')?.textContent).toBe('signedOut');
    await act(async () => state.listener?.('PASSWORD_RECOVERY', session()));
    expect(container.textContent).toContain('recovering');
  });

  it('consume el código PKCE y elimina los parámetros sensibles al volver a la ruta local', async () => {
    window.history.replaceState({}, '', '/auth/callback?code=once');
    sessionStorage.setItem('b20.supabase.returnTo', '/#/m/calendario');
    await render();
    expect(state.exchange).toHaveBeenCalledExactlyOnceWith('once');
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/#/m/calendario');
  });
});
