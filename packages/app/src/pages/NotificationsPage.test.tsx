// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { NotificationsPage } from './NotificationsPage';

const actions = { markNotificationRead: vi.fn(), markAllNotificationsRead: vi.fn() };
const notices = [{ id: '1', kind: 'direct_message', title: 'Nuevo mensaje privado', route: '/m/mensajes/directos/7', createdAt: new Date('2026-10-21T12:00:00Z'), readAt: undefined },
  { id: '2', kind: 'guide', title: 'Guía disponible', route: '/m/guias/8', createdAt: new Date('2026-10-20T12:00:00Z'), readAt: new Date('2026-10-21T10:00:00Z') }];
vi.mock('../data/DataContext', () => ({ useSnapshot: () => ({ notifications: notices }), useDataSource: () => actions }));
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); actions.markNotificationRead.mockResolvedValue(undefined); actions.markAllNotificationsRead.mockResolvedValue(undefined);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = () => act(async () => root.render(<MemoryRouter><NotificationsPage /></MemoryRouter>));
const button = (text: string) => [...container.querySelectorAll('button')].find((entry) => entry.textContent === text)!;

describe('bandeja personal de avisos', () => {
  it('filtra sin leer y conserva el destino del aviso sin mostrar el texto del chat', async () => {
    await render();
    expect(container.querySelector('a[href="/m/mensajes/directos/7"]')?.textContent).toBe('Nuevo mensaje privado');
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(container.querySelector('a[href="/m/guias/8"]')).toBeNull();
    expect(actions.markAllNotificationsRead).not.toHaveBeenCalled();
  });
  it('solo cambia la lectura al actuar sobre el aviso o su botón', async () => {
    await render(); expect(actions.markNotificationRead).not.toHaveBeenCalled();
    await act(async () => button('Marcar como leído').click());
    expect(actions.markNotificationRead).toHaveBeenCalledWith('1');
  });
  it('informa un rechazo del servidor sin inventar una lectura local', async () => {
    actions.markAllNotificationsRead.mockRejectedValue(new Error('La cuenta ya no está activa.'));
    await render(); await act(async () => button('Marcar todos como leídos').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('La cuenta ya no está activa.');
    expect(button('Marcar como leído')).toBeTruthy();
  });
});
