// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferencesInput } from '@b20/core';
import { NotificationSettings } from './NotificationSettings';

vi.mock('./PlatformContext', () => ({ usePlatform: () => 'web' }));
vi.mock('../config', () => ({ config: { vapidPublicKey: 'BAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE' } }));
vi.mock('../data/DataContext', () => ({ useSnapshot: () => snapshot, useDataSource: () => source }));

const source = { saveNotificationPreferences: vi.fn(), registerPushInstallation: vi.fn(), removePushInstallation: vi.fn(), requestNotificationTest: vi.fn() };
const installation = (id: string, label: string, enabled = true) => ({ id, label, enabled, createdAt: new Date(), updatedAt: new Date() });
const freshSnapshot = () => ({ me: { id: 'member' }, notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, version: 1, pushEnabled: true }, pushInstallations: [installation('local', 'Mi teléfono'), installation('remote', 'Otro teléfono'), installation('disabled', 'Retirado', false)] });
let snapshot: ReturnType<typeof freshSnapshot>; let container: HTMLDivElement; let root: Root;
let notification: { permission: NotificationPermission; requestPermission: ReturnType<typeof vi.fn> };
let permissionStatus: EventTarget & { state: PermissionState };
let worker: { active: object | null; pushManager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> } };
let getRegistration: ReturnType<typeof vi.fn>; let query: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.resetAllMocks(); localStorage.clear(); snapshot = freshSnapshot();
  localStorage.setItem('b20.push.installation.member', 'local'); localStorage.setItem('b20.push.owner', 'member');
  notification = { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') };
  permissionStatus = Object.assign(new EventTarget(), { state: 'granted' as PermissionState });
  query = vi.fn().mockResolvedValue(permissionStatus);
  const subscription = { toJSON: () => ({ endpoint: 'https://web.push.apple.com/example', keys: { p256dh: 'public-key', auth: 'auth-secret' } }), unsubscribe: vi.fn().mockResolvedValue(true) };
  worker = { active: {}, pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription), subscribe: vi.fn().mockResolvedValue(subscription) } };
  getRegistration = vi.fn().mockResolvedValue(worker);
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: Object.assign(new EventTarget(), { getRegistration, ready: Promise.resolve(worker) }) });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query } });
  vi.stubGlobal('Notification', notification); vi.stubGlobal('PushManager', class {});
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  source.saveNotificationPreferences.mockImplementation((input: NotificationPreferencesInput) => { snapshot = { ...snapshot, notificationPreferences: { ...input, version: snapshot.notificationPreferences.version + 1 } }; });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker'); Reflect.deleteProperty(navigator, 'permissions');
});
const render = () => act(async () => root.render(<MemoryRouter><NotificationSettings /></MemoryRouter>));
const badge = (label = 'Mi teléfono') => [...container.querySelectorAll('li')].find((row) => row.querySelector('.settings-person__name')?.textContent?.startsWith(label))!.querySelector('.badge')!;
const button = (text: string) => [...container.querySelectorAll('button')].find((entry) => entry.textContent === text)!;
const event = (target: EventTarget, name: string) => act(async () => { target.dispatchEvent(new Event(name)); });
function permission(value: NotificationPermission) { notification.permission = value; permissionStatus.state = value === 'default' ? 'prompt' : value; }
function expectReadOnly() {
  expect(notification.requestPermission).not.toHaveBeenCalled(); expect(worker.pushManager.subscribe).not.toHaveBeenCalled();
  for (const action of Object.values(source)) expect(action).not.toHaveBeenCalled();
}

