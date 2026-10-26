/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_PASSKEYS_ENABLED?: string;
  readonly VITE_SUPABASE_OAUTH_PROVIDERS?: string;
  readonly VITE_DATA_MODE?: 'demo' | 'spacetime';
  readonly VITE_WEB_ORIGIN?: string;
  readonly VITE_PAGES_ORIGIN?: string;
  readonly VITE_SPACETIME_URI?: string;
  readonly VITE_SPACETIME_DB?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_AI_API_URL?: string;
  readonly VITE_INVITATION_API_URL?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  readonly VITE_DEV_AUTH_BYPASS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
