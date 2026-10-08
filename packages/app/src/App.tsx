import { createHashRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { ModulePage } from './pages/ModulePage';
import { SettingsPage } from './pages/SettingsPage';
import { InstallPage } from './pages/InstallPage';
import { SpacetimeProvider } from './lib/spacetime';
import { PlatformContext } from './components/PlatformContext';
import type { Platform } from './platform';

/**
 * Se usa hash routing porque funciona igual en la web, en las páginas empaquetadas de la
 * extensión (chrome-extension://) y dentro del WebView de Capacitor.
 */
const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'm/:moduleId', element: <ModulePage /> },
      { path: 'ajustes', element: <SettingsPage /> },
      { path: 'instalar', element: <InstallPage /> },
    ],
  },
]);

export function App({ platform }: { platform: Platform }) {
  return (
    <PlatformContext value={platform}>
      <SpacetimeProvider>
        <RouterProvider router={router} />
      </SpacetimeProvider>
    </PlatformContext>
  );
}
