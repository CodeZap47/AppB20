// @vitest-environment jsdom
import { StrictMode, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from './auth/session';
import type { DataSource } from './data/types';

const control = vi.hoisted(() => ({
  session: { status: 'signedOut' } as SessionState,
  config: { dataMode: 'demo', spacetimeAuthClientId: 'client_test' },
  currentSource: undefined as DataSource | undefined,
  realSource: undefined as DataSource | undefined,
  realConnections: vi.fn(),
}));

vi.mock('./config', () => ({ config: control.config }));
vi.mock('./auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <div data-auth-provider>{children}</div>,
  useSession: () => control.session,
  useSessionStore: () => ({ signOut: () => { control.session = { status: 'signedOut' }; } }),
  SpacetimeAuthButton: () => <button>Continuar con SpacetimeAuth</button>,
}));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  const { useDataSource, useSnapshot } = await import('./data/DataContext');
  return {
    ...actual,
    createHashRouter: () => ({}),
    RouterProvider: () => {
      control.currentSource = useDataSource();
      const snapshot = useSnapshot();
      return <section data-simulation>{snapshot.groupMessages.map((message) =>
        <p key={message.id}>{message.text}</p>)}</section>;
    },
  };
});
vi.mock('./lib/spacetime', async () => {
  const { DataProvider } = await import('./data/DataContext');
  return {
    SpacetimeProvider: ({ children, token }: { children: ReactNode; token: string }) => {
      control.realConnections(token);
      return <DataProvider source={control.realSource!}>{children}</DataProvider>;
    },
  };
});

import { App } from './App';
import { createDemoState, DemoDataSource } from './data/demo';

let root: Root;
let container: HTMLDivElement;

function signedIn(subject = 'verified-new-user', token = 'token-a'): SessionState {
  return {
    status: 'signedIn', token, expiresAt: Date.now() + 3_600_000,
    profile: { subject, email: `${subject}@example.test`, name: 'Cuenta real' },
  };
}

async function renderApp() {
  await act(async () => root.render(<StrictMode><App platform="web" /></StrictMode>));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  control.session = { status: 'signedOut' };
  control.config.dataMode = 'demo';
  control.currentSource = undefined;
  control.realSource = undefined;
  control.realConnections.mockClear();
  window.history.replaceState({}, '', '/');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('login real antes de cualquier fuente de datos', () => {
  it.each(['/', '/?demo', '/?demo=1'])('exige sesión aunque la dirección sea %s', async (url) => {
    window.history.replaceState({}, '', url);
    await renderApp();
    expect(container.querySelector('[data-auth-provider]')).not.toBeNull();
    expect(container.textContent).toContain('Continuar con SpacetimeAuth');
    expect(container.querySelector('[data-simulation]')).toBeNull();
    expect(container.querySelector('a[href="?demo"]')).toBeNull();
    expect(control.realConnections).not.toHaveBeenCalled();
  });

  it('tampoco ofrece una entrada de prueba cuando falta configurar el cliente real', async () => {
    const { AuthProvider } = await vi.importActual<typeof import('./auth/AuthContext')>('./auth/AuthContext');
    await act(async () => root.render(<AuthProvider clientId=""><p>Datos protegidos</p></AuthProvider>));
    expect(container.textContent).toContain('Client ID');
    expect(container.textContent).not.toContain('Datos protegidos');
    expect(container.querySelector('a[href="?demo"]')).toBeNull();
  });

  it('permite usar los fixtures a una sesión nueva sin invitación y sin abrir Maincloud', async () => {
    control.session = signedIn();
    await renderApp();
    const source = control.currentSource!;
    expect(source).toBeInstanceOf(DemoDataSource);
    expect(source.getSnapshot().members.length).toBeGreaterThan(0);
    expect(source.getSnapshot().invitations.some((invite) => invite.email === 'verified-new-user@example.test')).toBe(false);
    expect(container.querySelector('[data-simulation]')).not.toBeNull();
    expect(container.textContent).not.toContain('Unirme al grupo');
    expect(control.realConnections).not.toHaveBeenCalled();
  });

  it('conserva la simulación durante la renovación y al cambiar solo el perfil ficticio', async () => {
    control.session = signedIn();
    await renderApp();
    const source = control.currentSource as DemoDataSource;
    await act(async () => { source.sendGroupMessage('Cambio que debe sobrevivir a la renovación'); });
    control.session = signedIn('verified-new-user', 'token-renovado');
    await renderApp();
    expect(control.currentSource).toBe(source);
    expect(container.textContent).toContain('Cambio que debe sobrevivir a la renovación');
    await act(async () => { source.setViewer('demo-2'); });
    expect(control.session.status === 'signedIn' && control.session.profile.email).toBe('verified-new-user@example.test');
    expect(control.realConnections).not.toHaveBeenCalled();
  });

  it('descarta los cambios al salir y crea otra copia al volver a entrar', async () => {
    control.session = signedIn();
    await renderApp();
    const previous = control.currentSource as DemoDataSource;
    await act(async () => { previous.sendGroupMessage('Solo de la sesión anterior'); });
    control.session = { status: 'signedOut' };
    await renderApp();
    expect(container.querySelector('[data-simulation]')).toBeNull();
    expect(previous.getSnapshot().groupMessages).toEqual([]);
    control.session = signedIn();
    await renderApp();
    expect(control.currentSource).not.toBe(previous);
    expect(container.textContent).not.toContain('Solo de la sesión anterior');
  });

  it('aísla dos cuentas y reinicia los datos al volver a montar la app', async () => {
    control.session = signedIn('cuenta-a');
    await renderApp();
    const first = control.currentSource as DemoDataSource;
    await act(async () => { first.sendGroupMessage('Contenido de A'); });
    control.session = signedIn('cuenta-b');
    await renderApp();
    const second = control.currentSource as DemoDataSource;
    expect(second).not.toBe(first);
    expect(first.getSnapshot().members).toEqual([]);
    expect(container.textContent).not.toContain('Contenido de A');
    await act(async () => { second.sendGroupMessage('Contenido de B'); });
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderApp();
    expect(control.currentSource).not.toBe(second);
    expect(second.getSnapshot().members).toEqual([]);
    expect(container.textContent).not.toContain('Contenido de B');
  });

  it('mantiene la puerta de membresía al activar los datos reales, incluso con ?demo', async () => {
    control.config.dataMode = 'spacetime';
    control.session = signedIn();
    control.realSource = new DemoDataSource(createDemoState(), 'sin-membresia');
    window.history.replaceState({}, '', '/?demo');
    await renderApp();
    expect(control.realConnections).toHaveBeenCalledWith('token-a');
    expect(container.textContent).toContain('Unirme al grupo');
    expect(container.querySelector('[data-simulation]')).toBeNull();
  });
});
