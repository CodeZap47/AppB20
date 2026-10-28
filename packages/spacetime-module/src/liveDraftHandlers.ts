import { ScheduleAt, Timestamp } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { memberIdentityFor } from './authIdentity';
import { assertDirectAllowed, channel, conversationAccess } from './delivery2Handlers';
import { typingVisible, TYPING_TTL_MICROS } from './engagementHandlers';
import { activeMember, isActive, type Ctx, type ViewDb } from './moduleContext';

type Draft = Ctx['db']['chatLiveDraft']['key'] extends { find(key: string): infer R } ? NonNullable<R> : never;
const validConversation = (scope: string, id: string) =>
  scope === 'group' ? id === 'general' : ['channel', 'direct'].includes(scope) && /^[1-9][0-9]{0,19}$/.test(id);

export function liveDraftVisible(db: ViewDb, viewer: Ctx['sender'], row: Draft): boolean {
  return !!row.text && db.chatLivePreference.memberId.find(row.memberId)?.enabled !== false && typingVisible(db, viewer, row);
}

function schedule(ctx: Ctx) {
  let earliest: Timestamp | undefined;
  for (const row of ctx.db.chatLiveDraft.iter()) {
    if (!earliest || row.expiresAt.microsSinceUnixEpoch < earliest.microsSinceUnixEpoch) earliest = row.expiresAt;
  }
  const pending = [...ctx.db.chatLiveDraftExpiry.iter()];
  if (pending.length === 1 && earliest && pending[0]!.expiresAt.microsSinceUnixEpoch === earliest.microsSinceUnixEpoch) return;
  for (const row of pending) ctx.db.chatLiveDraftExpiry.id.delete(row.id);
  if (earliest) ctx.db.chatLiveDraftExpiry.insert({ id: 0n, expiresAt: earliest, scheduledAt: ScheduleAt.time(earliest.microsSinceUnixEpoch) });
}

export function setLiveDraft(ctx: Ctx, input: { scope: string; conversationId: string; text: string; revision: bigint }) {
  activeMember(ctx);
  if (!ctx.connectionId || !validConversation(input.scope, input.conversationId)) throw new SenderError('La conversación no es válida.');
  if (input.text.length > 4000) throw new SenderError('El borrador admite hasta 4000 caracteres.');
  const memberId = memberIdentityFor(ctx);
  const connectionId = ctx.connectionId.toHexString();
  const key = `${connectionId}:${input.scope}:${input.conversationId}`;
  const previous = ctx.db.chatLiveDraft.key.find(key);
  if (previous && input.revision <= previous.revision) return;
  if (!input.text && !previous) return;
  if (input.text) {
    if (ctx.db.chatLivePreference.memberId.find(memberId)?.enabled === false) return;
    conversationAccess(ctx, input.scope, input.conversationId);
    if (input.scope === 'channel') channel(ctx, BigInt(input.conversationId), true);
    if (input.scope === 'direct') {
      const chat = ctx.db.directConversation.id.find(BigInt(input.conversationId))!;
      const other = chat.userA.isEqual(memberId) ? chat.userB : chat.userA;
      if (!isActive(ctx.db, other)) throw new SenderError('La conversación no está disponible.');
      assertDirectAllowed(ctx, memberId, other);
    }
  }
  // An empty tombstone retains only a sequence number, preventing late writes from
  // restoring text after send/blur. It has the same short lifetime as a draft.
  const row = { key, connectionId, memberId, scope: input.scope, conversationId: input.conversationId,
    text: input.text, revision: input.revision, updatedAt: ctx.timestamp,
    expiresAt: new Timestamp(ctx.timestamp.microsSinceUnixEpoch + TYPING_TTL_MICROS) };
  if (previous) ctx.db.chatLiveDraft.key.update(row); else ctx.db.chatLiveDraft.insert(row);
  schedule(ctx);
}

export function setLiveDraftSharing(ctx: Ctx, { enabled }: { enabled: boolean }) {
  activeMember(ctx);
  const memberId = memberIdentityFor(ctx);
  const row = { memberId, enabled, updatedAt: ctx.timestamp };
  if (ctx.db.chatLivePreference.memberId.find(memberId)) ctx.db.chatLivePreference.memberId.update(row);
  else ctx.db.chatLivePreference.insert(row);
  if (!enabled) for (const draft of [...ctx.db.chatLiveDraft.memberId.filter(memberId)])
    ctx.db.chatLiveDraft.key.update({ ...draft, text: '' });
  schedule(ctx);
}

export function disconnectLiveDrafts(ctx: Ctx) {
  const connectionId = ctx.connectionId?.toHexString();
  if (!connectionId) return;
  for (const row of [...ctx.db.chatLiveDraft.connectionId.filter(connectionId)]) ctx.db.chatLiveDraft.key.delete(row.key);
  // The legacy rows also belong to this connection, and still contain no text.
  for (const row of [...ctx.db.chatTyping.iter()]) if (row.key.startsWith(`${connectionId}:`)) ctx.db.chatTyping.key.delete(row.key);
  schedule(ctx);
}

export function expireLiveDrafts(ctx: Ctx, event: { id: bigint; expiresAt: Timestamp }) {
  if (!ctx.sender.isEqual(ctx.identity)) throw new SenderError('Solo el programador interno puede limpiar borradores.');
  const scheduled = ctx.db.chatLiveDraftExpiry.id.find(event.id);
  if (!scheduled || scheduled.expiresAt.microsSinceUnixEpoch !== event.expiresAt.microsSinceUnixEpoch) return;
  ctx.db.chatLiveDraftExpiry.id.delete(event.id);
  for (const row of [...ctx.db.chatLiveDraft.iter()])
    if (row.expiresAt.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) ctx.db.chatLiveDraft.key.delete(row.key);
  schedule(ctx);
}
