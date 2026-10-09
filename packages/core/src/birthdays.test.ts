import { describe, expect, it } from 'vitest';
import { daysUntil, isValidBirthday, monthGrid, nextCelebration } from './birthdays';
import { canReadDirectConversation } from './permissions';

describe('cumpleaños', () => {
  it('valida día y mes', () => {
    expect(isValidBirthday({ day: 29, month: 2 })).toBe(true);
    expect(isValidBirthday({ day: 31, month: 4 })).toBe(false);
    expect(isValidBirthday({ day: 0, month: 1 })).toBe(false);
  });

  it('recorre el 29 de febrero al 28 en años no bisiestos', () => {
    const next = nextCelebration({ day: 29, month: 2 }, new Date(2027, 0, 10));
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(28);
  });

  it('pasa al año siguiente si ya pasó', () => {
    const next = nextCelebration({ day: 1, month: 3 }, new Date(2026, 9, 8));
    expect(next.getFullYear()).toBe(2027);
  });

  it('cuenta los días que faltan', () => {
    expect(daysUntil({ day: 9, month: 10 }, new Date(2026, 9, 9, 22))).toBe(0);
    expect(daysUntil({ day: 22, month: 10 }, new Date(2026, 9, 9))).toBe(13);
    expect(daysUntil({ day: 8, month: 10 }, new Date(2026, 9, 9))).toBe(364);
  });

  it('arma el mes en semanas de domingo a sábado', () => {
    // Octubre de 2026 empieza en jueves y termina en sábado: 5 semanas.
    const days = monthGrid(2026, 10);
    expect(days).toHaveLength(35);
    expect(days[0]?.getDay()).toBe(0);
    expect(days[0]?.getDate()).toBe(27);
    expect(days[4]?.getDate()).toBe(1);
    expect(days.at(-1)?.getDate()).toBe(31);
    // Febrero de 2026 empieza en domingo y dura justo 4 semanas.
    expect(monthGrid(2026, 2)).toHaveLength(28);
  });
});

describe('permisos', () => {
  it('un tercero no lee una conversación 1 a 1', () => {
    expect(canReadDirectConversation('c', ['a', 'b'])).toBe(false);
    expect(canReadDirectConversation('a', ['a', 'b'])).toBe(true);
  });
});
