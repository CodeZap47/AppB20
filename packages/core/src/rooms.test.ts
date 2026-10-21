import { describe, expect, it } from 'vitest';
import { roomRemainingMs, roomStatusLabel, roomTimerMinutesError, studyRoomFieldsError } from './rooms';

const fields = { title: 'Sala', topic: 'Decisiones', objective: 'Explicar una condición', startsAt: new Date('2026-10-21T12:00:00Z'), endsAt: new Date('2026-10-21T13:00:00Z') };
describe('Reglas de salas de estudio', () => {
  it('valida textos, horarios locales convertidos a UTC y cupos enteros', () => {
    expect(studyRoomFieldsError(fields)).toBeUndefined();
    expect(studyRoomFieldsError({ ...fields, title: ' ' })).toContain('título');
    expect(studyRoomFieldsError({ ...fields, endsAt: fields.startsAt })).toContain('posterior');
    expect(studyRoomFieldsError({ ...fields, startsAt: new Date('invalid') })).toContain('horario');
    for (const capacity of [0, -1, 1.5, Infinity, 10_001]) expect(studyRoomFieldsError({ ...fields, capacity })).toContain('cupo');
    expect(studyRoomFieldsError({ ...fields, capacity: 1 })).toBeUndefined();
  });
  it('calcula tiempo sin escrituras periódicas ni avances automáticos de fase', () => {
    const timer = { state: 'running', remainingMs: 60_000, startedAt: fields.startsAt };
    expect(roomRemainingMs(timer, fields.startsAt.getTime() + 15_000)).toBe(45_000);
    expect(roomRemainingMs(timer, fields.startsAt.getTime() + 90_000)).toBe(0);
    expect(roomRemainingMs(timer, fields.startsAt.getTime() - 10_000)).toBe(60_000);
    expect(roomRemainingMs({ ...timer, state: 'paused' }, fields.endsAt)).toBe(60_000);
  });
  it('limita los bloques y da nombres públicos a los estados', () => {
    expect(roomTimerMinutesError(25, 5)).toBeUndefined();
    for (const minutes of [0, 181, 1.5, NaN]) expect(roomTimerMinutesError(minutes, 5)).toBeDefined();
    expect(roomStatusLabel('active')).toBe('En curso');
  });
});
