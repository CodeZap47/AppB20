/** Configuración pública del cliente. Ningún secreto vive aquí (sección 2, protección técnica). */
export const config = {
  authProvider: import.meta.env.VITE_AUTH_PROVIDER === 'supabase' ? 'supabase' : 'spacetimeauth',
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
  supabasePasskeysEnabled: import.meta.env.VITE_SUPABASE_PASSKEYS_ENABLED === 'true',
  supabaseOAuthProviders: String(import.meta.env.VITE_SUPABASE_OAUTH_PROVIDERS ?? '').split(',').filter((p): p is 'google' | 'github' => p === 'google' || p === 'github'),
  socialAuthEnabled: import.meta.env.VITE_SOCIAL_AUTH_ENABLED === 'true',
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
  vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '',
} as const;
