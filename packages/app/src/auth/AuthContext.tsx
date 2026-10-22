import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { AuthProvider as OidcProvider, useAuth as useOidc } from 'react-oidc-context';
import { config } from '../config';
import type { Platform } from '../platform';
import { buildOidcSettings, matchesCallback, signinReturnTo } from './oidc';
import { AndroidAuthNavigator, androidSilentNavigator, attachAndroidCallbacks, ChromeSessionStateStore, ChromeRememberedUserStore,
  createChromeNavigator, getChromeAuth } from './platformAuth';
import { SessionStore, type SessionState } from './session';
import { AuthFrame } from './AuthFrame';
import { RememberedUserStore } from './persistence';
import { AuthContext, type SignInOptions } from './accessContext';
import { SupabaseAuthProvider } from './SupabaseAuthProvider';

export function AuthProvider(props: { clientId: string; platform?: Platform; children: ReactNode }) {
  return config.devAuthBypass ? <DevAuthProvider>{props.children}</DevAuthProvider> : <OidcAuthProvider {...props} />;
}

/** Solo `vite dev` con datos simulados: sesión local sin SpacetimeAuth. Nunca llega a un build. */
function DevAuthProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => new SessionStore({ onSignOut: async () => {} }), []);
  const signIn = () => { store.receiveToken(devIdToken()); };
  useEffect(() => {
    signIn();
    return () => store.dispose();
  }, [store]);
  return <AuthContext value={{ store, signIn, busy: false }}>{children}</AuthContext>;
}

function devIdToken(): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_');
  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({ sub: 'dev-local', email: 'dev@localhost', email_verified: true, name: 'Desarrollo local',
      exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600 }),
    'dev',
  ].join('.');
}

/** OIDC Authorization Code + PKCE. Cada presentación usa el navegador apropiado a su plataforma. */
function OidcAuthProvider({ clientId, platform = 'web', children }: {
  clientId: string; platform?: Platform; children: ReactNode;
}) {
  if (config.authProvider === 'supabase') return <SupabaseAuthProvider platform={platform}>{children}</SupabaseAuthProvider>;
  return <SpacetimeAuthProvider clientId={clientId} platform={platform}>{children}</SpacetimeAuthProvider>;
}

function SpacetimeAuthProvider({ clientId, platform, children }: {
  clientId: string; platform: Platform; children: ReactNode;
}) {
  const setup = useMemo(() => {
    try {
      const chrome = platform.startsWith('extension') ? getChromeAuth() : undefined;
      const settings = buildOidcSettings({
        clientId,
        platform,
        origin: window.location.origin,
        authority: config.spacetimeAuthAuthority,
        redirectUri: config.spacetimeAuthRedirectUri,
        postLogoutRedirectUri: config.spacetimeAuthPostLogoutRedirectUri,
        extensionRedirectUri: chrome?.identity.getRedirectURL('auth/callback'),
        extensionLogoutUri: chrome?.identity.getRedirectURL('auth/logout'),
      });
      if (platform === 'android') {
        const navigator = new AndroidAuthNavigator();
        // El estado PKCE debe sobrevivir a que Android cierre el proceso durante el login.
        settings.stateStore = new WebStorageStateStore({ store: localStorage, prefix: 'b20.oidc.state.' });
        settings.userStore = new RememberedUserStore();
        return { manager: new UserManager(settings, undefined, navigator, androidSilentNavigator), navigator };
      }
      if (chrome) {
        settings.stateStore = new ChromeSessionStateStore(chrome.storage.session, 'b20.oidc.state.');
        settings.userStore = new ChromeRememberedUserStore(chrome.storage.session, chrome.storage.local);
        return { manager: new UserManager(settings, undefined, createChromeNavigator(chrome, true), createChromeNavigator(chrome, false)) };
      }
      // El enlace del correo puede devolver el login en otra pestaña del mismo navegador.
      // La sesión recordada sobrevive al cierre del navegador; PKCE sigue siendo de un solo uso.
      settings.stateStore = new WebStorageStateStore({ store: localStorage, prefix: 'b20.oidc.state.' });
      settings.userStore = new RememberedUserStore();
      return { manager: new UserManager(settings) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'No se pudo preparar SpacetimeAuth.' };
    }
  }, [clientId, platform]);

  // No se recupera ninguna credencial del antiguo acceso directo de Google.
  useEffect(() => { try { sessionStorage.removeItem('b20.idToken'); } catch {} }, []);

  if (!setup.manager) {
    return <AuthFrame title="El acceso aún no está listo"
      description="Hace falta completar la configuración de acceso de B20.">
      <p role="alert" className="auth-feedback auth-feedback--error">{setup.error}</p>
      <p className="auth-help">Configura SpacetimeAuth y las direcciones de retorno para iniciar sesión.</p>
    </AuthFrame>;
  }
  return <OidcProvider userManager={setup.manager}
    skipSigninCallback={platform !== 'web'}
    onSigninCallback={(user) => replaceLocation(signinReturnTo(user?.state, window.location.origin))}
    matchSignoutCallback={(settings) => platform === 'web' && !!settings.post_logout_redirect_uri &&
      matchesCallback(window.location.href, settings.post_logout_redirect_uri)}
    onSignoutCallback={() => replaceLocation('/')}>
    <SessionBridge manager={setup.manager} navigator={setup.navigator} platform={platform}>{children}</SessionBridge>
  </OidcProvider>;
}

