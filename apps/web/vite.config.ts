import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { VitePWA } from 'vite-plugin-pwa';
import { parsePagesOrigin, parseWebOrigin } from './src/canonicalOrigin.ts';

// `--mode capacitor` genera la misma app para el APK Android, sin service worker de PWA:
// en el APK se conserva la bandeja; el push nativo sigue pendiente.
export default defineConfig(({ mode }) => {
  const designPreview = mode === 'design-preview';
  if (mode === 'pages') {
    const env = loadEnv(mode, '../..', 'VITE_');
    if (env.VITE_DATA_MODE && !['demo', 'spacetime'].includes(env.VITE_DATA_MODE)) {
      throw new Error('VITE_DATA_MODE debe ser demo o spacetime.');
    }
    // Supabase Auth es el único proveedor de inicio de sesión.
    const required = ['VITE_WEB_ORIGIN', 'VITE_SPACETIME_URI', 'VITE_SPACETIME_DB', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];
    if (env.VITE_SUPABASE_PUBLISHABLE_KEY && !env.VITE_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')) {
      throw new Error('Usa una clave pública sb_publishable_ de Supabase en el cliente.');
    }
    for (const key of required) {
      if (!env[key]?.trim()) {
        throw new Error(`Falta ${key}. Configura las variables del build de Pages o copia .env.pages.example a .env.pages.`);
      }
    }
    if (!parseWebOrigin(env.VITE_WEB_ORIGIN)) {
      throw new Error('VITE_WEB_ORIGIN debe ser un origen HTTPS estable, como https://b20.mx, sin ruta, parámetros ni credenciales.');
    }
    if (env.VITE_PAGES_ORIGIN?.trim() ? !parsePagesOrigin(env.VITE_PAGES_ORIGIN) : !parsePagesOrigin(env.VITE_WEB_ORIGIN)) {
      throw new Error('VITE_PAGES_ORIGIN debe ser https://<proyecto>.pages.dev cuando VITE_WEB_ORIGIN es un dominio propio.');
    }
    // Evita publicar accidentalmente una web que dependa de la computadora del desarrollador.
    const urls = [
      ['VITE_SPACETIME_URI', 'wss:'],
      ['VITE_API_URL', 'https:'],
      ['VITE_AI_API_URL', 'https:'],
      ['VITE_INVITATION_API_URL', 'https:'],
      ['VITE_SUPABASE_URL', 'https:'],
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
  }
  return {
  build: designPreview ? { rollupOptions: { input: {
    app: fileURLToPath(new URL('./index.html', import.meta.url)),
    preview: fileURLToPath(new URL('./design-preview.html', import.meta.url)),
  } } } : undefined,
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
        // El bundle principal ya supera los 2 MiB predeterminados; sin esto el build falla
        // y la app dejaría de funcionar sin conexión. Dividir el bundle permitiría bajarlo.
        injectManifest: { maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
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
          theme_color: '#3152a0',
          icons: [
            { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            // TODO(Etapa 0): agregar PNG 192, 512 y apple-touch-icon 180 para iPhone.
          ],
        },
      }),
  ],
  };
});
