/** Configuración pública del cliente. Ningún secreto vive aquí (sección 2, protección técnica). */
export const config = {
  dataMode: import.meta.env.VITE_DATA_MODE === 'spacetime' ? 'spacetime' : 'demo',
  spacetimeUri: import.meta.env.VITE_SPACETIME_URI ?? 'ws://localhost:3000',
  spacetimeDb: import.meta.env.VITE_SPACETIME_DB ?? 'app-b20',
  apiUrl: import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8787' : ''),
  aiApiUrl: import.meta.env.VITE_AI_API_URL || import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8787' : ''),
  spacetimeAuthClientId: import.meta.env.VITE_SPACETIMEAUTH_CLIENT_ID ?? '',
  spacetimeAuthExtensionClientId: import.meta.env.VITE_SPACETIMEAUTH_EXTENSION_CLIENT_ID ?? '',
  spacetimeAuthAndroidClientId: import.meta.env.VITE_SPACETIMEAUTH_ANDROID_CLIENT_ID ?? '',
  spacetimeAuthAuthority:
    import.meta.env.VITE_SPACETIMEAUTH_AUTHORITY ?? 'https://auth.spacetimedb.com/oidc',
  spacetimeAuthRedirectUri: import.meta.env.VITE_SPACETIMEAUTH_REDIRECT_URI ?? '',
  spacetimeAuthPostLogoutRedirectUri:
    import.meta.env.VITE_SPACETIMEAUTH_POST_LOGOUT_REDIRECT_URI ?? '',
  /** Omite SpacetimeAuth solo en `vite dev` con datos simulados. */
  devAuthBypass: import.meta.env.DEV && import.meta.env.VITE_DATA_MODE !== 'spacetime' &&
    import.meta.env.VITE_DEV_AUTH_BYPASS === 'true',
  vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '',
} as const;
