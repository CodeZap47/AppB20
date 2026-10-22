import type { UserManagerSettings } from 'oidc-client-ts';
import type { Platform } from '../platform';

export const SPACETIMEAUTH_AUTHORITY = 'https://auth.spacetimedb.com/oidc';
export const ANDROID_REDIRECT_URI = 'mx.b20.app://auth/callback';
export const ANDROID_LOGOUT_URI = 'mx.b20.app://auth/logout';

interface AuthOptions {
  clientId: string;
  platform: Platform;
  origin: string;
  authority?: string;
  redirectUri?: string;
  postLogoutRedirectUri?: string;
  extensionRedirectUri?: string;
  extensionLogoutUri?: string;
}

/** Configuración pública. PKCE queda habilitado por oidc-client-ts; no hay client secret. */
export function buildOidcSettings(options: AuthOptions): UserManagerSettings {
  if (!options.clientId.trim()) {
    throw new Error('Falta configurar el Client ID de SpacetimeAuth para esta presentación.');
  }
  const authority = (options.authority || SPACETIMEAUTH_AUTHORITY).replace(/\/$/, '');
  if (authority !== SPACETIMEAUTH_AUTHORITY) {
    throw new Error('La autoridad de SpacetimeAuth debe ser https://auth.spacetimedb.com/oidc.');
  }
  let redirectUri: string;
  let logoutUri: string;
  if (options.platform === 'android') {
    redirectUri = ANDROID_REDIRECT_URI;
    logoutUri = ANDROID_LOGOUT_URI;
  } else if (options.platform.startsWith('extension')) {
    if (!options.extensionRedirectUri || !options.extensionLogoutUri) {
      throw new Error('Abre esta presentación desde la extensión de Chrome con el permiso identity.');
    }
    redirectUri = options.extensionRedirectUri;
    logoutUri = options.extensionLogoutUri;
  } else {
    redirectUri = webRedirect(options.redirectUri || `${options.origin}/auth/callback`, options.origin);
    logoutUri = webRedirect(options.postLogoutRedirectUri || `${options.origin}/auth/logout`, options.origin);
    if (redirectUri === logoutUri) throw new Error('Usa direcciones distintas para entrada y cierre de sesión.');
  }
  return {
    authority,
    client_id: options.clientId.trim(),
    redirect_uri: redirectUri,
    post_logout_redirect_uri: logoutUri,
    popup_redirect_uri: redirectUri,
    popup_post_logout_redirect_uri: logoutUri,
    silent_redirect_uri: redirectUri,
    scope: 'openid profile email offline_access',
    response_type: 'code',
    response_mode: 'query',
    // React inicia/detiene la renovación al montar/desmontar; el constructor no deja timers huérfanos en StrictMode.
    automaticSilentRenew: false,
    accessTokenExpiringNotificationTimeInSeconds: 300,
    loadUserInfo: false,
    validateSubOnSilentRenew: true,
    includeIdTokenInSilentRenew: true,
    // La firma y los permisos se comprueban de nuevo en el módulo y la API.
    monitorSession: false,
  };
}

function webRedirect(value: string, origin: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('La dirección de retorno de SpacetimeAuth no es válida.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.origin !== origin || url.username || url.password || url.hash || url.search) {
    throw new Error('Las direcciones de retorno deben pertenecer a esta web y usar HTTPS (HTTP solo en localhost).');
  }
  return url.href;
}

/** Solo restaura una ruta local de la app, nunca una URL externa ni otra devolución OAuth. */
export function signinReturnTo(state: unknown, origin: string): string {
  const returnTo = state && typeof state === 'object' && 'returnTo' in state ? state.returnTo : undefined;
  if (typeof returnTo !== 'string' || !returnTo.startsWith('/') || returnTo.startsWith('//')) return '/';
  try {
    const url = new URL(returnTo, origin);
    if (url.origin !== origin || url.pathname.startsWith('/auth/')) return '/';
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    url.searchParams.delete('session_state');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/'; }
}

/** Compara la dirección exacta sin aceptar prefijos parecidos o rutas ajenas. */
export function matchesCallback(value: string, expected: string): boolean {
  try {
    const url = new URL(value);
    const target = new URL(expected);
    return url.protocol === target.protocol && url.host === target.host && url.pathname === target.pathname &&
      !url.username && !url.password;
  } catch { return false; }
}
