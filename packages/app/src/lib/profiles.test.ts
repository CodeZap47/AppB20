import { describe, expect, it } from 'vitest';
import { cleanMemberProfile, cleanPortfolioLinks, PROFILE_PHOTO_MAX_BYTES, profileList, profilePhotoError } from './profiles';

describe('presentación voluntaria del perfil', () => {
  it('admite un perfil vacío y limpia listas sin inventar datos', () => {
    const input = { preferredName: '', bio: '', interests: [], learningGoals: '', skills: [], helpTopics: [], portfolioLinks: [], subjectIds: [], expectedVersion: 0 };
    expect(cleanMemberProfile(input)).toEqual(input);
    expect(profileList('Rust, Bases de datos\nRust, ')).toEqual(['Rust', 'Bases de datos']);
    expect(cleanMemberProfile({ ...input, preferredName: '  Luis ', subjectIds: ['s1', 's1'], interests: [' Rust ', 'Rust'] })).toMatchObject({ preferredName: 'Luis', subjectIds: ['s1'], interests: ['Rust'] });
  });

  it('impide enlaces ejecutables, credenciales y fotos fuera de los límites', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,test', 'http://example.com', 'https://user:secret@example.com', '/relative']) expect(() => cleanPortfolioLinks([url])).toThrow();
    expect(cleanPortfolioLinks(['https://example.com', 'https://example.com/'])).toEqual(['https://example.com/']);
    expect(profilePhotoError({ type: 'image/svg+xml', size: 100 })).toBeDefined();
    expect(profilePhotoError({ type: 'image/png', size: 0 })).toBeDefined();
    expect(profilePhotoError({ type: 'image/png', size: PROFILE_PHOTO_MAX_BYTES + 1 })).toBeDefined();
    expect(profilePhotoError({ type: 'image/webp', size: PROFILE_PHOTO_MAX_BYTES })).toBeUndefined();
  });
});
