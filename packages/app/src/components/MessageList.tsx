import { useEffect, useRef } from 'react';
import type { Id, Member } from '../data/types';
import { formatTime, memberName } from '../lib/format';
import { Avatar } from './Avatar';

interface Message {
  id: Id;
  senderId: Id;
  text: string;
  sentAt: Date;
}

export function MessageList({
  messages,
  members,
  meId,
  empty,
}: {
  messages: Message[];
  members: Member[];
  meId: Id | undefined;
  empty: string;
}) {
  const endRef = useRef<HTMLLIElement>(null);
  useEffect(() => endRef.current?.scrollIntoView?.({ block: 'end' }), [messages.length]);

  if (!messages.length) return <p className="muted">{empty}</p>;

  return (
    <ol className="messages">
      {messages.map((m) => {
        const sender = members.find((x) => x.id === m.senderId);
        return (
          <li key={m.id} className={m.senderId === meId ? 'message message--mine' : 'message'}>
            <Avatar member={sender} size={32} />
            <div>
              <div className="message__meta">
                <strong>{memberName(members, m.senderId)}</strong>{' '}
                <time dateTime={m.sentAt.toISOString()}>{formatTime(m.sentAt)}</time>
              </div>
              <p className="message__text">{m.text}</p>
            </div>
          </li>
        );
      })}
      <li ref={endRef} aria-hidden="true" />
    </ol>
  );
}
