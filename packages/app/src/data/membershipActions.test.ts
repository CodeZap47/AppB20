import { expect, it, vi, afterEach } from 'vitest';
import type { DbConnection } from '../module_bindings';
import { createMembershipActions } from './membershipActions';

afterEach(() => vi.unstubAllGlobals());
it('envía el identificador estable y la sesión al copiar/crear sin poner el secreto en la petición HTTP', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: 'link', url: 'https://b20.test/#/invitacion?token=secret' }), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  const actions = createMembershipActions(() => ({} as DbConnection), { apiUrl: 'https://api.test/', getToken: () => 'session' });
  expect(await actions.copyInvitationLink('link')).toContain('#/invitacion');
  expect(fetcher.mock.calls[0]).toEqual(['https://api.test/admin/invitation-links/link/copy', expect.objectContaining({ method: 'POST', cache: 'no-store', headers: { Authorization: 'Bearer session', 'Content-Type': 'application/json' } })]);
  const input = { requestId: crypto.randomUUID(), name: 'Clase', expiresAt: null, maxUses: 10 };
  await actions.createInvitationLink(input); await actions.createInvitationLink(input);
  expect(fetcher.mock.calls.slice(1).map((call) => (call[1] as RequestInit).body)).toEqual([JSON.stringify(input), JSON.stringify(input)]);
});

it('consulta el resultado del servidor y no confunde un fallo individual guardado con una retirada exitosa', async () => {
  const moderateContentItem = vi.fn(async () => {});
  const adminContentResult = vi.fn(async () => JSON.stringify({ status: 'failed', error: 'La versión cambió.' }));
  const c = { reducers: { moderateContentItem }, procedures: { adminContentResult } } as unknown as DbConnection;
  const actions = createMembershipActions(() => c, { apiUrl: '', getToken: () => 'session' });
  const input = { operationId: crypto.randomUUID(), kind: 'group_message' as const, targetId: '18446744073709551600', expectedVersion: 2, withdrawn: true, reason: 'Revisión', acknowledgeImpact: true };
  await expect(actions.moderateContentItem(input)).rejects.toThrow('La versión cambió.');
  expect(moderateContentItem).toHaveBeenCalledWith({ ...input, targetId: 18446744073709551600n });
  expect(adminContentResult).toHaveBeenCalledWith({ operationId: input.operationId, kind: input.kind, targetId: 18446744073709551600n });
});

it('desactiva un enlace histórico por su identificador sin solicitar ni reconstruir su secreto', async () => {
  const legacyInvitationLinkRevoke = vi.fn(async () => JSON.stringify({ id: '18446744073709551600', status: 'inactive' }));
  const c = { procedures: { legacyInvitationLinkRevoke } } as unknown as DbConnection;
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const actions = createMembershipActions(() => c, { apiUrl: '', getToken: () => 'session' });
  await actions.revokeLegacyInvitationLink('18446744073709551600');
  expect(legacyInvitationLinkRevoke).toHaveBeenCalledExactlyOnceWith({ payload: JSON.stringify({ id: '18446744073709551600' }) });
  expect(fetcher).not.toHaveBeenCalled();
});
