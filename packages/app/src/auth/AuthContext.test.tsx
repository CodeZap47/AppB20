// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const oidc = vi.hoisted(() => ({
  isLoading: false,
  activeNavigator: undefined as string | undefined,
  signinRedirect: vi.fn(async () => {}),
}));
vi.mock('react-oidc-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({
    isLoading: oidc.isLoading,
    activeNavigator: oidc.activeNavigator,
    signinRedirect: oidc.signinRedirect,
    user: null,
  }),
}));

import { AuthProvider, SpacetimeAuthButton } from './AuthContext';

let root: Root;
let container: HTMLDivElement;
async function renderAccess() {
  await act(async () => root.render(
    <AuthProvider clientId="client_test"><SpacetimeAuthButton label="Continuar con correo" /></AuthProvider>,
  ));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  oidc.isLoading = false;
  oidc.activeNavigator = undefined;
  oidc.signinRedirect.mockClear();
  window.history.replaceState({}, '', '/?filter=mine#/m/tareas');
  localStorage.clear();
  sessionStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('acción de acceso con SpacetimeAuth', () => {
  it('mantiene la navegación OIDC al cambiar la presentación del botón', async () => {
    await renderAccess();
    const button = container.querySelector('button')!;
    expect(button.textContent).toContain('Continuar con correo');
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(oidc.signinRedirect).toHaveBeenCalledExactlyOnceWith({ state: { returnTo: '/?filter=mine#/m/tareas' } });
  });

  it.each(['loading', 'navigation'])('no permite un segundo acceso durante %s', async (stage) => {
    oidc.isLoading = stage === 'loading';
    oidc.activeNavigator = stage === 'navigation' ? 'signinRedirect' : undefined;
    await renderAccess();
    const button = container.querySelector('button')!;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    await act(async () => button.click());
    expect(oidc.signinRedirect).not.toHaveBeenCalled();
  });
});