describe('estado actual de Web Push en preferencias', () => {
  it('marca Activo solo el teléfono comprobado y conserva los demás como registrados o desactivados', async () => {
    await render(); expect(badge().textContent).toBe('Activo'); expect(badge().classList.contains('badge--group')).toBe(true);
    expect(badge('Otro teléfono').textContent).toBe('Registrado'); expect(badge('Otro teléfono').classList.contains('badge--group')).toBe(false);
    expect(badge('Retirado').textContent).toBe('Desactivado'); expectReadOnly();
  });
  it('no atribuye una instalación local a una cuenta distinta', async () => {
    localStorage.setItem('b20.push.owner', 'another-member'); await render();
    expect(badge().textContent).toBe('Registrado'); expect(container.querySelector('.badge--group')).toBeNull(); expectReadOnly();
  });
  it.each([['default', 'Permiso pendiente'], ['denied', 'Permiso bloqueado']] as const)('refleja el permiso %s sin pedirlo al consultar', async (value, label) => {
    permission(value); await render(); expect(badge().textContent).toBe(label); expectReadOnly();
  });
  it('detecta revocación y recuperación al volver a la app, incluida la restauración de página', async () => {
    await render(); permission('denied'); await event(window, 'focus'); expect(badge().textContent).toBe('Permiso bloqueado');
    permission('granted'); await event(window, 'pageshow'); expect(badge().textContent).toBe('Activo');
    worker.pushManager.getSubscription.mockResolvedValue(null); await event(document, 'visibilitychange'); expect(badge().textContent).toBe('Sin suscripción'); expectReadOnly();
  });
  it('atiende cambios del permiso desde la configuración del navegador', async () => {
    await render(); expect(query).toHaveBeenCalledWith({ name: 'notifications' });
    permission('denied'); await event(permissionStatus, 'change'); expect(badge().textContent).toBe('Permiso bloqueado');
    permission('granted'); await event(permissionStatus, 'change'); expect(badge().textContent).toBe('Activo'); expectReadOnly();
  });
  it('tolera Permissions.query rechazada y vuelve a comprobar al recuperar el foco', async () => {
    query.mockRejectedValue(new Error('Permissions API no disponible')); await render(); expect(badge().textContent).toBe('Activo');
    permission('denied'); await event(window, 'focus'); expect(badge().textContent).toBe('Permiso bloqueado'); expectReadOnly();
  });
  it('recupera un cambio de permiso ocurrido mientras se prepara su observación', async () => {
    let resolveQuery!: (value: typeof permissionStatus) => void;
    query.mockReturnValue(new Promise((resolve) => { resolveQuery = resolve; }));
    await render(); expect(badge().textContent).toBe('Activo');
    permission('denied');
    await act(async () => { resolveQuery(permissionStatus); });
    expect(badge().textContent).toBe('Permiso bloqueado'); expectReadOnly();
  });
  it('mantiene los ajustes disponibles si el navegador restringe el acceso al service worker', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get() { throw new Error('Acceso restringido'); } });
    await render(); expect(badge().textContent).toBe('No comprobado'); expectReadOnly();
  });
  it.each(['sin registro', 'sin worker activo', 'sin suscripción', 'error de registro', 'error de suscripción'] as const)('consulta %s sin inventar un estado activo', async (scenario) => {
    if (scenario === 'sin registro') getRegistration.mockResolvedValue(undefined);
    if (scenario === 'sin worker activo') worker.active = null;
    if (scenario === 'sin suscripción') worker.pushManager.getSubscription.mockResolvedValue(null);
    if (scenario === 'error de registro') getRegistration.mockRejectedValue(new Error('No se pudo consultar'));
    if (scenario === 'error de suscripción') worker.pushManager.getSubscription.mockRejectedValue(new Error('No se pudo consultar'));
    await render(); expect(badge().textContent).toBe(scenario.startsWith('error') ? 'No comprobado' : 'Sin suscripción'); expectReadOnly();
  });
  it('ignora una comprobación anterior que termina después de desaparecer la suscripción', async () => {
    let resolveSubscription!: (value: object) => void;
    worker.pushManager.getSubscription.mockReturnValueOnce(new Promise((resolve) => { resolveSubscription = resolve; }));
    await render(); expect(badge().textContent).toBe('Comprobando…');
    worker.pushManager.getSubscription.mockResolvedValue(null); await event(window, 'focus'); expect(badge().textContent).toBe('Sin suscripción');
    await act(async () => { resolveSubscription({}); }); expect(badge().textContent).toBe('Sin suscripción'); expectReadOnly();
  });
  it('usa la preferencia guardada y actualiza el estado al guardar su activación', async () => {
    snapshot.notificationPreferences.pushEnabled = false; await render(); expect(badge().textContent).toBe('Envío desactivado');
    const checkbox = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) => input.closest('label')?.textContent?.includes('Enviar también'))!;
    await act(async () => checkbox.click()); expect(badge().textContent).toBe('Envío desactivado'); expect(source.saveNotificationPreferences).not.toHaveBeenCalled();
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(source.saveNotificationPreferences).toHaveBeenCalledWith(expect.objectContaining({ pushEnabled: true })); expect(badge().textContent).toBe('Activo');
  });
  it('vuelve a comprobar después de activar el dispositivo con una acción explícita', async () => {
    permission('default'); notification.requestPermission.mockImplementation(async () => { permission('granted'); return 'granted'; });
    await render(); expect(badge().textContent).toBe('Permiso pendiente');
    await act(async () => button('Activar en este dispositivo').click());
    expect(notification.requestPermission).toHaveBeenCalledOnce(); expect(source.registerPushInstallation).toHaveBeenCalledOnce(); expect(badge().textContent).toBe('Activo');
  });
  it.each(['unsupported', 'needs-install'] as const)('muestra la limitación %s sin consultar ni registrar push', async (kind) => {
    if (kind === 'unsupported') Reflect.deleteProperty(window, 'PushManager');
    else vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
    await render(); expect(badge().textContent).toBe(kind === 'unsupported' ? 'No compatible' : 'Instalación necesaria'); expectReadOnly();
  });
});
