// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../../data/DataContext';
import { emptySnapshot } from '../../data/spacetimeSnapshot';
import type { DataSource, Snapshot } from '../../data/types';
import { OnlineMembers } from './OnlineMembers';

let host: HTMLDivElement;
let root: Root;
let snapshot: Snapshot;
let compact = false;
const listeners = new Set<() => void>();
const mediaListeners = new Set<() => void>();
const at = new Date('2026-10-26T12:00:00Z');
const members = [
  { id: 'me', displayName: 'Kevin Alcaraz', status: 'active', joinedAt: at },
  { id: 'ana', displayName: 'Ana López', status: 'active', joinedAt: at },
  { id: 'beto', displayName: 'Beto Ruiz', status: 'active', joinedAt: at },
  { id: 'retired', displayName: 'Retirado', status: 'removed', joinedAt: at },
] as Snapshot['members'];
const source = { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } } as unknown as DataSource;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  compact = false;
  vi.stubGlobal('matchMedia', () => ({ get matches() { return compact; }, addEventListener: (_type: string, fn: () => void) => mediaListeners.add(fn), removeEventListener: (_type: string, fn: () => void) => mediaListeners.delete(fn) }));
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, char => `\\${char.codePointAt(0)!.toString(16)} `) });
  snapshot = { ...emptySnapshot('ready'), me: members[0], members, onlineMemberIds: ['me', 'ana', 'ana', 'retired', 'missing'] };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); listeners.clear(); mediaListeners.clear(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => root.render(<DataProvider source={source}><OnlineMembers /></DataProvider>)); }
async function change(value: Partial<Snapshot>) { await act(async () => { snapshot = { ...snapshot, ...value }; for (const listener of listeners) listener(); }); }
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function key(element: Element, key: string) { await act(async () => { element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); element.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true })); }); }
function trigger() { return host.querySelector<HTMLButtonElement>('.online-members-trigger')!; }
function list() { return document.querySelector<HTMLUListElement>('[aria-label="Integrantes activos ahora"]'); }

describe('integrantes activos del salón', () => {
  it('cuenta integrantes y personas activas únicas, incluye al propio usuario y excluye bajas', async () => {
    await mount();
    expect(trigger().textContent).toBe('3 integrantes·2 activos');
    expect(trigger().getAttribute('aria-label')).toContain('3 integrantes · 2 activos');
    expect(trigger().textContent).not.toContain('lo ve todo el grupo');
    await click(trigger());
    expect(document.querySelector('.online-members-popover')).not.toBeNull();
    expect(list()?.children).toHaveLength(2);
    expect(list()?.textContent).toContain('Kevin AlcarazTú');
    expect(list()?.textContent).toContain('Ana López');
    expect(list()?.textContent).not.toMatch(/Beto|Retirado|missing/);
  });

  it('actualiza el listado abierto al entrar, salir y darse de baja sin cerrar el desplegable', async () => {
    await mount(); await click(trigger());
    await change({ onlineMemberIds: ['me', 'beto'] });
    expect(list()?.textContent).toContain('Beto Ruiz'); expect(list()?.textContent).not.toContain('Ana López');
    await change({ members: members.map(member => member.id === 'beto' ? { ...member, status: 'removed' as const } : member) });
    expect(trigger().textContent).toBe('2 integrantes·1 activo');
    expect(list()?.textContent).not.toContain('Beto'); expect(list()?.children).toHaveLength(1);
    await change({ onlineMemberIds: [] });
    expect(trigger().textContent).toBe('2 integrantes·0 activos');
    expect(list()).toBeNull(); expect(document.querySelector('[role="dialog"]')?.textContent).toContain('No hay integrantes activos');
  });

  it('usa los singulares correctos y anuncia el contador actualizado', async () => {
    snapshot = { ...snapshot, members: [members[0]!], onlineMemberIds: ['me'] };
    await mount(); expect(trigger().textContent).toBe('1 integrante·1 activo');
    await click(trigger());
    expect(document.querySelector('.online-members-status')?.textContent).toBe('1 persona activa');
    expect(document.querySelector('.online-members-status')?.getAttribute('aria-live')).toBe('polite');
  });

  it('muestra estado de conexión y conserva el último total conocido sin inventar un cero', async () => {
    snapshot = { ...emptySnapshot('connecting'), onlineMemberIds: [] };
    await mount(); expect(trigger().textContent).toBe('Integrantes·Conectando…'); expect(trigger().disabled).toBe(true);
    await change({ connection: 'ready', me: members[0], members, onlineMemberIds: ['me'] });
    expect(trigger().textContent).toBe('3 integrantes·1 activo');
    await click(trigger());
    await change({ ...emptySnapshot('offline'), onlineMemberIds: [] });
    expect(trigger().textContent).toBe('3 integrantes·Sin conexión');
    expect(trigger().disabled).toBe(true); expect(list()).toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('La lista se actualizará cuando recuperes la conexión.');
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('0 personas');
  });

  it('distingue una desconexión inicial de una lista realmente vacía', async () => {
    snapshot = { ...emptySnapshot('offline'), onlineMemberIds: [] };
    await mount(); expect(trigger().textContent).toBe('Integrantes·Sin conexión'); expect(trigger().disabled).toBe(true);
    await change({ connection: 'ready', members, onlineMemberIds: [] });
    await click(trigger()); expect(document.querySelector('[role="dialog"]')?.textContent).toContain('No hay integrantes activos');
  });

  it('abre con teclado y devuelve el foco al contador al cerrar con Escape', async () => {
    await mount(); const button = trigger();
    await act(async () => button.focus()); await key(button, 'Enter');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await key(document.activeElement!, 'Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    expect(document.activeElement).toBe(button);
  });

  it('adapta la lista a un diálogo móvil y conserva las actualizaciones', async () => {
    compact = true; await mount(); await click(trigger());
    expect(document.querySelector('.online-members-overlay')).not.toBeNull(); expect(document.querySelector('.online-members-popover')).toBeNull();
    await change({ onlineMemberIds: ['me'] }); expect(list()?.children).toHaveLength(1);
    await click(document.querySelector<HTMLButtonElement>('[aria-label="Cerrar integrantes activos"]')!);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
