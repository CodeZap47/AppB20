// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { MembershipSettings } from './MembershipSettings';

let root: Root; let container: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

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
