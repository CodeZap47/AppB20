/** Configuración pública del cliente. Ningún secreto vive aquí (sección 2, protección técnica). */
export const config = {
  spacetimeUri: import.meta.env.VITE_SPACETIME_URI ?? 'ws://localhost:3000',
  spacetimeDb: import.meta.env.VITE_SPACETIME_DB ?? 'app-b20',
  apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:8787',
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
  vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '',
} as const;
