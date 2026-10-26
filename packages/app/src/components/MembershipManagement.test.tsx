// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import type { AdminMembershipSnapshot, AdminContentEntry, Snapshot } from '../data/types';
import { MembershipManagement } from './MembershipManagement';

let root: Root; let container: HTMLDivElement; let source: DemoDataSource; let data: AdminMembershipSnapshot; let snapshot: Snapshot;
const linkId = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  sessionStorage.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_') });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  source = new DemoDataSource(createDemoState(), 'demo-1'); snapshot = source.getSnapshot();
  data = { links: [{ id: linkId, name: 'Grupo de octubre', status: 'active', createdAt: Date.now(), expiresAt: Date.now() + 86400000, maxUses: null, uses: 2, version: 1 }], members: [
    { identity: 'demo-2', displayName: 'Ana', status: 'active', isCreator: false, email: 'ana@ejemplo.mx', emails: ['ana@ejemplo.mx'], generation: 1, origin: 'invitation_link', invitationLinkId: linkId, joinedAt: Date.now(), removedAt: null },
    { identity: 'demo-3', displayName: 'Luis', status: 'active', isCreator: false, email: 'luis@ejemplo.mx', emails: ['luis@ejemplo.mx'], generation: 1, origin: 'invitation_link', invitationLinkId: linkId, joinedAt: Date.now(), removedAt: null },
    { identity: 'admin', displayName: 'Otra administradora', status: 'active', isCreator: true, email: null, emails: [], generation: 1, origin: 'invitation_link', invitationLinkId: linkId, joinedAt: Date.now(), removedAt: null },
  ], admissions: [], blockedEmails: [], events: [] };
  vi.spyOn(source, 'getAdminMembership').mockImplementation(async () => structuredClone(data));
  vi.spyOn(source, 'getSnapshot').mockImplementation(() => snapshot);
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<DataProvider source={source}><MembershipManagement /></DataProvider>)); }
function button(text: string, area: ParentNode = document): HTMLButtonElement { const found = [...area.querySelectorAll<HTMLButtonElement>('button')].find((row) => row.textContent === text); if (!found) throw new Error(`No button: ${text}`); return found; }
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function fill(element: HTMLTextAreaElement, text: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, text); element.dispatchEvent(new Event('input', { bubbles: true })); }); }

it('predetermina desactivar solo el enlace y nunca llama bajas ni retiradas de contenido', async () => {
  const revoke = vi.spyOn(source, 'revokeInvitationLink').mockResolvedValue(undefined);
  const access = vi.spyOn(source, 'manageMemberAccess'); const content = vi.spyOn(source, 'moderateContentItem');
  await render(); await click(button('Revocar', container));
  expect(dialog().querySelector<HTMLInputElement>('input[name="revoke-mode"]')?.checked).toBe(true);
  await click(button('Continuar', dialog())); await click(button('Confirmar cambios', dialog()));
  expect(revoke).toHaveBeenCalledExactlyOnceWith(linkId, 1);
  expect(access).not.toHaveBeenCalled(); expect(content).not.toHaveBeenCalled();
  expect(dialog().textContent).toContain('Enlace desactivado.');
});

