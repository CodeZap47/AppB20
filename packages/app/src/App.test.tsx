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
  SpacetimeAuthButton: ({ label = 'Continuar con SpacetimeAuth' }: { label?: string }) => <button>{label}</button>,
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
import { SpacetimeDataSource } from './data/spacetime';

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
  if (control.realSource instanceof DemoDataSource) control.realSource.dispose();
  container.remove();
});

describe('login real antes de cualquier fuente de datos', () => {
  it('reconecta la misma fuente sin recargar ni descartar borradores privados en memoria', async () => {
    control.config.dataMode = 'spacetime';
    control.session = signedIn();
    const source = new SpacetimeDataSource({ uri: 'ws://localhost:3000', database: 'test', token: 'test-token' });
    source.disconnect();
    const reconnect = vi.spyOn(source, 'connect').mockImplementation(() => {});
    control.realSource = source as unknown as DataSource;
    await renderApp();
    const button = [...container.querySelectorAll('button')].find((element) => element.textContent === 'Volver a conectar');
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(control.realSource).toBe(source);
  });
  it.each(['/', '/?demo', '/?demo=1'])('exige sesión aunque la dirección sea %s', async (url) => {
    window.history.replaceState({}, '', url);
    await renderApp();
    expect(container.querySelector('[data-auth-provider]')).not.toBeNull();
    expect(container.textContent).toContain('Continuar con correo');
    expect(container.querySelector('[data-simulation]')).toBeNull();
    expect(container.querySelector('a[href="?demo"]')).toBeNull();
    expect(control.realConnections).not.toHaveBeenCalled();
  });

  it('anuncia la preparación de sesión y no muestra datos ni una acción de entrada duplicada', async () => {
    control.session = { status: 'loading' };
    await renderApp();
    expect(container.querySelector('main[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector('[data-simulation]')).toBeNull();
    expect(container.textContent).not.toContain('Continuar con correo');
    expect(control.realConnections).not.toHaveBeenCalled();
  });

  it('presenta el fallo de acceso como alerta sin abrir la simulación', async () => {
    control.session = { status: 'signedOut', error: 'No se pudo completar el acceso.' };
    await renderApp();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No se pudo completar el acceso.');
    expect(container.querySelector('[data-simulation]')).toBeNull();
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

  it.each(['alumno@example.test', '', '   ', 'A'.repeat(81)])('exige corregir el nombre inválido de un miembro activo antes de montar las rutas (%s)', async (name) => {
    control.config.dataMode = 'spacetime';
    control.session = signedIn();
    const state = createDemoState();
    state.members[0]!.displayName = name;
    control.realSource = new DemoDataSource(state, state.members[0]!.id);
    window.history.replaceState({}, '', '/#/m/mensajes');
    await renderApp();
    expect(container.textContent).toContain('Completa tu nombre');
    expect(container.querySelector('input')!.value).toBe('');
    expect(container.querySelector('[data-simulation]')).toBeNull();
  });

  it('espera el nombre confirmado en los datos y después abre las rutas conservando el perfil', async () => {
    control.config.dataMode = 'spacetime';
    control.session = signedIn();
    const state = createDemoState();
    state.members[0]!.displayName = 'alumno@example.test';
    state.members[0]!.photoUrl = 'https://example.test/foto.png';
    const source = new DemoDataSource(state, state.members[0]!.id);
    control.realSource = source;
    const original = source.getSnapshot().me!;
    const applyUpdate = source.updateProfile.bind(source);
    const update = vi.spyOn(source, 'updateProfile').mockImplementation(() => {});
    const join = vi.spyOn(source, 'joinGroup');
    await renderApp();
    const input = container.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '  Ana Pérez  ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenCalledExactlyOnceWith('Ana Pérez', original.photoUrl);
    expect(join).not.toHaveBeenCalled();
    expect(container.querySelector('[data-simulation]')).toBeNull();
    expect(container.textContent).toContain('Completa tu nombre');
    await act(async () => applyUpdate('Ana Pérez', original.photoUrl));
    expect(container.querySelector('[data-simulation]')).not.toBeNull();
    expect(container.textContent).not.toContain('Completa tu nombre');
    expect(source.getSnapshot().me).toEqual({ ...original, displayName: 'Ana Pérez' });
  });

  it('mantiene el acceso cerrado a miembros dados de baja aunque tengan un nombre inválido', async () => {
    control.config.dataMode = 'spacetime';
    control.session = signedIn();
    const state = createDemoState();
    Object.assign(state.members[0]!, { displayName: 'alumno@example.test', status: 'removed' });
    control.realSource = new DemoDataSource(state, state.members[0]!.id);
    await renderApp();
    expect(container.textContent).toContain('Tu acceso al grupo está cerrado');
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('[data-simulation]')).toBeNull();
  });

  it('espera la conexión antes de pedir corregir un nombre', async () => {
    control.config.dataMode = 'spacetime';
    control.session = signedIn();
    const state = createDemoState();
    state.members[0]!.displayName = 'alumno@example.test';
    const source = new DemoDataSource(state, state.members[0]!.id);
    control.realSource = source;
    vi.spyOn(source, 'getSnapshot').mockReturnValue({ ...source.getSnapshot(), connection: 'connecting' });
    await renderApp();
    expect(container.textContent).toContain('Conectando con tu grupo');
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('[data-simulation]')).toBeNull();
  });
});
