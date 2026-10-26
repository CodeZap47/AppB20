import { displayNameError } from '@b20/core';
import type { Id, Invitation, Member } from './types';
import type { AdminAccessInput, AdminAccessResult, AdminMembershipSnapshot, InvitationLink, InvitationLinkInput, InvitationLinkResult, LegacyInvitationLink, MembershipEvent } from './membershipTypes';

interface MembershipState { members: Member[]; invitations: Invitation[] }
interface Context {
  state(): MembershipState; viewer(): Id; active(): Member; alive(): void; now(): Date; emit(): void;
  removed(identity: Id): void;
}
interface Access { generation: number; origin: string; sourceId?: string; joinedAt: number; removedAt: number | null; removedOrder?: number }
interface Restriction { blocked: boolean; reason: string; blockedAt?: number; removedAt?: number; removedOrder?: number }
interface StoredLink extends InvitationLink { token: string; active: boolean; replacementId?: string }
interface Operation { actor: Id; signature: string; result: unknown }
interface Store {
  verified: Map<Id, string[]>; ownerId?: Id; access: Map<Id, Access>; restrictions: Map<string, Restriction>;
  links: Map<string, StoredLink>; events: MembershipEvent[]; admissions: AdminMembershipSnapshot['admissions'];
  legacyLinks: Map<string, LegacyInvitationLink>;
  operations: Map<string, Operation>; grants: Map<string, number>; sequence: number;
}
const stores = new WeakMap<MembershipState, Store>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function storage(state: MembershipState): Store {
  let store = stores.get(state);
  if (!store) {
    store = { verified: new Map(), access: new Map(), restrictions: new Map(), links: new Map(), legacyLinks: new Map(), events: [], admissions: [], operations: new Map(), grants: new Map(), sequence: 0 };
    stores.set(state, store);
  }
  return store;
}
function email(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 320 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new Error('Ese correo no es válido.');
  return normalized;
}
function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error('El identificador del intento debe ser UUID.');
  return value.toLowerCase();
}
/** Explicit fictitious login fixtures only; never infer an address from a member name. */
export function seedDemoMembership(state: MembershipState, verified: Record<Id, string | string[]>, ownerId?: Id) {
  const store = storage(state);
  for (const [identity, values] of Object.entries(verified)) {
    const list = (Array.isArray(values) ? values : [values]).map(email);
    if (list.some((value) => !value.endsWith('@ejemplo.mx'))) throw new Error('La simulación solo admite correos ficticios @ejemplo.mx.');
    store.verified.set(identity, [...new Set(list)]);
  }
  if (ownerId) store.ownerId = ownerId;
}

/** Metadatos ficticios, sin inventar secretos ni atribuir incorporaciones históricas. */
export function seedDemoLegacyInvitationLinks(state: MembershipState, links: LegacyInvitationLink[]) {
  const store = storage(state);
  for (const link of links) store.legacyLinks.set(link.id, structuredClone(link));
}

