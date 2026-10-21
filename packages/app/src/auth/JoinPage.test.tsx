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

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  source = new DemoDataSource(createDemoState(), 'without-membership');
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
    expect(input.value).toBe('Nombre real');
    expect(input.labels?.length).toBeGreaterThan(0);
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(join).toHaveBeenCalledExactlyOnceWith('Nombre real');
  });

  it('bloquea el envío mientras espera al servidor y anuncia el error al recuperarse', async () => {
    let reject!: (error: Error) => void;
    vi.spyOn(source, 'joinGroup').mockImplementation(() => new Promise<void>((_, rejectPromise) => { reject = rejectPromise; }));
    await renderJoin();
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(container.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(true);
    expect(container.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
    await act(async () => reject(new Error('Este correo no tiene invitación.')));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Este correo no tiene invitación.');
    expect(container.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(false);
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
