import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { config } from '../config';
import type { Platform } from '../platform';
import { AuthContext } from './accessContext';
import { AuthFrame } from './AuthFrame';
import { SessionStore } from './session';
import { createB20Supabase, supabaseRedirect, supabaseStorage } from './supabaseClient';
import { getChromeAuth } from './platformAuth';
import { matchesCallback, signinReturnTo } from './callbacks';

/** `password`: activada y sin contraseña. `inactive`: sin invitación pendiente en B20. */
export type AccountState = 'password' | 'setup' | 'inactive';
/** Pasos obligatorios u ofrecidos después de entrar con el código del correo. */
export type PendingStep = 'password' | 'passkey' | null;
interface SupabaseActions {
  busy: boolean;
  pending: PendingStep;
  passkeysAvailable: boolean;
  lookup(email: string): Promise<AccountState>;
  signIn(email: string, password: string): Promise<void>;
  sendCode(email: string): Promise<void>;
  /** Tras el código siempre se crea una contraseña: primer acceso u olvido. */
  verifyCode(email: string, token: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  skipPasskey(): void;
  oauth(provider: 'google' | 'github'): Promise<void>;
  passkey(register?: boolean): Promise<void>;
}
const SupabaseContext = createContext<SupabaseActions | null>(null);
export const useSupabaseAuth = () => useContext(SupabaseContext);
const RETURN_KEY = 'b20.supabase.returnTo';
/** Marca que la persona ya creó su contraseña en B20; solo decide qué pantalla mostrar. */
const PASSWORD_FLAG = 'b20_password';
const hasPassword = (session: Session) => session.user?.user_metadata?.[PASSWORD_FLAG] === true;

export function SupabaseAuthProvider({ platform, children }: { platform: Platform; children: ReactNode }) {
  const setup = useMemo(() => {
    try { return { client: createB20Supabase(platform) }; }
    catch { return { error: 'Falta configurar la URL y la clave pública del proyecto Supabase de B20.' }; }
  }, [platform]);
  if (!setup.client) return <AuthFrame title="El acceso aún no está listo" description="Estamos preparando el acceso de tu grupo.">
    <p role="alert" className="auth-feedback auth-feedback--error">{setup.error}</p>
  </AuthFrame>;
  return <SupabaseBridge client={setup.client} platform={platform}>{children}</SupabaseBridge>;
}

function SupabaseBridge({ client, platform, children }: {
  client: ReturnType<typeof createB20Supabase>; platform: Platform; children: ReactNode;
}) {
  const [pending, setPending] = useState(0);
  const [pendingStep, setPendingStep] = useState<PendingStep>(null);
  const revision = useRef(0);
  const signedOut = useRef(false);
  const store = useMemo(() => new SessionStore({ onSignOut: async () => {
    signedOut.current = true;
    revision.current++;
    client.auth.stopAutoRefresh();
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
    } finally {
      const storage = supabaseStorage(platform);
      const key = `b20.supabase.${new URL(config.supabaseUrl).hostname}`;
      await storage.removeItem(key);
      await storage.removeItem(`${key}-code-verifier`);
      store.signedOut();
      setPendingStep(null);
    }
  } }), [client, platform]);

