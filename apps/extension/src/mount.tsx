import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, type Platform } from '@b20/app';
import '@b20/app/styles.css';

export function mount(platform: Platform) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App platform={platform} />
    </StrictMode>,
  );
}
