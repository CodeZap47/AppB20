/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

interface PushPayload {
  title?: string;
  body?: string;
  /** Ruta dentro de la app, por ejemplo `#/m/mensajes`. */
  url?: string;
}

// Los mensajes 1 a 1 llegan con texto genérico por defecto para no exponerlos en la pantalla
// bloqueada; el backend decide el contenido según las preferencias del usuario.
self.addEventListener('push', (event) => {
  const data: PushPayload = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'B20', {
      body: data.body ?? 'Tienes novedades en el grupo.',
      icon: 'icons/icon.svg',
      data: { url: data.url ?? './' },
    }),
  );
});

// Al tocar el aviso se abre la app; la app vuelve a comprobar sesión y permisos.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? './';
  event.waitUntil(self.clients.openWindow(url));
});
