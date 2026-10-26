import { getChromeAuth } from './platformAuth';

const PREFIX = 'b20.invitation.pending.';
const CURRENT = 'b20.invitation.current';
const HOUR = 3_600_000;
interface PendingInvitation { flow: string; token: string; expiresAt: number }
let memory: PendingInvitation | undefined;
let pendingWrite: Promise<void> = Promise.resolve();

function flowFromLocation(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const route = new URL(window.location.hash.slice(1) || '/', 'https://invitation.invalid');
    if (route.pathname !== '/invitacion') return undefined;
    return route.searchParams.get('flujo') ?? undefined;
  } catch { return undefined; }
}
function valid(value: unknown): value is PendingInvitation {
  return !!value && typeof value === 'object' && 'flow' in value && typeof value.flow === 'string' &&
    'token' in value && typeof value.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.token) &&
    'expiresAt' in value && typeof value.expiresAt === 'number' && value.expiresAt > Date.now() && value.expiresAt <= Date.now() + HOUR;
}
function parse(value: unknown): PendingInvitation | undefined {
  try { const data: unknown = typeof value === 'string' ? JSON.parse(value) : undefined; return valid(data) ? data : undefined; } catch { return undefined; }
}

/** Debe ejecutarse antes del router y de capturar returnTo para OAuth. */
export function capturePendingInvitation(): void {
  if (typeof window === 'undefined') return;
  let route: URL;
  try { route = new URL(window.location.hash.slice(1) || '/', 'https://invitation.invalid'); }
  catch { return; }
  if (route.pathname !== '/invitacion' || !route.searchParams.has('token')) return;
  const token = route.searchParams.get('token') ?? '';
  const flow = crypto.randomUUID();
  window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}#/invitacion?flujo=${flow}`);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { clearPendingInvitation(); return; }
  memory = { flow, token, expiresAt: Date.now() + HOUR };
  const serialized = JSON.stringify(memory);
  const chrome = getChromeAuth();
  if (chrome) pendingWrite = pendingWrite.then(() => chrome.storage.session.set({ [PREFIX + flow]: serialized, [CURRENT]: flow })).catch(() => {});
  else {
    try { localStorage.setItem(PREFIX + flow, serialized); localStorage.setItem(CURRENT, flow); } catch { /* El token aún sirve en la sesión en memoria. */ }
  }
}

/** Chrome comparte esta memoria entre pestaña y panel; web admite retornos en otra pestaña. */
export async function preparePendingInvitation(): Promise<void> {
  await pendingWrite;
  const chrome = getChromeAuth();
  if (!chrome) {
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX) && !parse(localStorage.getItem(key))) localStorage.removeItem(key);
      const current = localStorage.getItem(CURRENT);
      if (current && !parse(localStorage.getItem(PREFIX + current))) localStorage.removeItem(CURRENT);
    } catch { /* El token en memoria sigue siendo válido si el navegador bloquea almacenamiento. */ }
    return;
  }
  try {
    const values = await chrome.storage.session.get(null);
    const flow = flowFromLocation() ?? (typeof values[CURRENT] === 'string' ? values[CURRENT] : undefined);
    if (flow) memory = parse(values[PREFIX + flow]) ?? (valid(memory) && memory.flow === flow ? memory : undefined);
    for (const key of Object.keys(values)) if (key.startsWith(PREFIX) && !parse(values[key])) await chrome.storage.session.remove(key);
  } catch { /* La invitación actual puede seguir en memoria. */ }
}

export function getPendingInvitation(): string | undefined {
  const flow = flowFromLocation();
  if (valid(memory) && (!flow || flow === memory.flow)) return memory.token;
  memory = undefined;
  if (getChromeAuth()) return undefined;
  try {
    const current = flow ?? localStorage.getItem(CURRENT);
    if (!current) return undefined;
    memory = parse(localStorage.getItem(PREFIX + current));
    if (!memory) { localStorage.removeItem(PREFIX + current); if (localStorage.getItem(CURRENT) === current) localStorage.removeItem(CURRENT); }
    return memory?.token;
  } catch { return undefined; }
}

export function clearPendingInvitation(): void {
  const flow = memory?.flow ?? flowFromLocation();
  memory = undefined;
  const chrome = getChromeAuth();
  if (chrome) {
    pendingWrite = pendingWrite.then(async () => {
      const values = await chrome.storage.session.get(null);
      for (const key of Object.keys(values)) if (key.startsWith(PREFIX) || key === CURRENT) await chrome.storage.session.remove(key);
    }).catch(() => {});
  } else {
    try {
      // Al salir no dejamos invitaciones de otros flujos abiertas en este navegador.
      for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX) || key === CURRENT) localStorage.removeItem(key);
      if (flow) localStorage.removeItem(PREFIX + flow);
    } catch {}
  }
}
