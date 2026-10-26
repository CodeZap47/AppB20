export interface BrowserPushInstallation {
  id: string; label: string; endpoint: string; p256dh: string; auth: string;
}

const storageKey = (memberId: string) => `b20.push.installation.${memberId}`;
const ownerKey = 'b20.push.owner';
export function browserPushInstallationId(memberId: string): string | undefined {
  try { return localStorage.getItem(storageKey(memberId)) || undefined; } catch { return undefined; }
}

/** La suscripción del navegador solo puede pertenecer a una cuenta a la vez. */
export function currentBrowserPushInstallationId(memberId: string): string | undefined {
  try { return localStorage.getItem(ownerKey) === memberId ? browserPushInstallationId(memberId) : undefined; }
  catch { return undefined; }
}

function applicationKey(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Las notificaciones todavía no están configuradas.');
  let decoded: string;
  try { decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')); }
  catch { throw new Error('Las notificaciones todavía no están configuradas.'); }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('Las notificaciones todavía no están configuradas.');
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const current = await navigator.serviceWorker.getRegistration();
  if (current) return current;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('La instalación todavía no está lista. Recarga e inténtalo de nuevo.')), 15_000);
    navigator.serviceWorker.ready.then((ready) => { clearTimeout(timeout); resolve(ready); }, (error: unknown) => { clearTimeout(timeout); reject(error); });
  });
}

/** Se llama desde un clic. Solo persiste el identificador del dispositivo, nunca sus claves. */
export async function enableBrowserPush(memberId: string, vapidPublicKey: string,
  register: (input: BrowserPushInstallation) => Promise<unknown> | unknown): Promise<string> {
  const key = applicationKey(vapidPublicKey);
  if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('Este navegador no admite avisos externos.');
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('El navegador no autorizó los avisos. La bandeja de la app sigue disponible.');
  const worker = await registration();
  let previous = await worker.pushManager.getSubscription();
  let previousOwner: string | undefined;
  try { previousOwner = localStorage.getItem(ownerKey) || undefined; } catch { /* Se permite continuar sin persistencia. */ }
  if (previous && (previousOwner !== memberId || !browserPushInstallationId(memberId))) {
    if (!await previous.unsubscribe()) throw new Error('No se pudo retirar la suscripción anterior de este navegador.');
    previous = null;
  }
  const subscription = previous ?? await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const data = subscription.toJSON();
  const id = browserPushInstallationId(memberId) ?? crypto.randomUUID();
  try {
    if (!data.endpoint || !data.keys?.p256dh || !data.keys.auth) throw new Error('El navegador no completó el registro del dispositivo.');
    await register({ id, label: 'Web/PWA', endpoint: data.endpoint, p256dh: data.keys.p256dh, auth: data.keys.auth });
    try { localStorage.setItem(storageKey(memberId), id); localStorage.setItem(ownerKey, memberId); } catch { /* La instalación sigue administrable en la bandeja. */ }
    return id;
  } catch (error) {
    if (!previous) await subscription.unsubscribe().catch(() => false);
    throw error;
  }
}

export async function disableBrowserPush(memberId: string, remove: (id: string) => Promise<unknown> | unknown): Promise<void> {
  const id = browserPushInstallationId(memberId);
  if (id) await remove(id);
  if ('serviceWorker' in navigator) {
    const worker = await navigator.serviceWorker.getRegistration();
    const subscription = await worker?.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
  }
  try { localStorage.removeItem(storageKey(memberId)); if (localStorage.getItem(ownerKey) === memberId) localStorage.removeItem(ownerKey); } catch { /* No contiene credenciales. */ }
}
