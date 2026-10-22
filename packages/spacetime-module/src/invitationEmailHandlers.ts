import { Timestamp } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import type { Ctx, ViewDb } from './moduleContext';
import { isNotificationService } from './notificationHandlers';
import { notificationRetrySeconds } from '../../core/src/notifications';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ATTEMPTS = 5;
const LEASE_MS = 300_000;
/** Evita que "Reenviar" sirva para llenar el buzón de alguien. */
export const RESEND_INTERVAL_MS = 600_000;
const now = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
const at = (value: number) => new Timestamp(BigInt(Math.floor(value)) * 1000n);
const ms = (value: Timestamp) => Number(value.microsSinceUnixEpoch / 1000n);

function service(ctx: Ctx) {
  if (!isNotificationService(ctx) || !ctx.db.notificationServiceConfig.id.find(0)?.enabled) throw new SenderError('El servicio de notificaciones no está habilitado.');
}

/** Deja el correo listo para el siguiente cron; reinicia intentos si ya se había enviado o falló. */
export function queueInvitationEmail(ctx: Ctx, email: string) {
  const previous = ctx.db.invitationEmail.email.find(email);
  const row = {
    email, status: 'pending', attempts: 0, leaseId: undefined, leaseUntil: undefined,
    nextAttemptAt: ctx.timestamp, requestedAt: ctx.timestamp, sentAt: previous?.sentAt, lastError: undefined,
  };
  if (previous) ctx.db.invitationEmail.email.update(row); else ctx.db.invitationEmail.insert(row);
}

export function cancelInvitationEmail(ctx: Ctx, email: string) {
  ctx.db.invitationEmail.email.delete(email);
}

/** Quien llama ya pasó requireCreator. */
export function resendInvitationEmail(ctx: Ctx, email: string) {
  if (!ctx.db.invitation.email.find(email)) throw new SenderError('Esa invitación ya no existe.');
  const row = ctx.db.invitationEmail.email.find(email);
  if (row && ['pending', 'leased'].includes(row.status)) return;
  if (row && row.status !== 'failed' && now(ctx) - ms(row.requestedAt) < RESEND_INTERVAL_MS) {
    throw new SenderError('Ya se envió hace poco. Espera unos minutos antes de reenviarlo.');
  }
  queueInvitationEmail(ctx, email);
}

export function claimInvitationEmails(ctx: Ctx, input: { leaseId: string; limit: number }) {
  service(ctx); if (!UUID.test(input.leaseId)) throw new SenderError('Lease inválido.');
  const jobs: { email: string; isCreator: boolean; inviterName: string }[] = [];
  const limit = Math.min(25, Math.max(1, input.limit));
  for (const row of [...ctx.db.invitationEmail.iter()]) {
    if (jobs.length >= limit) break;
    if (['sent', 'failed'].includes(row.status) || ms(row.nextAttemptAt) > now(ctx)) continue;
    const expired = row.status === 'leased' && !!row.leaseUntil && ms(row.leaseUntil) <= now(ctx);
    if (row.status === 'leased' && !expired && row.leaseId !== input.leaseId) continue;
    const invite = ctx.db.invitation.email.find(row.email);
    // Retirada o aceptada mientras esperaba: ya no hay nada que avisar.
    if (!invite) { ctx.db.invitationEmail.email.delete(row.email); continue; }
    const attempts = row.attempts + (expired ? 1 : 0);
    if (attempts >= MAX_ATTEMPTS) { ctx.db.invitationEmail.email.update({ ...row, attempts, status: 'failed', leaseUntil: undefined }); continue; }
    ctx.db.invitationEmail.email.update({ ...row, attempts, status: 'leased', leaseId: input.leaseId, leaseUntil: at(now(ctx) + LEASE_MS) });
    const inviter = ctx.db.member.identity.find(invite.invitedBy);
    jobs.push({ email: row.email, isCreator: invite.isCreator, inviterName: inviter?.status === 'active' ? inviter.displayName : 'La administración del grupo' });
  }
  return { now: now(ctx), jobs };
}

export function finishInvitationEmail(ctx: Ctx, input: { email: string; leaseId: string; outcome: string; error?: string }) {
  service(ctx); const row = ctx.db.invitationEmail.email.find(input.email);
  if (!row || row.leaseId !== input.leaseId || row.status !== 'leased') return;
  if (!row.leaseUntil || ms(row.leaseUntil) <= now(ctx)) throw new SenderError('El lease ya venció.');
  if (!['sent', 'retry', 'failed'].includes(input.outcome)) throw new SenderError('Resultado de envío inválido.');
  const attempts = row.attempts + 1;
  const lastError = input.error?.slice(0, 200) || undefined;
  if (input.outcome === 'sent') {
    ctx.db.invitationEmail.email.update({ ...row, attempts, status: 'sent', sentAt: ctx.timestamp, leaseUntil: undefined, lastError: undefined });
    return;
  }
  const status = input.outcome === 'failed' || attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
  ctx.db.invitationEmail.email.update({ ...row, attempts, status, lastError, nextAttemptAt: at(now(ctx) + notificationRetrySeconds(attempts) * 1000), leaseUntil: undefined });
}

/** Solo los creadores activos ven el estado, igual que la lista de invitaciones. */
export function invitationEmailStatuses(db: ViewDb, sender: Ctx['sender']) {
  const me = db.member.identity.find(sender);
  if (me?.status !== 'active' || !me.isCreator) return [];
  return [...db.invitationEmail.iter()].map((row) => ({ ...row, leaseId: undefined, leaseUntil: undefined, lastError: undefined }));
}
