// Enlace de invitación: https://b20.mx/#/unirme/<código>. Lo que va después de # no viaja al
// servidor; el código se guarda solo en esta pestaña hasta que la persona se une al grupo.
const KEY = 'b20.inviteLink';
const ROUTE = /^#\/unirme\/([A-Za-z0-9_-]{43})\/?$/;

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 32 bytes aleatorios y su hash SHA-256: el módulo solo recibe el hash. */
export async function newInviteCode(): Promise<{ code: string; hash: string }> {
  const code = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)));
  return { code, hash: [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('') };
}

/** La dirección pública de la web, también desde la extensión o Android. */
export function inviteLinkUrl(code: string): string {
  const origin = import.meta.env.VITE_WEB_ORIGIN || window.location.origin;
  return `${origin.replace(/\/+$/, '')}/#/unirme/${code}`;
}

/** Guarda el código si la dirección es un enlace de invitación y lo quita de la barra. */
export function captureInviteLink(): void {
  const match = ROUTE.exec(window.location.hash);
  if (!match) return;
  try { sessionStorage.setItem(KEY, match[1]!); } catch { /* Sin almacenamiento: el enlace se pierde al recargar. */ }
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
}

export function pendingInviteLink(): string | undefined {
  try { return sessionStorage.getItem(KEY) ?? undefined; } catch { return undefined; }
}

export function clearInviteLink(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* Nada que limpiar. */ }
}
