import { useRef, useState } from 'react';
import { FEED_LIMITS } from '@b20/core';
import { useDataSource, useSnapshot } from '../../data/DataContext';
import type { FeedComment, Member, FeedPost } from '../../data/types';
import { formatClock, memberName } from '../../lib/format';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { useAction } from '../useAction';

const VISIBLE = 2;

interface Props {
  post: FeedPost;
  comments: FeedComment[];
  members: Member[];
  me: Member | undefined;
}

/** Comentarios de una publicación: se ven los últimos y el resto al pedirlo. */
export function CommentThread({ post, comments, members, me }: Props) {
  const source = useDataSource();
  const { connection } = useSnapshot();
  const lock = useRef(false);
  const { error, pending, run } = useAction();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const sorted = [...comments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const shown = open ? sorted : sorted.slice(-VISIBLE);
  const canDelete = (c: FeedComment) => c.authorId === me?.id || post.authorId === me?.id || Boolean(me?.isCreator);
  const writable = connection === 'ready' && me?.status === 'active';
  const remove = async (commentId: string) => {
    if (lock.current || !writable || !confirm('¿Eliminar este comentario?')) return;
    lock.current = true;
    try { await run(() => source.deleteFeedComment({ commentId })); }
    finally { lock.current = false; }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (lock.current || connection !== 'ready' || me?.status !== 'active' || !text.trim()) return;
    lock.current = true;
    try {
      const ok = await run(async () => { await source.commentFeedPost({ postId: post.id, text, requestId }); return true; });
      if (ok) { setText(''); setRequestId(crypto.randomUUID()); }
    } finally { lock.current = false; }
  };

  return (
    <div className="comments">
      {sorted.length > VISIBLE && !open && (
        <button type="button" className="link-button" onClick={() => setOpen(true)}>
          Ver los {sorted.length} comentarios
        </button>
      )}
      {shown.length > 0 && (
        <ul className="comments__list">
          {shown.map((c) => (
            <li key={c.id} className="comment">
              <Avatar member={members.find((m) => m.id === c.authorId)} size={28} />
              <div className="comment__bubble">
                <span className="comment__head">
                  <strong>{memberName(members, c.authorId)}</strong>
                  <time className="muted" dateTime={c.createdAt.toISOString()}>{formatClock(c.createdAt)}</time>
                </span>
                <span className="comment__text">{c.text}</span>
              </div>
              {canDelete(c) && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Eliminar comentario"
                  disabled={pending || !writable}
                  onClick={() => void remove(c.id)}
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="comment-form" onSubmit={submit}>
        <Avatar member={me} size={28} />
        <input
          aria-label="Escribe un comentario"
          placeholder="Escribe un comentario…"
          maxLength={FEED_LIMITS.comment}
          value={text}
          disabled={pending || connection !== 'ready'}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="secondary" disabled={pending || connection !== 'ready' || !text.trim()}>Comentar</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
