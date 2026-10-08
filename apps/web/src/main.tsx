import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, type Platform } from '@b20/app';
import '@b20/app/styles.css';

const platform: Platform = import.meta.env.MODE === 'capacitor' ? 'android' : 'web';

if (platform === 'web') {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App platform={platform} />
  </StrictMode>,
);
