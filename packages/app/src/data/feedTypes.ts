import type { FeedReactionEmoji, FeedTargetKind } from '@b20/core';
import type { Id, MaybePromise } from './types';
/** Una persona, una reacción por contenido; reaccionar con otra la cambia. */
export interface FeedReaction { targetKind: FeedTargetKind; targetId: Id; memberId: Id; emoji: FeedReactionEmoji; }
export interface FeedPost { id: Id; authorId: Id; text: string; subjectId?: Id; createdAt: Date; editedAt?: Date; }
export interface FeedComment { id: Id; postId: Id; authorId: Id; text: string; createdAt: Date; }
export interface FeedSnapshot { feedReactions: FeedReaction[]; feedPosts: FeedPost[]; feedComments: FeedComment[]; }
export interface FeedActions {
  /** Pone, cambia o quita (si es la misma) tu reacción. */
  toggleFeedReaction(input: { targetKind: FeedTargetKind; targetId: Id; emoji: FeedReactionEmoji }): MaybePromise<void>;
  createFeedPost(input: { text: string; subjectId?: Id; requestId: string }): MaybePromise<void>;
  /** Solo su autor. */
  editFeedPost(input: { postId: Id; text: string }): MaybePromise<void>;
  /** Su autor o un administrador. */
  deleteFeedPost(input: { postId: Id }): MaybePromise<void>;
  commentFeedPost(input: { postId: Id; text: string; requestId: string }): MaybePromise<void>;
  /** Quien comentó, quien publicó o un administrador. */
  deleteFeedComment(input: { commentId: Id }): MaybePromise<void>;
}
export function emptyFeed(): FeedSnapshot { return { feedReactions: [], feedPosts: [], feedComments: [] }; }
