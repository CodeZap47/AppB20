// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { capturePendingInvitation, clearPendingInvitation, getPendingInvitation, preparePendingInvitation } from './pendingInvitation';

const token = 'A'.repeat(43);
beforeEach(() => { localStorage.clear(); window.history.replaceState({}, '', '/'); clearPendingInvitation(); });
afterEach(() => { clearPendingInvitation(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('limpia el secreto antes de preparar el retorno de autenticación y conserva solo el flujo en la URL', () => {
  window.history.replaceState({}, '', `/#/invitacion?token=${token}`);
  capturePendingInvitation();
  expect(window.location.href).not.toContain(token);
  expect(window.location.hash).toMatch(/^#\/invitacion\?flujo=/);
  expect(getPendingInvitation()).toBe(token);
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  expect(returnTo).not.toContain('token=');
});

it('permite recuperar la invitación en otra pestaña y separa los flujos concurrentes', () => {
  window.history.replaceState({}, '', `/#/invitacion?token=${token}`); capturePendingInvitation();
  const first = window.location.hash;
  const second = 'B'.repeat(43);
  window.history.replaceState({}, '', `/#/invitacion?token=${second}`); capturePendingInvitation();
  expect(getPendingInvitation()).toBe(second);
  window.history.replaceState({}, '', `/${first}`);
  expect(getPendingInvitation()).toBe(token);
});

it('vence después de una hora y elimina la copia temporal al aceptar o cancelar', () => {
  vi.useFakeTimers();
  window.history.replaceState({}, '', `/#/invitacion?token=${token}`); capturePendingInvitation();
  vi.advanceTimersByTime(3_600_001);
  expect(getPendingInvitation()).toBeUndefined();
  expect(Object.keys(localStorage).some((key) => key.startsWith('b20.invitation.pending.'))).toBe(false);
  window.history.replaceState({}, '', `/#/invitacion?token=${token}`); capturePendingInvitation();
  clearPendingInvitation();
  expect(getPendingInvitation()).toBeUndefined();
});

it('descarta secretos malformados sin volver a usar una invitación anterior', () => {
  window.history.replaceState({}, '', `/#/invitacion?token=${token}`); capturePendingInvitation();
  window.history.replaceState({}, '', '/#/invitacion?token=no-valido'); capturePendingInvitation();
  expect(window.location.href).not.toContain('no-valido');
  expect(getPendingInvitation()).toBeUndefined();
});

it('usa memoria de sesión de Chrome en lugar de persistir el secreto en el almacenamiento local', async () => {
  const values: Record<string, string> = {};
  vi.stubGlobal('chrome', { identity: { launchWebAuthFlow: vi.fn() }, storage: { session: {
    set: async (entries: Record<string, string>) => { Object.assign(values, entries); },
    get: async () => ({ ...values }), remove: async (key: string) => { delete values[key]; },
  } } });
  window.history.replaceState({}, '', `/#/invitacion?token=${token}`); capturePendingInvitation();
  await preparePendingInvitation();
  expect(getPendingInvitation()).toBe(token);
  expect(Object.keys(localStorage)).toHaveLength(0);
  clearPendingInvitation(); await preparePendingInvitation();
  expect(Object.keys(values)).toHaveLength(0);
});

it('un fragmento de ruta malformado no impide arrancar ni consultar el flujo pendiente', () => {
  window.history.replaceState({}, '', '/#http://[');
  expect(() => capturePendingInvitation()).not.toThrow();
  expect(() => getPendingInvitation()).not.toThrow();
  expect(getPendingInvitation()).toBeUndefined();
});

it('limpia flujos web vencidos aunque otro flujo más reciente esté en uso', async () => {
  vi.useFakeTimers();
  window.history.replaceState({}, '', `/#/invitacion?token=${token}`); capturePendingInvitation();
  const oldKey = Object.keys(localStorage).find((key) => key.startsWith('b20.invitation.pending.'))!;
  vi.advanceTimersByTime(3_600_001);
  const next = 'B'.repeat(43);
  window.history.replaceState({}, '', `/#/invitacion?token=${next}`); capturePendingInvitation();
  await preparePendingInvitation();
  expect(localStorage.getItem(oldKey)).toBeNull();
  expect(getPendingInvitation()).toBe(next);
});

it('serializa captura, cierre y nueva captura en Chrome para no borrar el flujo recién abierto', async () => {
  const values: Record<string, string> = {};
  let release!: () => void;
  let count = 0;
  const set = vi.fn(async (entries: Record<string, string>) => {
    if (++count === 1) await new Promise<void>((resolve) => { release = resolve; });
    Object.assign(values, entries);
  });
  vi.stubGlobal('chrome', { identity: { launchWebAuthFlow: vi.fn() }, storage: { session: {
    set, get: async () => ({ ...values }), remove: async (key: string) => { delete values[key]; },
  } } });
  window.history.replaceState({}, '', `/#/invitacion?token=${token}`); capturePendingInvitation();
  await vi.waitFor(() => expect(set).toHaveBeenCalledOnce());
  clearPendingInvitation();
  const next = 'B'.repeat(43);
  window.history.replaceState({}, '', `/#/invitacion?token=${next}`); capturePendingInvitation();
  const flow = new URLSearchParams(window.location.hash.split('?')[1]).get('flujo');
  release(); await preparePendingInvitation();
  expect(getPendingInvitation()).toBe(next);
  expect(values['b20.invitation.current']).toBe(flow);
  expect(JSON.parse(values[`b20.invitation.pending.${flow}`]!).token).toBe(next);
  expect(Object.keys(values).filter((key) => key.startsWith('b20.invitation.pending.'))).toHaveLength(1);
  clearPendingInvitation(); await preparePendingInvitation();
});

it('conserva el token en memoria si Chrome rechaza escribir su almacenamiento temporal', async () => {
  vi.stubGlobal('chrome', { identity: { launchWebAuthFlow: vi.fn() }, storage: { session: {
    set: async () => { throw new Error('Storage unavailable'); }, get: async () => ({}), remove: async () => {},
  } } });
  window.history.replaceState({}, '', `/#/invitacion?token=${token}`); capturePendingInvitation();
  await preparePendingInvitation();
  expect(getPendingInvitation()).toBe(token);
  clearPendingInvitation(); await preparePendingInvitation();
});
