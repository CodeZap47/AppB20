import { memberIdentityFor } from './authIdentity';
import { Timestamp } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { activeMember, isActive, type Ctx, type ViewDb } from './moduleContext';
import { assertDirectAllowed, channel, conversationAccess } from './delivery2Handlers';

export const TYPING_TTL_MICROS = 7_000_000n;

export function typingVisible(
  db: ViewDb,
  viewer: Ctx['sender'],
  row: { memberId: Ctx['sender']; scope: string; conversationId: string },
): boolean {
  if (!isActive(db, viewer) || !isActive(db, row.memberId)) return false;
  if (
    [...db.memberBlock.iter()].some(
      (block) =>
        (block.owner.isEqual(viewer) && block.memberId.isEqual(row.memberId)) ||
        (block.owner.isEqual(row.memberId) && block.memberId.isEqual(viewer)),
    )
  )
    return false;
  if (row.scope === 'group') return row.conversationId === 'general';
  if (!/^[1-9][0-9]{0,19}$/.test(row.conversationId)) return false;
  if (row.scope === 'channel') {
    const room = db.chatChannel.id.find(BigInt(row.conversationId));
    return !!room && !room.archivedAt;
  }
  if (row.scope !== 'direct') return false;
  const chat = db.directConversation.id.find(BigInt(row.conversationId));
  return (
    !!chat &&
    isActive(db, chat.userA) &&
    isActive(db, chat.userB) &&
    (chat.userA.isEqual(viewer) || chat.userB.isEqual(viewer)) &&
    (chat.userA.isEqual(row.memberId) || chat.userB.isEqual(row.memberId))
  );
}

export function setTyping(
  ctx: Ctx,
  input: { scope: string; conversationId: string; typing: boolean },
) {
  conversationAccess(ctx, input.scope, input.conversationId);
  if (input.scope === 'channel') channel(ctx, BigInt(input.conversationId), true);
  if (input.scope === 'direct') {
    const chat = ctx.db.directConversation.id.find(BigInt(input.conversationId))!;
    const other = chat.userA.isEqual(memberIdentityFor(ctx)) ? chat.userB : chat.userA;
    if (!isActive(ctx.db, other)) throw new SenderError('La conversación no está disponible.');
    assertDirectAllowed(ctx, memberIdentityFor(ctx), other);
  }
  const key = `${ctx.connectionId?.toHexString() ?? memberIdentityFor(ctx).toHexString()}:${input.scope}:${input.conversationId}`;
  const previous = ctx.db.chatTyping.key.find(key);
  // Pruning needs no extra scheduler and bounds retained data to recent participants.
  for (const row of ctx.db.chatTyping.iter()) {
    if (row.expiresAt.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch)
      ctx.db.chatTyping.key.delete(row.key);
  }
  if (!input.typing) {
    ctx.db.chatTyping.key.delete(key);
    return;
  }
  const expiresAt = new Timestamp(ctx.timestamp.microsSinceUnixEpoch + TYPING_TTL_MICROS);
  if (
    previous &&
    previous.expiresAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch + 5_000_000n
  )
    return;
  const row = {
    key,
    memberId: memberIdentityFor(ctx),
    scope: input.scope,
    conversationId: input.conversationId,
    expiresAt,
  };
  if (ctx.db.chatTyping.key.find(key)) ctx.db.chatTyping.key.update(row);
  else ctx.db.chatTyping.insert(row);
}

export function completeOnboarding(ctx: Ctx) {
  activeMember(ctx);
  if (ctx.db.memberOnboarding.memberId.find(memberIdentityFor(ctx))) return;
  ctx.db.memberOnboarding.insert({ memberId: memberIdentityFor(ctx), version: 1, completedAt: ctx.timestamp });
}
