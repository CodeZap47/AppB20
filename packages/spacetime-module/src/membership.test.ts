import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import { sha256 } from '@noble/hashes/sha2.js';

vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }),
    table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import { invite_member, join_group, on_connect, link_auth_identity, subjects, assert_active_member, remove_member } from './index';
import { adminMemberAccess, adminMembershipSnapshot, blockEmail, configureInvitationLink, copyInvitationLink,
  createInvitationLink, joinWithInvitationLink, myMembershipAccess, replaceInvitationLink, revokeInvitationLink, unblockEmail } from './membershipHandlers';
import type { Ctx } from './index';

const ident = (letter: string) => Identity.fromString(letter.repeat(64));
const owner = ident('f'); const student = ident('a'); const other = ident('b'); const admin = ident('d');
const linkId = '00000000-0000-4000-8000-000000000001'; const nextId = '00000000-0000-4000-8000-000000000002';
const operationId = '00000000-0000-4000-8000-000000000003';
const token = 'a'.repeat(43); const nextToken = 'b'.repeat(43);
const hash = (value: string) => Array.from(sha256(new TextEncoder().encode(value)), byte => byte.toString(16).padStart(2, '0')).join('');
const key = (value: unknown): string => value instanceof Identity ? value.toHexString() : String(value);
function store(primaryKey: string, initial: Record<string, unknown>[] = []) {
  const rows = new Map(initial.map(row => [key(row[primaryKey]), row])); let serial = 1n;
  const insert = (row: Record<string, unknown>) => {
    const saved = row[primaryKey] === 0n ? { ...row, [primaryKey]: serial++ } : row;
    rows.set(key(saved[primaryKey]), saved); return saved;
  };
  return new Proxy({ rows, iter: () => rows.values(), insert }, { get(target, prop) {
    if (prop in target) return target[prop as keyof typeof target];
    return { find: (value: unknown) => [...rows.values()].find(row => key(row[String(prop)]) === key(value)),
      filter: (value: unknown) => [...rows.values()].filter(row => key(row[String(prop)]) === key(value)),
      update: (row: Record<string, unknown>) => { rows.set(key(row[primaryKey]), row); return row; },
      delete: (value: unknown) => rows.delete(key(value)) };
  } }) as ReturnType<typeof tableStore>;
}
// Interfaz de fixture deliberadamente abierta para representar índices del SDK.
function tableStore() { return {} as { rows: Map<string, Record<string, unknown>>; iter(): IterableIterator<Record<string, unknown>>; insert(row: Record<string, unknown>): Record<string, unknown>; [column: string]: any }; }
function setup() {
  let now = 1_800_000_000_000;
  const db = {
    appConfig: store('id', [{ id: 0, owner }]), authConfig: store('id', [{ id: 0, issuer: 'https://auth.spacetimedb.com/oidc', audiences: ['web'] }]),
    member: store('identity'), authIdentityLink: store('sessionIdentity'), invitation: store('email'), invitationEmail: store('email'),
    invitationLink: store('id'), memberEmail: store('email'), memberAccess: store('memberIdentity'), memberAdmission: store('id'),
    individualInvitationGrant: store('email'), emailRestriction: store('email'), membershipEvent: store('id'), adminAccessOperation: store('id'),
    fileServiceConfig: store('id'), aiServiceConfig: store('id'), notificationServiceConfig: store('id'), maintenanceService: store('id'),
    roomMember: store('key'), studyRoom: store('id'), changeLog: store('id'),
    subject: store('id', [{ id: 1n, name: 'Grupo' }]), agentProfile: store('owner', [{ owner: student, privateDraft: 'Solo del dueño' }]),
  };
  const mutable = { sender: owner, db, env: {}, timestamp: new Timestamp(BigInt(now) * 1000n), identity: ident('e'),
    senderAuth: { jwt: { issuer: 'https://auth.spacetimedb.com/oidc', audience: ['web'], fullPayload: { email: 'admin@example.com', email_verified: true } } },
  };
  const ctx = mutable as unknown as Ctx;
  const as = (sender: Identity, email = sender.isEqual(student) ? 'alumno@example.com' : sender.isEqual(other) ? 'otro@example.com' : 'admin@example.com') => {
    mutable.sender = sender; mutable.senderAuth.jwt.fullPayload = { email, email_verified: true };
  };
  const tick = (delta = 1000) => { now += delta; mutable.timestamp = new Timestamp(BigInt(now) * 1000n); };
  const create = (extra: Record<string, unknown> = {}) => { as(owner); return createInvitationLink(ctx, { id: linkId, name: 'Grupo B20', tokenHash: hash(token), ciphertext: 'ciphertext-original', iv: 'iv-original', keyVersion: 'v1', ...extra }); };
  const join = (sender = student) => { as(sender); return joinWithInvitationLink(ctx, token, 'Alumno'); };
  return { ctx, mutable, db, as, tick, create, join, now: () => now };
}

