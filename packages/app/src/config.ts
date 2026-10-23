/** Configuración pública del cliente. Ningún secreto vive aquí (sección 2, protección técnica). */
export const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
  supabasePasskeysEnabled: import.meta.env.VITE_SUPABASE_PASSKEYS_ENABLED === 'true',
  supabaseOAuthProviders: String(import.meta.env.VITE_SUPABASE_OAUTH_PROVIDERS ?? '').split(',').filter((p): p is 'google' | 'github' => p === 'google' || p === 'github'),
  dataMode: import.meta.env.VITE_DATA_MODE === 'spacetime' ? 'spacetime' : 'demo',
  spacetimeUri: import.meta.env.VITE_SPACETIME_URI ?? 'ws://localhost:3000',
  spacetimeDb: import.meta.env.VITE_SPACETIME_DB ?? 'app-b20',
  apiUrl: import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8787' : ''),
  aiApiUrl: import.meta.env.VITE_AI_API_URL || import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8787' : ''),
  /** Omite el inicio de sesión solo en `vite dev` con datos simulados. */
  devAuthBypass: import.meta.env.DEV && import.meta.env.VITE_DATA_MODE !== 'spacetime' &&
    import.meta.env.VITE_DEV_AUTH_BYPASS === 'true',
  vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '',
} as const;
