// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../../data/DataContext';
import { emptySnapshot } from '../../data/spacetimeSnapshot';
import type { DataSource, Snapshot } from '../../data/types';
import { NewConversation } from './NewConversation';

let host: HTMLDivElement;
let root: Root;
let snapshot: Snapshot;
let source: DataSource;
const openDirect = vi.fn();
const createChannel = vi.fn();
const at = new Date('2026-10-26T12:00:00Z');
function Harness({ initialMode = null }: { initialMode?: 'direct' | 'channel' | null }) {
  const [mode, setMode] = useState(initialMode);
  return <><NewConversation mode={mode} onModeChange={setMode} /><output>{useLocation().pathname}</output></>;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char.codePointAt(0)!.toString(16)} `) });
  snapshot = { ...emptySnapshot('ready'), me: { id: 'me', displayName: 'Yo', status: 'active', joinedAt: at },
    members: [{ id: 'me', displayName: 'Yo', status: 'active', joinedAt: at }, { id: 'ana', displayName: 'Ana López', status: 'active', joinedAt: at }, { id: 'beto', displayName: 'Beto Ruiz', status: 'active', joinedAt: at }, { id: 'retired', displayName: 'Retirado', status: 'retired', joinedAt: at }],
    directConversations: [{ id: 'existing', participantIds: ['me', 'ana'] }],
    subjects: [{ id: 'math', name: 'Matemáticas' }],
  } as Snapshot;
  openDirect.mockResolvedValue('new'); createChannel.mockResolvedValue('channel');
  source = { getSnapshot: () => snapshot, subscribe: () => () => {}, openDirectConversation: openDirect, createChatChannel: createChannel } as unknown as DataSource;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function show(initialMode?: 'direct' | 'channel') { await act(async () => root.render(<DataProvider source={source}><MemoryRouter initialEntries={['/m/mensajes']}><Harness initialMode={initialMode} /></MemoryRouter></DataProvider>)); }
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function fill(element: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function key(element: Element, key: string) { await act(async () => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))); }
function byText(text: string) { return [...document.querySelectorAll<HTMLElement>('button,[role="menuitem"]')].find((element) => element.textContent?.includes(text))!; }

describe('crear conversaciones desde el menú', () => {
  it('despliega dos acciones y abre el selector separado de la lista', async () => {
    await show();
    const trigger = host.querySelector<HTMLElement>('[aria-label="Nueva conversación"]')!;
    await click(trigger);
    expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Nueva conversación');
    expect(byText('Mensaje directo')).toBeTruthy(); expect(byText('Crear canal')).toBeTruthy();
    await click(byText('Mensaje directo'));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Nuevo mensaje');
    expect(document.querySelector('[aria-label="Buscar compañero"]')).toBe(document.activeElement);
    await click(document.querySelector<HTMLElement>('[aria-label="Cerrar"]')!);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(document.activeElement).toBe(trigger);
  });
  it('reutiliza un directo existente y filtra solo integrantes activos', async () => {
    await show('direct');
    expect(document.querySelector('.messaging-people')?.textContent).not.toContain('Retirado');
    expect(document.querySelector('.messaging-people')?.textContent).not.toContain('Yo');
    await fill(document.querySelector<HTMLInputElement>('[aria-label="Buscar compañero"]')!, 'ana');
    expect(document.querySelector('.messaging-people')?.textContent).not.toContain('Beto');
    await click(byText('Ana López'));
    expect(openDirect).not.toHaveBeenCalled();
    expect(host.querySelector('output')?.textContent).toBe('/m/mensajes/directos/existing');
  });
  it('conserva el selector y anuncia el fallo, permite reintentar sin duplicar clics pendientes', async () => {
    let reject!: (error: Error) => void;
    openDirect.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    await show('direct');
    await click(byText('Beto Ruiz')); await click(byText('Beto Ruiz'));
    expect(openDirect).toHaveBeenCalledExactlyOnceWith('beto');
    await act(async () => reject(new Error('Sin conexión')));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Sin conexión');
    await click(byText('Beto Ruiz'));
    expect(openDirect).toHaveBeenCalledTimes(2);
    expect(host.querySelector('output')?.textContent).toBe('/m/mensajes/directos/new');
  });
  it('crea un canal de materia con la materia elegida y navega al resultado', async () => {
    await show('channel');
    await fill(document.querySelector<HTMLInputElement>('input[maxlength="80"]')!, ' Repaso final ');
    const selects = () => [...document.querySelectorAll<HTMLSelectElement>('select')];
    await act(async () => { selects()[0]!.value = 'subject'; selects()[0]!.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await act(async () => { selects()[1]!.value = 'math'; selects()[1]!.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(createChannel).toHaveBeenCalledExactlyOnceWith({ name: 'Repaso final', kind: 'subject', subjectId: 'math' });
    expect(host.querySelector('output')?.textContent).toBe('/m/mensajes/canales/channel');
  });

  it('abre el menú con teclado y permite cancelar el diálogo con Escape', async () => {
    await show();
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Nueva conversación"]')!;
    await act(async () => trigger.focus());
    await key(trigger, 'ArrowDown');
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await key(document.activeElement!, 'End');
    expect(document.activeElement?.textContent).toContain('Crear canal');
    await key(document.activeElement!, 'Enter');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Crear un canal');
    await key(document.activeElement!, 'Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    expect(document.activeElement).toBe(trigger);
  });

  it('conserva el nombre ante un fallo de creación y bloquea envíos duplicados', async () => {
    let reject!: (error: Error) => void;
    createChannel.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    await show('channel');
    await fill(document.querySelector<HTMLInputElement>('input[maxlength="80"]')!, 'Equipo de repaso');
    const form = document.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(createChannel).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLInputElement>('input[maxlength="80"]')!.disabled).toBe(true);
    await act(async () => reject(new Error('Sin conexión')));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Sin conexión');
    expect(document.querySelector<HTMLInputElement>('input[maxlength="80"]')!.value).toBe('Equipo de repaso');
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(createChannel).toHaveBeenCalledTimes(2);
    expect(host.querySelector('output')?.textContent).toBe('/m/mensajes/canales/channel');
  });
});
