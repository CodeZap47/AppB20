import { isValidPeriod } from '@b20/core';

/** Los formularios abren en el cuatrimestre donde publicaste la última vez. */
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
