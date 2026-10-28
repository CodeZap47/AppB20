import type { Id, MaybePromise, MessageScope } from './types';

export interface LiveDraft {
  id: string;
  memberId: Id;
  scope: MessageScope;
  conversationId: Id;
  text: string;
  revision: bigint;
  updatedAt: Date;
  expiresAt: Date;
}

/** An isolated external store: keypresses never rebuild the application snapshot. */
export interface LiveDraftSource {
  getSnapshot(scope: MessageScope, conversationId: Id): readonly LiveDraft[];
  subscribe(scope: MessageScope, conversationId: Id, listener: () => void): () => void;
  publish(scope: MessageScope, conversationId: Id, text: string): MaybePromise<void>;
}

export const EMPTY_LIVE_DRAFTS: readonly LiveDraft[] = Object.freeze([]);
