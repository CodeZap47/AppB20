// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { SettingsPage } from './SettingsPage';

vi.mock('../components/PlatformContext', () => ({ usePlatform: () => 'android' }));
vi.mock('../config', () => ({ config: { vapidPublicKey: '', aiApiUrl: 'https://api.example' } }));
let container: HTMLDivElement; let root: Root; let source: DemoDataSource; let location = '';
function Where() { const here = useLocation(); location = here.pathname + here.search; return null; }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); });
async function show(viewer: string, entry = '/ajustes') {
  source = new DemoDataSource(createDemoState(new Date('2026-10-21T12:00:00Z')), viewer);
  await act(async () => root.render(<MemoryRouter initialEntries={[entry]}><DataProvider source={source}><SettingsPage /><Where /></DataProvider></MemoryRouter>));
}
const tabs = () => [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
const tab = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((entry) => entry.textContent === label)!;

describe('Ajustes por pestañas', () => {
  it('un integrante no ve Administración y la URL de esa pestaña cae a Cuenta', async () => {
    await show('demo-2', '/ajustes?pestana=admin');
    expect(tabs()).toEqual(['Cuenta', 'Calendario', 'Avisos', 'IA']);
    expect(tab('Cuenta').getAttribute('aria-selected')).toBe('true');
    expect(container.textContent).toContain('Integrante');
    expect(container.textContent).toContain('Administración del grupo');
    expect(container.textContent).not.toContain('Invitaciones');
  });

  it('un integrante ve el calendario de solo lectura y la pestaña queda en la URL', async () => {
    await show('demo-2');
    await act(async () => tab('Calendario').click());
    expect(location).toBe('/ajustes?pestana=calendario');
    expect(container.textContent).toContain('Solo lectura');
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it('un administrador ve el resumen del grupo y puede editar el calendario', async () => {
    await show('demo-1', '/ajustes?pestana=admin');
    expect(tabs()).toContain('Administración');
    const summary = container.querySelector('section[aria-label="Resumen del grupo"]')!;
    expect(summary.textContent).toContain('Integrantes activos');
    expect(summary.textContent).toContain('Invitaciones pendientes');
    expect(container.textContent).toContain('Invitar como administrador');
    await act(async () => tab('Calendario').click());
    expect(container.textContent).not.toContain('Solo lectura');
    expect(container.querySelector('input[type="date"]')).not.toBeNull();
  });
});