  useEffect(() => {
    let active = true;
    const receive = (session: Session | null) => {
      if (!active || signedOut.current) return;
      if (session) {
        // Quien entró con el código y aún no crea su contraseña vuelve a esa pantalla.
        if (!hasPassword(session)) setPendingStep('password');
        store.receiveToken(session.access_token);
      } else store.signedOut();
    };
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      revision.current++;
      if (event === 'PASSWORD_RECOVERY') setPendingStep('password');
      if (event === 'SIGNED_OUT') { store.signedOut(); setPendingStep(null); return; }
      receive(session);
    });
    const start = revision.current;
    void client.auth.getSession().then(({ data, error }) => {
      if (!active || start !== revision.current || signedOut.current) return;
      if (error) store.signedOut('No se pudo recuperar tu sesión. Vuelve a entrar.');
      else receive(data.session);
    }).catch(() => {
      if (active && start === revision.current && !signedOut.current) store.signedOut('No se pudo recuperar tu sesión. Vuelve a entrar.');
    });
    client.auth.startAutoRefresh();
    return () => { active = false; subscription.unsubscribe(); client.auth.stopAutoRefresh(); store.dispose(); };
  }, [client, store]);

  const callback = async (value: string) => {
    if (!matchesCallback(value, supabaseRedirect(platform))) return;
    const url = new URL(value);
    const code = url.searchParams.get('code');
    try {
      if (url.searchParams.has('error')) throw new Error('El enlace de acceso no es válido o ya venció.');
      if (code) {
        const { error } = await client.auth.exchangeCodeForSession(code);
        if (error) throw new Error('El enlace venció o se abrió en otro navegador. Solicita uno nuevo.');
      }
    } finally {
      if (platform === 'web') {
        const returnTo = signinReturnTo({ returnTo: sessionStorage.getItem(RETURN_KEY) }, window.location.origin);
        sessionStorage.removeItem(RETURN_KEY);
        window.history.replaceState({}, '', returnTo);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    }
  };
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const seenCallbacks = useRef(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    const receive = async (url: string) => {
      if (cancelled || seenCallbacks.current.has(url)) return;
      seenCallbacks.current.add(url);
      try { await callbackRef.current(url); }
      catch (error) { store.signedOut(error instanceof Error ? error.message : 'No se pudo completar el acceso.'); }
    };
    if (platform === 'web') void receive(window.location.href);
    if (platform === 'android') {
      void Promise.all([import('@capacitor/app'), import('@capacitor/browser')]).then(async ([{ App }, { Browser }]) => {
        const listener = await App.addListener('appUrlOpen', ({ url }) => {
          if (matchesCallback(url, supabaseRedirect(platform))) {
            void receive(url).finally(() => Browser.close().catch(() => {}));
          }
        });
        cleanup = () => { void listener.remove(); };
        if (cancelled) { cleanup(); return; }
        const launch = await App.getLaunchUrl();
        if (launch?.url) await receive(launch.url);
      }).catch(() => store.signedOut('No se pudo preparar el retorno de acceso.'));
    }
    return () => { cancelled = true; cleanup?.(); };
  }, [platform, client, store]);

  const run = async <T,>(action: () => Promise<T>): Promise<T> => {
    setPending((n) => n + 1);
    signedOut.current = false;
    client.auth.startAutoRefresh();
    try { return await action(); } finally { setPending((n) => n - 1); }
  };
  const saveReturn = () => sessionStorage.setItem(RETURN_KEY, signinReturnTo({ returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}` }, window.location.origin));
  const passkeysAvailable = config.supabasePasskeysEnabled && platform === 'web' && window.isSecureContext && !!navigator.credentials;
  const actions: SupabaseActions = {
    busy: pending > 0, pending: pendingStep, passkeysAvailable,
    lookup: (email) => run(async () => {
      if (!config.aiApiUrl) throw new Error('El acceso todavía no está configurado.');
      const response = await fetch(new URL('/auth/account/state', config.aiApiUrl), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      }).catch(() => null);
      const body = await response?.json().catch(() => null) as { state?: AccountState; error?: string } | null;
      if (!response?.ok || !body?.state) throw new Error(body?.error ?? 'No pudimos comprobar tu cuenta. Inténtalo de nuevo.');
      return body.state;
    }),
    signIn: (email, password) => run(async () => {
      saveReturn();
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error('No pudimos entrar. Comprueba tu contraseña.');
    }),
    sendCode: (email) => run(async () => {
      // Solo cuentas ya activadas: el acceso nunca crea cuentas nuevas en Supabase.
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (error) throw new Error('No se pudo enviar el código. Espera un minuto e inténtalo de nuevo.');
    }),
    verifyCode: (email, token) => run(async () => {
      const { error } = await client.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw new Error('El código no es válido o ya venció. Solicita uno nuevo.');
      setPendingStep('password');
    }),
    updatePassword: (password) => run(async () => {
      const { error } = await client.auth.updateUser({ password, data: { [PASSWORD_FLAG]: true } });
      if (error) throw new Error('No se pudo guardar la contraseña. Usa al menos ocho caracteres e inténtalo de nuevo.');
      setPendingStep(passkeysAvailable ? 'passkey' : null);
    }),
    skipPasskey: () => setPendingStep(null),
    oauth: (provider) => run(async () => {
      if (!config.supabaseOAuthProviders.includes(provider)) throw new Error('Este proveedor aún no está habilitado.');
      saveReturn();
      const { data, error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo: supabaseRedirect(platform), skipBrowserRedirect: true } });
      if (error || !data.url) throw new Error('No se pudo abrir el acceso.');
      if (platform.startsWith('extension')) {
        const response = await getChromeAuth()!.identity.launchWebAuthFlow({ url: data.url, interactive: true });
        if (!response || !matchesCallback(response, supabaseRedirect(platform))) throw new Error('El acceso se canceló.');
        await callback(response);
      } else if (platform === 'android') {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url: data.url });
      } else window.location.assign(data.url);
    }),
    passkey: (register = false) => run(async () => {
      if (!config.supabasePasskeysEnabled || platform !== 'web') throw new Error('Usa la web de B20 para administrar tus passkeys.');
      const { error } = register ? await client.auth.registerPasskey() : await client.auth.signInWithPasskey();
      if (error) throw new Error('No se pudo usar la passkey. Comprueba el dispositivo o usa otro método de acceso.');
      if (register) setPendingStep((step) => step === 'passkey' ? null : step);
    }),
  };
  return <AuthContext value={{ store, busy: pending > 0 }}>
    <SupabaseContext value={actions}>{children}</SupabaseContext>
  </AuthContext>;
}
