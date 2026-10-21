import { describe, expect, it } from 'vitest';
import { nextSpacedSchedule, SPACED_DAY_MS, SPACED_INTERVAL_DAYS, spacedCardError } from './spaced';

describe('programación de repaso espaciado', () => {
  const now = Date.parse('2026-10-21T18:23:00Z');
  it('avanza por 1, 3, 7, 14, 30, 60 y 120 días y conserva el máximo', () => {
    for (let step = 0; step <= SPACED_INTERVAL_DAYS.length; step++) {
      const next = nextSpacedSchedule(step, 'remembered', now);
      expect(next).toEqual({ step: Math.min(step + 1, 7),
        dueAt: now + SPACED_INTERVAL_DAYS[Math.min(step, 6)]! * SPACED_DAY_MS });
    }
  });
  it('una pista espera un día sin avanzar; volver a estudiar reinicia en diez minutos', () => {
    expect(nextSpacedSchedule(4, 'hint', now)).toEqual({ step: 4, dueAt: now + SPACED_DAY_MS });
    expect(nextSpacedSchedule(4, 'again', now)).toEqual({ step: 0, dueAt: now + 600_000 });
    expect(nextSpacedSchedule(0, 'hint', now)).toEqual({ step: 0, dueAt: now + SPACED_DAY_MS });
  });
  it('usa tiempo transcurrido incluso durante el cambio de horario', () => {
    const before = Date.parse('2026-11-01T08:30:00Z');
    expect(nextSpacedSchedule(0, 'remembered', before).dueAt - before).toBe(86_400_000);
  });
  it.each([-1, 8, NaN, 1.5])('rechaza progreso inválido %s', (step) => {
    expect(() => nextSpacedSchedule(step, 'remembered', now)).toThrow();
  });
  it('exige pregunta y explicación, limita textos y permite omitir pista', () => {
    expect(spacedCardError({ question: '¿Qué es una variable?', explanation: 'Un nombre asociado a un valor.', hint: '' })).toBeUndefined();
    expect(spacedCardError({ question: ' ', explanation: 'Respuesta', hint: '' })).toContain('pregunta');
    expect(spacedCardError({ question: 'Pregunta', explanation: '', hint: '' })).toContain('explicación');
    expect(spacedCardError({ question: 'x'.repeat(1001), explanation: 'Respuesta', hint: '' })).toContain('1000');
    expect(spacedCardError({ question: 'Pregunta', explanation: 'Respuesta', hint: 'x'.repeat(2001) })).toContain('2000');
  });
});
