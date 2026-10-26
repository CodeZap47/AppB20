import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';
import { seedDemoLegacyInvitationLinks, seedDemoMembership } from './demoMembership';
import type { AdminAccessInput } from './membershipTypes';

const sources: DemoDataSource[] = [];
function setup() {
  let at = new Date('2026-10-24T18:00:00Z');
  const state = createDemoState(at);
  const as = (identity: string) => { const source = new DemoDataSource(state, identity, () => at); sources.push(source); return source; };
  return { state, admin: as('demo-1'), as, advance: (ms: number) => { at = new Date(at.getTime() + ms); } };
}
afterEach(() => { for (const source of sources.splice(0)) source.dispose(); vi.restoreAllMocks(); });
const tokenFrom = (url: string) => new URLSearchParams(new URL(url).hash.split('?')[1]).get('token')!;
const linkInput = (extra = {}) => ({ requestId: crypto.randomUUID(), name: 'Ingreso ficticio de octubre', ...extra });
async function accessInput(admin: DemoDataSource, identity: string, extra: Partial<AdminAccessInput> = {}): Promise<AdminAccessInput> {
  const member = (await admin.getAdminMembership()).members.find((row) => row.identity === identity)!;
  return { operationId: crypto.randomUUID(), identity, generation: member.generation, action: 'remove', reason: '', bulk: false, ...extra };
}

