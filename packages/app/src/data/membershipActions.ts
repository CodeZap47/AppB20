import type { DbConnection } from '../module_bindings';
import type { AdminMembershipSnapshot, MembershipActions, InvitationLinkResult } from './membershipTypes';

export function createMembershipActions(connection: () => DbConnection, options: { apiUrl: string; getToken(): string | undefined }): MembershipActions {
  async function request(path: string, body: unknown = {}): Promise<InvitationLinkResult> {
    connection();
    const token = options.getToken();
    if (!token) throw new Error('Inicia sesión para administrar los enlaces.');
    if (!options.apiUrl) throw new Error('Falta configurar el servicio de enlaces de invitación.');
    let response: Response;
    try {
      response = await fetch(`${options.apiUrl.replace(/\/$/, '')}/admin/invitation-links${path}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new Error('No se pudo contactar al servicio de enlaces. Reintenta la misma operación.'); }
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : 'No se pudo gestionar el enlace.');
    if (!result || typeof result !== 'object' || !('id' in result) || !('url' in result) || typeof result.id !== 'string' || typeof result.url !== 'string') throw new Error('El servicio de enlaces devolvió una respuesta incompleta.');
    return { id: result.id, url: result.url };
  }
  const payload = (value: unknown) => ({ payload: JSON.stringify(value) });
  return {
    getAdminMembership: async () => JSON.parse(await connection().procedures.adminMembershipSnapshot({})) as AdminMembershipSnapshot,
    createInvitationLink: (input) => request('', input),
    copyInvitationLink: async (id) => (await request(`/${encodeURIComponent(id)}/copy`)).url,
    replaceInvitationLink: (id, input) => request(`/${encodeURIComponent(id)}/replace`, input),
    configureInvitationLink: async (input) => { await connection().procedures.invitationLinkConfigure(payload(input)); },
    revokeInvitationLink: async (id, expectedVersion) => { await connection().procedures.invitationLinkRevoke(payload({ id, expectedVersion })); },
    revokeLegacyInvitationLink: async (id) => { await connection().procedures.legacyInvitationLinkRevoke(payload({ id })); },
    joinWithInvitationLink: async (token, displayName) => { await connection().procedures.joinWithInvitationLink({ token, displayName }); },
    manageMemberAccess: async (input) => JSON.parse(await connection().procedures.adminMemberAccess(payload(input))),
    blockEmail: async (email, reason, operationId) => { await connection().procedures.blockEmail(payload({ email, reason, operationId })); },
    unblockEmail: async (email, operationId) => { await connection().procedures.unblockEmail(payload({ email, operationId })); },
    moderateContentItem: async (input) => {
      const c = connection();
      const args = { ...input, targetId: BigInt(input.targetId), expectedImpact: input.expectedImpact };
      await c.reducers.moderateContentItem(args);
      const result = JSON.parse(await c.procedures.adminContentResult({ operationId: input.operationId, kind: input.kind, targetId: args.targetId })) as { status: string; error: string } | null;
      if (!result) throw new Error('No se pudo confirmar la retirada. Reintenta la misma operación.');
      if (result.status !== 'completed') throw new Error(result.error || 'No se pudo retirar este contenido. Revisa su versión y el impacto.');
    },
    getMyMembershipAccess: async () => JSON.parse(await connection().procedures.myMembershipAccess({})),
  };
}
