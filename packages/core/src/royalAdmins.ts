/** Cosmetic recognition only: server-granted creator membership remains mandatory. */
export function hasRoyalBanner(member: {
  displayName: string;
  isCreator: boolean;
  status: string;
}): boolean {
  if (!member.isCreator || member.status !== 'active') return false;
  const name = member.displayName
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  return (
    ['luis flores bojorquez', 'gamaliel seefoo', 'kevin alcaraz'].includes(name) ||
    name === 'christian' ||
    name.startsWith('christian ')
  );
}
