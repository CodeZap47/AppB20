import { describe, expect, it } from 'vitest';
import { buildPeriodCalendar, currentTerm, type TermDates } from './calendar';

const calendar: TermDates[] = [
  { period: 1, term: 1, startDate: '2026-09-01', endDate: '2026-09-30' },
  { period: 1, term: 2, startDate: '2026-10-05', endDate: '2026-10-30' },
  { period: 1, term: 3, startDate: '2026-11-02', endDate: '2026-12-04' },
  { period: 2, term: 1, startDate: '2027-01-11', endDate: '2027-02-12' },
];
const at = (day: string) => {
  const found = currentTerm(calendar, day);
  return found && `${found.period}.${found.term}`;
};

describe('currentTerm', () => {
  it('es el parcial que contiene la fecha, incluidos su primer y último día', () => {
    expect(at('2026-09-01')).toBe('1.1');
    expect(at('2026-10-08')).toBe('1.2');
    expect(at('2026-12-04')).toBe('1.3');
  });

  it('cambia justo el día en que empieza el siguiente parcial', () => {
    expect(at('2026-10-04')).toBe('1.1');
    expect(at('2026-10-05')).toBe('1.2');
    expect(at('2027-01-10')).toBe('1.3');
    expect(at('2027-01-11')).toBe('2.1');
  });

  it('no hay parcial vigente antes del primero configurado', () => {
    expect(at('2026-08-31')).toBeUndefined();
    expect(currentTerm([], '2026-10-08')).toBeUndefined();
  });
});

describe('buildPeriodCalendar', () => {
  const none = { startDate: '', endDate: '' };
  const others = calendar.filter((entry) => entry.period !== 2);

  it('guarda solo los parciales con fechas y deja pendientes los vacíos', () => {
    expect(
      buildPeriodCalendar(2, [{ startDate: '2027-01-11', endDate: '2027-02-12' }, none, none], others),
    ).toEqual({ entries: [{ period: 2, term: 1, startDate: '2027-01-11', endDate: '2027-02-12' }] });
    expect(buildPeriodCalendar(2, [none, none, none], others)).toEqual({ entries: [] });
  });

  it('rechaza fechas incompletas, invertidas o que no existen', () => {
    const problem = (first: { startDate: string; endDate: string }) => {
      const result = buildPeriodCalendar(2, [first, none, none], others);
      return 'problem' in result ? result.problem : undefined;
    };
    expect(problem({ startDate: '2027-01-11', endDate: '' })).toContain('le falta');
    expect(problem({ startDate: '2027-02-12', endDate: '2027-01-11' })).toContain('antes de empezar');
    expect(problem({ startDate: '2027-02-30', endDate: '2027-03-05' })).toContain('le falta');
  });

  it('exige que los parciales vayan en orden y no se encimen', () => {
    const result = buildPeriodCalendar(
      2,
      [
        { startDate: '2027-01-11', endDate: '2027-02-12' },
        { startDate: '2027-02-12', endDate: '2027-03-12' },
        none,
      ],
      others,
    );
    expect(result).toEqual({ problem: 'El parcial 2 debe empezar después de que termine el parcial 1.' });
  });

  it('rechaza encimarse con otro cuatrimestre', () => {
    const result = buildPeriodCalendar(2, [{ startDate: '2026-12-01', endDate: '2026-12-20' }, none, none], others);
    expect(result).toEqual({ problem: 'El parcial 1 se encima con el parcial 3 del cuatrimestre 1.' });
  });

  it('rechaza un cuatrimestre que no existe o un número distinto de parciales', () => {
    expect(buildPeriodCalendar(10, [none, none, none], [])).toHaveProperty('problem');
    expect(buildPeriodCalendar(1, [none], [])).toHaveProperty('problem');
  });
});
