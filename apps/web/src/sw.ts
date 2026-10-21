/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { pushDestination } from './pushRoute';

declare const self: ServiceWorkerGlobalScope;

// El registro usa autoUpdate: una versión nueva debe sustituir la caché anterior
// incluso cuando siguen abiertas otras pestañas de B20.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

interface PushPayload {
  title?: string;
  body?: string;
  /** Ruta dentro de la app, por ejemplo `#/m/mensajes`. */
  url?: string;
  tag?: string;
}

// Los mensajes 1 a 1 llegan con texto genérico por defecto para no exponerlos en la pantalla
// bloqueada; el backend decide el contenido según las preferencias del usuario.
self.addEventListener('push', (event) => {
  let data: PushPayload = {};
  try { const parsed: unknown = event.data?.json(); if (typeof parsed === 'object' && parsed !== null) data = parsed; } catch { /* Un mensaje vacío sigue mostrando la bandeja. */ }
  event.waitUntil(
    self.registration.showNotification(typeof data.title === 'string' ? data.title.slice(0, 100) : 'B20', {
      body: typeof data.body === 'string' ? data.body.slice(0, 200) : 'Tienes novedades en el grupo.',
      tag: typeof data.tag === 'string' && /^b20:\d{1,20}$/.test(data.tag) ? data.tag : undefined,
      icon: 'icons/icon.svg',
      data: { url: pushDestination(data.url, self.location.href) },
    }),
  );
});

// Al tocar el aviso se abre la app; la app vuelve a comprobar sesión y permisos.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = pushDestination((event.notification.data as { url?: string } | undefined)?.url, self.location.href);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(url); await existing.focus(); }
    else await self.clients.openWindow(url);
  })());
});
