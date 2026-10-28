import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { FEED_LIMITS, type ExamSummary } from '@b20/core';
import { useDataSource } from '../../data/DataContext';
import type { FeedComment, FeedPost, FeedReaction, Snapshot } from '../../data/types';
import { formatClock, memberName } from '../../lib/format';
import { getFeedPresentation } from '../../lib/feedPresentation';
import { feedInteractionTarget } from '../../lib/feedInteractionTargets';
import type { NewsItem } from '../../lib/whatsNew';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { useAction } from '../useAction';
import { ResourceComments } from './ResourceComments';
import { ShareOptionsDialog } from './ShareOptionsDialog';
import { FeedActions } from './FeedActions';
import { FeedContent } from './FeedContent';
import { ReactionBar } from './ReactionBar';
import { relativeTime } from './shared';

interface Props {
  item: NewsItem;
  snapshot: Snapshot;
  sharedExams?: ExamSummary[];
  isNew: boolean;
  now: Date;
  reactions: FeedReaction[];
  post?: FeedPost;
  comments: FeedComment[];
  highlighted?: boolean;
}

export function FeedCard({ item, snapshot, sharedExams, isNew, now, reactions, post, highlighted }: Props) {
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [sharing, setSharing] = useState<{ source: typeof source; actorId: string | undefined; targetKey: string }>();
  const lock = useRef(false);
  const { members, subjects, me } = snapshot;
  const presentation = getFeedPresentation(item, snapshot, sharedExams);
  const subject = subjects.find((s) => s.id === item.subjectId);
  const mine = item.actorId === me?.id;
  const writable = snapshot.connection === 'ready' && me?.status === 'active';
  const when = relativeTime(item.at, now) ?? formatClock(item.at);
  const target = item.target;
  const interactionTarget = feedInteractionTarget(item);
  const interactionKey = interactionTarget ? `${interactionTarget.kind}:${interactionTarget.id}` : '';
  const mutate = async (action: () => Promise<unknown> | unknown) => {
    if (lock.current || !writable) return;
    lock.current = true;
    try { return await run(async () => { await action(); return true; }); }
    finally { lock.current = false; }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (post && draft.trim() && draft.trim().length <= FEED_LIMITS.post &&
      await mutate(() => source.editFeedPost({ postId: post.id, text: draft }))) setEditing(false);
  };
  const classes = ['feed-card', `feed-card--${presentation.layout}`, `feed-card--${presentation.tone}`,
    isNew && 'feed-card--pending', highlighted && 'feed-card--highlighted', item.kind === 'ranking' && 'feed-card--ranking'].filter(Boolean).join(' ');

  return (
    <article className={classes} data-news-kind={item.kind} id={post ? `publicacion-${post.id}` : undefined}
      aria-label={`${presentation.label}: ${presentation.title}`}>
      <header className="feed-card__head">
        <Link to={`/perfil/${item.actorId}`} className="feed-card__avatar" aria-label={`Ver perfil de ${memberName(members, item.actorId)}`}>
          <Avatar member={members.find((m) => m.id === item.actorId)} size={40} />
        </Link>
        <div className="feed-card__who">
          <Link to={`/perfil/${item.actorId}`} className="feed-card__author">{mine ? 'Tú' : memberName(members, item.actorId)}</Link>
          <span className="feed-card__meta">
            <time dateTime={item.at.toISOString()} title={item.at.toLocaleString('es-MX')}>{when}</time>
            {post?.editedAt && <span> · editada</span>}
          </span>
        </div>
        {isNew && <span className="feed-card__new"><span className="news-item__dot" aria-hidden="true" />Nuevo</span>}
        {post && (mine || me?.isCreator) && (
          <div className="feed-card__manage">
            {mine && !editing && <button type="button" className="icon-button" disabled={!writable || pending}
              aria-label="Editar publicación" onClick={() => { setDraft(post.text); setEditing(true); }}><Icon name="edit" size={16} /></button>}
            <button type="button" className="icon-button" aria-label="Eliminar publicación" disabled={!writable || pending}
              onClick={() => { if (confirm('¿Eliminar esta publicación? También se borran sus comentarios y reacciones.')) void mutate(() => source.deleteFeedPost({ postId: post.id })); }}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        )}
      </header>
      <div className="feed-card__labels">
        <span className="feed-type"><Icon name={presentation.icon} size={14} />{presentation.label}</span>
        <span className="feed-subject">{subject?.name ?? 'Grupo B20'}</span>
        {presentation.status && <span className="feed-status">{presentation.status}</span>}
      </div>
      <span className="feed-card__action">{mine && item.selfText ? item.selfText : item.text}</span>
      {editing && post ? (
        <form className="feed-card__edit" onSubmit={save}>
          <textarea aria-label="Editar publicación" rows={4} maxLength={FEED_LIMITS.post} disabled={pending || !writable} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="row"><button type="submit" disabled={pending || !writable || !draft.trim()}>Guardar</button>
            <button type="button" className="secondary" disabled={pending} onClick={() => setEditing(false)}>Cancelar</button></div>
        </form>
      ) : <FeedContent presentation={presentation} link={item.link} socialText={post?.text} />}
      <FeedActions item={item} snapshot={snapshot} />
      <footer className="feed-card__foot">
        {target && <ReactionBar reactions={reactions} members={members} meId={me?.id} disabled={pending || !writable}
          onReact={(emoji) => void mutate(() => source.toggleFeedReaction({ targetKind: target.kind, targetId: target.id, emoji }))} />}
        {interactionTarget && <button type="button" className="feed-card__share" disabled={!writable || (typeof source.resolveChatPosts !== 'function' && typeof source.createFeedShare !== 'function')} onClick={() => setSharing({ source, actorId: me?.id, targetKey: interactionKey })}><Icon name="forward" size={15} />Compartir</button>}
        {!post && <Link to={item.link} className="feed-card__open">{presentation.cta}<Icon name="forward" size={15} /></Link>}
      </footer>
      {error && <p className="error" role="alert">{error}</p>}
      {interactionTarget && <ResourceComments target={interactionTarget} initiallyOpen={false} share={false} />}
      {sharing?.source === source && sharing.actorId === me?.id && sharing.targetKey === interactionKey && interactionTarget && <ShareOptionsDialog key={`${me?.id}:${interactionKey}`} target={interactionTarget} onClose={() => setSharing(undefined)} />}
    </article>
  );
}
