import { describe, expect, it } from 'vitest';
import { isValidBirthday, nextCelebration } from './birthdays';
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
});

describe('permisos', () => {
  it('un tercero no lee una conversación 1 a 1', () => {
    expect(canReadDirectConversation('c', ['a', 'b'])).toBe(false);
    expect(canReadDirectConversation('a', ['a', 'b'])).toBe(true);
  });
});
