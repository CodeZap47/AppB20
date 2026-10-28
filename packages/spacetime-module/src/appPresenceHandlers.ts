import { ScheduleAt, Timestamp } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { memberIdentityFor } from './authIdentity';
import { activeMember, isActive, type Ctx, type ViewDb } from './moduleContext';

export const APP_PRESENCE_TTL_MICROS = 15_000_000n;

function schedule(ctx: Ctx) {
  let earliest: Timestamp | undefined;
  for (const row of ctx.db.appPresenceSession.iter()) {
    if (row.active && (!earliest || row.expiresAt.microsSinceUnixEpoch < earliest.microsSinceUnixEpoch)) earliest = row.expiresAt;
  }
  const pending = [...ctx.db.appPresenceExpiry.iter()];
  if (pending.length === 1 && earliest && pending[0]!.expiresAt.microsSinceUnixEpoch === earliest.microsSinceUnixEpoch) return;
  for (const row of pending) ctx.db.appPresenceExpiry.id.delete(row.id);
  if (earliest) ctx.db.appPresenceExpiry.insert({ id: 0n, expiresAt: earliest, scheduledAt: ScheduleAt.time(earliest.microsSinceUnixEpoch) });
}

/** App clients register after loading their authorized cache; connecting alone never counts. */
export function setAppPresence(ctx: Ctx, input: { active: boolean; revision: bigint }) {
  const connectionId = ctx.connectionId?.toHexString();
  if (!connectionId) throw new SenderError('La presencia necesita una conexión de la aplicación.');
  const previous = ctx.db.appPresenceSession.connectionId.find(connectionId);
  // Revoked sessions can still clear their own existing connection. This cannot
  // create a row, choose another connection, or turn any member's presence on.
  if (!input.active && previous) {
    if (input.revision <= previous.revision) return;
    ctx.db.appPresenceSession.connectionId.update({ ...previous, active: false, revision: input.revision });
    schedule(ctx);
    return;
  }
  activeMember(ctx);
  if (previous && input.revision <= previous.revision) return;
  const row = { connectionId, memberId: memberIdentityFor(ctx), active: input.active, revision: input.revision,
    expiresAt: new Timestamp(ctx.timestamp.microsSinceUnixEpoch + APP_PRESENCE_TTL_MICROS) };
  if (previous) ctx.db.appPresenceSession.connectionId.update(row);
  else ctx.db.appPresenceSession.insert(row);
  schedule(ctx);
}

export function onlineMembers(db: ViewDb, viewer: Ctx['sender']) {
  if (!isActive(db, viewer)) return [];
  const seen = new Set<string>();
  return [...db.appPresenceSession.iter()].flatMap(row => {
    if (!row.active || !isActive(db, row.memberId)) return [];
    const memberId = row.memberId.toHexString();
    if (seen.has(memberId)) return [];
    seen.add(memberId);
    return [{ memberId: row.memberId }];
  }).sort((a, b) => a.memberId.toHexString().localeCompare(b.memberId.toHexString()));
}

export function disconnectAppPresence(ctx: Ctx) {
  const connectionId = ctx.connectionId?.toHexString();
  if (!connectionId || !ctx.db.appPresenceSession) return;
  ctx.db.appPresenceSession.connectionId.delete(connectionId);
  schedule(ctx);
}

export function expireAppPresence(ctx: Ctx, event: { id: bigint; expiresAt: Timestamp }) {
  if (!ctx.sender.isEqual(ctx.identity)) throw new SenderError('Solo el programador interno puede limpiar la presencia.');
  const scheduled = ctx.db.appPresenceExpiry.id.find(event.id);
  if (!scheduled || scheduled.expiresAt.microsSinceUnixEpoch !== event.expiresAt.microsSinceUnixEpoch) return;
  ctx.db.appPresenceExpiry.id.delete(event.id);
  for (const row of [...ctx.db.appPresenceSession.iter()]) {
    if (row.active && row.expiresAt.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) {
      // Keep the sequence watermark until this connection closes. A late old pulse
      // cannot reactivate a session after either hiding the app or its lease expiring.
      ctx.db.appPresenceSession.connectionId.update({ ...row, active: false });
    }
  }
  schedule(ctx);
}
