import { currentTerm, isValidPeriod, type TermDates } from '@b20/core';
import type { Id, Term } from '../data/types';
import { toDay } from './format';

/**
 * Respaldo cuando Ajustes aún no tiene fechas: los formularios abren en el cuatrimestre donde
 * publicaste la última vez.
 */
const LAST_PERIOD_KEY = 'b20:ultimo-cuatrimestre';

export function lastPeriod(): number {
  try {
    const period = Number(localStorage.getItem(LAST_PERIOD_KEY));
    return isValidPeriod(period) ? period : 1;
  } catch {
    return 1;
  }
}

export function rememberPeriod(period: number) {
  try {
    localStorage.setItem(LAST_PERIOD_KEY, String(period));
  } catch {
    // Sin almacenamiento local (modo privado): los formularios abrirán en el cuatrimestre 1.
  }
}

/** Cuatrimestre y parcial en que va el grupo hoy, según las fechas configuradas en Ajustes. */
export function currentPlacement(calendar: readonly TermDates[], now = new Date()): TermDates | undefined {
  return currentTerm(calendar, toDay(now));
}

/** El parcial de una materia que ocupa cierta posición (1, 2 o 3), si existe. */
export function termAt(terms: Term[], subjectId: Id, position: number | undefined): Term | undefined {
  return position ? terms.find((t) => t.subjectId === subjectId && t.position === position) : undefined;
}
