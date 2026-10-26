import { useCallback, useEffect, useState } from 'react';
import { webPushSupport } from './notifications';

export type BrowserPushStatusKind = 'checking' | 'unsupported' | 'needs-install' | 'permission-required' | 'denied' | 'unsubscribed' | 'subscribed' | 'unknown';

/** Consulta el navegador; nunca solicita permiso ni registra una suscripción. */
export function useBrowserPushStatus(enabled: boolean) {
  const [status, setStatus] = useState<{ kind: BrowserPushStatusKind }>({ kind: 'checking' });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false; let generation = 0; let permissionStatus: PermissionStatus | undefined;
    let serviceWorker: ServiceWorkerContainer | undefined;
    async function check() {
      const request = ++generation;
      const update = (kind: BrowserPushStatusKind) => { if (!disposed && request === generation) setStatus({ kind }); };
      try {
        const support = webPushSupport();
        if (support.kind !== 'supported') { update(support.kind); return; }
        if (Notification.permission !== 'granted') { update(Notification.permission === 'denied' ? 'denied' : 'permission-required'); return; }
        update('checking');
        const worker = await navigator.serviceWorker.getRegistration();
        const subscription = worker?.active && worker.pushManager ? await worker.pushManager.getSubscription() : null;
        // El permiso puede cambiar mientras se resuelve la consulta de la suscripción.
        if (Notification.permission !== 'granted') { update(Notification.permission === 'denied' ? 'denied' : 'permission-required'); return; }
        update(subscription && (subscription.expirationTime == null || subscription.expirationTime > Date.now()) ? 'subscribed' : 'unsubscribed');
      } catch { update('unknown'); }
    }
    const recheck = () => { void check(); };
    const visibility = () => {
      if (document.visibilityState === 'visible') recheck();
      else { generation++; setStatus({ kind: 'checking' }); }
    };
    recheck();
    window.addEventListener('focus', recheck);
    window.addEventListener('pageshow', recheck);
    window.addEventListener('storage', recheck);
    document.addEventListener('visibilitychange', visibility);
    try {
      serviceWorker = navigator.serviceWorker;
      serviceWorker?.addEventListener('controllerchange', recheck);
    } catch { /* El acceso al service worker también puede estar restringido. */ }
    // Algunos navegadores no admiten consultar este permiso. Foco y visibilidad siguen
    // actualizando el estado al volver de los ajustes del teléfono.
    void (async () => {
      try {
        const initialPermission = typeof Notification === 'undefined' ? undefined : Notification.permission;
        const result = await navigator.permissions?.query({ name: 'notifications' });
        if (disposed || !result) return;
        permissionStatus = result;
        permissionStatus.addEventListener('change', recheck);
        // No perder un cambio ocurrido antes de que se pudiera instalar el listener.
        if (typeof Notification !== 'undefined' && Notification.permission !== initialPermission) recheck();
      } catch { /* La consulta es opcional; no se pide permiso como alternativa. */ }
    })();
    return () => {
      disposed = true; generation++;
      window.removeEventListener('focus', recheck);
      window.removeEventListener('pageshow', recheck);
      window.removeEventListener('storage', recheck);
      document.removeEventListener('visibilitychange', visibility);
      serviceWorker?.removeEventListener('controllerchange', recheck);
      permissionStatus?.removeEventListener('change', recheck);
    };
  }, [enabled, revision]);

  return { status, refresh };
}
