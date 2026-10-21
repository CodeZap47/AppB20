import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { AuthProvider as OidcProvider, useAuth as useOidc } from 'react-oidc-context';
import { config } from '../config';
import type { Platform } from '../platform';
import { buildOidcSettings, matchesCallback, signinReturnTo } from './oidc';
import { AndroidAuthNavigator, androidSilentNavigator, attachAndroidCallbacks, ChromeSessionStateStore,
  createChromeNavigator, getChromeAuth } from './platformAuth';
import { SessionStore, type SessionState } from './session';

interface AuthValue {
  store: SessionStore;
  signIn: () => void;
  busy: boolean;
}
const AuthContext = createContext<AuthValue | null>(null);

/** OIDC Authorization Code + PKCE. Cada presentación usa el navegador apropiado a su plataforma. */
export function AuthProvider({ clientId, platform = 'web', children }: {
  clientId: string; platform?: Platform; children: ReactNode;
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
        settings.userStore = new WebStorageStateStore({ store: sessionStorage, prefix: 'b20.oidc.user.' });
        return { manager: new UserManager(settings, undefined, navigator, androidSilentNavigator), navigator };
      }
      if (chrome) {
        settings.stateStore = new ChromeSessionStateStore(chrome.storage.session, 'b20.oidc.state.');
        settings.userStore = new ChromeSessionStateStore(chrome.storage.session, 'b20.oidc.user.');
        return { manager: new UserManager(settings, undefined, createChromeNavigator(chrome, true), createChromeNavigator(chrome, false)) };
      }
      settings.stateStore = new WebStorageStateStore({ store: sessionStorage, prefix: 'b20.oidc.state.' });
      settings.userStore = new WebStorageStateStore({ store: sessionStorage, prefix: 'b20.oidc.user.' });
      return { manager: new UserManager(settings) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'No se pudo preparar SpacetimeAuth.' };
    }
  }, [clientId, platform]);

  // No se recupera ninguna credencial del antiguo acceso directo de Google.
  useEffect(() => { try { sessionStorage.removeItem('b20.idToken'); } catch {} }, []);

  if (!setup.manager) {
    return <main className="signin"><h1>B20</h1><p role="alert" className="error">{setup.error}</p>
      <p>Configura SpacetimeAuth y las direcciones de retorno antes de usar cuentas reales.</p>
      <a href="?demo">Ver la demo con datos de prueba</a></main>;
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

  const signIn = () => {
    manuallySignedOut.current = false;
    manager.startSilentRenew();
    setCallbackError(false);
    if (platform === 'web') {
      void auth.signinRedirect({ state: { returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}` } });
    } else {
      void auth.signinPopup();
    }
  };
  return <AuthContext value={{ store, signIn, busy: auth.isLoading || !!auth.activeNavigator || signingOut }}>{children}</AuthContext>;
}

/** `null` solo cuando el usuario pidió explícitamente la demo. */
export function useSession(): SessionState | null {
  const value = useContext(AuthContext);
  return useSyncExternalStore(
    (listener) => value?.store.subscribe(listener) ?? (() => {}),
    () => value?.store.getSnapshot() ?? null,
  );
}
export function useSessionStore(): SessionStore | null { return useContext(AuthContext)?.store ?? null; }

export function SpacetimeAuthButton() {
  const auth = useContext(AuthContext);
  if (!auth) return null;
  return <button type="button" disabled={auth.busy} onClick={auth.signIn}>
    {auth.busy ? 'Preparando acceso…' : 'Continuar con SpacetimeAuth'}
  </button>;
}
