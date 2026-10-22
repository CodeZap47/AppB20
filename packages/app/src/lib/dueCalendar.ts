export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isCalendarDay(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** Monday-first month grid, using local civil days rather than UTC to avoid timezone drift. */
export function calendarDays(monthKey: string): string[] {
  if (!isCalendarDay(`${monthKey}-01`)) return [];
  const [year = 0, month = 0] = monthKey.split('-').map(Number);
  const first = new Date(year, month - 1, 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const count = Math.ceil((offset + new Date(year, month, 0, 12).getDate()) / 7) * 7;
  return Array.from({ length: count }, (_, index) =>
    dayKey(new Date(year, month - 1, 1 - offset + index, 12)),
  );
}
