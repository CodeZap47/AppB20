import { t, table } from 'spacetimedb/server';

/** Provisional text is isolated from messages and expires without a message event. */
export const chatLiveDraft = table({ name: 'chat_live_draft' }, {
  key: t.string().primaryKey(),
  connectionId: t.string().index('btree'),
  memberId: t.identity().index('btree'),
  scope: t.string(),
  conversationId: t.string(),
  text: t.string(),
  revision: t.u64(),
  updatedAt: t.timestamp(),
  expiresAt: t.timestamp(),
});

export const chatLivePreference = table({ name: 'chat_live_preference' }, {
  memberId: t.identity().primaryKey(),
  enabled: t.bool(),
  updatedAt: t.timestamp(),
});

/** Only the next deadline is scheduled; updates do not enqueue one job per keypress. */
export const chatLiveDraftExpiry = table({ name: 'chat_live_draft_expiry' }, {
  id: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
  expiresAt: t.timestamp(),
});

export const liveDraftTables = { chatLiveDraft, chatLivePreference, chatLiveDraftExpiry };