describe('Administración de membresías en la simulación', () => {
  it('desactiva enlaces históricos sin inventar secretos ni atribuir incorporaciones o retirar contenido', async () => {
    const { admin, state, as } = setup(); const now = new Date('2026-10-24T18:00:00Z').getTime();
    seedDemoLegacyInvitationLinks(state, [{ id: '7', name: 'Enlace anterior #7', status: 'active', createdAt: now - 86_400_000, expiresAt: now + 86_400_000, maxUses: 100, usedCount: 3, revokedAt: null }]);
    const before = structuredClone({ members: state.members, works: state.works, messages: state.groupMessages });
    expect((await admin.getAdminMembership()).legacyLinks).toEqual([{ id: '7', name: 'Enlace anterior #7', status: 'active', createdAt: now - 86_400_000, expiresAt: now + 86_400_000, maxUses: 100, usedCount: 3, revokedAt: null }]);
    expect(() => as('demo-2').revokeLegacyInvitationLink('7')).toThrow('Solo los creadores');
    admin.revokeLegacyInvitationLink('7'); admin.revokeLegacyInvitationLink('7');
    const after = await admin.getAdminMembership();
    expect(after.legacyLinks?.[0]).toMatchObject({ status: 'inactive', revokedAt: now, usedCount: 3 });
    expect(after.admissions).toEqual([]);
    expect(after.members.every((member) => member.origin === 'unknown')).toBe(true);
    expect(after.events.filter((event) => event.action === 'deactivate_legacy_link')).toHaveLength(1);
    expect({ members: state.members, works: state.works, messages: state.groupMessages }).toEqual(before);
  });
  it('mantiene correos e historial privados y no inventa el origen de miembros históricos', async () => {
    const { admin, as, state } = setup();
    state.members.push({ id: 'historico-sin-correo', displayName: 'Persona de prueba histórica', status: 'active', isCreator: false, joinedAt: new Date() });
    const snapshot = await admin.getAdminMembership();
    expect(snapshot.members.find((row) => row.identity === 'demo-3')).toMatchObject({ email: 'demo-3@ejemplo.mx', origin: 'unknown', generation: 0, invitationLinkId: null });
    expect(snapshot.members.find((row) => row.identity === 'historico-sin-correo')).toMatchObject({ email: null, emails: [], origin: 'unknown' });
    expect(snapshot.admissions).toEqual([]);
    expect(admin.getSnapshot().members.some((member) => 'email' in member)).toBe(false);
    await expect(as('demo-2').getAdminMembership()).rejects.toThrow('Solo los creadores');
    await expect(admin.manageMemberAccess(await accessInput(admin, 'historico-sin-correo', { action: 'block' }))).rejects.toThrow('pendiente de vincular');
  });
  it('desactiva solamente el enlace y conserva al incorporado y sus aportes', async () => {
    const { admin, as, state } = setup();
    const link = await admin.createInvitationLink(linkInput());
    const invited = as('demo-invitado');
    invited.joinWithInvitationLink(tokenFrom(link.url), 'Nueva persona de prueba');
    const workId = invited.publishWork({ assignmentId: 't4', title: 'Trabajo conservado', description: 'Aporte ficticio', coauthorIds: [] });
    const before = await admin.getAdminMembership();
    const member = before.members.find((row) => row.identity === 'demo-invitado')!;
    expect(member).toMatchObject({ origin: 'invitation_link', invitationLinkId: link.id, generation: 1, status: 'active' });
    expect(before.links[0]).toMatchObject({ uses: 1, maxUses: null, expiresAt: new Date('2026-10-31T18:00:00Z').getTime() });
    admin.revokeInvitationLink(link.id);
    expect(state.members.find((row) => row.id === invited.viewerId)?.status).toBe('active');
    expect(invited.getSnapshot().works.some((row) => row.id === workId)).toBe(true);
    await expect(admin.copyInvitationLink(link.id)).rejects.toThrow('desactivado');
    expect(() => as('demo-invitado-2').joinWithInvitationLink(tokenFrom(link.url), 'Otra persona ficticia')).toThrow('desactivado');
    expect((await admin.getAdminMembership()).admissions).toHaveLength(1);
  });
  it('respeta el último cupo y un reingreso activo no consume ni modifica su origen', async () => {
    const { admin, as } = setup();
    const link = await admin.createInvitationLink(linkInput({ maxUses: 1 }));
    const first = as('demo-invitado'); const second = as('demo-invitado-2');
    first.joinWithInvitationLink(tokenFrom(link.url), 'Persona ficticia');
    first.joinWithInvitationLink(tokenFrom(link.url), 'Nombre que se ignora');
    expect(() => second.joinWithInvitationLink(tokenFrom(link.url), 'Otra persona')).toThrow('sin cupo');
    const snapshot = await admin.getAdminMembership();
    expect(snapshot.links[0]).toMatchObject({ status: 'exhausted', uses: 1 });
    expect(snapshot.admissions).toHaveLength(1);
    expect(snapshot.members.find((row) => row.identity === first.viewerId)?.displayName).toBe('Persona ficticia');
    // Even after deactivation, a known active member's idempotent reopen is harmless.
    admin.revokeInvitationLink(link.id); expect(() => first.joinWithInvitationLink(tokenFrom(link.url), '')).not.toThrow();
  });
  it('copia entre sesiones, reintenta creación y reemplazo y conserva el historial anterior', async () => {
    const { admin, as, state } = setup();
    const input = linkInput(); const link = await admin.createInvitationLink(input);
    expect(await admin.createInvitationLink(input)).toEqual(link);
    expect(await as('demo-1').copyInvitationLink(link.id)).toBe(link.url);
    const invited = as('demo-invitado'); invited.joinWithInvitationLink(tokenFrom(link.url), 'Persona ficticia');
    const replacementInput = linkInput({ expiresAt: null, maxUses: 4 });
    const replacement = await admin.replaceInvitationLink(link.id, replacementInput);
    expect(await admin.replaceInvitationLink(link.id, replacementInput)).toEqual(replacement);
    expect(replacement.url).not.toBe(link.url);
    expect((await admin.getAdminMembership()).links).toHaveLength(2);
    expect((await admin.getAdminMembership()).members.find((row) => row.identity === invited.viewerId)?.invitationLinkId).toBe(link.id);
    expect(state.members.find((row) => row.id === invited.viewerId)?.status).toBe('active');
    await expect(admin.replaceInvitationLink(link.id, linkInput())).rejects.toThrow('ya fue reemplazado');
  });
  it('requiere una invitación individual nueva tras la baja y protege generaciones posteriores', async () => {
    const { admin, as, state } = setup(); const link = await admin.createInvitationLink(linkInput()); const invited = as('demo-invitado');
    invited.joinWithInvitationLink(tokenFrom(link.url), 'Nombre original');
    const workId = invited.publishWork({ assignmentId: 't4', title: 'Autoría original', description: '', coauthorIds: [] });
    const request = await accessInput(admin, invited.viewerId, { bulk: true, invitationLinkId: link.id });
    admin.inviteMember('invitado@ejemplo.mx', false); // A pending grant must be cancelled by removal.
    expect((await admin.manageMemberAccess(request)).status).toBe('applied');
    expect(await admin.manageMemberAccess(request)).toMatchObject({ status: 'applied' });
    expect(invited.getSnapshot().works).toEqual([]);
    expect(await invited.getMyMembershipAccess()).toEqual({ blocked: false, canRejoin: false });
    expect(() => invited.joinWithInvitationLink(tokenFrom(link.url), 'Otro nombre')).toThrow('invitación individual');
    expect(() => invited.joinGroup('Otro nombre')).toThrow('invitación individual');
    admin.inviteMember('invitado@ejemplo.mx', false);
    expect(await invited.getMyMembershipAccess()).toEqual({ blocked: false, canRejoin: true });
    invited.joinGroup('Otro nombre');
    expect(state.members.filter((row) => row.id === invited.viewerId)).toHaveLength(1);
    expect(state.members.find((row) => row.id === invited.viewerId)?.displayName).toBe('Nombre original');
    expect(invited.getSnapshot().works.find((row) => row.id === workId)?.authorIds).toEqual([invited.viewerId]);
    expect((await admin.getAdminMembership()).members.find((row) => row.identity === invited.viewerId)).toMatchObject({ generation: 2, origin: 'individual', invitationLinkId: null });
    const stale = await admin.manageMemberAccess({ ...request, operationId: crypto.randomUUID() });
    expect(stale.status).toBe('skipped'); expect(invited.getSnapshot().me?.status).toBe('active');
    await expect(admin.manageMemberAccess({ ...request, reason: 'Un cambio' })).rejects.toThrow('otra operación');
  });
  it('bloquea correos antes de que exista cuenta y desbloquear no restaura membresías dadas de baja', async () => {
    const { admin, as } = setup(); const link = await admin.createInvitationLink(linkInput()); const invited = as('demo-invitado');
    admin.blockEmail('invitado@ejemplo.mx', 'Bloqueo ficticio', crypto.randomUUID());
    expect(() => invited.joinWithInvitationLink(tokenFrom(link.url), 'Persona ficticia')).toThrow('bloqueado');
    expect(() => admin.inviteMember('invitado@ejemplo.mx', false)).toThrow('Desbloquéalo');
    admin.unblockEmail('invitado@ejemplo.mx', crypto.randomUUID()); invited.joinWithInvitationLink(tokenFrom(link.url), 'Persona ficticia');
    await admin.manageMemberAccess(await accessInput(admin, invited.viewerId, { action: 'block' }));
    expect(await invited.getMyMembershipAccess()).toEqual({ blocked: true, canRejoin: false });
    admin.unblockEmail('invitado@ejemplo.mx', crypto.randomUUID());
    expect(invited.getSnapshot().me?.status).toBe('removed');
    expect(() => invited.joinWithInvitationLink(tokenFrom(link.url), 'Persona ficticia')).toThrow('invitación individual');
    admin.inviteMember('invitado@ejemplo.mx', false); invited.joinGroup('Persona ficticia');
    expect(invited.getSnapshot().me?.status).toBe('active');
  });
  it('impide la auto baja, excluye administradores de acciones masivas y exige vínculo ante otra identidad', async () => {
    const { admin, as, state } = setup(); state.members.find((row) => row.id === 'demo-2')!.isCreator = true;
    await expect(admin.manageMemberAccess(await accessInput(admin, 'demo-1'))).rejects.toThrow('a ti mismo');
    await expect(admin.manageMemberAccess(await accessInput(admin, 'demo-2', { bulk: true }))).rejects.toThrow('acciones masivas');
    await expect(as('demo-2').manageMemberAccess(await accessInput(admin, 'demo-1'))).rejects.toThrow('propietario');
    seedDemoMembership(state, { 'otro-proveedor': 'demo-3@ejemplo.mx' });
    const link = await admin.createInvitationLink(linkInput());
    expect(() => as('otro-proveedor').joinWithInvitationLink(tokenFrom(link.url), 'Otro proveedor')).toThrow('vincular explícitamente');
  });
  it('bloquea y desbloquea juntos los alias conocidos sin rehabilitar el acceso', async () => {
    const { admin, as, state } = setup();
    seedDemoMembership(state, { 'demo-3': ['demo-3@ejemplo.mx', 'alias-3@ejemplo.mx'] });
    admin.blockEmail('alias-3@ejemplo.mx', 'Bloqueo ficticio de la membresía', crypto.randomUUID());
    expect((await admin.getAdminMembership()).blockedEmails.map((row) => row.email)).toEqual(expect.arrayContaining(['demo-3@ejemplo.mx', 'alias-3@ejemplo.mx']));
    const member = as('demo-3'); expect(await member.getMyMembershipAccess()).toEqual({ blocked: true, canRejoin: false });
    admin.unblockEmail('demo-3@ejemplo.mx', crypto.randomUUID());
    expect((await admin.getAdminMembership()).blockedEmails).toEqual([]);
    expect(member.getSnapshot().me?.status).toBe('removed');
    expect(await member.getMyMembershipAccess()).toEqual({ blocked: false, canRejoin: false });
    admin.inviteMember('demo-3@ejemplo.mx', false); member.joinGroup('Nombre');
    expect(member.getSnapshot().me?.status).toBe('active');
  });
  it('cierra salas y sesiones abiertas sin borrar los datos privados ni restaurar permisos al reinvitar', async () => {
    const { admin, as, state } = setup(); const member = as('demo-2');
    expect(member.getSnapshot().roomMembers.some((row) => row.roomId === 'room-demo-open' && row.status === 'joined')).toBe(true);
    expect(member.getSnapshot().directMessages).toHaveLength(1);
    const beforeMessages = [...state.directMessages]; const beforePersonal = [...state.teachingPersonal];
    admin.removeMember('demo-2');
    expect(member.getSnapshot().directMessages).toEqual([]);
    expect(member.getSnapshot().studyRooms).toEqual([]);
    expect(state.directMessages).toEqual(beforeMessages); expect(state.teachingPersonal).toEqual(beforePersonal);
    expect(state.studyRooms.find((row) => row.id === 'room-demo-open')?.status).toBe('cancelled');
    admin.inviteMember('demo-2@ejemplo.mx', false); member.joinGroup('Nombre');
    expect(state.roomMembers.find((row) => row.roomId === 'room-demo-open' && row.memberId === 'demo-2')?.status).toBe('removed');
    expect(member.getSnapshot().directMessages).toHaveLength(1);
  });
  it('controla caducidad y versiones y no llama a la red en modo de prueba', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('La simulación no debe usar la red'));
    const { admin, as, advance } = setup(); const link = await admin.createInvitationLink(linkInput()); const row = (await admin.getAdminMembership()).links[0]!;
    expect(() => admin.configureInvitationLink({ id: link.id, name: 'Cambio', expiresAt: null, maxUses: null, expectedVersion: row.version + 1 })).toThrow('cambió');
    admin.configureInvitationLink({ id: link.id, name: 'Cambio', expiresAt: null, maxUses: 1, expectedVersion: row.version });
    const other = await admin.createInvitationLink(linkInput()); advance(7 * 86_400_000 + 1);
    await expect(admin.copyInvitationLink(other.id)).rejects.toThrow('vencido');
    expect(() => as('demo-invitado').joinWithInvitationLink(tokenFrom(other.url), 'Persona ficticia')).toThrow('vencido');
    expect((await admin.getAdminMembership()).links.find((item) => item.id === link.id)?.status).toBe('active');
    expect(network).not.toHaveBeenCalled();
  });
});