/** Private state is shared by simulated sessions; no API, email or real login is contacted. */
export class DemoMembershipStore {
  private store: Store;
  constructor(private ctx: Context) { this.store = storage(ctx.state()); }
  private creator(): Member {
    const me = this.ctx.active();
    if (!me.isCreator) throw new Error('Solo los creadores de la app pueden hacer esto.');
    return me;
  }
  private addresses(identity: Id): string[] { return this.store.verified.get(identity) ?? []; }
  private verifiedEmail(): string {
    const value = this.addresses(this.ctx.viewer())[0];
    if (!value) throw new Error('La cuenta de prueba necesita un correo ficticio verificado para incorporarse.');
    return value;
  }
  private assertEmail(value: string) {
    if (this.blockedFor(value)) throw new Error('Este correo está bloqueado. Contacta a la administración.');
    const owner = [...this.store.verified.entries()].find(([identity, values]) => identity !== this.ctx.viewer()
      && this.ctx.state().members.some((member) => member.id === identity) && values.includes(value));
    if (owner) throw new Error('Este correo ya pertenece a otra membresía. Solicita vincular explícitamente tu cuenta.');
  }
  private blockedFor(value: string): boolean {
    const bound = [...this.store.verified.entries()].find(([identity, values]) => values.includes(value)
      && this.ctx.state().members.some((member) => member.id === identity));
    return [value, ...(bound?.[1] ?? this.addresses(this.ctx.viewer()))].some((address) => this.store.restrictions.get(address)?.blocked);
  }
  private event(action: string, reason = '', memberIdentity: Id | null = null, address: string | null = null) {
    this.store.events.push({ id: crypto.randomUUID(), action, reason, memberIdentity, email: address, at: this.ctx.now().getTime() });
  }
  private status(link: StoredLink): string {
    return !link.active ? 'inactive' : link.expiresAt !== null && link.expiresAt <= this.ctx.now().getTime() ? 'expired'
      : link.maxUses !== null && link.uses >= link.maxUses ? 'exhausted' : 'active';
  }
  private link(id: string, usable = false): StoredLink {
    const row = this.store.links.get(uuid(id));
    if (!row) throw new Error('El enlace no existe.');
    if (usable && this.status(row) !== 'active') throw new Error('El enlace está desactivado, vencido o sin cupo. Genera uno nuevo.');
    return row;
  }
  private options(input: { name: string; expiresAt?: number | null; maxUses?: number | null }, defaults: boolean) {
    const name = input.name.trim();
    if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('El nombre del enlace no es válido.');
    const expiresAt = input.expiresAt === undefined && defaults ? this.ctx.now().getTime() + 7 * 86_400_000 : input.expiresAt;
    if (expiresAt !== null && (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= this.ctx.now().getTime())) throw new Error('La fecha de vencimiento debe estar en el futuro o desactivarse.');
    const maxUses = input.maxUses ?? null;
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1_000_000)) throw new Error('El cupo debe ser un número entero positivo.');
    return { name, expiresAt, maxUses };
  }
  private url(link: StoredLink): string {
    let base = 'https://demo.b20.local/';
    if (typeof location !== 'undefined' && ['https:', 'http:'].includes(location.protocol)) base = `${location.origin}${location.pathname}`;
    const url = new URL(base); url.hash = `/invitacion?token=${link.token}`; return url.href;
  }
  private create(input: InvitationLinkInput): StoredLink {
    const id = uuid(input.requestId); const old = this.store.links.get(id);
    if (old) return old;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const row: StoredLink = { id, ...this.options(input, true), token, active: true, status: 'active', createdAt: this.ctx.now().getTime(), uses: 0, version: 1 };
    this.store.links.set(id, row); this.event('create_link'); return row;
  }
  async getAdminMembership(): Promise<AdminMembershipSnapshot> {
    this.creator();
    return structuredClone({ links: [...this.store.links.values()].map(({ token: _token, active: _active, replacementId: _replacementId, ...link }) => ({ ...link, status: this.status(this.store.links.get(link.id)!) })),
      legacyLinks: [...this.store.legacyLinks.values()].map((link) => ({ ...link, status: link.revokedAt !== null ? 'inactive' as const : link.expiresAt <= this.ctx.now().getTime() ? 'expired' as const : link.usedCount >= link.maxUses ? 'exhausted' as const : 'active' as const })),
      members: this.ctx.state().members.map((member) => {
        const current = this.store.access.get(member.id); const emails = [...this.addresses(member.id)].sort();
        return { identity: member.id, displayName: member.displayName, isCreator: member.isCreator,
          status: emails.some((value) => this.store.restrictions.get(value)?.blocked) ? 'blocked' : member.status,
          email: emails[0] ?? null, emails, generation: current?.generation ?? 0, origin: current?.origin ?? 'unknown',
          invitationLinkId: current?.origin === 'invitation_link' ? current.sourceId ?? null : null,
          joinedAt: member.joinedAt.getTime(), removedAt: current?.removedAt ?? null };
      }), blockedEmails: [...this.store.restrictions.entries()].filter(([, row]) => row.blocked).map(([email, row]) => ({ email, reason: row.reason, blockedAt: row.blockedAt! })),
      admissions: this.store.admissions, events: this.store.events });
  }
  async createInvitationLink(input: InvitationLinkInput): Promise<InvitationLinkResult> {
    this.creator(); const row = this.create(input);
    if (this.status(row) !== 'active') throw new Error('Este enlace ya no está activo.');
    this.ctx.emit(); return { id: row.id, url: this.url(row) };
  }
  async copyInvitationLink(id: string): Promise<string> { this.creator(); return this.url(this.link(id, true)); }
  async replaceInvitationLink(id: string, input: InvitationLinkInput): Promise<InvitationLinkResult> {
    this.creator(); const previous = this.link(id); const nextId = uuid(input.requestId);
    if (nextId === previous.id) throw new Error('El enlace nuevo necesita un identificador distinto.');
    const existing = this.store.links.get(nextId);
    if (existing && previous.replacementId !== nextId) throw new Error('Este identificador ya pertenece a otro enlace.');
    if (previous.replacementId && previous.replacementId !== nextId) throw new Error('Este enlace ya fue reemplazado. Actualiza la lista.');
    const next = existing ?? this.create(input);
    if (this.status(next) !== 'active') throw new Error('Este enlace ya no está activo.');
    if (!previous.replacementId) { previous.active = false; previous.replacementId = next.id; previous.version++; this.event('replace_link'); }
    this.ctx.emit(); return { id: next.id, url: this.url(next) };
  }
  configureInvitationLink(input: { id: string; name: string; expiresAt: number | null; maxUses: number | null; expectedVersion: number }) {
    this.creator(); const row = this.link(input.id, true);
    if (row.version !== input.expectedVersion) throw new Error('El enlace cambió. Actualiza la lista antes de guardar.');
    const options = this.options(input, false);
    if (options.maxUses !== null && options.maxUses < row.uses) throw new Error('El cupo no puede ser menor al número de incorporaciones existentes.');
    Object.assign(row, options); row.version++; this.event('configure_link'); this.ctx.emit();
  }
  revokeInvitationLink(id: string, expectedVersion?: number) {
    this.creator(); const row = this.link(id);
    if (!row.active) return;
    if (expectedVersion !== undefined && expectedVersion !== row.version) throw new Error('El enlace cambió. Revisa la acción otra vez.');
    row.active = false; row.version++; this.event('deactivate_link'); this.ctx.emit();
  }
  revokeLegacyInvitationLink(id: string) {
    this.creator(); const row = this.store.legacyLinks.get(id);
    if (!row) throw new Error('El enlace anterior no existe.');
    if (row.revokedAt !== null) return;
    row.revokedAt = this.ctx.now().getTime(); row.status = 'inactive';
    this.event('deactivate_legacy_link'); this.ctx.emit();
  }
  private admitted(origin: string, sourceId: string) {
    const identity = this.ctx.viewer(); const previous = this.store.access.get(identity);
    const row: Access = { generation: (previous?.generation ?? 0) + 1, origin, sourceId, joinedAt: this.ctx.now().getTime(), removedAt: null };
    this.store.access.set(identity, row);
    this.store.admissions.push({ id: `${identity}:${row.generation}`, memberIdentity: identity, generation: row.generation, origin, sourceId, joinedAt: row.joinedAt });
  }
  private removedFor(value: string): { at?: number; order?: number } {
    const current = this.store.access.get(this.ctx.viewer()); const restriction = this.store.restrictions.get(value);
    return { at: Math.max(current?.removedAt ?? 0, restriction?.removedAt ?? 0) || undefined,
      order: Math.max(current?.removedOrder ?? 0, restriction?.removedOrder ?? 0) || undefined };
  }
  private canRejoin(value: string): boolean {
    const invite = this.ctx.state().invitations.find((row) => row.email === value); if (!invite) return false;
    const current = this.ctx.state().members.find((row) => row.id === this.ctx.viewer()); const removed = this.removedFor(value);
    const grant = this.store.grants.get(value);
    if (current?.status === 'removed' && !removed.at) return grant !== undefined;
    return removed.order !== undefined ? (grant ?? 0) > removed.order : !removed.at || invite.createdAt.getTime() > removed.at;
  }
  joinWithInvitationLink(token: string, displayName: string) {
    this.ctx.alive(); const value = this.verifiedEmail(); this.assertEmail(value);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('El enlace de invitación no está disponible.');
    const row = [...this.store.links.values()].find((link) => link.token === token);
    if (!row) throw new Error('El enlace de invitación no está disponible.');
    const state = this.ctx.state(); const existing = state.members.find((member) => member.id === this.ctx.viewer());
    if (existing?.status === 'active') return;
    if (this.status(row) !== 'active') throw new Error('El enlace de invitación está desactivado, vencido o sin cupo.');
    if (existing?.status === 'removed' || this.removedFor(value).at) throw new Error('Tu acceso fue dado de baja. Necesitas una invitación individual posterior a la baja.');
    const error = displayNameError(displayName); if (error) throw new Error(error);
    state.members.push({ id: this.ctx.viewer(), displayName: displayName.trim(), status: 'active', isCreator: false, joinedAt: this.ctx.now() });
    this.admitted('invitation_link', row.id); row.uses++; row.version++;
    state.invitations = state.invitations.filter((invite) => invite.email !== value); this.store.grants.delete(value);
    this.event('join_link', '', this.ctx.viewer(), value); this.ctx.emit();
  }
  joinGroup(displayName: string) {
    this.ctx.alive(); const state = this.ctx.state(); const existing = state.members.find((row) => row.id === this.ctx.viewer());
    if (existing?.status === 'active') { const value = this.addresses(this.ctx.viewer())[0]; if (value) this.assertEmail(value); return; }
    const error = displayNameError(displayName); if (error) throw new Error(error);
    const value = this.addresses(this.ctx.viewer())[0];
    if (value) this.assertEmail(value);
    const invite = value ? state.invitations.find((row) => row.email === value) : undefined;
    if (!value || !invite || !this.canRejoin(value)) {
      if (existing?.status === 'removed' || value && this.removedFor(value).at) throw new Error('Tu acceso fue dado de baja. Necesitas una invitación individual posterior a la baja.');
      throw new Error('Tu correo no está en la lista autorizada del grupo.');
    }
    if (existing) { existing.status = 'active'; existing.isCreator = invite.isCreator; }
    else state.members.push({ id: this.ctx.viewer(), displayName: displayName.trim(), isCreator: invite.isCreator, status: 'active', joinedAt: this.ctx.now() });
    this.admitted('individual', value); state.invitations = state.invitations.filter((row) => row.email !== value); this.store.grants.delete(value);
    this.event(existing ? 'rejoin' : 'join', '', this.ctx.viewer(), value); this.ctx.emit();
  }
  inviteMember(value: string, isCreator: boolean) {
    this.creator(); const normalized = email(value);
    if (this.blockedFor(normalized)) throw new Error('Este correo está bloqueado. Desbloquéalo antes de invitar.');
    const previous = this.ctx.state().invitations.find((row) => row.email === normalized);
    this.store.grants.set(normalized, ++this.store.sequence);
    if (previous) previous.isCreator = isCreator;
    else this.ctx.state().invitations.push({ email: normalized, isCreator, invitedBy: this.ctx.viewer(), createdAt: this.ctx.now() });
    this.event('invite', '', null, normalized); this.ctx.emit();
  }
  revokeInvitation(value: string) {
    this.creator(); const normalized = email(value);
    this.ctx.state().invitations = this.ctx.state().invitations.filter((row) => row.email !== normalized);
    this.store.grants.delete(normalized); this.event('revoke_invitation', '', null, normalized); this.ctx.emit();
  }
  private remove(identity: Id, block: boolean, reason: string, bulk: boolean) {
    const me = this.creator(); const state = this.ctx.state(); const member = state.members.find((row) => row.id === identity);
    if (identity === me.id) throw new Error('No puedes darte de baja ni bloquearte a ti mismo.');
    if (identity === this.store.ownerId) throw new Error('No se puede dar de baja al propietario.');
    if (!member) throw new Error('Ese miembro no existe.');
    if (bulk && member.isCreator) throw new Error('Los administradores quedan fuera de las acciones masivas.');
    if (member.status === 'active' && member.isCreator && state.members.filter((row) => row.status === 'active' && row.isCreator).length <= 1) throw new Error('Debe conservarse al menos un administrador activo.');
    const emails = this.addresses(identity);
    if (block && !emails.length) throw new Error('El correo está pendiente de vincular. Da de baja la membresía o espera una sesión verificada para bloquear su correo.');
    const previous = this.store.access.get(identity); const removedAt = previous?.removedAt ?? this.ctx.now().getTime(); const removedOrder = previous?.removedOrder ?? ++this.store.sequence;
    this.store.access.set(identity, { generation: previous?.generation ?? 0, origin: previous?.origin ?? 'unknown', sourceId: previous?.sourceId,
      joinedAt: previous?.joinedAt ?? member.joinedAt.getTime(), removedAt, removedOrder });
    for (const value of emails) {
      const prior = this.store.restrictions.get(value);
      this.store.restrictions.set(value, { ...prior, blocked: block || !!prior?.blocked, reason, removedAt, removedOrder,
        ...(block ? { blockedAt: prior?.blockedAt ?? this.ctx.now().getTime() } : {}) });
      state.invitations = state.invitations.filter((row) => row.email !== value); this.store.grants.delete(value);
    }
    if (member.status === 'active') { member.status = 'removed'; this.ctx.removed(identity); }
    this.event(block ? 'block' : 'remove', reason, identity, emails[0] ?? null);
  }
  removeMember(identity: Id) { this.remove(identity, false, '', false); this.ctx.emit(); }
  private operation<T>(operationId: string, request: unknown, run: () => T): T {
    const actor = this.creator().id; const id = uuid(operationId); const signature = JSON.stringify(request); const previous = this.store.operations.get(id);
    if (previous) {
      if (previous.actor !== actor || previous.signature !== signature) throw new Error('Este envío ya corresponde a otra operación.');
      return structuredClone(previous.result) as T;
    }
    const result = run(); this.store.operations.set(id, { actor, signature, result: structuredClone(result) }); this.ctx.emit(); return result;
  }
  async manageMemberAccess(input: AdminAccessInput): Promise<AdminAccessResult> {
    if (!Number.isInteger(input.generation) || input.generation < 0 || !['remove', 'block'].includes(input.action)) throw new Error('La acción o generación del acceso no es válida.');
    const request = { identity: input.identity, generation: input.generation, action: input.action, reason: input.reason.trim().slice(0, 1000), bulk: input.bulk,
      invitationLinkId: input.invitationLinkId === undefined ? undefined : uuid(input.invitationLinkId) };
    return this.operation<AdminAccessResult>(input.operationId, request, () => {
      const current = this.store.access.get(input.identity); const generation = current?.generation ?? 0;
      const common = { operationId: input.operationId, identity: input.identity, generation };
      if (generation !== input.generation || request.invitationLinkId && (current?.origin !== 'invitation_link' || current.sourceId !== request.invitationLinkId)) {
        return { ...common, status: 'skipped', message: 'El acceso cambió desde la revisión. Se conservó la reincorporación posterior.' };
      }
      const member = this.ctx.state().members.find((row) => row.id === input.identity);
      if (!member || member.status !== 'active' && input.action === 'remove') return { ...common, status: 'skipped', message: 'Esta membresía ya estaba dada de baja.' };
      this.remove(input.identity, input.action === 'block', request.reason, input.bulk);
      return { ...common, status: 'applied', message: input.action === 'block' ? 'Correo bloqueado y acceso cerrado.' : 'Acceso dado de baja. Se conservaron sus aportes.' };
    });
  }
  blockEmail(value: string, reason: string, operationId: string) {
    const normalized = email(value); const cleaned = reason.trim();
    if (!cleaned || cleaned.length > 1000) throw new Error('Escribe el motivo del bloqueo (hasta 1000 caracteres).');
    this.operation(operationId, { email: normalized, reason: cleaned, action: 'block_email' }, () => {
      // Membership presence is checked independently: login fixtures may represent future users.
      const memberIdentity = [...this.store.verified.entries()].find(([id, values]) => values.includes(normalized) && this.ctx.state().members.some((row) => row.id === id))?.[0];
      if (memberIdentity) this.remove(memberIdentity, true, cleaned, false);
      else { const prior = this.store.restrictions.get(normalized); this.store.restrictions.set(normalized, { ...prior, blocked: true, reason: cleaned, blockedAt: prior?.blockedAt ?? this.ctx.now().getTime() }); this.event('block_email', cleaned, null, normalized); }
      this.ctx.state().invitations = this.ctx.state().invitations.filter((row) => row.email !== normalized); this.store.grants.delete(normalized);
    });
  }
  unblockEmail(value: string, operationId: string) {
    const normalized = email(value);
    this.operation(operationId, { email: normalized, action: 'unblock_email' }, () => {
      const bound = [...this.store.verified.entries()].find(([identity, values]) => values.includes(normalized)
        && this.ctx.state().members.some((member) => member.id === identity));
      for (const address of new Set([normalized, ...(bound?.[1] ?? [])])) {
        const row = this.store.restrictions.get(address); if (row?.blocked) { row.blocked = false; row.blockedAt = undefined; this.event('unblock_email', '', bound?.[0] ?? null, address); }
      }
    });
  }
  async getMyMembershipAccess(): Promise<{ blocked: boolean; canRejoin: boolean }> {
    this.ctx.alive(); const value = this.addresses(this.ctx.viewer())[0];
    if (!value) return { blocked: false, canRejoin: false };
    const blocked = this.blockedFor(value);
    if (!blocked) this.assertEmail(value);
    return { blocked, canRejoin: !blocked && this.canRejoin(value) };
  }
}
