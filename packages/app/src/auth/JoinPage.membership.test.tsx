// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const control = vi.hoisted(() => ({
  token: 'A'.repeat(43), clear: vi.fn(), signOut: vi.fn(),
  session: { status: 'signedIn', token: 'session-fixture', expiresAt: Date.now() + 3600_000,
    profile: { subject: 'fixture', email: 'invitado@ejemplo.mx', name: '' } },
}));
vi.mock('./AuthContext', () => ({ useSession: () => control.session, useSessionStore: () => ({ signOut: control.signOut }) }));
vi.mock('./pendingInvitation', () => ({ getPendingInvitation: () => control.token, clearPendingInvitation: control.clear }));

import { JoinPage } from './JoinPage';
import { DataProvider } from '../data/DataContext';
import { DemoDataSource, createDemoState } from '../data/demo';

let source: DemoDataSource;
let root: Root;
let container: HTMLDivElement;
async function render() { await act(async () => root.render(<DataProvider source={source}><JoinPage /></DataProvider>)); }
async function submitName(name = 'Persona ficticia') {
  await act(async () => {
    const input = container.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  control.clear.mockClear(); control.signOut.mockClear();
  source = new DemoDataSource(createDemoState(), 'demo-invitado');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); });

describe('Ingreso por enlaces e invitaciones individuales', () => {
  it('prioriza una invitación individual administrativa aunque haya un enlace pendiente', async () => {
    vi.spyOn(source, 'getMyMembershipAccess').mockResolvedValue({ blocked: false, canRejoin: true });
    const individual = vi.spyOn(source, 'joinGroup').mockImplementation(() => {});
    const link = vi.spyOn(source, 'joinWithInvitationLink').mockImplementation(() => {});
    await render(); await submitName();
    expect(individual).toHaveBeenCalledExactlyOnceWith('Persona ficticia');
    expect(link).not.toHaveBeenCalled(); expect(control.clear).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('rol que Administración te concedió');
  });
  it('espera la comprobación antes de permitir un ingreso que podría perder el rol individual', async () => {
    let finish!: (value: { blocked: boolean; canRejoin: boolean }) => void;
    vi.spyOn(source, 'getMyMembershipAccess').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const individual = vi.spyOn(source, 'joinGroup').mockImplementation(() => {});
    const link = vi.spyOn(source, 'joinWithInvitationLink').mockImplementation(() => {});
    await render(); expect(container.querySelector('form')).toBeNull(); expect(container.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => finish({ blocked: false, canRejoin: true }));
    await submitName(); expect(individual).toHaveBeenCalledOnce(); expect(link).not.toHaveBeenCalled();
  });
  it('reincorpora una membresía dada de baja por invitación individual y conserva la identidad', async () => {
    source.dispose(); const state = createDemoState(); state.members.find((member) => member.id === 'demo-3')!.status = 'removed';
    source = new DemoDataSource(state, 'demo-3');
    vi.spyOn(source, 'getMyMembershipAccess').mockResolvedValue({ blocked: false, canRejoin: true });
    const individual = vi.spyOn(source, 'joinGroup').mockImplementation(() => {});
    const link = vi.spyOn(source, 'joinWithInvitationLink').mockImplementation(() => {});
    await render(); expect(container.textContent).toContain('misma membresía y autoría'); await submitName();
    expect(individual).toHaveBeenCalledOnce(); expect(link).not.toHaveBeenCalled();
  });
  it('usa el enlace para una nueva cuenta sin invitación individual y permite reintentar fallos sin perderlo', async () => {
    vi.spyOn(source, 'getMyMembershipAccess').mockResolvedValue({ blocked: false, canRejoin: false });
    const link = vi.spyOn(source, 'joinWithInvitationLink').mockRejectedValueOnce(new Error('Sin conexión.')).mockResolvedValueOnce(undefined);
    const individual = vi.spyOn(source, 'joinGroup');
    await render(); await submitName();
    expect(link).toHaveBeenCalledExactlyOnceWith(control.token, 'Persona ficticia'); expect(control.clear).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Sin conexión');
    await submitName(); expect(link).toHaveBeenCalledTimes(2); expect(link.mock.calls[1]).toEqual(link.mock.calls[0]);
    expect(individual).not.toHaveBeenCalled(); expect(control.clear).toHaveBeenCalledOnce();
  });
  it('cierra el formulario si el correo está bloqueado aunque conserve un enlace pendiente', async () => {
    vi.spyOn(source, 'getMyMembershipAccess').mockResolvedValue({ blocked: true, canRejoin: false });
    const link = vi.spyOn(source, 'joinWithInvitationLink');
    await render(); expect(container.querySelector('form')).toBeNull(); expect(container.textContent).toContain('Tu correo está bloqueado');
    expect(link).not.toHaveBeenCalled();
  });
  it('un fallo al consultar acceso impide continuar y ofrece repetir sin borrar la invitación', async () => {
    const check = vi.spyOn(source, 'getMyMembershipAccess').mockRejectedValueOnce(new Error('No se pudo comprobar el acceso.')).mockResolvedValueOnce({ blocked: false, canRejoin: true });
    await render(); expect(container.querySelector('form')).toBeNull(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('comprobar');
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Volver a comprobar'))!;
    await act(async () => retry.click()); expect(check).toHaveBeenCalledTimes(2); expect(container.querySelector('form')).not.toBeNull();
    expect(control.clear).not.toHaveBeenCalled();
  });
});
