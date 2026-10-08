import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// `--mode capacitor` genera la misma app para el APK Android, sin service worker de PWA:
// en Android los avisos llegan por FCM, no por Web Push.
export default defineConfig(({ mode }) => ({
  envDir: '../..',
  plugins: [
    react(),
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
}));
