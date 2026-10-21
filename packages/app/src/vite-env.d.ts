/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SPACETIME_URI?: string;
  readonly VITE_SPACETIME_DB?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_SPACETIMEAUTH_CLIENT_ID?: string;
  readonly VITE_SPACETIMEAUTH_EXTENSION_CLIENT_ID?: string;
  readonly VITE_SPACETIMEAUTH_ANDROID_CLIENT_ID?: string;
  readonly VITE_SPACETIMEAUTH_AUTHORITY?: string;
  readonly VITE_SPACETIMEAUTH_REDIRECT_URI?: string;
  readonly VITE_SPACETIMEAUTH_POST_LOGOUT_REDIRECT_URI?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
