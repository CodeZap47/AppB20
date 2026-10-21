// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@b20/core';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { NotificationSettings } from './NotificationSettings';

vi.mock('./PlatformContext', () => ({ usePlatform: () => 'android' }));
vi.mock('../config', () => ({ config: { vapidPublicKey: '' } }));
let container: HTMLDivElement; let root: Root; let editor: DemoDataSource; let concurrent: DemoDataSource;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const state = createDemoState(new Date('2026-10-21T12:00:00Z')); editor = new DemoDataSource(state, 'demo-2'); concurrent = new DemoDataSource(state, 'demo-2');
  concurrent.saveNotificationPreferences({ ...DEFAULT_NOTIFICATION_PREFERENCES, timeZone: 'UTC' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); editor.dispose(); concurrent.dispose(); container.remove(); vi.restoreAllMocks(); });
const render = () => act(async () => root.render(<MemoryRouter><DataProvider source={editor}><NotificationSettings /></DataProvider></MemoryRouter>));
const button = (text: string) => [...container.querySelectorAll('button')].find((entry) => entry.textContent === text)!;
const zone = () => container.querySelector<HTMLInputElement>('input[placeholder="America/Tijuana"]')!;
async function editZone(value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(zone(), value); zone().dispatchEvent(new Event('input', { bubbles: true })); });
}
const submit = () => act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });

describe('preferencias de avisos con concurrencia real del almacén', () => {
  it('conserva la edición al rechazar expectedVersion y permite recargar y guardar sobre la nueva versión', async () => {
    const save = vi.spyOn(editor, 'saveNotificationPreferences'); await render(); expect(zone().value).toBe('UTC');
    await editZone('Asia/Kolkata');
    await act(async () => concurrent.saveNotificationPreferences({ ...DEFAULT_NOTIFICATION_PREFERENCES, expectedVersion: 1, timeZone: 'Europe/Madrid' }));
    expect(zone().value).toBe('Asia/Kolkata'); await submit();
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 1, timeZone: 'Asia/Kolkata' }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('preferencias cambiaron'); expect(zone().value).toBe('Asia/Kolkata');
    expect(editor.getSnapshot().notificationPreferences).toMatchObject({ timeZone: 'Europe/Madrid', version: 2 }); expect(container.querySelector('[role="status"]')).toBeNull();
    await act(async () => button('Recargar preferencias guardadas').click()); expect(zone().value).toBe('Europe/Madrid');
    await editZone('America/Tijuana'); await submit();
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 2, timeZone: 'America/Tijuana' })); expect(editor.getSnapshot().notificationPreferences).toMatchObject({ timeZone: 'America/Tijuana', version: 3 });
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.querySelector('[role="status"]')?.textContent).toBe('Preferencias guardadas.');
  });
  it('mantiene el error del servidor al probar avisos y no anuncia éxito al recibir otro snapshot', async () => {
    const test = vi.spyOn(editor, 'requestNotificationTest').mockImplementation(() => { throw new Error('El servidor rechazó la prueba.'); });
    await render(); await act(async () => button('Probar mis avisos').click()); expect(test).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('El servidor rechazó la prueba.'); expect(container.querySelector('[role="status"]')).toBeNull();
    await act(async () => concurrent.saveNotificationPreferences({ ...DEFAULT_NOTIFICATION_PREFERENCES, expectedVersion: 1, timeZone: 'Europe/Madrid' }));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('El servidor rechazó la prueba.'); expect(container.textContent).not.toContain('Prueba solicitada.'); expect(button('Probar mis avisos').disabled).toBe(false);
  });
});
