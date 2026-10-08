import type { Member } from '../data/types';
import { Avatar } from './Avatar';

/** Fotos encimadas de varias personas; a partir de `max` muestra «+N». */
export function AvatarStack({
  members,
  size = 24,
  max = 3,
}: {
  members: (Member | undefined)[];
  size?: number;
  max?: number;
}) {
  const shown = members.length > max ? members.slice(0, max - 1) : members;
  const extra = members.length - shown.length;
  return (
    <span className="avatar-stack" aria-hidden="true">
      {shown.map((m, i) => (
        <Avatar key={m?.id ?? i} member={m} size={size} />
      ))}
      {extra > 0 && (
        <span className="avatar avatar--more" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
          +{extra}
        </span>
      )}
    </span>
  );
}
