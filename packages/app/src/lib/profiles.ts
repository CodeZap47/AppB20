import type { MemberProfileInput } from '../data/communityTypes';

export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PROFILE_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function profilePhotoError(file: Pick<File, 'type' | 'size'>): string | undefined {
  if (!(PROFILE_PHOTO_TYPES as readonly string[]).includes(file.type)) return 'Elige una imagen PNG, JPEG o WebP.';
  if (!file.size || file.size > PROFILE_PHOTO_MAX_BYTES) return 'La foto debe ocupar entre 1 byte y 5 MiB.';
  return undefined;
}

export const profileList = (text: string): string[] =>
  [...new Set(text.split(/[,\n]/).map((part) => part.trim()).filter(Boolean))];

/** Solo enlaces explícitos, nunca HTML o URLs ejecutables en el portafolio. */
export function cleanPortfolioLinks(links: readonly string[]): string[] {
  return [...new Set(links.map((value) => {
    let url: URL;
    try { url = new URL(value.trim()); } catch { throw new Error('Cada enlace del portafolio debe ser una dirección HTTPS completa.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Usa enlaces HTTPS sin credenciales en el portafolio.');
    return url.href;
  }))];
}

export function cleanMemberProfile(input: MemberProfileInput): MemberProfileInput {
  const text = (value: string, max: number, label: string) => {
    const cleaned = value.trim();
    if (cleaned.length > max) throw new Error(`${label}: el máximo es de ${max} caracteres.`);
    return cleaned;
  };
  const list = (values: string[], label: string) => {
    const cleaned = [...new Set(values.map((value) => text(value, 100, label)).filter(Boolean))];
    if (cleaned.length > 20) throw new Error(`${label}: el máximo es de 20 elementos.`);
    return cleaned;
  };
  if (input.portfolioLinks.length > 10) throw new Error('El máximo es de 10 enlaces de portafolio.');
  return {
    ...input,
    preferredName: text(input.preferredName, 80, 'Nombre preferido'),
    bio: text(input.bio, 1000, 'Presentación'),
    interests: list(input.interests, 'Intereses'),
    learningGoals: text(input.learningGoals, 1000, 'Objetivos de aprendizaje'),
    skills: list(input.skills, 'Temas que puedes explicar'),
    helpTopics: list(input.helpTopics, 'Temas en los que buscas ayuda'),
    subjectIds: [...new Set(input.subjectIds)],
    portfolioLinks: cleanPortfolioLinks(input.portfolioLinks),
  };
}
