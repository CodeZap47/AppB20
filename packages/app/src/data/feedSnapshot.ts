import { isFeedReaction, isFeedTargetKind } from '@b20/core';
import type { DbConnection } from '../module_bindings';
import type { Snapshot } from './types';
import { emptyFeed, type FeedReaction, type FeedSnapshot } from './feedTypes';
type View = 'feedReactions' | 'feedPosts' | 'feedComments';
type Connection = { db: { [K in View]: Pick<DbConnection['db'][K], 'iter'> } };
export function readFeedSnapshot(c: Connection, base: Snapshot, identity: string): FeedSnapshot {
  if (base.me?.id !== identity || base.me.status !== 'active') return emptyFeed();
  const feedPosts = [...(c.db.feedPosts?.iter() ?? [])].filter((r) => !r.deletedAt).map((r) => ({ id: r.id.toString(), authorId: r.author.toHexString(), text: r.text,
    subjectId: r.subjectId?.toString(), createdAt: r.createdAt.toDate(), editedAt: r.editedAt?.toDate() }));
  const posts = new Set(feedPosts.map((r) => r.id));
  return { feedPosts,
    // Una versión anterior de la app ignora tipos o emojis que todavía no conoce.
    feedReactions: [...(c.db.feedReactions?.iter() ?? [])].flatMap((r): FeedReaction[] => isFeedTargetKind(r.targetKind) && isFeedReaction(r.emoji)
      ? [{ targetKind: r.targetKind, targetId: r.targetId.toString(), memberId: r.member.toHexString(), emoji: r.emoji }] : []),
    feedComments: [...(c.db.feedComments?.iter() ?? [])].filter((r) => !r.deletedAt && posts.has(r.postId.toString())).map((r) => ({ id: r.id.toString(), postId: r.postId.toString(),
      authorId: r.author.toHexString(), text: r.text, createdAt: r.createdAt.toDate() })),
  };
}
