import { useState } from 'react';
import { FEED_REACTIONS, type FeedReactionEmoji } from '@b20/core';
import type { FeedReaction, Id, Member } from '../../data/types';
import { peopleList } from '../../lib/format';
import { Icon } from '../Icon';

interface Props {
  reactions: FeedReaction[];
  members: Member[];
  meId: Id | undefined;
  disabled?: boolean;
  onReact: (emoji: FeedReactionEmoji) => void;
}

/** Conteo por emoji (el tuyo resaltado) y un selector con la lista cerrada de reacciones. */
export function ReactionBar({ reactions, members, meId, disabled, onReact }: Props) {
  const [picking, setPicking] = useState(false);
  const mine = reactions.find((r) => r.memberId === meId)?.emoji;
  const counts = FEED_REACTIONS.map((emoji) => ({ emoji, people: reactions.filter((r) => r.emoji === emoji).map((r) => r.memberId) }))
    .filter((c) => c.people.length > 0);
  const react = (emoji: FeedReactionEmoji) => { if (disabled) return; setPicking(false); onReact(emoji); };

  return (
    <div className="reactions">
      {counts.map(({ emoji, people }) => (
        <button
          key={emoji}
          type="button"
          className="reaction"
          aria-pressed={mine === emoji}
          title={peopleList(people, members, meId)}
          aria-label={`${emoji} ${people.length}: ${peopleList(people, members, meId)}`}
          disabled={disabled}
          onClick={() => react(emoji)}
        >
          <span aria-hidden="true">{emoji}</span> {people.length}
        </button>
      ))}
      <button
        type="button"
        className="reaction reaction--add"
        aria-expanded={picking}
        aria-label="Reaccionar"
        disabled={disabled}
        onClick={() => setPicking((v) => !v)}
      >
        <Icon name="smile" size={16} />
      </button>
      {picking && (
        <div className="reaction-picker" role="group" aria-label="Elige una reacción">
          {FEED_REACTIONS.map((emoji) => (
            <button key={emoji} type="button" disabled={disabled} aria-pressed={mine === emoji} onClick={() => react(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
