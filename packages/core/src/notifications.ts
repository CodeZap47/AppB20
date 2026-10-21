import { NOTIFICATION_TIME_ZONES } from './notificationTimeZones';
export { NOTIFICATION_TIME_ZONES } from './notificationTimeZones';

export const NOTIFICATION_KINDS = ['direct_message', 'mention', 'work', 'due_change', 'answer', 'room', 'poll', 'guide', 'birthday', 'assignment_reminder', 'activity_reminder', 'spaced_review', 'test'] as const;
export type NotificationKind = typeof NOTIFICATION_KINDS[number];
export interface NotificationPreferencesInput {
  expectedVersion?: number;
  timeZone: string; enabledKinds: NotificationKind[]; pushEnabled: boolean;
  quietStartMinute: number; quietEndMinute: number; reminderMinute: number;
}
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferencesInput = { timeZone: 'America/Tijuana', enabledKinds: [...NOTIFICATION_KINDS], pushEnabled: false, quietStartMinute: 22 * 60, quietEndMinute: 7 * 60, reminderMinute: 9 * 60 };
export const NOTIFICATION_TITLES: Record<NotificationKind, string> = { direct_message: 'Nuevo mensaje privado', mention: 'Te mencionaron', work: 'Nuevo trabajo compartido', due_change: 'Cambió una fecha de entrega', answer: 'Nueva respuesta', room: 'Sesión de estudio', poll: 'Votación por cerrar', guide: 'Guía disponible', birthday: 'Cumpleaños del grupo', assignment_reminder: 'Recordatorio de entrega', activity_reminder: 'Actividad de clase', spaced_review: 'Tienes un repaso pendiente', test: 'Aviso de prueba de App B20' };
const zones = new Set(NOTIFICATION_TIME_ZONES);
export function notificationPreferences(input: NotificationPreferencesInput): NotificationPreferencesInput {
  if (!zones.has(input.timeZone)) throw new Error('Elige una zona horaria IANA válida.');
  for (const value of [input.quietStartMinute, input.quietEndMinute, input.reminderMinute]) if (!Number.isInteger(value) || value < 0 || value >= 1440) throw new Error('Los horarios deben estar entre 00:00 y 23:59.');
  if (typeof input.pushEnabled !== 'boolean' || !Array.isArray(input.enabledKinds) || input.enabledKinds.length > NOTIFICATION_KINDS.length || input.enabledKinds.some((kind) => !(NOTIFICATION_KINDS as readonly string[]).includes(kind))) throw new Error('Preferencias de notificación inválidas.');
  return { ...input, enabledKinds: [...new Set(input.enabledKinds)] };
}
export function validLocalDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T12:00:00Z`)) && new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day;
}
export function addLocalDays(day: string, count: number): string {
  if (!validLocalDay(day) || !Number.isInteger(count)) throw new Error('Fecha local inválida.');
  return new Date(Date.parse(`${day}T12:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
}
/** Solo se ejecuta en navegador/Workers con Intl; el servidor usa validación IANA estática. */
function localClockReader(timeZone: string) {
  if (!zones.has(timeZone)) throw new Error('Zona horaria inválida.');
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return (at: number): { day: string; minute: number } => {
  if (!Number.isFinite(at)) throw new Error('Fecha inválida.');
  const parts = formatter.formatToParts(new Date(at));
  const value = (kind: string) => parts.find((part) => part.type === kind)!.value;
  return { day: `${value('year')}-${value('month')}-${value('day')}`, minute: Number(value('hour')) * 60 + Number(value('minute')) };
  };
}
export function notificationLocalClock(at: number, timeZone: string): { day: string; minute: number } { return localClockReader(timeZone)(at); }
export function isQuietMinute(minute: number, start: number, end: number): boolean {
  return start === end ? false : start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
/** Avanza sobre tiempo real: también respeta saltos y horas repetidas durante DST. */
export function nextNotificationPushAt(at: number, preferences: NotificationPreferencesInput): number {
  notificationPreferences(preferences);
  const clock = localClockReader(preferences.timeZone);
  if (!isQuietMinute(clock(at).minute, preferences.quietStartMinute, preferences.quietEndMinute)) return at;
  let next = Math.ceil(at / 60_000) * 60_000;
  for (let minute = 0; minute <= 26 * 60; minute++, next += 60_000) if (!isQuietMinute(clock(next).minute, preferences.quietStartMinute, preferences.quietEndMinute)) return next;
  throw new Error('No se pudo resolver el descanso en esta zona horaria.');
}
export function reminderCatchupDays(cursor: string | undefined, throughDay: string, limit = 31): string[] {
  if (!validLocalDay(throughDay) || (cursor && !validLocalDay(cursor))) throw new Error('Cursor de recordatorios inválido.');
  const days: string[] = [];
  for (let day = cursor ? addLocalDays(cursor, 1) : throughDay; day <= throughDay && days.length < Math.min(31, Math.max(1, limit)); day = addLocalDays(day, 1)) days.push(day);
  return days;
}
/** Un cumpleaños del 29/2 se recuerda el 28/2 cuando el año no es bisiesto. */
export function birthdayOnLocalDay(month: number, day: number, localDay: string): boolean {
  if (!validLocalDay(localDay)) return false;
  const year = Number(localDay.slice(0, 4)); const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return localDay.slice(5) === `${String(month).padStart(2, '0')}-${String(month === 2 && day === 29 && !leap ? 28 : day).padStart(2, '0')}`;
}
export function notificationRetrySeconds(attempt: number, retryAfter = 0): number { return Math.min(28_800, Math.max(30 * 2 ** Math.min(7, Math.max(0, attempt - 1)), Number.isFinite(retryAfter) ? Math.ceil(retryAfter) : 0)); }
export function notificationDayBounds(day: string, timeZone: string): { startAt: number; endAt: number } {
  if (!validLocalDay(day)) throw new Error('Fecha local inválida.');
  const clock = localClockReader(timeZone);
  const first = (target: string) => {
    const center = Date.parse(`${target}T00:00:00Z`); let low = Math.floor((center - 36 * 3_600_000) / 60_000); let high = Math.ceil((center + 36 * 3_600_000) / 60_000);
    while (low < high) { const middle = Math.floor((low + high) / 2); if (clock(middle * 60_000).day < target) low = middle + 1; else high = middle; }
    return low * 60_000;
  };
  return { startAt: first(day), endAt: first(addLocalDays(day, 1)) };
}
/** Pure validation also runs inside the database runtime, without URL or Intl globals. */
export function validatePushEndpointText(endpoint: string): string {
  if (typeof endpoint !== 'string' || endpoint.length > 4096 || /[\u0000-\u0020\u007f]/.test(endpoint)) throw new Error('Suscripción push inválida.');
  const parsed = /^https:\/\/([a-z0-9.-]+)(\/[^#]*)$/.exec(endpoint);
  if (!parsed) throw new Error('Suscripción push inválida.');
  const host = parsed[1]!; const path = parsed[2]!;
  if (!(host === 'fcm.googleapis.com' && /^\/(fcm\/send|wp)\/.+/.test(path)) && !(host === 'updates.push.services.mozilla.com' && /^\/wpush\/.+/.test(path)) && !(host === 'web.push.apple.com' && path.length > 1) && !(/^[a-z0-9-]+\.notify\.windows\.com$/.test(host) && path.length > 1)) throw new Error('El destino no pertenece a un servicio Web Push autorizado.');
  return endpoint;
}
export function validatePushEndpoint(endpoint: string): URL {
  validatePushEndpointText(endpoint);
  if (endpoint.length > 4096 || /[\u0000-\u0020\u007f]/.test(endpoint)) throw new Error('Suscripción push inválida.');
  let url: URL; try { url = new URL(endpoint); } catch { throw new Error('Suscripción push inválida.'); }
  const google = url.hostname === 'fcm.googleapis.com' && /^\/(fcm\/send|wp)\/.+/.test(url.pathname);
  const mozilla = url.hostname === 'updates.push.services.mozilla.com' && /^\/wpush\/.+/.test(url.pathname);
  const apple = url.hostname === 'web.push.apple.com' && url.pathname.length > 1;
  const windows = /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname) && url.pathname.length > 1;
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !(google || mozilla || apple || windows)) throw new Error('El destino no pertenece a un servicio Web Push autorizado.');
  return url;
}
export function validPushKeys(p256dh: string, auth: string): boolean {
  const encoded = (value: string, size: number) => /^[A-Za-z0-9_-]+$/.test(value) && Math.floor(value.length * 6 / 8) === size;
  return encoded(p256dh, 65) && p256dh.startsWith('B') && encoded(auth, 16);
}
export function notificationRoute(route: string): string {
  if (!/^\/m\/[a-zA-Z0-9_/?=&%-]*$/.test(route) || route.includes('//') || /%2f|%5c/i.test(route) || route.length > 300) throw new Error('Destino de notificación inválido.');
  return route;
}
