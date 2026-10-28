import { SenderError } from 'spacetimedb/server';
import { memberIdentityFor } from './authIdentity';
import { activeMember, isActive, readableMessage, type Ctx, type ViewDb } from './moduleContext';
import { conversationAccess, withdrawn } from './delivery2Handlers';

export const receiptMessageKey = (scope: string, id: bigint) => `${scope}:${id}`;
function available(db: ViewDb, scope: string, id: bigint) {
  const row = scope === 'group' ? db.groupMessage.id.find(id) : scope === 'channel' ? db.channelMessage.id.find(id) : scope === 'direct' ? db.directMessage.id.find(id) : undefined;
  return !!row && !row.deletedAt && (scope === 'direct' || !withdrawn(db, `${scope}_message`, id));
}
function allowed(db: ViewDb, viewer: Ctx['sender'], scope: string, conversationId: string) {
  if (!isActive(db, viewer)) return false;
  if (scope === 'group') return conversationId === 'general';
  if (!/^[1-9][0-9]{0,19}$/.test(conversationId)) return false;
  if (scope === 'channel') return !!db.chatChannel.id.find(BigInt(conversationId));
  if (scope !== 'direct') return false;
  const chat = db.directConversation.id.find(BigInt(conversationId));
  if (!chat || !(chat.userA.isEqual(viewer) || chat.userB.isEqual(viewer))) return false;
  return ![...db.memberBlock.iter()].some(row => (row.owner.isEqual(chat.userA) && row.memberId.isEqual(chat.userB)) || (row.owner.isEqual(chat.userB) && row.memberId.isEqual(chat.userA)));
}
export function receiptVisible(db: ViewDb, viewer: Ctx['sender'], row: {
  scope: string; conversationId: string; messageId: bigint; sender: Ctx['sender']; recipient: Ctx['sender'];
}, author: boolean) {
  return (author ? row.sender.isEqual(viewer) : row.recipient.isEqual(viewer)) &&
    allowed(db, viewer, row.scope, row.conversationId) && available(db, row.scope, row.messageId);
}
export function trackingVisible(db: ViewDb, viewer: Ctx['sender'], row: { scope: string; conversationId: string; messageId: bigint; sender: Ctx['sender'] }) {
  return row.sender.isEqual(viewer) && allowed(db, viewer, row.scope, row.conversationId) && available(db, row.scope, row.messageId);
}

/** Called atomically with every existing send reducer, including older clients. */
export function trackMessageRecipients(ctx: Ctx, scope: string, conversationId: string, messageId: bigint) {
  if (!ctx.db.messageReceiptTracking || !ctx.db.messageReceipt) return;
  const sender = memberIdentityFor(ctx); const messageKey = receiptMessageKey(scope, messageId);
  if (ctx.db.messageReceiptTracking.key.find(messageKey)) return;
  ctx.db.messageReceiptTracking.insert({ key: messageKey, scope, conversationId, messageId, sender, startedAt: ctx.timestamp });
  const chat = scope === 'direct' ? ctx.db.directConversation.id.find(BigInt(conversationId)) : undefined;
  for (const member of ctx.db.member.iter()) {
    if (member.status !== 'active' || member.identity.isEqual(sender)) continue;
    if (chat && !(chat.userA.isEqual(member.identity) || chat.userB.isEqual(member.identity))) continue;
    ctx.db.messageReceipt.insert({ key: `${messageKey}:${member.identity.toHexString()}`, messageKey,
      scope, conversationId, messageId, sender, recipient: member.identity, deliveredAt: undefined, readAt: undefined });
  }
}

export function acknowledgeMessages(ctx: Ctx, input: { scope: string; conversationId: string; messageIds: bigint[] }, seen: boolean) {
  activeMember(ctx); conversationAccess(ctx, input.scope, input.conversationId);
  if (!input.messageIds.length || input.messageIds.length > 100) throw new SenderError('Confirma entre 1 y 100 mensajes por lote.');
  const recipient = memberIdentityFor(ctx);
  if (!allowed(ctx.db, recipient, input.scope, input.conversationId)) throw new SenderError('No participas o esta conversación no está disponible para confirmar mensajes.');
  for (const messageId of new Set(input.messageIds)) {
    const found = readableMessage(ctx, input.scope, messageId);
    const conversationId = found.scope === 'direct' ? found.row.conversationId.toString() : found.scope === 'channel' ? found.row.channelId.toString() : 'general';
    if (conversationId !== input.conversationId) throw new SenderError('El mensaje pertenece a otra conversación.');
    if (!available(ctx.db, input.scope, messageId)) throw new SenderError('El mensaje ya no está disponible.');
    if (found.row.sender.isEqual(recipient)) continue;
    const messageKey = receiptMessageKey(input.scope, messageId); const key = `${messageKey}:${recipient.toHexString()}`;
    const previous = ctx.db.messageReceipt.key.find(key);
    // A later member is never retroactively inserted into an established cohort.
    if (!previous && ctx.db.messageReceiptTracking.key.find(messageKey)) continue;
    const row = { key, messageKey, scope: input.scope, conversationId, messageId, sender: found.row.sender, recipient,
      deliveredAt: previous?.deliveredAt ?? ctx.timestamp, readAt: previous?.readAt ?? (seen ? ctx.timestamp : undefined) };
    if (previous) {
      if (previous.deliveredAt && (!seen || previous.readAt)) continue;
      ctx.db.messageReceipt.key.update(row);
    } else ctx.db.messageReceipt.insert(row);
  }
}

export function purgeMessageReceipts(ctx: Ctx, scope: string, id: bigint) {
  const key = receiptMessageKey(scope, id);
  for (const row of [...(ctx.db.messageReceipt?.messageKey.filter(key) ?? [])]) ctx.db.messageReceipt.key.delete(row.key);
  ctx.db.messageReceiptTracking?.key.delete(key);
}
