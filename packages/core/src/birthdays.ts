/**
 * Cumpleaños compartidos voluntariamente (sección 3.10): solo día y mes, nunca el año.
 */

export interface SharedBirthday {
  day: number;
  month: number;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function isValidBirthday({ day, month }: SharedBirthday): boolean {
  if (!Number.isInteger(day) || !Number.isInteger(month)) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= (DAYS_IN_MONTH[month - 1] ?? 0);
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Fecha en que se celebra en un año dado. El 29 de febrero se recorre al 28 en años no
 * bisiestos; es un criterio provisional (pendiente en la sección 9).
 */
export function celebrationDate(birthday: SharedBirthday, year: number): Date {
  const { month } = birthday;
  let { day } = birthday;
  if (month === 2 && day === 29 && !isLeapYear(year)) day = 28;
  return new Date(year, month - 1, day);
}

/** Próxima celebración a partir de `from` (incluye el mismo día). */
export function nextCelebration(birthday: SharedBirthday, from: Date): Date {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const thisYear = celebrationDate(birthday, today.getFullYear());
  return thisYear >= today ? thisYear : celebrationDate(birthday, today.getFullYear() + 1);
}

/** Días completos de `from` a la próxima celebración (0 si es hoy). */
export function daysUntil(birthday: SharedBirthday, from: Date): number {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((nextCelebration(birthday, today).getTime() - today.getTime()) / 86_400_000);
}

/**
 * Semanas completas, de domingo a sábado, que cubren un mes (`month` de 1 a 12), para pintarlo
 * como calendario. Incluye los días del mes anterior y del siguiente que rellenan los extremos.
 */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month - 1, 1);
  const start = new Date(year, month - 1, 1 - first.getDay());
  const last = new Date(year, month, 0);
  const total = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;
  return Array.from(
    { length: total },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}
