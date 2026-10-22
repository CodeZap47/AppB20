import { describe, expect, it } from 'vitest';
import { hasRoyalBanner } from './royalAdmins';
const creator = { status: 'active', isCreator: true };
describe('distintivo de administración', () => {
  it.each([
    'Luis Flores Bojorquez',
    'Luis Flores Bojórquez',
    'Gamaliel Seefoo',
    'Christian',
    'Christian Apellido',
    'Kevin Alcaraz',
  ])('reconoce a %s solo como creador activo', (displayName) => {
    expect(hasRoyalBanner({ ...creator, displayName })).toBe(true);
    expect(hasRoyalBanner({ ...creator, displayName, isCreator: false })).toBe(false);
    expect(hasRoyalBanner({ ...creator, displayName, status: 'removed' })).toBe(false);
  });
  it('no concede el banner por nombres parciales o por el apodo público', () => {
    expect(hasRoyalBanner({ ...creator, displayName: 'Luis' })).toBe(false);
    expect(hasRoyalBanner({ ...creator, displayName: 'Christianity' })).toBe(false);
    expect(hasRoyalBanner({ ...creator, displayName: 'Otro administrador' })).toBe(false);
  });
});
