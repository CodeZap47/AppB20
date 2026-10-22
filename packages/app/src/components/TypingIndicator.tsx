import { useEffect, useState } from 'react';
import { useSnapshot } from '../data/DataContext';
import type { MessageScope } from '../data/types';

export function TypingIndicator({
  scope,
  conversationId,
}: {
  scope: MessageScope;
  conversationId: string;
}) {
  const { me, members, typingPresence = [], blockedMembers } = useSnapshot();
  const [now, setNow] = useState(Date.now);
  const candidates = typingPresence.filter(
    (row) =>
      row.scope === scope && row.conversationId === conversationId && row.memberId !== me?.id,
  );
  const hasCandidates = candidates.length > 0;
  useEffect(() => {
    if (!hasCandidates) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasCandidates, scope, conversationId]);
  const ids = new Set(
    candidates
      .filter(
        (row) =>
          row.expiresAt.getTime() > now &&
          !blockedMembers.some((blocked) => blocked.memberId === row.memberId),
      )
      .map((row) => row.memberId),
  );
  const names = members
    .filter((member) => ids.has(member.id) && member.status === 'active')
    .map((member) => member.displayName.split(' ')[0]);
  const text =
    names.length > 2
      ? `${names[0]}, ${names[1]} y ${names.length - 2} más están escribiendo…`
      : names.length === 2
        ? `${names[0]} y ${names[1]} están escribiendo…`
        : names.length === 1
          ? `${names[0]} está escribiendo…`
          : '';
  return (
    <div className="typing-indicator" role="status" aria-live="polite" aria-atomic="true">
      {text && (
        <>
          <span className="typing-indicator__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>{text}</span>
        </>
      )}
    </div>
  );
}
