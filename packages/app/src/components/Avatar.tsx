import type { CSSProperties } from 'react';
import type { Member } from '../data/types';
import { hueOf, initials } from '../lib/format';

export function Avatar({ member, size = 36 }: { member: Member | undefined; size?: number }) {
  const name = member?.displayName ?? '?';
  return member?.photoUrl ? (
    <img className="avatar" src={member.photoUrl} alt="" width={size} height={size} />
  ) : (
    <span
      className="avatar"
      style={
        {
          width: size,
          height: size,
          fontSize: Math.max(11, Math.round(size * 0.38)),
          '--hue': member ? hueOf(member.id) : undefined,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
