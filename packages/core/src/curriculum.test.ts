import { describe, expect, it } from 'vitest';
import { CURRICULUM, isValidPeriod, PERIOD_COUNT, termNames } from './curriculum';

describe('plan de estudios', () => {
  it('tiene nueve cuatrimestres de cinco materias', () => {
    expect(CURRICULUM).toHaveLength(45);
    for (let period = 1; period <= PERIOD_COUNT; period++) {
      expect(CURRICULUM.filter((s) => s.period === period)).toHaveLength(5);
    }
  });

  it('no repite claves ni nombres', () => {
    expect(new Set(CURRICULUM.map((s) => s.code)).size).toBe(45);
    expect(new Set(CURRICULUM.map((s) => s.name)).size).toBe(45);
  });

  it('cada materia se divide en tres parciales', () => {
    expect(termNames()).toEqual(['Parcial 1', 'Parcial 2', 'Parcial 3']);
  });

  it('solo acepta cuatrimestres del 1 al 9', () => {
    expect([0, 1, 9, 10, 1.5].map(isValidPeriod)).toEqual([false, true, true, false, false]);
  });
});
