import { describe, expect, it } from 'vitest';
import { hasRoyalBanner } from './royalAdmins';

const member = { status: 'active', isCreator: true };

describe('distintivo visual honorífico', () => {
  it.each([
    'Kevin Alcaraz',
    'kevin alcaraz',
    'Kevin Alcáraz',
    'KEVIN ALCARAZ',
  ])('reconoce a %s como destinatario del distintivo', (displayName) => {
    expect(hasRoyalBanner({ ...member, displayName })).toBe(true);
    expect(hasRoyalBanner({ displayName, isCreator: false, status: 'active' })).toBe(true);
    expect(hasRoyalBanner({ ...member, displayName, status: 'removed' })).toBe(false);
  });

  it('no concede el distintivo a otros nombres', () => {
    expect(hasRoyalBanner({ ...member, displayName: 'Luis Flores Bojorquez' })).toBe(false);
    expect(hasRoyalBanner({ ...member, displayName: 'Gamaliel Seefoo' })).toBe(false);
    expect(hasRoyalBanner({ ...member, displayName: 'Christian' })).toBe(false);
    expect(hasRoyalBanner({ ...member, displayName: 'Kevin' })).toBe(false);
    expect(hasRoyalBanner({ ...member, displayName: 'Alcaraz' })).toBe(false);
    expect(hasRoyalBanner({ ...member, displayName: 'Otro usuario' })).toBe(false);
  });
});
