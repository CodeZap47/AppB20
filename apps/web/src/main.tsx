import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, type Platform } from '@b20/app';
import '@b20/app/styles.css';
import { canonicalPagesUrl, containsOAuthResponse } from './canonicalOrigin';

const platform: Platform = import.meta.env.MODE === 'capacitor' ? 'android' : 'web';
const canonicalUrl = import.meta.env.MODE === 'pages'
  ? canonicalPagesUrl(window.location.href, import.meta.env.VITE_WEB_ORIGIN)
  : undefined;

if (canonicalUrl) {
  // La navegación termina antes de montar OIDC o registrar un service worker en el alias.
  window.location.replace(canonicalUrl);
} else {
  if (platform === 'web') {
    void import('virtual:pwa-register').then(({ registerSW }) => registerSW({
      immediate: true,
      onNeedReload: () => {
        // Una actualización nunca debe interrumpir el canje de un código de un solo uso.
        if (!containsOAuthResponse(new URL(window.location.href))) window.location.reload();
      },
    }));
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App platform={platform} />
    </StrictMode>,
  );
}
