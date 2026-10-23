/** Distintivo visual honorífico exclusivo para Kevin Alcaraz (no concede permisos). */
export function hasRoyalBanner(member: {
  displayName: string;
  isCreator?: boolean;
  status?: string;
}): boolean {
  if (member.status && member.status !== 'active') return false;
  const name = member.displayName
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  return name === 'kevin alcaraz';
}
