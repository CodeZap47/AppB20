import { t, table } from 'spacetimedb/server';

/** No draft text is stored or exposed. Rows are short-lived presence hints. */
export const chatTyping = table(
  { name: 'chat_typing' },
  {
    key: t.string().primaryKey(),
    memberId: t.identity().index('btree'),
    scope: t.string(),
    conversationId: t.string(),
    expiresAt: t.timestamp(),
  },
);
export const memberOnboarding = table(
  { name: 'member_onboarding' },
  {
    memberId: t.identity().primaryKey(),
    version: t.u32(),
    completedAt: t.timestamp(),
  },
);
export const engagementTables = { chatTyping, memberOnboarding };
