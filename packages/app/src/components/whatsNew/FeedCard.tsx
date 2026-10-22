import { useState } from 'react';
import { Link } from 'react-router';
import { FEED_LIMITS } from '@b20/core';
import { useDataSource } from '../../data/DataContext';
import type { FeedComment, FeedPost, FeedReaction, Member, Subject } from '../../data/types';
import { formatClock, memberName } from '../../lib/format';
import { NEWS_LABEL, type NewsItem } from '../../lib/whatsNew';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { useAction } from '../useAction';
import { CommentThread } from './CommentThread';
import { ReactionBar } from './ReactionBar';
import { relativeTime } from './shared';

interface Props {
  item: NewsItem;
  members: Member[];
  subjects: Subject[];
  me: Member | undefined;
  isNew: boolean;
  now: Date;
  reactions: FeedReaction[];
  /** Solo si el aviso es una publicación del feed. */
  post?: FeedPost;
  comments: FeedComment[];
  highlighted?: boolean;
}

/** Una novedad como publicación: autor, vista previa, materia, reacciones y, si es un post, comentarios. */
export function FeedCard({ item, members, subjects, me, isNew, now, reactions, post, comments, highlighted }: Props) {
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const subject = subjects.find((s) => s.id === item.subjectId);
  const mine = item.actorId === me?.id;
  const when = relativeTime(item.at, now) ?? formatClock(item.at);
  const ranking = item.kind === 'ranking';
  const target = item.target;
  const classes = ['feed-card', 'panel', isNew && 'feed-card--pending', highlighted && 'feed-card--highlighted', ranking && 'feed-card--ranking'].filter(Boolean).join(' ');

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!post) return;
    const ok = await run(async () => { await source.editFeedPost({ postId: post.id, text: draft }); return true; });
    if (ok) setEditing(false);
  };

  return (
    <article className={classes} id={post ? `publicacion-${post.id}` : undefined} aria-label={`${memberName(members, item.actorId)} ${item.text}`}>
      <header className="feed-card__head">
        <span className="feed-card__avatar">
          <Avatar member={members.find((m) => m.id === item.actorId)} size={40} />
          {ranking && <span className="feed-card__trophy" aria-hidden="true">🏆</span>}
        </span>
        <div className="feed-card__who">
          <span>
            <strong>{mine ? 'Tú' : memberName(members, item.actorId)}</strong>{' '}
            <span className="feed-card__action">{mine && item.selfText ? item.selfText : item.text}</span>
          </span>
          <span className="feed-card__meta">
            <time dateTime={item.at.toISOString()}>{when}</time>
            {post?.editedAt && <span> · editada</span>}
            <span> · {subject?.name ?? 'Grupo'}</span>
          </span>
        </div>
        {isNew && <span className="news-item__dot" role="img" aria-label="Pendiente" />}
        <span className={`badge news-kind news-kind--${item.kind}`}>{NEWS_LABEL[item.kind]}</span>
      </header>

      {editing && post ? (
        <form className="feed-card__edit" onSubmit={save}>
          <textarea aria-label="Editar publicación" rows={3} maxLength={FEED_LIMITS.post + 50} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="row">
            <button type="submit" disabled={pending || !draft.trim()}>Guardar</button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        </form>
      ) : post ? (
        <p className="feed-card__text">{post.text}</p>
      ) : (
        item.preview && <p className="feed-card__preview">{item.preview}</p>
      )}

      <footer className="feed-card__foot">
        {target && (
          <ReactionBar
            reactions={reactions}
            members={members}
            meId={me?.id}
            disabled={pending}
            onReact={(emoji) => void run(() => source.toggleFeedReaction({ targetKind: target.kind, targetId: target.id, emoji }))}
          />
        )}
        <div className="feed-card__tools">
          {post && mine && !editing && (
            <button type="button" className="icon-button" aria-label="Editar publicación" onClick={() => { setDraft(post.text); setEditing(true); }}>
              <Icon name="edit" size={16} />
            </button>
          )}
          {post && (mine || me?.isCreator) && (
            <button
              type="button"
              className="icon-button"
              aria-label="Eliminar publicación"
              disabled={pending}
              onClick={() => { if (confirm('¿Eliminar esta publicación? También se borran sus comentarios y reacciones.')) void run(() => source.deleteFeedPost({ postId: post.id })); }}
            >
              <Icon name="trash" size={16} />
            </button>
          )}
          {!post && (
            <Link to={item.link} className="feed-card__open">
              {ranking ? 'Ver ranking' : 'Abrir'} <Icon name="forward" size={14} />
            </Link>
          )}
        </div>
      </footer>
      {error && <p className="error" role="alert">{error}</p>}

      {post && <CommentThread post={post} comments={comments} members={members} me={me} />}
    </article>
  );
}
