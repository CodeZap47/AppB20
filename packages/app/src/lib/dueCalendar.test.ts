import { describe, expect, it } from 'vitest';
import { calendarDays, dayKey, isCalendarDay } from './dueCalendar';
describe('calendario de entregas', () => {
  it('rechaza días imposibles y meses fuera de rango', () => {
    for (const day of [
      '2026-02-29',
      '2026-04-31',
      '2026-13-01',
      '0000-01-01',
      '2026-01-0',
      '',
      undefined,
    ])
      expect(isCalendarDay(day)).toBe(false);
    expect(isCalendarDay('2028-02-29')).toBe(true);
    expect(calendarDays('2026-13')).toEqual([]);
  });
  it('incluye todos los días del mes en semanas de lunes a domingo', () => {
    const days = calendarDays('2026-10');
    expect(days[0]).toBe('2026-09-28');
    expect(days.at(-1)).toBe('2026-11-01');
    expect(days.filter((day) => day.startsWith('2026-10'))).toHaveLength(31);
    expect(days.length % 7).toBe(0);
  });
  it('conserva el día local y el bisiesto en una frontera de mes', () => {
    expect(dayKey(new Date(2026, 9, 22, 0, 1))).toBe('2026-10-22');
    expect(calendarDays('2028-02')).toContain('2028-02-29');
    expect(calendarDays('2026-03')[0]).toBe('2026-02-23');
  });
});
