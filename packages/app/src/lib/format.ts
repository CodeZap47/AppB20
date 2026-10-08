import type { Id, Member } from '../data/types';

const timeFormat = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' });
const dayMonthFormat = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long' });

export function formatTime(date: Date, now = new Date()): string {
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay ? timeFormat.format(date) : `${dateFormat.format(date)} ${timeFormat.format(date)}`;
}

export function formatDate(date: Date): string {
  return dateFormat.format(date);
}

const weekdayFormat = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
const fullDateFormat = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

const mediumDateFormat = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

/** «6 oct 2026», para fichas de detalle donde el año importa. */
export function formatMediumDate(date: Date): string {
  return mediumDateFormat.format(date);
}

/** Días de calendario transcurridos entre `date` y `now` (0 = hoy, 1 = ayer). */
function daysAgo(date: Date, now: Date): number {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((start(now) - start(date)) / 86_400_000);
}

/** Solo la hora, para mensajes que ya están bajo un separador de día. */
export function formatClock(date: Date): string {
  return timeFormat.format(date);
}

/** Separador de día en un chat: «Hoy», «Ayer», «Lunes, 5 de octubre» o la fecha con año. */
export function formatDayLabel(date: Date, now = new Date()): string {
  const days = daysAgo(date, now);
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  const label =
    date.getFullYear() === now.getFullYear() ? weekdayFormat.format(date) : fullDateFormat.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Fecha compacta para listas: la hora si es de hoy, «Ayer» o el día y el mes. */
export function formatListTime(date: Date, now = new Date()): string {
  const days = daysAgo(date, now);
  if (days === 0) return timeFormat.format(date);
  if (days === 1) return 'Ayer';
  return dateFormat.format(date);
}

/** «15 de noviembre»; el año nunca se muestra en cumpleaños. */
export function formatDayMonth(day: number, month: number): string {
  return dayMonthFormat.format(new Date(2000, month - 1, day));
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Convierte «AAAA-MM-DD» en una fecha local, sin el desfase de leerla como UTC. */
export function parseDay(day: string): Date {
  const [year = 1970, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
}

/** Fecha local como «AAAA-MM-DD», el formato de los campos de fecha. */
export function toDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const monthFormat = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' });
const shortMonthFormat = new Intl.DateTimeFormat('es-MX', { month: 'short' });
const longDayFormat = new Intl.DateTimeFormat('es-MX', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** «Octubre de 2026». */
export function formatMonth(date: Date): string {
  return capitalize(monthFormat.format(date));
}

/** «oct», para el recuadro de fecha de una lista. */
export function formatShortMonth(date: Date): string {
  return shortMonthFormat.format(date).replace('.', '');
}

/** «Martes, 6 de octubre de 2026». */
export function formatLongDay(date: Date): string {
  return capitalize(longDayFormat.format(date));
}

const peopleFormat = new Intl.ListFormat('es', { style: 'long', type: 'conjunction' });

/** Lista completa de nombres: «Tú, Ana López y Luis Pérez». Quien mira va primero. */
export function peopleList(ids: Id[], members: Member[], meId?: Id): string {
  const ordered = [...ids].sort((a, b) => Number(b === meId) - Number(a === meId));
  return peopleFormat.format(ordered.map((id) => (id === meId ? 'Tú' : memberName(members, id))));
}

export function memberName(members: Member[], id: Id): string {
  return members.find((m) => m.id === id)?.displayName ?? 'Miembro desconocido';
}

/** Iniciales de la primera y la última palabra: «Ana López Ruiz» → «AR». */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Tono estable (0-359) a partir de un id, para que cada persona tenga su color. */
export function hueOf(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Mezcla final: sin ella, ids casi iguales («demo-1», «demo-2») caen en tonos vecinos.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) % 360;
}
