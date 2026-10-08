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

/** «15 de noviembre»; el año nunca se muestra en cumpleaños. */
export function formatDayMonth(day: number, month: number): string {
  return dayMonthFormat.format(new Date(2000, month - 1, day));
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