function replaceLocation(path: string): void {
  window.history.replaceState({}, document.title, path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function SessionBridge({ manager, navigator, platform, children }: {
  manager: UserManager; navigator?: AndroidAuthNavigator; platform: Platform; children: ReactNode;
}) {
  const auth = useOidc();
  const authRef = useRef(auth);
  authRef.current = auth;
  const manuallySignedOut = useRef(false);
  const [callbackError, setCallbackError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    if (platform === 'web' && !auth.isLoading && auth.error &&
        matchesCallback(window.location.href, manager.settings.redirect_uri)) {
      // Un retorno rechazado tampoco debe conservar códigos OAuth en la dirección.
      replaceLocation('/');
    }
  }, [auth.isLoading, auth.error, manager, platform]);
  const store = useMemo(() => new SessionStore({
    onSignOut: async () => {
      manuallySignedOut.current = true;
      manager.stopSilentRenew();
      setSigningOut(true);
      const current = authRef.current;
      const hint = current.user?.id_token;
      // El cierre local es inmediato incluso si no se consigue contactar al proveedor.
      try {
        await manager.removeUser();
        if (platform === 'web') await manager.signoutRedirect({ id_token_hint: hint, state: { returnTo: '/' } });
        else await manager.signoutPopup({ id_token_hint: hint, state: { returnTo: '/' } });
      } finally { setSigningOut(false); }
    },
  }), [manager, platform]);

  useEffect(() => {
    // Una renovación iniciada antes de salir puede terminar después; no debe reabrir la cuenta.
    if (manuallySignedOut.current) {
      if (auth.user) void manager.removeUser().catch(() => {});
      return;
    }
    if (auth.user?.id_token && !auth.user.expired) {
      if (!store.receiveToken(auth.user.id_token)) {
        setCallbackError(true);
        void manager.removeUser().catch(() => {});
      }
    } else if (auth.isLoading) {
      store.loading();
    } else if (auth.user?.expired && auth.user.refresh_token) {
      store.loading();
      manager.stopSilentRenew();
      void manager.signinSilent().catch(() => store.renewalFailed()).finally(() => {
        if (!manuallySignedOut.current) manager.startSilentRenew();
      });
    } else {
      store.signedOut(auth.error || callbackError ? 'No se pudo completar el acceso con SpacetimeAuth. Comprueba tu conexión y vuelve a intentarlo.' : undefined);
    }
  }, [auth.user, auth.isLoading, auth.error, callbackError, manager, store]);

  useEffect(() => {
    const expire = () => store.renewalFailed();
    const signedOut = () => { store.signedOut(); void manager.removeUser().catch(() => {}); };
    void manager.clearStaleState().catch(() => {});
    manager.startSilentRenew();
    manager.events.addAccessTokenExpired(expire);
    manager.events.addSilentRenewError(expire);
    manager.events.addUserSignedOut(signedOut);
    return () => {
      manager.events.removeAccessTokenExpired(expire);
      manager.events.removeSilentRenewError(expire);
      manager.events.removeUserSignedOut(signedOut);
      manager.stopSilentRenew();
      store.dispose();
    };
  }, [manager, store]);

  useEffect(() => {
    if (!navigator) return;
    let active = true;
    let remove: (() => void) | undefined;
    void attachAndroidCallbacks(manager, navigator, () => setCallbackError(true)).then((cleanup) => {
      if (active) remove = cleanup; else cleanup();
    }).catch(() => setCallbackError(true));
    return () => { active = false; remove?.(); };
  }, [manager, navigator]);

  useEffect(() => {
    if (platform !== 'web') return;
    const sync = (event: StorageEvent) => {
      if (event.key !== null && !event.key.startsWith('b20.oidc.user.')) return;
      void manager.getUser(true).then((user) => {
        if (!user) { store.signedOut(); return manager.removeUser(); }
        if (!user.expired && user.id_token) store.receiveToken(user.id_token);
        else store.renewalFailed();
      }).catch(() => store.renewalFailed());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [manager, store, platform]);

  const signIn = (options?: SignInOptions) => {
    manuallySignedOut.current = false;
    manager.startSilentRenew();
    setCallbackError(false);
    if (platform === 'web') {
      void auth.signinRedirect({ state: { returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}` },
        ...(options?.loginHint ? { login_hint: options.loginHint } : {}) }).catch(() => store.signedOut('No se pudo abrir el acceso. Vuelve a intentarlo.'));
    } else {
      void auth.signinPopup(options?.loginHint ? { login_hint: options.loginHint } : undefined).catch(() => store.signedOut('El acceso se canceló. Vuelve a intentarlo.'));
    }
  };
  return <AuthContext value={{ store, signIn, busy: auth.isLoading || !!auth.activeNavigator || signingOut }}>{children}</AuthContext>;
}

/** `null` únicamente fuera del proveedor, por ejemplo al probar componentes aislados. */
export function useSession(): SessionState | null {
  const value = useContext(AuthContext);
  return useSyncExternalStore(
    (listener) => value?.store.subscribe(listener) ?? (() => {}),
    () => value?.store.getSnapshot() ?? null,
  );
}
export function useSessionStore(): SessionStore | null { return useContext(AuthContext)?.store ?? null; }

export function SpacetimeAuthButton({ className, label = 'Continuar con SpacetimeAuth', loginHint, social = false, disabled = false }: {
  className?: string;
  label?: string;
  loginHint?: string;
  social?: boolean;
  disabled?: boolean;
} = {}) {
  const auth = useContext(AuthContext);
  if (!auth) return null;
  return <button type="button" className={className} disabled={auth.busy || disabled} aria-busy={auth.busy} onClick={() => auth.signIn(loginHint ? { loginHint } : undefined)}>
    {auth.busy ? <span className="auth-spinner" aria-hidden="true" /> : (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" focusable="false">
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="m4 7 8 6 8-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )}
    {social && <span className="auth-social-mark" aria-hidden="true">G</span>}
    <span>{auth.busy ? 'Preparando acceso…' : label}</span>
  </button>;
}
