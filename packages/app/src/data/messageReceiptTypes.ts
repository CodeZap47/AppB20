import type { Id, MaybePromise, MessageScope } from './types';

export interface MessageReceipt {
  scope: MessageScope; conversationId: Id; messageId: Id; recipientId: Id;
  deliveredAt?: Date; readAt?: Date;
  /** False for a newly observed historical delivery, whose old cursor still applies. */
  tracked?: boolean;
}
export interface MessageReceiptInfo {
  loading: boolean; unavailable: boolean; tracked: boolean;
  receipts: readonly MessageReceipt[];
}
export const EMPTY_RECEIPT_INFO: MessageReceiptInfo = Object.freeze({ loading: false, unavailable: false, tracked: false, receipts: Object.freeze([]) });
export interface MessageReceiptSource {
  getSnapshot(scope: MessageScope, messageId: Id): MessageReceiptInfo;
  subscribe(scope: MessageScope, messageId: Id, listener: () => void): () => void;
  markSeen(scope: MessageScope, conversationId: Id, messageIds: Id[]): MaybePromise<void>;
}
