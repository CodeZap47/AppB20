// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { MembershipSettings } from './MembershipSettings';

let root: Root; let container: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const render = (source: DemoDataSource) => act(async () => root.render(<DataProvider source={source}><MembershipSettings /></DataProvider>));
const emailInput = () => container.querySelector<HTMLInputElement>('input[type="email"]')!;
const creatorBox = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const inviteButton = () => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Invitar')!;
const invitationItem = (email: string) => [...container.querySelectorAll('li')].find((li) => li.textContent?.includes(email));

async function typeEmail(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(emailInput(), value); emailInput().dispatchEvent(new Event('input', { bubbles: true })); });
}

it('un creador invita como creador, ve la invitación en la lista y la retira', async () => {
  const source = new DemoDataSource(createDemoState(), 'demo-1');
  await render(source);
  expect(inviteButton().disabled).toBe(true);
  await typeEmail(' Nueva@Ejemplo.MX ');
  await act(async () => creatorBox().click());
  await act(async () => inviteButton().click());

  expect(source.getSnapshot().invitations).toContainEqual(expect.objectContaining({ email: 'nueva@ejemplo.mx', isCreator: true }));
  expect(invitationItem('nueva@ejemplo.mx')?.textContent).toContain('Administración');
  expect(emailInput().value).toBe('');
  expect(creatorBox().checked).toBe(false);

  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await act(async () => [...invitationItem('nueva@ejemplo.mx')!.querySelectorAll('button')].find((b) => b.textContent === 'Retirar')!.click());
  expect(invitationItem('nueva@ejemplo.mx')).toBeUndefined();
});

it('reinvitar con otro rol actualiza la invitación existente', async () => {
  const source = new DemoDataSource(createDemoState(), 'demo-1');
  await render(source);
  await typeEmail('pendiente@ejemplo.mx');
  await act(async () => creatorBox().click());
  await act(async () => inviteButton().click());
  const pendientes = source.getSnapshot().invitations.filter((i) => i.email === 'pendiente@ejemplo.mx');
  expect(pendientes).toEqual([expect.objectContaining({ isCreator: true })]);
  expect(invitationItem('pendiente@ejemplo.mx')?.textContent).toContain('Administración');
});

it('muestra el error y conserva el correo cuando no es válido', async () => {
  const source = new DemoDataSource(createDemoState(), 'demo-1');
  await render(source);
  await typeEmail('alumno@sin-dominio');
  await act(async () => inviteButton().click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('no es válido');
  expect(emailInput().value).toBe('alumno@sin-dominio');
  expect(invitationItem('alumno@sin-dominio')).toBeUndefined();
});

it('quien no es creador no ve el formulario de invitaciones', async () => {
  await render(new DemoDataSource(createDemoState(), 'demo-2'));
  expect(emailInput()).toBeNull();
  expect(container.textContent).not.toContain('Invitaciones');
});

it('muestra el estado del correo y permite reenviar solo cuando corresponde', async () => {
  const resendInvitationEmail = vi.fn().mockResolvedValue(undefined);
  const me = { id: 'yo', displayName: 'Ana', status: 'active', isCreator: true, joinedAt: new Date() };
  const base = { invitedBy: 'yo', createdAt: new Date('2026-10-20T12:00:00Z'), isCreator: false };
  const snapshot = {
    me, members: [me], subjects: [], inviteLinks: [],
    invitations: [
      { ...base, email: 'enviando@ejemplo.mx', emailStatus: 'pending', emailRequestedAt: new Date() },
      { ...base, email: 'reciente@ejemplo.mx', emailStatus: 'sent', emailRequestedAt: new Date(), emailSentAt: new Date() },
      { ...base, email: 'viejo@ejemplo.mx', emailStatus: 'sent', emailRequestedAt: new Date('2026-10-20T12:00:00Z'), emailSentAt: new Date('2026-10-20T12:00:00Z') },
      { ...base, email: 'fallido@ejemplo.mx', emailStatus: 'failed', emailRequestedAt: new Date() },
    ],
  };
  const source = { resendInvitationEmail, getSnapshot: () => snapshot, subscribe: () => () => {} } as unknown as DemoDataSource;
  await render(source);
  const resend = (email: string) => [...invitationItem(email)!.querySelectorAll('button')].find((b) => b.textContent === 'Reenviar');

  expect(invitationItem('enviando@ejemplo.mx')?.textContent).toContain('Enviando correo');
  expect(invitationItem('reciente@ejemplo.mx')?.textContent).toContain('Correo enviado el');
  expect(invitationItem('fallido@ejemplo.mx')?.textContent).toContain('No se pudo enviar');
  expect(resend('enviando@ejemplo.mx')).toBeUndefined();
  expect(resend('reciente@ejemplo.mx')).toBeUndefined();
  expect(resend('viejo@ejemplo.mx')).toBeDefined();

  await act(async () => resend('fallido@ejemplo.mx')!.click());
  expect(resendInvitationEmail).toHaveBeenCalledWith('fallido@ejemplo.mx');
});

it('gestiona enlaces desde Administración y crea uno sin usar el flujo anterior', async () => {
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_') });
  const source = new DemoDataSource(createDemoState(), 'demo-1');
  const url = `https://b20.test/#/invitacion?token=${'A'.repeat(43)}`;
  const create = vi.spyOn(source, 'createInvitationLink').mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', url });
  const legacy = vi.spyOn(source, 'createInviteLink');
  await render(source);
  expect(container.querySelectorAll('#admin-links-title')).toHaveLength(1);
  expect(container.textContent).toContain('Integrantes y correos');
  const createButton = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Crear enlace')!;
  await act(async () => createButton.click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.getAttribute('aria-label')).toBe('Crear enlace de invitación');
  await act(async () => dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), name: 'Invitación al grupo',
    expiresAt: expect.any(Number), maxUses: null,
  }));
  expect(legacy).not.toHaveBeenCalled();
  expect(dialog.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe(url);
  expect(dialog.textContent).toContain('Podrás volver a copiarlo desde Administración');
  source.dispose();
});
