import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { VitePWA } from 'vite-plugin-pwa';
import { parsePagesOrigin } from './src/canonicalOrigin.ts';

// `--mode capacitor` genera la misma app para el APK Android, sin service worker de PWA:
// en el APK se conserva la bandeja; el push nativo sigue pendiente.
export default defineConfig(({ mode }) => {
  if (mode === 'pages') {
    const env = loadEnv(mode, '../..', 'VITE_');
    if (env.VITE_DATA_MODE && !['demo', 'spacetime'].includes(env.VITE_DATA_MODE)) {
      throw new Error('VITE_DATA_MODE debe ser demo o spacetime.');
    }
    const required = ['VITE_WEB_ORIGIN', 'VITE_SPACETIME_URI', 'VITE_SPACETIME_DB', 'VITE_SPACETIMEAUTH_CLIENT_ID'];
    for (const key of required) {
      if (!env[key]?.trim()) {
        throw new Error(`Falta ${key}. Configura las variables del build de Pages o copia .env.pages.example a .env.pages.`);
      }
    }
    if (!parsePagesOrigin(env.VITE_WEB_ORIGIN)) {
      throw new Error('VITE_WEB_ORIGIN debe ser el origen estable https://<proyecto>.pages.dev, sin ruta, parámetros ni credenciales.');
    }
    // Evita publicar accidentalmente una web que dependa de la computadora del desarrollador.
    const urls = [
      ['VITE_SPACETIME_URI', 'wss:'],
      ['VITE_API_URL', 'https:'],
      ['VITE_SPACETIMEAUTH_REDIRECT_URI', 'https:'],
      ['VITE_SPACETIMEAUTH_POST_LOGOUT_REDIRECT_URI', 'https:'],
    ] as const;
    for (const [key, protocol] of urls) {
      if (!env[key]?.trim()) continue;
      let url: URL;
      try { url = new URL(env[key]); } catch { throw new Error(`${key} debe ser una URL válida para producción.`); }
      if (url.protocol !== protocol || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
          url.username || url.password || url.search || url.hash) {
        throw new Error(`${key} debe usar ${protocol} sin credenciales y apuntar a un servicio público.`);
      }
    }
    if (env.VITE_SPACETIMEAUTH_AUTHORITY &&
        env.VITE_SPACETIMEAUTH_AUTHORITY.replace(/\/$/, '') !== 'https://auth.spacetimedb.com/oidc') {
      throw new Error('VITE_SPACETIMEAUTH_AUTHORITY debe ser https://auth.spacetimedb.com/oidc.');
    }
  }
  return {
  envDir: '../..',
  resolve: {
    alias: { '@b20-ui': fileURLToPath(new URL('../../packages/app/src/untitled', import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    mode !== 'capacitor' &&
      VitePWA({
        registerType: 'autoUpdate',
        // Service worker propio para manejar eventos `push` y `notificationclick`.
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        includeAssets: ['icons/icon.svg'],
        manifest: {
          name: 'App B20',
          short_name: 'B20',
          description: 'Plataforma colaborativa del grupo B20.',
          lang: 'es-MX',
          start_url: './',
          scope: './',
          display: 'standalone',
          background_color: '#f7f7f9',
          theme_color: '#2f5bea',
          icons: [
            { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            // TODO(Etapa 0): agregar PNG 192, 512 y apple-touch-icon 180 para iPhone.
          ],
        },
      }),
  ],
  };
});
