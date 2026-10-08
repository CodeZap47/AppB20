import type { Member } from '../data/types';
import { initials } from '../lib/format';

export function Avatar({ member, size = 36 }: { member: Member | undefined; size?: number }) {
  const name = member?.displayName ?? '?';
  return member?.photoUrl ? (
    <img className="avatar" src={member.photoUrl} alt="" width={size} height={size} />
  ) : (
    <span className="avatar" style={{ width: size, height: size }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
