import { formatDayLabel } from '../../lib/format';
import type { NewsItem } from '../../lib/whatsNew';

export function dueLabel(days: number): string {
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  return `En ${days} días`;
}

/** Agrupa por día para poner separadores como en un chat: «Hoy», «Ayer», «Lunes, 5 de octubre». */
export function byDay(items: NewsItem[]) {
  const groups: { label: string; items: NewsItem[] }[] = [];
  for (const item of items) {
    const label = formatDayLabel(item.at);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/** «hace un momento», «hace 5 min», «hace 3 h»; con más de un día basta el separador del día. */
export function relativeTime(date: Date, now: Date): string | undefined {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  if (minutes < 24 * 60) return `hace ${Math.floor(minutes / 60)} h`;
  return undefined;
}
