import { Identity, Timestamp } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { sha256 } from '@noble/hashes/sha2.js';
import { memberIdentityFor } from './authIdentity';
import { log, type Ctx, type ViewDb } from './moduleContext';
import { cancelInvitationEmail } from './invitationEmailHandlers';
import { removeGroupMember } from './roomsHandlers';
import { isNotificationService } from './notificationHandlers';
import { legacyInvitationLinks } from './inviteLinkHandlers';

interface Helpers {
  requireCreator(ctx: Ctx): void;
  verifiedEmail(ctx: Ctx): string;
  requireDisplayName(value: string): string;
}
let helpers: Helpers;
export function configureMembershipHelpers(value: Helpers) { helpers = value; }
type Person = Ctx['sender'];
type Link = NonNullable<ReturnType<Ctx['db']['invitationLink']['id']['find']>>;
const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const micros = (value: Timestamp) => typeof value === 'bigint' ? value : value.microsSinceUnixEpoch;
const ms = (value: Timestamp) => Number(micros(value) / 1000n);
const at = (value: number) => new Timestamp(BigInt(value) * 1000n);
function text(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new SenderError(`${field} no es válido.`);
  return value.trim();
}
function uuid(value: unknown): string {
  const result = text(value, 'El identificador', 36).toLowerCase();
  if (!UUID.test(result)) throw new SenderError('El identificador debe ser UUID.');
  return result;
}
function person(value: unknown): Person {
  const result = text(value, 'La identidad', 66).replace(/^0x/i, '');
  if (!/^[0-9a-f]{64}$/i.test(result)) throw new SenderError('La identidad no es válida.');
  return Identity.fromString(result);
}
export function normalizeEmail(value: unknown): string {
  const result = text(value, 'El correo', 320).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(result)) throw new SenderError('Ese correo no es válido.');
  return result;
}
export function parseMembershipPayload(payload: string): Record<string, unknown> {
  if (payload.length > 16_000) throw new SenderError('La solicitud excede el límite.');
  try {
    const value: unknown = JSON.parse(payload);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* La respuesta nunca incluye el payload ni secretos de invitación. */ }
  throw new SenderError('La solicitud no es válida.');
}
function event(ctx: Ctx, action: string, reason = '', memberIdentity?: Person, email?: string) {
  ctx.db.membershipEvent?.insert({ id: 0n, memberIdentity, email, action, reason, actor: memberIdentityFor(ctx), at: ctx.timestamp });
}
function access(ctx: Ctx, identity: Person) { return ctx.db.memberAccess?.memberIdentity.find(identity); }
function identityBlocked(ctx: Ctx, identity: Person): boolean {
  return [...(ctx.db.memberEmail?.memberIdentity.filter(identity) ?? [])].some(row => ctx.db.emailRestriction?.email.find(row.email)?.blocked);
}
export function isEmailBlocked(ctx: Ctx, email: string): boolean {
  const binding = ctx.db.memberEmail?.email.find(email);
  return !!ctx.db.emailRestriction?.email.find(email)?.blocked || (!!binding && identityBlocked(ctx, binding.memberIdentity));
}
export function isVerifiedMembershipBlocked(ctx: Ctx, email: string): boolean {
  return isEmailBlocked(ctx, email) || identityBlocked(ctx, memberIdentityFor(ctx));
}
export function assertEmailNotBlocked(ctx: Ctx, email: string) {
  if (isEmailBlocked(ctx, email)) throw new SenderError('Este correo está bloqueado. Contacta a la administración.');
}
/** Un correo verificado identifica una membresía; cambiar de proveedor exige vincularla. */
export function assertVerifiedMembershipEmail(ctx: Ctx, email: string) {
  if (isVerifiedMembershipBlocked(ctx, email)) throw new SenderError('Este correo está bloqueado. Contacta a la administración.');
  const identity = memberIdentityFor(ctx);
  const existing = ctx.db.memberEmail?.email.find(email);
  if (existing && !existing.memberIdentity.isEqual(identity)) {
    throw new SenderError('Este correo ya pertenece a otra membresía. Solicita vincular explícitamente tu cuenta.');
  }
}
export function recordVerifiedEmail(ctx: Ctx, email: string) {
  assertVerifiedMembershipEmail(ctx, email);
  const identity = memberIdentityFor(ctx);
  const existing = ctx.db.memberEmail?.email.find(email);
  // Los históricos se vinculan solo cuando presentan una sesión verificada real.
  if (!existing && ctx.db.member.identity.find(identity)) {
    ctx.db.memberEmail?.insert({ email, memberIdentity: identity, verifiedAt: ctx.timestamp });
  }
}
function bindAdmissionEmail(ctx: Ctx, email: string) {
  recordVerifiedEmail(ctx, email);
  if (!ctx.db.memberEmail?.email.find(email)) ctx.db.memberEmail?.insert({ email, memberIdentity: memberIdentityFor(ctx), verifiedAt: ctx.timestamp });
}
function saveAdmission(ctx: Ctx, origin: string, sourceId: string) {
  const memberIdentity = memberIdentityFor(ctx); const previous = access(ctx, memberIdentity);
  const generation = (previous?.generation ?? 0) + 1;
  const row = { memberIdentity, generation, origin, sourceId, admittedAt: ctx.timestamp, removedAt: undefined };
  if (previous) ctx.db.memberAccess?.memberIdentity.update(row); else ctx.db.memberAccess?.insert(row);
  ctx.db.memberAdmission?.insert({ id: `${memberIdentity.toHexString()}:${generation}`, memberIdentity, generation, origin, sourceId, joinedAt: ctx.timestamp });
  return generation;
}
function latestRemoval(ctx: Ctx, email: string, identity = memberIdentityFor(ctx)) {
  const memberAt = access(ctx, identity)?.removedAt;
  const emailAt = ctx.db.emailRestriction?.email.find(email)?.removedAt;
  return memberAt && emailAt ? (micros(memberAt) > micros(emailAt) ? memberAt : emailAt) : memberAt ?? emailAt;
}
function canRejoin(ctx: Ctx, email: string, identity = memberIdentityFor(ctx)) {
  const invite = ctx.db.invitation.email.find(email); if (!invite) return false;
  const removedAt = latestRemoval(ctx, email, identity);
  const existing = ctx.db.member.identity.find(identity);
  const grant = ctx.db.individualInvitationGrant?.email.find(email);
  // Una invitación histórica no rehabilita una baja cuya fecha no se conoce.
  if (existing?.status === 'removed' && !removedAt) return !!grant;
  return !removedAt || micros(grant?.issuedAt ?? invite.createdAt) > micros(removedAt);
}
/** Un canje preautenticación no demuestra una nueva identidad ni rehabilita una baja. */
export function legacySharedLinkAllowed(ctx: Ctx, email: string): boolean {
  if (isEmailBlocked(ctx, email) || ctx.db.emailRestriction?.email.find(email)?.removedAt) return false;
  const identity = ctx.db.memberEmail?.email.find(email)?.memberIdentity;
  return !identity || (ctx.db.member.identity.find(identity)?.status !== 'removed' && !access(ctx, identity)?.removedAt);
}
/** Compatibilidad con activación por correo: solo previsualiza elegibilidad; el canje real exige sesión verificada. */
export function activationAllowed(ctx: Ctx, input: Record<string, unknown>): boolean {
  if (!isNotificationService(ctx) || !ctx.db.notificationServiceConfig.id.find(0)?.enabled) {
    throw new SenderError('El servicio de notificaciones no está habilitado.');
  }
  let email: string;
  try { email = normalizeEmail(input.email); } catch { return false; }
  if (isEmailBlocked(ctx, email)) return false;
  const identity = ctx.db.memberEmail?.email.find(email)?.memberIdentity;
  if (ctx.db.invitation.email.find(email) && canRejoin(ctx, email, identity)) return true;
  if (!legacySharedLinkAllowed(ctx, email) || typeof input.tokenHash !== 'string' || !/^[0-9a-f]{64}$/i.test(input.tokenHash)) return false;
  const link = [...ctx.db.invitationLink.tokenHash.filter(input.tokenHash.toLowerCase())][0];
  return !!link && invitationLinkStatus(link, ms(ctx.timestamp)) === 'active';
}
export function markIndividualInvitation(ctx: Ctx, email: string) {
  assertEmailNotBlocked(ctx, email);
  const row = { email, issuedAt: ctx.timestamp };
  if (ctx.db.individualInvitationGrant?.email.find(email)) ctx.db.individualInvitationGrant.email.update(row);
  else ctx.db.individualInvitationGrant?.insert(row);
  event(ctx, 'invite', '', ctx.db.memberEmail?.email.find(email)?.memberIdentity, email);
}
export function cancelIndividualInvitation(ctx: Ctx, email: string) { ctx.db.individualInvitationGrant?.email.delete(email); }
export function recordInvitationRevoked(ctx: Ctx, email: string) { event(ctx, 'revoke_invitation', '', ctx.db.memberEmail?.email.find(email)?.memberIdentity, email); }
export function myMembershipAccess(ctx: Ctx) {
  const email = helpers.verifiedEmail(ctx);
  const blocked = isVerifiedMembershipBlocked(ctx, email);
  if (!blocked) recordVerifiedEmail(ctx, email);
  return { blocked, canRejoin: !blocked && canRejoin(ctx, email) };
}
export function joinIndividual(ctx: Ctx, displayName: string) {
  const email = helpers.verifiedEmail(ctx); recordVerifiedEmail(ctx, email);
  const identity = memberIdentityFor(ctx); const existing = ctx.db.member.identity.find(identity);
  if (existing?.status === 'active') {
    ctx.db.invitation.email.delete(email); cancelIndividualInvitation(ctx, email); cancelInvitationEmail(ctx, email); return;
  }
  const invite = ctx.db.invitation.email.find(email);
  if (!invite || !canRejoin(ctx, email)) {
    if (existing?.status === 'removed' || latestRemoval(ctx, email)) throw new SenderError('Tu acceso fue dado de baja. Necesitas una invitación individual posterior a la baja.');
    throw new SenderError('Tu correo no está en la lista autorizada del grupo.');
  }
  const name = helpers.requireDisplayName(displayName);
  if (existing) ctx.db.member.identity.update({ ...existing, status: 'active', isCreator: invite.isCreator });
  else ctx.db.member.insert({ identity, displayName: name, photoUrl: undefined, status: 'active', isCreator: invite.isCreator, joinedAt: ctx.timestamp });
  bindAdmissionEmail(ctx, email); saveAdmission(ctx, 'individual', email);
  ctx.db.invitation.email.delete(email); cancelIndividualInvitation(ctx, email); cancelInvitationEmail(ctx, email);
  event(ctx, existing ? 'rejoin' : 'join', '', identity, email); log(ctx, 'join', 'member', identity.toHexString());
}
export function invitationLinkStatus(row: Link, nowMs: number): string {
  if (!row.active) return 'inactive';
  if (row.expiresAt && ms(row.expiresAt) <= nowMs) return 'expired';
  if (row.maxUses !== undefined && row.usedCount >= row.maxUses) return 'exhausted';
  return 'active';
}
export function invitationLinkMetadata(row: Link, nowMs: number) {
  return { id: row.id, name: row.name, active: row.active, status: invitationLinkStatus(row, nowMs),
    createdAt: row.createdAt, expiresAt: row.expiresAt, maxUses: row.maxUses, usedCount: row.usedCount, version: row.version };
}
function metadataJson(row: Link, nowMs: number) {
  return { ...invitationLinkMetadata(row, nowMs), createdAt: ms(row.createdAt), expiresAt: row.expiresAt ? ms(row.expiresAt) : null,
    maxUses: row.maxUses ?? null, uses: row.usedCount };
}
function envelope(row: Link, nowMs: number) { return { ...metadataJson(row, nowMs), ciphertext: row.ciphertext, iv: row.iv, keyVersion: row.keyVersion }; }
function usableLink(ctx: Ctx, id: unknown) {
  const row = ctx.db.invitationLink.id.find(uuid(id));
  if (!row || invitationLinkStatus(row, ms(ctx.timestamp)) !== 'active') throw new SenderError('El enlace está desactivado, vencido o sin cupo. Genera uno nuevo.');
  return row;
}
function linkOptions(ctx: Ctx, input: Record<string, unknown>, defaults: boolean) {
  const name = text(input.name, 'El nombre del enlace', 120);
  const rawExpires = input.expiresAt === undefined && defaults ? ms(ctx.timestamp) + 7 * DAY_MS : input.expiresAt;
  if (rawExpires !== null && (typeof rawExpires !== 'number' || !Number.isSafeInteger(rawExpires) || rawExpires <= ms(ctx.timestamp) || rawExpires > 8_640_000_000_000_000)) {
    throw new SenderError('La fecha de vencimiento debe estar en el futuro o desactivarse.');
  }
  const maxUses = input.maxUses === null || input.maxUses === undefined ? undefined : input.maxUses;
  if (maxUses !== undefined && (typeof maxUses !== 'number' || !Number.isInteger(maxUses) || maxUses < 1 || maxUses > 4_294_967_295)) throw new SenderError('El cupo debe ser un número entero positivo.');
  return { name, expiresAt: rawExpires === null ? undefined : at(rawExpires as number), maxUses };
}
function createLink(ctx: Ctx, input: Record<string, unknown>) {
  const id = uuid(input.id); const previous = ctx.db.invitationLink.id.find(id);
  if (previous) return previous;
  const tokenHash = text(input.tokenHash, 'La huella del enlace', 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) throw new SenderError('La huella del enlace no es válida.');
  if ([...ctx.db.invitationLink.tokenHash.filter(tokenHash)].length) throw new SenderError('Este secreto ya está asociado a otro enlace.');
  const ciphertext = text(input.ciphertext, 'El secreto cifrado', 4096);
  const iv = text(input.iv, 'El vector del cifrado', 100);
  const keyVersion = text(input.keyVersion, 'La versión de la clave', 100);
  return ctx.db.invitationLink.insert({ id, ...linkOptions(ctx, input, true), tokenHash, ciphertext, iv, keyVersion,
    active: true, createdBy: memberIdentityFor(ctx), createdAt: ctx.timestamp, usedCount: 0, version: 1, deactivatedAt: undefined, replacementId: undefined });
}
export function createInvitationLink(ctx: Ctx, input: Record<string, unknown>) {
  helpers.requireCreator(ctx); const existed = ctx.db.invitationLink.id.find(uuid(input.id)); const row = createLink(ctx, input);
  if (!existed) { event(ctx, 'create_link', '', undefined); log(ctx, 'create', 'invitation_link', row.id); }
  return envelope(row, ms(ctx.timestamp));
}
export function copyInvitationLink(ctx: Ctx, input: Record<string, unknown>) {
  helpers.requireCreator(ctx); return envelope(usableLink(ctx, input.id), ms(ctx.timestamp));
}
export function configureInvitationLink(ctx: Ctx, input: Record<string, unknown>) {
  helpers.requireCreator(ctx); const row = usableLink(ctx, input.id);
  if (row.version !== input.expectedVersion) throw new SenderError('El enlace cambió. Actualiza la lista antes de guardar.');
  const options = linkOptions(ctx, input, false);
  if (options.maxUses !== undefined && options.maxUses < row.usedCount) throw new SenderError('El cupo no puede ser menor al número de incorporaciones existentes.');
  const next = { ...row, ...options, version: row.version + 1 };
  ctx.db.invitationLink.id.update(next); log(ctx, 'configure', 'invitation_link', row.id); return metadataJson(next, ms(ctx.timestamp));
}
export function revokeInvitationLink(ctx: Ctx, input: Record<string, unknown>) {
  helpers.requireCreator(ctx); const row = ctx.db.invitationLink.id.find(uuid(input.id));
  if (!row) throw new SenderError('El enlace no existe.');
  if (!row.active) return metadataJson(row, ms(ctx.timestamp));
  if (input.expectedVersion !== undefined && row.version !== input.expectedVersion) throw new SenderError('El enlace cambió. Revisa la acción otra vez.');
  const next = { ...row, active: false, deactivatedAt: ctx.timestamp, version: row.version + 1 };
  ctx.db.invitationLink.id.update(next); log(ctx, 'deactivate', 'invitation_link', row.id);
  return metadataJson(next, ms(ctx.timestamp));
}
export function replaceInvitationLink(ctx: Ctx, input: Record<string, unknown>) {
  helpers.requireCreator(ctx); const previousId = uuid(input.previousId); const id = uuid(input.id);
  if (id === previousId) throw new SenderError('El nuevo enlace necesita un identificador diferente.');
  const previous = ctx.db.invitationLink.id.find(previousId);
  if (!previous) throw new SenderError('El enlace anterior no existe.');
  const existing = ctx.db.invitationLink.id.find(id);
  if (existing) {
    if (previous.replacementId !== id) throw new SenderError('Este identificador ya pertenece a otro enlace.');
    return envelope(existing, ms(ctx.timestamp));
  }
  if (previous.replacementId) throw new SenderError('Este enlace ya fue reemplazado. Actualiza la lista.');
  const row = createLink(ctx, input);
  ctx.db.invitationLink.id.update({ ...previous, active: false, deactivatedAt: previous.deactivatedAt ?? ctx.timestamp,
    replacementId: row.id, version: previous.version + 1 });
  log(ctx, 'replace', 'invitation_link', previous.id); return envelope(row, ms(ctx.timestamp));
}
/** Se ejecuta íntegramente en una transacción: cupo, estado, correo y generación cambian juntos. */
export function joinWithInvitationLink(ctx: Ctx, token: string, displayName: string) {
  const email = helpers.verifiedEmail(ctx); recordVerifiedEmail(ctx, email);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new SenderError('El enlace de invitación no está disponible.');
  const tokenHash = Array.from(sha256(new TextEncoder().encode(token)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const row = [...ctx.db.invitationLink.tokenHash.filter(tokenHash)][0];
  if (!row) throw new SenderError('El enlace de invitación no está disponible.');
  const identity = memberIdentityFor(ctx); const existing = ctx.db.member.identity.find(identity);
  if (existing?.status === 'active') return { memberIdentity: identity.toHexString(), generation: access(ctx, identity)?.generation ?? 0, alreadyMember: true };
  if (invitationLinkStatus(row, ms(ctx.timestamp)) !== 'active') throw new SenderError('El enlace de invitación está desactivado, vencido o sin cupo.');
  if (existing?.status === 'removed' || latestRemoval(ctx, email)) throw new SenderError('Tu acceso fue dado de baja. Necesitas una invitación individual posterior a la baja.');
  const name = helpers.requireDisplayName(displayName);
  ctx.db.member.insert({ identity, displayName: name, photoUrl: undefined, status: 'active', isCreator: false, joinedAt: ctx.timestamp });
  bindAdmissionEmail(ctx, email); const generation = saveAdmission(ctx, 'invitation_link', row.id);
  ctx.db.invitationLink.id.update({ ...row, usedCount: row.usedCount + 1, version: row.version + 1 });
  ctx.db.invitation.email.delete(email); cancelIndividualInvitation(ctx, email); cancelInvitationEmail(ctx, email);
  event(ctx, 'join_link', '', identity, email); log(ctx, 'join', 'member', identity.toHexString());
  return { memberIdentity: identity.toHexString(), generation, alreadyMember: false };
}
function restriction(ctx: Ctx, email: string, blocked: boolean, reason: string, removedAt?: Timestamp) {
  const previous = ctx.db.emailRestriction?.email.find(email);
  const row = { email, blocked, reason, removedAt: removedAt ?? previous?.removedAt,
    blockedAt: blocked ? previous?.blockedAt ?? ctx.timestamp : undefined, updatedBy: memberIdentityFor(ctx), updatedAt: ctx.timestamp };
  if (previous) ctx.db.emailRestriction?.email.update(row); else ctx.db.emailRestriction?.insert(row);
}
function assertRemovalAllowed(ctx: Ctx, identity: Person, bulk: boolean) {
  if (identity.isEqual(memberIdentityFor(ctx))) throw new SenderError('No puedes darte de baja ni bloquearte a ti mismo.');
  if (ctx.db.appConfig.id.find(0)?.owner.isEqual(identity)) throw new SenderError('No se puede dar de baja al propietario.');
  const row = ctx.db.member.identity.find(identity); if (!row) throw new SenderError('Ese miembro no existe.');
  if (bulk && row.isCreator) throw new SenderError('Los administradores quedan fuera de las acciones masivas.');
  if (row.status === 'active' && row.isCreator && [...ctx.db.member.iter()].filter((member) => member.status === 'active' && member.isCreator).length <= 1) {
    throw new SenderError('Debe conservarse al menos un administrador activo.');
  }
  return row;
}
export function removeMember(ctx: Ctx, identity: Person, options: { block?: boolean; reason?: string; bulk?: boolean } = {}) {
  helpers.requireCreator(ctx); const row = assertRemovalAllowed(ctx, identity, options.bulk === true);
  const reason = options.reason?.trim() ?? '';
  const emails = [...(ctx.db.memberEmail?.memberIdentity.filter(identity) ?? [])].map((entry) => entry.email);
  if (options.block && !emails.length) throw new SenderError('El correo está pendiente de vincular. Da de baja la membresía o espera una sesión verificada para bloquear su correo.');
  const previous = access(ctx, identity); const removedAt = previous?.removedAt ?? ctx.timestamp;
  const state = { memberIdentity: identity, generation: previous?.generation ?? 0, origin: previous?.origin ?? 'unknown',
    sourceId: previous?.sourceId, admittedAt: previous?.admittedAt ?? row.joinedAt, removedAt };
  if (previous) ctx.db.memberAccess?.memberIdentity.update(state); else ctx.db.memberAccess?.insert(state);
  for (const email of emails) {
    restriction(ctx, email, options.block || !!ctx.db.emailRestriction?.email.find(email)?.blocked, reason, removedAt);
    // Una invitación emitida antes o durante la baja no puede rehabilitarla.
    ctx.db.invitation.email.delete(email); cancelIndividualInvitation(ctx, email); cancelInvitationEmail(ctx, email);
  }
  if (row.status === 'active') {
    ctx.db.member.identity.update({ ...row, status: 'removed' });
    removeGroupMember(ctx, identity);
  }
  // El agente y otros datos privados se conservan; sus handlers exigen membresía activa.
  event(ctx, options.block ? 'block' : 'remove', reason, identity, emails[0]);
  log(ctx, options.block ? 'block' : 'remove', 'member', identity.toHexString());
}
function runOperation(ctx: Ctx, operationId: unknown, request: Record<string, unknown>, execute: () => Record<string, unknown>): Record<string, unknown> {
  helpers.requireCreator(ctx); const id = uuid(operationId); const serialized = JSON.stringify(request);
  const previous = ctx.db.adminAccessOperation.id.find(id);
  if (previous) {
    if (!previous.actor.isEqual(memberIdentityFor(ctx)) || previous.request !== serialized) throw new SenderError('Este envío ya corresponde a otra operación.');
    return JSON.parse(previous.result) as Record<string, unknown>;
  }
  const result = { operationId: id, ...execute() };
  ctx.db.adminAccessOperation.insert({ id, actor: memberIdentityFor(ctx), request: serialized, result: JSON.stringify(result), createdAt: ctx.timestamp });
  return result;
}
export function adminMemberAccess(ctx: Ctx, input: Record<string, unknown>) {
  const identity = person(input.identity); const generation = input.generation;
  if (!Number.isInteger(generation) || (generation as number) < 0) throw new SenderError('La generación del acceso no es válida.');
  if (input.action !== 'remove' && input.action !== 'block') throw new SenderError('La acción no es válida.');
  const action = input.action; const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 1000) : '';
  const bulk = input.bulk === true; const invitationLinkId = input.invitationLinkId === undefined ? undefined : uuid(input.invitationLinkId);
  return runOperation(ctx, input.operationId, { identity: identity.toHexString(), generation, action, reason, bulk, invitationLinkId }, () => {
    const current = access(ctx, identity);
    if ((current?.generation ?? 0) !== generation || (invitationLinkId && (current?.origin !== 'invitation_link' || current.sourceId !== invitationLinkId))) {
      return { status: 'skipped', message: 'El acceso cambió desde la revisión. Se conservó la reincorporación posterior.', identity: identity.toHexString(), generation: current?.generation ?? 0 };
    }
    const row = ctx.db.member.identity.find(identity);
    if (!row || (row.status !== 'active' && action === 'remove')) return { status: 'skipped', message: 'Esta membresía ya estaba dada de baja.', identity: identity.toHexString(), generation };
    removeMember(ctx, identity, { block: action === 'block', reason, bulk });
    return { status: 'applied', message: action === 'block' ? 'Correo bloqueado y acceso cerrado.' : 'Acceso dado de baja. Se conservaron sus aportes.', identity: identity.toHexString(), generation };
  });
}
export function blockEmail(ctx: Ctx, input: Record<string, unknown>) {
  const email = normalizeEmail(input.email); const reason = text(input.reason, 'El motivo', 1000);
  return runOperation(ctx, input.operationId, { email, reason, action: 'block_email' }, () => {
    const binding = ctx.db.memberEmail.email.find(email);
    if (binding) removeMember(ctx, binding.memberIdentity, { block: true, reason });
    else { restriction(ctx, email, true, reason); event(ctx, 'block_email', reason, undefined, email); }
    ctx.db.invitation.email.delete(email); cancelIndividualInvitation(ctx, email); cancelInvitationEmail(ctx, email);
    return { status: 'applied', email, message: 'Correo bloqueado. Su contenido se conserva.' };
  });
}
export function unblockEmail(ctx: Ctx, input: Record<string, unknown>) {
  const email = normalizeEmail(input.email);
  return runOperation(ctx, input.operationId, { email, action: 'unblock_email' }, () => {
    const binding = ctx.db.memberEmail.email.find(email);
    const emails = binding ? [...ctx.db.memberEmail.memberIdentity.filter(binding.memberIdentity)].map(row => row.email) : [email];
    for (const alias of emails) {
      const previous = ctx.db.emailRestriction.email.find(alias);
      if (previous?.blocked) { restriction(ctx, alias, false, previous.reason); event(ctx, 'unblock_email', '', binding?.memberIdentity, alias); }
    }
    return { status: 'applied', email, affectedEmails: emails, message: 'Correos vinculados desbloqueados. Para regresar necesita una invitación individual.' };
  });
}
export function adminMembers(db: ViewDb) {
  return [...db.member.iter()].map((row) => {
    const state = db.memberAccess.memberIdentity.find(row.identity);
    const emails = [...db.memberEmail.memberIdentity.filter(row.identity)].map((entry) => entry.email).sort();
    const blocked = emails.some((email) => db.emailRestriction.email.find(email)?.blocked);
    return { identity: row.identity, displayName: row.displayName, status: blocked ? 'blocked' : row.status, isCreator: row.isCreator,
      email: emails[0], emails, generation: state?.generation ?? 0, origin: state?.origin ?? 'unknown',
      invitationLinkId: state?.origin === 'invitation_link' ? state.sourceId : undefined, joinedAt: row.joinedAt, removedAt: state?.removedAt };
  });
}
export function adminMembershipSnapshot(ctx: Ctx) {
  helpers.requireCreator(ctx);
  return {
    links: [...ctx.db.invitationLink.iter()].map((row) => metadataJson(row, ms(ctx.timestamp))),
    legacyLinks: legacyInvitationLinks(ctx),
    members: adminMembers(ctx.db).map((row) => ({ ...row, identity: row.identity.toHexString(), email: row.email ?? null,
      invitationLinkId: row.invitationLinkId ?? null, joinedAt: ms(row.joinedAt), removedAt: row.removedAt ? ms(row.removedAt) : null })),
    blockedEmails: [...ctx.db.emailRestriction.iter()].filter((row) => row.blocked).map((row) => ({ email: row.email, reason: row.reason, blockedAt: row.blockedAt ? ms(row.blockedAt) : null })),
    admissions: [...ctx.db.memberAdmission.iter()].map((row) => ({ ...row, memberIdentity: row.memberIdentity.toHexString(), sourceId: row.sourceId ?? null, joinedAt: ms(row.joinedAt) })),
    events: [...ctx.db.membershipEvent.iter()].map((row) => ({ id: row.id.toString(), memberIdentity: row.memberIdentity?.toHexString() ?? null,
      email: row.email ?? null, action: row.action, reason: row.reason, at: ms(row.at) })),
  };
}
