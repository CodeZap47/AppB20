import { Timestamp, type Identity } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import type { Ctx, ViewDb } from './moduleContext';
import { log } from './moduleContext';
import { isNotificationService } from './notificationHandlers';
import { cancelInvitationEmail } from './invitationEmailHandlers';

const HASH = /^[0-9a-f]{64}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const INVITE_LINK_DAYS = [1, 7, 30];
export const INVITE_LINK_MAX_USES = 100;
export const INVITE_LINK_MAX_ACTIVE = 10;
const DAY_MS = 86_400_000;
const now = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
const at = (value: number) => new Timestamp(BigInt(Math.floor(value)) * 1000n);
const ms = (value: Timestamp) => Number(value.microsSinceUnixEpoch / 1000n);

type LinkRow = { revokedAt?: Timestamp; expiresAt: Timestamp; uses: number; maxUses: number };
const usable = (row: LinkRow, nowMs: number) => !row.revokedAt && ms(row.expiresAt) > nowMs && row.uses < row.maxUses;

/** Quien llama ya pasó requireCreator. El navegador genera el código y solo envía su hash. */
export function createInviteLink(ctx: Ctx, actor: Identity, input: { tokenHash: string; expiresInDays: number; maxUses: number }) {
  const tokenHash = input.tokenHash.trim().toLowerCase();
  if (!HASH.test(tokenHash)) throw new SenderError('El enlace no es válido. Vuelve a generarlo.');
  if (!INVITE_LINK_DAYS.includes(input.expiresInDays)) throw new SenderError('Elige un vencimiento de 1, 7 o 30 días.');
  if (!Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > INVITE_LINK_MAX_USES) {
    throw new SenderError(`Elige de 1 a ${INVITE_LINK_MAX_USES} usos.`);
  }
  const active = [...ctx.db.inviteLink.iter()].filter((row) => usable(row, now(ctx))).length;
  if (active >= INVITE_LINK_MAX_ACTIVE) throw new SenderError(`Ya hay ${INVITE_LINK_MAX_ACTIVE} enlaces vigentes. Revoca uno antes de crear otro.`);
  if (ctx.db.inviteLink.tokenHash.find(tokenHash)) throw new SenderError('El enlace no es válido. Vuelve a generarlo.');
  const row = ctx.db.inviteLink.insert({
    id: 0n, tokenHash, createdBy: actor, createdAt: ctx.timestamp,
    expiresAt: at(now(ctx) + input.expiresInDays * DAY_MS), maxUses: input.maxUses, uses: 0, revokedAt: undefined,
  });
  log(ctx, 'create', 'invite_link', row.id);
}

/** Quien llama ya pasó requireCreator. Retira las invitaciones del enlace que nadie aceptó. */
export function revokeInviteLink(ctx: Ctx, id: bigint) {
  const row = ctx.db.inviteLink.id.find(id);
  if (!row) throw new SenderError('Ese enlace ya no existe.');
  if (row.revokedAt) return;
  ctx.db.inviteLink.id.update({ ...row, revokedAt: ctx.timestamp });
  for (const redemption of [...ctx.db.inviteLinkRedemption.linkId.filter(id)]) {
    if (!ctx.db.invitation.email.find(redemption.email)) continue;
    ctx.db.invitation.email.delete(redemption.email);
    cancelInvitationEmail(ctx, redemption.email);
  }
  log(ctx, 'revoke', 'invite_link', id);
}

/**
 * Solo la identidad técnica: el Worker canjea el enlace cuando alguien escribe su correo.
 * Crea la invitación de integrante y gasta un uso por correo. No revela por qué falla.
 */
export function redeemInviteLink(ctx: Ctx, input: { tokenHash: string; email: string }): boolean {
  if (!isNotificationService(ctx) || !ctx.db.notificationServiceConfig.id.find(0)?.enabled) {
    throw new SenderError('El servicio de notificaciones no está habilitado.');
  }
  const email = input.email.trim().toLowerCase();
  const link = ctx.db.inviteLink.tokenHash.find(input.tokenHash.trim().toLowerCase());
  if (!link || !EMAIL.test(email) || email.length > 320) return false;
  const key = `${link.id}:${email}`;
  // Volver a usar el mismo enlace con el mismo correo no gasta otro uso.
  if (ctx.db.inviteLinkRedemption.key.find(key)) return !link.revokedAt;
  if (!usable(link, now(ctx))) return false;
  // Una invitación pendiente se respeta tal como está, con su rol.
  if (ctx.db.invitation.email.find(email)) return true;
  ctx.db.invitation.insert({ email, isCreator: false, invitedBy: link.createdBy, createdAt: ctx.timestamp });
  ctx.db.inviteLinkRedemption.insert({ key, linkId: link.id, email, redeemedAt: ctx.timestamp });
  ctx.db.inviteLink.id.update({ ...link, uses: link.uses + 1 });
  log(ctx, 'redeem', 'invite_link', link.id);
  return true;
}

/** Solo creadores activos; nunca se expone el hash. */
export function inviteLinks(db: ViewDb, sender: Identity) {
  const me = db.member.identity.find(sender);
  if (me?.status !== 'active' || !me.isCreator) return [];
  return [...db.inviteLink.iter()].map((row) => ({ ...row, tokenHash: '' }));
}
