import { isValidPeriod, TERMS_PER_PERIOD } from './curriculum';

/**
 * Calendario escolar: las fechas de cada parcial dentro de cada cuatrimestre. Lo configuran
 * los administradores en Ajustes y con él la app sabe en qué cuatrimestre y parcial va el
 * grupo cada día.
 */
export interface TermDates {
  /** Cuatrimestre, de 1 a 9. */
  period: number;
  /** Número de parcial dentro del cuatrimestre, de 1 a 3. */
  term: number;
  /** Primer y último día del parcial, `AAAA-MM-DD`. */
  startDate: string;
  endDate: string;
}

/** Fechas de un parcial tal como se capturan; las dos vacías significan «sin configurar». */
export interface TermDatesInput {
  startDate: string;
  endDate: string;
}

function isRealDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [year = 0, month = 0, date = 0] = day.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  return parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === date;
}

/**
 * Parcial vigente en `today` (`AAAA-MM-DD`): el último que ya empezó. Entre un parcial y el
 * siguiente sigue vigente el anterior; antes del primero configurado no hay ninguno.
 */
export function currentTerm(calendar: readonly TermDates[], today: string): TermDates | undefined {
  return calendar
    .filter((entry) => entry.startDate <= today)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
}

/**
 * Convierte las fechas capturadas para un cuatrimestre (una posición por parcial) en entradas
 * del calendario, o explica por qué no pueden guardarse. `others` son los demás cuatrimestres.
 */
export function buildPeriodCalendar(
  period: number,
  terms: readonly TermDatesInput[],
  others: readonly TermDates[],
): { entries: TermDates[] } | { problem: string } {
  if (!isValidPeriod(period)) return { problem: 'El cuatrimestre no existe.' };
  if (terms.length !== TERMS_PER_PERIOD) {
    return { problem: `Cada cuatrimestre tiene ${TERMS_PER_PERIOD} parciales.` };
  }
  const entries: TermDates[] = [];
  for (const [index, { startDate, endDate }] of terms.entries()) {
    const term = index + 1;
    if (!startDate && !endDate) continue;
    if (!isRealDay(startDate) || !isRealDay(endDate)) {
      return { problem: `Al parcial ${term} le falta la fecha de inicio o la de fin.` };
    }
    if (startDate > endDate) {
      return { problem: `El parcial ${term} no puede terminar antes de empezar.` };
    }
    const previous = entries.at(-1);
    if (previous && previous.endDate >= startDate) {
      return { problem: `El parcial ${term} debe empezar después de que termine el parcial ${previous.term}.` };
    }
    const clash = others.find(
      (other) => other.period !== period && startDate <= other.endDate && other.startDate <= endDate,
    );
    if (clash) {
      return {
        problem: `El parcial ${term} se encima con el parcial ${clash.term} del cuatrimestre ${clash.period}.`,
      };
    }
    entries.push({ period, term, startDate, endDate });
  }
  return { entries };
}
