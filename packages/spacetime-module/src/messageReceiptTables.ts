import { t, table } from 'spacetimedb/server';

/** Marker distinguishes a fixed recipient cohort from an untracked historical message. */
export const messageReceiptTracking = table({ name: 'message_receipt_cohort' }, {
  key: t.string().primaryKey(), scope: t.string(), conversationId: t.string(), messageId: t.u64(),
  sender: t.identity().index('btree'), startedAt: t.timestamp(),
});
export const messageReceipt = table({ name: 'message_receipt' }, {
  key: t.string().primaryKey(), messageKey: t.string().index('btree'), scope: t.string(),
  conversationId: t.string(), messageId: t.u64(), sender: t.identity().index('btree'),
  recipient: t.identity().index('btree'), deliveredAt: t.timestamp().optional(), readAt: t.timestamp().optional(),
});
/** Recipient metadata distinguishes legacy observations without changing stored receipt rows. */
export const myMessageReceiptRow = t.object('MyMessageReceipt', {
  key: t.string(), messageKey: t.string(), scope: t.string(), conversationId: t.string(), messageId: t.u64(),
  sender: t.identity(), recipient: t.identity(), deliveredAt: t.timestamp().optional(), readAt: t.timestamp().optional(), tracked: t.bool(),
});
export const messageReceiptTables = { messageReceiptTracking, messageReceipt };
