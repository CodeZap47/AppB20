// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from './session';

const control = vi.hoisted(() => ({
  session: {
    status: 'signedIn', token: 'test-token', expiresAt: Date.now() + 3_600_000,
    profile: { subject: 'real-account', email: 'cuenta-real@example.test', name: 'Nombre real' },
  } as SessionState,
  signOut: vi.fn(),
}));
vi.mock('./AuthContext', () => ({
  useSession: () => control.session,
  useSessionStore: () => ({ signOut: control.signOut }),
}));

import { JoinPage } from './JoinPage';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';

let container: HTMLDivElement;
let root: Root;
let source: DemoDataSource;

async function renderJoin() {
  await act(async () => root.render(<DataProvider source={source}><JoinPage /></DataProvider>));
}

async function enterName(value: string) {
  const input = container.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  source = new DemoDataSource(createDemoState(), 'without-membership');
  control.session = {
    status: 'signedIn', token: 'test-token', expiresAt: Date.now() + 3_600_000,
    profile: { subject: 'real-account', email: 'cuenta-real@example.test', name: 'Nombre real' },
  };
  control.signOut.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  source.dispose();
  container.remove();
});

describe('acceso al grupo tras autenticar la cuenta real', () => {
  it('muestra el correo autenticado y envía únicamente el nombre, sin volver a pedir credenciales', async () => {
    const join = vi.spyOn(source, 'joinGroup').mockImplementation(() => {});
    await renderJoin();
    expect(container.textContent).toContain('cuenta-real@example.test');
    expect(container.querySelector('input[type="email"], input[type="password"]')).toBeNull();
    const input = container.querySelector('input')!;
    expect(input.value).toBe('');
    expect(input.labels?.length).toBeGreaterThan(0);
    expect(input.required).toBe(true);
    expect(container.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(true);
    await enterName('  Ana María 李  ');
    await submit();
    expect(join).toHaveBeenCalledExactlyOnceWith('Ana María 李');
  });

  it.each(['cuenta-real@example.test', ''])('no usa el perfil de sesión como nombre inicial (%s)', async (name) => {
    if (control.session.status === 'signedIn') control.session.profile.name = name;
    await renderJoin();
    expect(container.querySelector('input')!.value).toBe('');
  });

  it.each(['', '   ', ' ALUMNO@Ejemplo.com ', 'alumno@localhost', 'A'.repeat(81)])('rechaza un nombre inválido incluso con envío programático (%s)', async (name) => {
    const join = vi.spyOn(source, 'joinGroup');
    await renderJoin();
    await enterName(name);
    await submit();
    expect(join).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    const input = container.querySelector('input')!;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(container.querySelector('[role="alert"]')!.id);
    expect(container.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(true);
  });

  it('bloquea el envío mientras espera al servidor y anuncia el error al recuperarse', async () => {
    let reject!: (error: Error) => void;
    vi.spyOn(source, 'joinGroup').mockImplementation(() => new Promise<void>((_, rejectPromise) => { reject = rejectPromise; }));
    await renderJoin();
    await enterName('Ana');
    await submit();
    expect(container.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(true);
    expect(container.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
    await act(async () => reject(new Error('Este correo no tiene invitación.')));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Este correo no tiene invitación.');
    expect(container.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(false);
  });

  it('solo envía una petición aunque el formulario se envíe dos veces antes de renderizar', async () => {
    let finish!: () => void;
    const join = vi.spyOn(source, 'joinGroup').mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await renderJoin();
    await enterName('Ana');
    await act(async () => {
      const form = container.querySelector('form')!;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(join).toHaveBeenCalledExactlyOnceWith('Ana');
    expect(container.querySelector('input')!.disabled).toBe(true);
    await act(async () => finish());
  });

  it('corrige un miembro existente conservando su foto, identidad, rol y publicaciones', async () => {
    source.dispose();
    const state = createDemoState();
    const original = { ...state.members[0]!, displayName: 'cuenta-real@example.test', photoUrl: 'https://example.test/foto.png' };
    state.members[0] = original;
    source = new DemoDataSource(state, original.id);
    const before = source.getSnapshot();
    const update = vi.spyOn(source, 'updateProfile');
    const join = vi.spyOn(source, 'joinGroup');
    await renderJoin();
    expect(container.textContent).toContain('Completa tu nombre');
    expect(container.querySelector('input')!.value).toBe('');
    await enterName('  Ana  ');
    await submit();
    expect(update).toHaveBeenCalledExactlyOnceWith('Ana', original.photoUrl);
    expect(join).not.toHaveBeenCalled();
    const after = source.getSnapshot();
    expect(after.me).toEqual({ ...before.me, displayName: 'Ana' });
    expect(after.members).toHaveLength(before.members.length);
    expect(after.works).toEqual(before.works);
    expect(after.groupMessages).toEqual(before.groupMessages);
  });

  it('mantiene la corrección disponible tras un fallo y permite volver a guardar', async () => {
    source.dispose();
    const state = createDemoState();
    state.members[0]!.displayName = 'cuenta-real@example.test';
    source = new DemoDataSource(state, state.members[0]!.id);
    const update = vi.spyOn(source, 'updateProfile').mockRejectedValueOnce(new Error('No se pudo guardar el nombre.'));
    await renderJoin();
    await enterName('Ana');
    await submit();
    expect(source.getSnapshot().me?.displayName).toBe('cuenta-real@example.test');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No se pudo guardar el nombre.');
    expect(container.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(false);
    await submit();
    expect(update).toHaveBeenCalledTimes(2);
    expect(source.getSnapshot().me?.displayName).toBe('Ana');
  });

  it('impide volver a unirse con una membresía dada de baja y permite cambiar de cuenta', async () => {
    const state = createDemoState();
    state.members.push({ ...state.members[0]!, id: 'removed-account', status: 'removed' });
    source.dispose();
    source = new DemoDataSource(state, 'removed-account');
    const join = vi.spyOn(source, 'joinGroup');
    await renderJoin();
    expect(container.querySelector('form')).toBeNull();
    expect(join).not.toHaveBeenCalled();
    const otherAccount = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Usar otra cuenta'))!;
    await act(async () => otherAccount.click());
    expect(control.signOut).toHaveBeenCalledOnce();
  });
});
