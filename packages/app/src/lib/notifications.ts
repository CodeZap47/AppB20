/**
 * Detección de capacidades para avisos (sección 5, notificaciones push por presentación).
 * El permiso solo se pide como respuesta a una acción directa del usuario.
 */

export type PushSupport =
  | { kind: 'supported' }
  | { kind: 'needs-install'; reason: string }
  | { kind: 'unsupported'; reason: string };

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function webPushSupport(): PushSupport {
  if (isIos() && !isStandalone()) {
    return {
      kind: 'needs-install',
      reason: 'En iPhone, primero añade la app a la pantalla de inicio (iOS 16.4 o superior).',
    };
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { kind: 'unsupported', reason: 'Este navegador no admite Web Push.' };
  }
  return { kind: 'supported' };
}

/** Llamar solo desde un manejador de clic. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  return Notification.requestPermission();
}