it('parte sin integrantes seleccionados y excluye administradores al seleccionar todos', async () => {
  await render(); await click(button('Revocar', container));
  await click(dialog().querySelectorAll<HTMLInputElement>('input[name="revoke-mode"]')[2]!); await click(button('Continuar', dialog()));
  expect([...dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((row) => !row.checked)).toBe(true);
  expect(dialog().textContent).not.toContain('Otra administradora');
  await click(button('Seleccionar todos (2)', dialog()));
  expect(dialog().querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(2);
});

it('conserva una baja exitosa y muestra el fallo al retirar un aporte, sin afectar otra persona', async () => {
  vi.spyOn(source, 'revokeInvitationLink').mockResolvedValue(undefined);
  const access = vi.spyOn(source, 'manageMemberAccess').mockImplementation(async (input) => ({ operationId: input.operationId, status: 'applied', message: 'Acceso dado de baja.', identity: input.identity, generation: input.generation }));
  const content = vi.spyOn(source, 'moderateContentItem').mockRejectedValue(new Error('La publicación cambió.'));
  snapshot = { ...snapshot, adminContentEntries: [{ kind: 'note', targetId: '88', ownerIds: ['demo-2'], title: 'Nota de Ana', version: 1, withdrawn: false, collaborative: false, foreignDependencies: 0, sharedFiles: 0, reportReferences: 0, safeForBulk: true } satisfies AdminContentEntry] };
  await render(); await click(button('Revocar', container));
  await click(dialog().querySelectorAll<HTMLInputElement>('input[name="revoke-mode"]')[2]!); await click(button('Continuar', dialog()));
  await click(dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  await fill(dialog().querySelector('textarea')!, 'Revisión de acceso'); await click(button('Continuar', dialog()));
  expect(dialog().querySelector<HTMLInputElement>('input[name="content-policy"]')?.checked).toBe(true);
  await click(dialog().querySelectorAll<HTMLInputElement>('input[name="content-policy"]')[1]!);
  await click(button('Seleccionar aportes propios sin dependencias', dialog())); await click(button('Continuar', dialog()));
  await click(button('Confirmar cambios', dialog()));
  expect(access).toHaveBeenCalledOnce(); expect(access.mock.calls[0]![0].identity).toBe('demo-2');
  expect(access.mock.calls[0]![0].operationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(content).toHaveBeenCalledOnce();
  expect(dialog().textContent).toContain('Acceso dado de baja.'); expect(dialog().textContent).toContain('La publicación cambió.');
  expect(button('Revisar pendientes', dialog())).toBeDefined();
});

it('retoma una operación interrumpida sin repetir la revocación y conserva los identificadores y el impacto revisado', async () => {
  const revoke = vi.spyOn(source, 'revokeInvitationLink').mockResolvedValue(undefined);
  const access = vi.spyOn(source, 'manageMemberAccess').mockImplementation(async (input) => ({ operationId: input.operationId, status: 'applied', message: 'Acceso dado de baja.', identity: input.identity, generation: input.generation }));
  const content = vi.spyOn(source, 'moderateContentItem').mockRejectedValueOnce(new Error('No se pudo confirmar la retirada.')).mockResolvedValue(undefined);
  const entry: AdminContentEntry = { kind: 'note', targetId: '88', ownerIds: ['demo-2'], title: 'Nota de Ana', version: 1, withdrawn: false, collaborative: false, foreignDependencies: 0, sharedFiles: 0, reportReferences: 0, safeForBulk: true };
  snapshot = { ...snapshot, adminContentEntries: [entry] };
  await render(); await click(button('Revocar', container));
  await click(dialog().querySelectorAll<HTMLInputElement>('input[name="revoke-mode"]')[2]!); await click(button('Continuar', dialog()));
  await click(dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  await fill(dialog().querySelector('textarea')!, 'Revisión de acceso'); await click(button('Continuar', dialog()));
  await click(dialog().querySelectorAll<HTMLInputElement>('input[name="content-policy"]')[1]!);
  await click(button('Seleccionar aportes propios sin dependencias', dialog())); await click(button('Continuar', dialog())); await click(button('Confirmar cambios', dialog()));
  const firstAccess = access.mock.calls[0]![0]; const firstContent = content.mock.calls[0]![0];
  await click(button('Cerrar', dialog()));
  expect(button('Retomar operación pendiente', container)).toBeDefined();
  const saved = Object.keys(sessionStorage).filter((key) => key.startsWith('b20.admin.access-draft.')).map((key) => sessionStorage.getItem(key)).join('');
  expect(saved).not.toContain('ana@ejemplo.mx'); expect(saved).not.toContain('Nota de Ana');
  snapshot = { ...snapshot, adminContentEntries: [{ ...entry, foreignDependencies: 2, safeForBulk: false }] };
  await click(button('Retomar operación pendiente', container)); await click(button('Confirmar cambios', dialog()));
  expect(revoke).toHaveBeenCalledOnce();
  expect(access.mock.calls[1]![0]).toEqual(firstAccess);
  expect(content.mock.calls[1]![0].operationId).toBe(firstContent.operationId);
  expect(content.mock.calls[1]![0].expectedImpact).toBe('0:0:0:0');
  await click(button('Terminar', dialog()));
  expect(container.textContent).not.toContain('Retomar operación pendiente');
});

it('permite cerrar el pop-up con Escape sin ejecutar acciones', async () => {
  const revoke = vi.spyOn(source, 'revokeInvitationLink');
  await render(); const trigger = button('Revocar', container);
  await act(async () => trigger.focus()); await click(trigger);
  expect(dialog()).toBeTruthy();
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(dialog()).toBeNull(); expect(revoke).not.toHaveBeenCalled();
});

it('mantiene Administración disponible si el permiso del portapapeles queda pendiente', async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const writeText = vi.fn(() => new Promise<void>(() => {}));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    const url = `https://b20.test/#/invitacion?token=${'A'.repeat(43)}`;
    vi.spyOn(source, 'copyInvitationLink').mockResolvedValue(url);
    await render(); await click(button('Copiar', container));
    expect(writeText).toHaveBeenCalledWith(url);
    expect(button('Copiar', container).disabled).toBe(false);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Enlace listo para copiar"]')!.value).toBe(url);
    await click(button('Bloquear correo', container)); expect(dialog().textContent).toContain('Bloquear correo');
  } finally {
    if (previous) Object.defineProperty(navigator, 'clipboard', previous); else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it('permite conservar un aporte después de revisar su retirada fallida y cierra el seguimiento pendiente', async () => {
  vi.spyOn(source, 'revokeInvitationLink').mockResolvedValue(undefined);
  const access = vi.spyOn(source, 'manageMemberAccess').mockImplementation(async (input) => ({ operationId: input.operationId, status: 'applied', message: 'Acceso dado de baja.', identity: input.identity, generation: input.generation }));
  const content = vi.spyOn(source, 'moderateContentItem').mockRejectedValue(new Error('La publicación cambió.'));
  snapshot = { ...snapshot, adminContentEntries: [{ kind: 'note', targetId: '88', ownerIds: ['demo-2'], title: 'Nota de Ana', version: 1, withdrawn: false, collaborative: false, foreignDependencies: 0, sharedFiles: 0, reportReferences: 0, safeForBulk: true }] };
  await render(); await click(button('Revocar', container));
  await click(dialog().querySelectorAll<HTMLInputElement>('input[name="revoke-mode"]')[2]!); await click(button('Continuar', dialog()));
  await click(dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!); await fill(dialog().querySelector('textarea')!, 'Revisión de acceso'); await click(button('Continuar', dialog()));
  await click(dialog().querySelectorAll<HTMLInputElement>('input[name="content-policy"]')[1]!);
  await click(button('Seleccionar aportes propios sin dependencias', dialog())); await click(button('Continuar', dialog())); await click(button('Confirmar cambios', dialog()));
  data.members = data.members.map((row) => row.identity === 'demo-2' ? { ...row, status: 'removed' } : row);
  await click(button('Revisar pendientes', dialog()));
  expect(dialog().textContent).toContain('Destino del contenido');
  await click(dialog().querySelector<HTMLInputElement>('input[name="content-policy"]')!);
  await click(button('Continuar', dialog())); await click(button('Confirmar cambios', dialog()));
  expect(access).toHaveBeenCalledOnce(); expect(content).toHaveBeenCalledOnce();
  expect(dialog().textContent).not.toContain('Pendiente:');
  await click(button('Terminar', dialog()));
  expect(container.textContent).not.toContain('Retomar operación pendiente');
});

it('gestiona aportes de una persona ya dada de baja sin reactivarla ni volver a retirar su acceso', async () => {
  data.members = data.members.map((row) => ({ ...row, status: row.identity === 'demo-2' ? 'removed' : row.status }));
  const access = vi.spyOn(source, 'manageMemberAccess'); const invite = vi.spyOn(source, 'inviteMember');
  const content = vi.spyOn(source, 'moderateContentItem').mockResolvedValue(undefined);
  snapshot = { ...snapshot, adminContentEntries: [{ kind: 'note', targetId: '88', ownerIds: ['demo-2'], title: 'Nota de Ana', version: 1, withdrawn: false, collaborative: false, foreignDependencies: 0, sharedFiles: 0, reportReferences: 0, safeForBulk: true }] };
  await render(); await click(button('Dados de baja', container)); await click(button('Gestionar aportes', container));
  expect(dialog().textContent).toContain('dado de baja');
  await click(dialog().querySelectorAll<HTMLInputElement>('input[name="content-policy"]')[1]!);
  await fill(dialog().querySelector('textarea')!, 'Revisión de aportes conservados');
  await click(button('Seleccionar aportes propios sin dependencias', dialog())); await click(button('Continuar', dialog()));
  await click(button('Confirmar cambios', dialog()));
  expect(access).not.toHaveBeenCalled(); expect(invite).not.toHaveBeenCalled();
  expect(content).toHaveBeenCalledOnce(); expect(content.mock.calls[0]![0].targetId).toBe('88');
});

it('muestra enlaces anteriores sin ofrecer copiar un secreto que nunca se guardó', async () => {
  data.legacyLinks = [{ id: '7', name: 'Enlace anterior #7', status: 'active', createdAt: Date.now(), expiresAt: Date.now() + 86400000, maxUses: 100, usedCount: 3, revokedAt: null }];
  await render();
  const area = container.querySelector<HTMLElement>('[aria-labelledby="admin-legacy-links-title"]')!;
  expect(area.textContent).toContain('su copia no está disponible');
  expect(area.textContent).toContain('Origen desconocido');
  expect(area.textContent).toContain('3 de 100 usos');
  expect([...area.querySelectorAll('button')].map((row) => row.textContent)).toEqual(['Crear enlace nuevo', 'Desactivar']);
  await click(button('Crear enlace nuevo', area));
  expect(dialog().getAttribute('aria-label')).toBe('Crear enlace de invitación');
});

it('confirma la desactivación histórica y conserva a las personas y sus aportes', async () => {
  data.legacyLinks = [{ id: '7', name: 'Enlace anterior #7', status: 'active', createdAt: Date.now(), expiresAt: Date.now() + 86400000, maxUses: 100, usedCount: 3, revokedAt: null }];
  const revoke = vi.spyOn(source, 'revokeLegacyInvitationLink').mockImplementation(() => { data.legacyLinks![0]!.status = 'inactive'; });
  const access = vi.spyOn(source, 'manageMemberAccess'); const content = vi.spyOn(source, 'moderateContentItem');
  const currentRevoke = vi.spyOn(source, 'revokeInvitationLink'); const copy = vi.spyOn(source, 'copyInvitationLink');
  await render(); await click(button('Desactivar', container));
  expect(dialog().textContent).toContain('conservarán el acceso y todos sus aportes');
  expect(revoke).not.toHaveBeenCalled();
  await click(button('Cerrar', dialog())); expect(revoke).not.toHaveBeenCalled();
  await click(button('Desactivar', container)); await click(button('Desactivar este enlace', dialog()));
  expect(revoke).toHaveBeenCalledExactlyOnceWith('7');
  expect(access).not.toHaveBeenCalled(); expect(content).not.toHaveBeenCalled();
  expect(currentRevoke).not.toHaveBeenCalled(); expect(copy).not.toHaveBeenCalled();
  expect(dialog()).toBeNull();
  expect(button('Desactivar', container).disabled).toBe(true);
});

it('mantiene la confirmación histórica disponible cuando falla el servidor', async () => {
  data.legacyLinks = [{ id: '7', name: 'Enlace anterior #7', status: 'active', createdAt: Date.now(), expiresAt: Date.now() + 86400000, maxUses: 100, usedCount: 3, revokedAt: null }];
  const revoke = vi.spyOn(source, 'revokeLegacyInvitationLink').mockRejectedValueOnce(new Error('No se pudo confirmar la desactivación.')).mockResolvedValueOnce(undefined);
  await render(); await click(button('Desactivar', container)); await click(button('Desactivar este enlace', dialog()));
  expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('No se pudo confirmar');
  expect(button('Desactivar este enlace', dialog()).disabled).toBe(false);
  await click(button('Desactivar este enlace', dialog()));
  expect(revoke).toHaveBeenCalledTimes(2); expect(dialog()).toBeNull();
});
