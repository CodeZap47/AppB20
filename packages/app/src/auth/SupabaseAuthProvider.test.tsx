// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';

const state = vi.hoisted(() => ({
  listener: undefined as ((event: string, session: Session | null) => void) | undefined,
  getSession: vi.fn(), signOut: vi.fn(), exchange: vi.fn(), remove: vi.fn(),
  otp: vi.fn(), verify: vi.fn(), updateUser: vi.fn(),
  start: vi.fn(), stop: vi.fn(), unsubscribe: vi.fn(),
}));
vi.mock('../config', () => ({ config: { supabaseUrl: 'https://example.supabase.co', supabasePasskeysEnabled: false, aiApiUrl: 'https://api.b20.invalid' } }));
vi.mock('./supabaseClient', () => ({
  createB20Supabase: () => ({ auth: {
    getSession: state.getSession, signOut: state.signOut,
    startAutoRefresh: state.start, stopAutoRefresh: state.stop,
    exchangeCodeForSession: state.exchange,
    signInWithOtp: state.otp, verifyOtp: state.verify, updateUser: state.updateUser,
    onAuthStateChange: (listener: typeof state.listener) => { state.listener = listener; return { data: { subscription: { unsubscribe: state.unsubscribe } } }; },
  } }),
  supabaseRedirect: () => `${window.location.origin}/auth/callback`,
  supabaseStorage: () => ({ removeItem: state.remove }),
}));
import { SupabaseAuthProvider, useSupabaseAuth } from './SupabaseAuthProvider';
import { useSession, useSessionStore } from './AuthContext';
import { capturePendingInvitation, clearPendingInvitation } from './pendingInvitation';

let root: Root;
let container: HTMLDivElement;
function session(subject = 'one', verified: boolean | undefined = true, passwordSet = true): Session {
  const payload = btoa(JSON.stringify({ sub: subject, email: 'student@b20.invalid', email_verified: verified, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return { access_token: `header.${payload}.signature`, user: { user_metadata: passwordSet ? { b20_password: true } : {} } } as unknown as Session;
}
let auth: ReturnType<typeof useSupabaseAuth> = null;
function Consumer() {
  const value = useSession();
  const store = useSessionStore();
  auth = useSupabaseAuth();
  return <><output>{value?.status === 'signedIn' ? value.profile.subject : value?.status}</output>
    <span data-pending>{auth?.pending ?? 'none'}</span><button onClick={() => store?.signOut()}>Salir</button></>;
}
const pendingStep = () => container.querySelector('[data-pending]')?.textContent;
async function render() {
  await act(async () => root.render(<SupabaseAuthProvider platform="web"><Consumer /></SupabaseAuthProvider>));
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); sessionStorage.clear();
  clearPendingInvitation();
  window.history.replaceState({}, '', '/');
  state.getSession.mockResolvedValue({ data: { session: null }, error: null });
  state.signOut.mockResolvedValue({ error: null });
  state.exchange.mockResolvedValue({ error: null });
  state.otp.mockResolvedValue({ error: null });
  state.verify.mockResolvedValue({ error: null });
  state.updateUser.mockResolvedValue({ error: null });
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
    expect(pendingStep()).toBe('password');
  });

  it('una sesión sin contraseña creada vuelve a pedirla; con ella entra directo', async () => {
    state.getSession.mockResolvedValue({ data: { session: session('one', true, false) }, error: null });
    await render(); expect(pendingStep()).toBe('password');
    await act(async () => root.unmount());
    root = createRoot(container);
    state.getSession.mockResolvedValue({ data: { session: session() }, error: null });
    await render(); expect(pendingStep()).toBe('none');
  });

  it('el código nunca crea cuentas y siempre lleva a crear la contraseña', async () => {
    await render();
    await act(async () => auth!.sendCode('a@b.mx'));
    expect(state.otp).toHaveBeenCalledWith({ email: 'a@b.mx', options: { shouldCreateUser: false } });
    await act(async () => auth!.verifyCode('a@b.mx', '123456'));
    expect(state.verify).toHaveBeenCalledWith({ email: 'a@b.mx', token: '123456', type: 'email' });
    expect(pendingStep()).toBe('password');
    await act(async () => auth!.updatePassword('una-clave-larga'));
    expect(state.updateUser).toHaveBeenCalledWith({ password: 'una-clave-larga', data: { b20_password: true } });
    expect(pendingStep()).toBe('none');
  });

  it('consulta el estado de la cuenta al Worker y muestra su error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ state: 'setup' }))
      .mockResolvedValueOnce(Response.json({ error: 'No pudimos comprobar tu cuenta.' }, { status: 503 }));
    await render();
    let result: string | undefined;
    await act(async () => { result = await auth!.lookup('a@b.mx'); });
    expect(result).toBe('setup');
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://api.b20.invalid/auth/account/state');
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ email: 'a@b.mx' });
    await expect(auth!.lookup('a@b.mx')).rejects.toThrow('No pudimos comprobar tu cuenta.');
    sessionStorage.setItem('b20.inviteLink', 'c'.repeat(43));
    fetchMock.mockResolvedValueOnce(Response.json({ state: 'setup' }));
    await auth!.lookup('a@b.mx');
    expect(JSON.parse(String(fetchMock.mock.calls[2]![1]!.body))).toEqual({ email: 'a@b.mx', invite: 'c'.repeat(43) });
    fetchMock.mockRestore();
  });

  it('consume el código PKCE y elimina los parámetros sensibles al volver a la ruta local', async () => {
    window.history.replaceState({}, '', '/auth/callback?code=once');
    sessionStorage.setItem('b20.supabase.returnTo', '/#/m/calendario');
    await render();
    expect(state.exchange).toHaveBeenCalledExactlyOnceWith('once');
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/#/m/calendario');
  });

  it('envía el enlace recuperable solo al servicio de activación y conserva el token fuera del retorno OAuth', async () => {
    const token = 'z'.repeat(43);
    window.history.replaceState({}, '', `/#/invitacion?token=${token}`);
    capturePendingInvitation();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ state: 'setup' }));
    await render();
    await act(async () => { await auth!.lookup('a@b.mx'); });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ email: 'a@b.mx', invitation: token });
    expect(window.location.href).not.toContain(token);
    expect(sessionStorage.getItem('b20.supabase.returnTo') ?? '').not.toContain(token);
    fetchMock.mockRestore();
  });
});