describe('Enlaces reutilizables y control privado de membresías', () => {
  it('caduca a siete días y snapshot solo revela metadatos y correos a Administración', () => {
    const { ctx, db, create, join, as, now } = setup(); const link = create();
    expect(link.expiresAt).toBe(now() + 7 * 86_400_000); expect(link.maxUses).toBeNull();
    join(); expect(db.member.rows.get(student.toHexString())?.isCreator).toBe(false);
    expect(() => adminMembershipSnapshot(ctx)).toThrow(/creadores/);
    as(owner); const snapshot = adminMembershipSnapshot(ctx);
    expect(snapshot.members[0]).toMatchObject({ email: 'alumno@example.com', generation: 1, origin: 'invitation_link', invitationLinkId: linkId });
    expect(JSON.stringify(snapshot)).not.toMatch(/ciphertext-original|iv-original|tokenHash/);
  });

  it('crear de nuevo el mismo UUID recupera exactamente el envelope persistido', () => {
    const { ctx, create } = setup(); const first = create();
    const retry = create({ tokenHash: hash(nextToken), ciphertext: 'otro-secreto', name: 'Otro nombre' });
    expect(retry).toEqual(first); expect(copyInvitationLink(ctx, { id: linkId }).ciphertext).toBe('ciphertext-original');
  });

  it('desactivar solo el enlace conserva membresía, aportes y origen', () => {
    const { ctx, db, create, join, as } = setup(); create(); join(); as(owner);
    revokeInvitationLink(ctx, { id: linkId }); revokeInvitationLink(ctx, { id: linkId });
    expect(db.member.rows.get(student.toHexString())?.status).toBe('active');
    expect(db.memberAdmission.rows.size).toBe(1);
    expect(() => copyInvitationLink(ctx, { id: linkId })).toThrow(/desactivado/);
    as(student); expect(() => assert_active_member(ctx, {})).not.toThrow();
    expect(joinWithInvitationLink(ctx, token, 'Alumno')).toMatchObject({ alreadyMember: true });
    as(other); expect(() => joinWithInvitationLink(ctx, token, 'Otro')).toThrow(/desactivado/);
  });

  it('reemplazar crea otro historial y una repetición conserva su secreto original', () => {
    const { ctx, db, create, join, as } = setup(); create(); join(); as(owner);
    const input = { previousId: linkId, id: nextId, name: 'Nuevo enlace', tokenHash: hash(nextToken), ciphertext: 'nuevo-secreto', iv: 'iv-nuevo', keyVersion: 'v2', expiresAt: null, maxUses: 2 };
    const first = replaceInvitationLink(ctx, input);
    expect(replaceInvitationLink(ctx, { ...input, ciphertext: 'retry-nuevo' })).toEqual(first);
    expect(first).toMatchObject({ expiresAt: null, usedCount: 0, ciphertext: 'nuevo-secreto' });
    expect(db.invitationLink.rows.get(linkId)).toMatchObject({ active: false, replacementId: nextId });
    expect(db.memberAccess.rows.get(student.toHexString())?.sourceId).toBe(linkId);
  });

  it('el último cupo admite solo una cuenta y los reintentos no consumen más plazas', () => {
    const { ctx, db, create, join, as } = setup(); create({ maxUses: 1 }); join();
    expect(joinWithInvitationLink(ctx, token, 'Alumno')).toMatchObject({ alreadyMember: true, generation: 1 });
    as(other); expect(() => joinWithInvitationLink(ctx, token, 'Otro')).toThrow(/cupo/);
    expect(db.invitationLink.rows.get(linkId)?.usedCount).toBe(1); expect(db.member.rows.size).toBe(1);
  });

  it('verifica correo, caducidad y versión al configurar', () => {
    const { ctx, mutable, create, as, now, tick } = setup(); const link = create({ expiresAt: null });
    configureInvitationLink(ctx, { id: linkId, expectedVersion: link.version, name: 'Cupo corto', expiresAt: now() + 1000, maxUses: 2 });
    expect(() => configureInvitationLink(ctx, { id: linkId, expectedVersion: link.version, name: 'Viejo', expiresAt: null, maxUses: null })).toThrow(/cambió/);
    as(student); mutable.senderAuth.jwt.fullPayload.email_verified = false;
    expect(() => joinWithInvitationLink(ctx, token, 'Alumno')).toThrow(/correo verificado/);
    mutable.senderAuth.jwt.fullPayload.email_verified = true; tick();
    expect(() => joinWithInvitationLink(ctx, token, 'Alumno')).toThrow(/vencido/);
  });

  it('una baja bloquea los enlaces y una invitación posterior recupera la misma membresía', () => {
    const { ctx, db, create, join, as, tick } = setup(); create(); join(); as(owner); tick();
    remove_member(ctx, { identity: student });
    expect(db.agentProfile.rows.get(student.toHexString())?.privateDraft).toBe('Solo del dueño');
    as(student); expect(subjects(ctx as never)).toEqual([]);
    expect(() => assert_active_member(ctx, {})).toThrow(/activo/);
    expect(() => joinWithInvitationLink(ctx, token, 'Nuevo nombre')).toThrow(/dado de baja/);
    expect(myMembershipAccess(ctx)).toEqual({ blocked: false, canRejoin: false });
    as(owner); tick(); invite_member(ctx, { email: 'alumno@example.com', isCreator: false });
    as(student); on_connect(ctx, {}); expect(myMembershipAccess(ctx).canRejoin).toBe(true);
    join_group(ctx, { displayName: 'Nuevo nombre' });
    expect(db.member.rows.size).toBe(1); expect(db.member.rows.get(student.toHexString())?.displayName).toBe('Alumno');
    expect(db.memberAccess.rows.get(student.toHexString())).toMatchObject({ generation: 2, origin: 'individual', removedAt: undefined });
  });

  it('una baja histórica requiere una reinvitación nueva demostrable', () => {
    const { ctx, db, as, tick } = setup();
    db.member.insert({ identity: student, displayName: 'Histórico', status: 'removed', isCreator: false, joinedAt: new Timestamp(1n) });
    db.invitation.insert({ email: 'alumno@example.com', isCreator: false, invitedBy: owner, createdAt: new Timestamp(1n) });
    as(student); expect(myMembershipAccess(ctx).canRejoin).toBe(false);
    expect(() => join_group(ctx, { displayName: 'Alumno' })).toThrow(/posterior/);
    as(owner); tick(); invite_member(ctx, { email: 'alumno@example.com', isCreator: false });
    as(student); join_group(ctx, { displayName: 'Alumno' });
    expect(db.member.rows.get(student.toHexString())?.status).toBe('active');
  });

  it('un bloqueo afecta correos nuevos, invitaciones e identidades vinculadas; desbloquear no activa', () => {
    const { ctx, db, as, create, join, tick } = setup(); create(); join(); as(owner);
    const linked = ident('c'); link_auth_identity(ctx, { sessionIdentity: linked, memberIdentity: student });
    blockEmail(ctx, { email: 'alumno@example.com', reason: 'Abuso', operationId });
    expect(() => invite_member(ctx, { email: 'alumno@example.com', isCreator: false })).toThrow(/bloqueado/);
    as(linked, 'alumno@example.com'); expect(myMembershipAccess(ctx)).toEqual({ blocked: true, canRejoin: false });
    expect(() => joinWithInvitationLink(ctx, token, 'Alumno')).toThrow(/bloqueado/);
    as(owner); unblockEmail(ctx, { email: 'alumno@example.com', operationId: nextId });
    expect(db.member.rows.get(student.toHexString())?.status).toBe('removed');
    as(linked, 'alumno@example.com'); expect(() => joinWithInvitationLink(ctx, token, 'Alumno')).toThrow(/dado de baja/);
    as(owner); tick(); invite_member(ctx, { email: 'alumno@example.com', isCreator: false });
    as(linked, 'alumno@example.com'); join_group(ctx, { displayName: 'Alumno' }); expect(db.member.rows.size).toBe(1);
  });

  it('desbloquear una membresía libera todos sus correos verificados sin reactivar el acceso', () => {
    const { ctx, db, create, join, as } = setup(); create(); join();
    as(student, 'alias@example.com'); on_connect(ctx, {});
    as(owner); blockEmail(ctx, { email: 'alumno@example.com', reason: 'Revisión', operationId });
    as(student, 'alias@example.com'); expect(() => on_connect(ctx, {})).not.toThrow();
    expect(subjects(ctx as never)).toEqual([]); expect(myMembershipAccess(ctx).blocked).toBe(true);
    // Aun si una migración dejara solo un alias bloqueado, la restricción sigue la identidad.
    const original = db.emailRestriction.rows.get('alumno@example.com')!;
    db.emailRestriction.rows.set('alumno@example.com', { ...original, blocked: false });
    as(student, 'alumno@example.com'); expect(myMembershipAccess(ctx).blocked).toBe(true);
    as(owner); expect(() => invite_member(ctx, { email: 'alumno@example.com', isCreator: false })).toThrow(/bloqueado/);
    unblockEmail(ctx, { email: 'alumno@example.com', operationId: nextId });
    expect([...db.emailRestriction.rows.values()].every(row => row.blocked === false)).toBe(true);
    expect(db.member.rows.get(student.toHexString())?.status).toBe('removed');
    as(student, 'alias@example.com'); expect(myMembershipAccess(ctx)).toEqual({ blocked: false, canRejoin: false });
  });

  it('se puede bloquear un correo sin cuenta y no puede canjear otro enlace', () => {
    const { ctx, as, create } = setup(); create(); blockEmail(ctx, { email: 'externo@example.com', reason: 'No autorizado', operationId });
    as(other, 'externo@example.com'); expect(() => joinWithInvitationLink(ctx, token, 'Otro')).toThrow(/bloqueado/);
  });

  it('otra identidad con el mismo correo exige vinculación explícita', () => {
    const { ctx, db, create, join, as } = setup(); create(); join(); as(other, 'alumno@example.com');
    expect(() => joinWithInvitationLink(ctx, token, 'Duplicado')).toThrow(/vincular explícitamente/);
    expect(db.member.rows.size).toBe(1);
    as(owner); link_auth_identity(ctx, { sessionIdentity: other, memberIdentity: student });
    as(other, 'alumno@example.com'); expect(joinWithInvitationLink(ctx, token, 'Alumno').alreadyMember).toBe(true);
  });

  it('vincula otro proveedor a una membresía dada de baja sin rehabilitarla y exige reinvitación', () => {
    const { ctx, db, create, join, as, tick } = setup(); create(); join(); as(owner); tick();
    remove_member(ctx, { identity: student });
    link_auth_identity(ctx, { sessionIdentity: other, memberIdentity: student });
    as(other, 'alumno@example.com'); on_connect(ctx, {});
    expect(myMembershipAccess(ctx)).toEqual({ blocked: false, canRejoin: false });
    expect(subjects(ctx as never)).toEqual([]);
    expect(() => joinWithInvitationLink(ctx, token, 'Alumno')).toThrow(/dado de baja/);
    as(owner); tick(); invite_member(ctx, { email: 'alumno@example.com', isCreator: false });
    as(other, 'alumno@example.com'); join_group(ctx, { displayName: 'Alumno' });
    expect(db.member.rows.size).toBe(1); expect(db.memberAccess.rows.get(student.toHexString())?.generation).toBe(2);
    as(owner); tick(); blockEmail(ctx, { email: 'alumno@example.com', reason: 'Bloqueo de prueba', operationId });
    const next = ident('c'); link_auth_identity(ctx, { sessionIdentity: next, memberIdentity: student });
    as(next, 'nuevo-alias@example.com'); expect(myMembershipAccess(ctx)).toEqual({ blocked: true, canRejoin: false });
    expect(() => join_group(ctx, { displayName: 'Alumno' })).toThrow(/bloqueado/);
    expect(db.member.rows.get(student.toHexString())?.status).toBe('removed');
  });

  it('protege al propietario, la propia cuenta, al último administrador y a administradores en lote', () => {
    const { ctx, db, as } = setup();
    db.member.insert({ identity: admin, displayName: 'Admin', status: 'active', isCreator: true, joinedAt: new Timestamp(1n) });
    db.member.insert({ identity: owner, displayName: 'Owner', status: 'active', isCreator: true, joinedAt: new Timestamp(1n) });
    expect(() => remove_member(ctx, { identity: owner })).toThrow(/ti mismo/);
    as(admin); expect(() => remove_member(ctx, { identity: owner })).toThrow(/propietario/);
    as(owner); db.member.rows.delete(owner.toHexString());
    expect(() => remove_member(ctx, { identity: admin })).toThrow(/administrador activo/);
    expect(() => adminMemberAccess(ctx, { operationId, identity: admin.toHexString(), generation: 0, action: 'remove', bulk: true })).toThrow(/acciones masivas/);
  });

  it('una selección antigua no retira una reincorporación posterior y las operaciones son reanudables', () => {
    const { ctx, db, create, join, as, tick } = setup(); create(); join(); as(owner);
    const request = { operationId, identity: student.toHexString(), generation: 1, action: 'remove', reason: '', bulk: true, invitationLinkId: linkId };
    const first = adminMemberAccess(ctx, request); expect(first.status).toBe('applied');
    expect(adminMemberAccess(ctx, request)).toEqual(first);
    tick(); invite_member(ctx, { email: 'alumno@example.com', isCreator: false }); as(student); join_group(ctx, { displayName: 'Alumno' }); as(owner);
    const stale = adminMemberAccess(ctx, { ...request, operationId: nextId });
    expect(stale.status).toBe('skipped'); expect(db.member.rows.get(student.toHexString())?.status).toBe('active');
    expect(() => adminMemberAccess(ctx, { ...request, reason: 'otra petición' })).toThrow(/otra operación/);
  });

  it('los históricos sin evidencia se muestran sin correo ni origen inventado', () => {
    const { ctx, db } = setup(); db.member.insert({ identity: student, displayName: 'Histórico', status: 'active', isCreator: false, joinedAt: new Timestamp(1n) });
    expect(adminMembershipSnapshot(ctx).members[0]).toMatchObject({ origin: 'unknown', email: null, emails: [], generation: 0 });
  });
});
