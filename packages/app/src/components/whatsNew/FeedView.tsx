import { useEffect } from 'react';
import type { ExamSummary } from '@b20/core';
import type { Snapshot } from '../../data/types';
import type { NewsItem } from '../../lib/whatsNew';
import { FeedCard } from './FeedCard';
import { byDay } from './shared';

interface Props {
  items: NewsItem[];
  snapshot: Snapshot;
  isPending: (item: NewsItem) => boolean;
  now: Date;
  /** Publicación a la que se llegó desde un enlace (`?publicacion=`). */
  highlightPostId?: string;
  sharedExams?: ExamSummary[];
}

/** La vista tipo red social: cada novedad es una tarjeta con vista previa y reacciones. */
export function FeedView({ items, snapshot, isPending, now, highlightPostId, sharedExams }: Props) {
  const { feedReactions, feedPosts, feedComments } = snapshot;

  useEffect(() => {
    if (highlightPostId) document.getElementById(`publicacion-${highlightPostId}`)?.scrollIntoView?.({ block: 'center' });
  }, [highlightPostId]);

  return byDay(items).map((group) => (
    <section key={group.label} className="news-day feed-day">
      <h2 className="feed-day__label">{group.label}<span>{group.items.length} {group.items.length === 1 ? 'publicación' : 'publicaciones'}</span></h2>
      <div className="feed-stream">
        {group.items.map((item) => {
          const target = item.target;
          const post = target?.kind === 'post' ? feedPosts.find((p) => p.id === target.id) : undefined;
          return (
            <FeedCard
              key={`${snapshot.me?.id}:${item.key}`}
              item={item}
              snapshot={snapshot}
              sharedExams={sharedExams}
              isNew={isPending(item)}
              now={now}
              reactions={target ? feedReactions.filter((r) => r.targetKind === target.kind && r.targetId === target.id) : []}
              post={post}
              comments={post ? feedComments.filter((c) => c.postId === post.id) : []}
              highlighted={Boolean(post && post.id === highlightPostId)}
            />
          );
        })}
      </div>
    </section>
  ));
}
