// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  busy: false,
  passkeysAvailable: false,
  lookup: vi.fn(),
  signIn: vi.fn(),
  sendCode: vi.fn(),
  updatePassword: vi.fn(),
}));
vi.mock('./SupabaseAuthProvider', () => ({ useSupabaseAuth: () => auth }));
vi.mock('../config', () => ({ config: { supabaseOAuthProviders: [] } }));
vi.mock('./inviteLink', () => ({ pendingInviteLink: () => null }));

import { CreatePasswordPage, SupabaseSignInForm } from './SupabaseSignInForm';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  auth.busy = false;
  auth.lookup.mockResolvedValue('password');
  auth.signIn.mockResolvedValue(undefined);
  auth.sendCode.mockResolvedValue(undefined);
  auth.updatePassword.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function toggle(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function submit() {
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}
async function showLogin() {
  await act(async () => root.render(<SupabaseSignInForm />));
  await input(container.querySelector('input')!, 'Alumno@Example.test');
  await submit();
}

describe('visibilidad de contraseñas al acceder', () => {
  it('permite mostrar y ocultar sin enviar el formulario y conserva la contraseña para entrar', async () => {
    await showLogin();
    const password = container.querySelector('input')!;
    expect(password.type).toBe('password');
    expect(password.autocomplete).toBe('current-password');
    expect(password.required).toBe(true);
    expect(password.labels?.[0]?.textContent).toContain('Contraseña');
    await input(password, 'Una contraseña 123');

    await toggle('Mostrar contraseña');
    expect(password.type).toBe('text');
    expect(password.value).toBe('Una contraseña 123');
    await toggle('Ocultar contraseña');
    expect(password.type).toBe('password');
    expect(password.value).toBe('Una contraseña 123');
    expect(auth.signIn).not.toHaveBeenCalled();

    await submit();
    expect(auth.signIn).toHaveBeenCalledExactlyOnceWith('alumno@example.test', 'Una contraseña 123');
    expect(password.value).toBe('');
    expect(password.type).toBe('password');
  });

  it('vuelve a ocultar el campo tras borrarlo y tras elegir otro correo', async () => {
    await showLogin();
    let password = container.querySelector('input')!;
    await input(password, 'Secreto inicial');
    await toggle('Mostrar contraseña');
    await input(password, '');
    expect(password.type).toBe('password');

    await input(password, 'Otra contraseña');
    await toggle('Mostrar contraseña');
    const otherEmail = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Usar otro correo')!;
    await act(async () => otherEmail.click());
    expect(container.querySelector('input')!.type).toBe('email');
    await submit();
    password = container.querySelector('input')!;
    expect(password.type).toBe('password');
    expect(password.value).toBe('');
    expect(auth.signIn).not.toHaveBeenCalled();
  });
});

describe('visibilidad al crear una contraseña', () => {
  it('mantiene independientes los dos campos y conserva las validaciones y el envío', async () => {
    await act(async () => root.render(<CreatePasswordPage />));
    const [password, confirmation] = [...container.querySelectorAll('input')] as [HTMLInputElement, HTMLInputElement];
    for (const field of [password, confirmation]) {
      expect(field.type).toBe('password');
      expect(field.autocomplete).toBe('new-password');
      expect(field.required).toBe(true);
      expect(field.minLength).toBe(8);
    }
    await input(password, 'Contraseña 123');
    await input(confirmation, 'Diferente 456');

    await toggle('Mostrar contraseña');
    expect(password.type).toBe('text');
    expect(confirmation.type).toBe('password');
    await toggle('Mostrar confirmación de contraseña');
    expect(password.type).toBe('text');
    expect(confirmation.type).toBe('text');
    await toggle('Ocultar contraseña');
    expect(password.type).toBe('password');
    expect(confirmation.type).toBe('text');
    expect(password.value).toBe('Contraseña 123');
    expect(confirmation.value).toBe('Diferente 456');
    expect(auth.updatePassword).not.toHaveBeenCalled();

    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Las contraseñas no coinciden.');
    expect(auth.updatePassword).not.toHaveBeenCalled();
    await input(confirmation, 'Contraseña 123');
    await submit();
    expect(auth.updatePassword).toHaveBeenCalledExactlyOnceWith('Contraseña 123');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
