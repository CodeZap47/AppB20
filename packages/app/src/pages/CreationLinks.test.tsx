// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource, Snapshot } from '../data/types';
import { MuseumPage } from './MuseumPage';
import { OpportunitiesPage } from './OpportunitiesPage';

let container: HTMLDivElement;
let root: Root;
let snapshot: Snapshot;
let source: DataSource;
let router: ReturnType<typeof createMemoryRouter>;
let listeners: Set<() => void>;
const now = new Date('2026-10-26T12:00:00Z');
const member = { id: 'me', displayName: 'Luis', status: 'active' as const, isCreator: false, joinedAt: now };
const modules = [
  { name: 'Museo', path: '/m/museo', heading: 'Documentar un bug', save: 'Guardar ficha', action: 'createMuseum' as const, Page: MuseumPage },
  { name: 'Oportunidades', path: '/m/oportunidades', heading: 'Compartir oportunidad', save: 'Guardar oportunidad', action: 'createOpportunity' as const, Page: OpportunitiesPage },
];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  snapshot = { ...emptySnapshot('ready'), me: member, members: [member], subjects: [{ id: 'subject', name: 'Algoritmos', period: 1 }] };
  listeners = new Set();
  source = {
    label: 'Prueba', getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    createMuseum: vi.fn<DataSource['createMuseum']>(async () => {}),
    createOpportunity: vi.fn<DataSource['createOpportunity']>(async () => {}),
  } as unknown as DataSource;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); router?.dispose(); container.remove(); vi.restoreAllMocks(); });

async function mount(module: typeof modules[number], query = '?crear=1&origen=feed&etiqueta=a&etiqueta=b') {
  router = createMemoryRouter([{ path: module.path, element: <module.Page /> }], { initialEntries: [module.path, `${module.path}${query}`], initialIndex: 1 });
  await act(async () => root.render(<DataProvider source={source}><RouterProvider router={router} /></DataProvider>));
}
async function update(patch: Partial<Snapshot>) {
  await act(async () => { snapshot = { ...snapshot, ...patch }; listeners.forEach((listener) => listener()); });
}
function form() { return container.querySelector<HTMLFormElement>('form'); }
function control(label: string) {
  const element = [...form()!.querySelectorAll('label')].find((node) => node.firstChild?.textContent === label)?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
  expect(element, label).toBeTruthy(); return element!;
}
async function fill(label: string, value: string) {
  const element = control(label);
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
function button(text: string) {
  const element = [...container.querySelectorAll('button')].find((node) => node.textContent === text);
  expect(element, text).toBeTruthy(); return element!;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function submit() { await act(async () => { form()!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
function params() { return new URLSearchParams(router.state.location.search); }
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

for (const module of modules) describe(`enlace de creación de ${module.name}`, () => {
  it('abre el editor y al cancelar reemplaza solo crear conservando los otros parámetros', async () => {
    await mount(module);
    expect(form()?.querySelector('h2')?.textContent).toBe(module.heading);
    await click('Cancelar');
    expect(form()).toBeNull(); expect(router.state.historyAction).toBe('REPLACE');
    expect(params().has('crear')).toBe(false); expect(params().get('origen')).toBe('feed'); expect(params().getAll('etiqueta')).toEqual(['a', 'b']);
    await act(async () => router.navigate(-1));
    expect(router.state.location.search).toBe(''); expect(form()).toBeNull();
  });

  it('responde a cambios de URL en la misma ruta y a atrás/adelante sin reutilizar el borrador', async () => {
    await mount(module, '?crear=0&origen=feed'); expect(form()).toBeNull();
    await click(module.heading); expect(params().get('crear')).toBe('1'); expect(params().get('origen')).toBe('feed');
    await fill('Título', 'Borrador anterior');
    await act(async () => router.navigate(-1)); expect(form()).toBeNull();
    await act(async () => router.navigate(1)); expect(form()).not.toBeNull(); expect(control('Título').value).toBe('');
    await act(async () => router.navigate(`${module.path}?origen=otro`)); expect(form()).toBeNull();
    await act(async () => router.navigate(`${module.path}?crear=1&origen=otro`)); expect(form()).not.toBeNull();
  });

  it('espera conexión y membresía activa antes de abrir el editor', async () => {
    snapshot = { ...snapshot, connection: 'connecting' };
    await mount(module); expect(form()).toBeNull(); expect(button(module.heading).disabled).toBe(true);
    await update({ connection: 'ready' }); expect(form()).not.toBeNull();
    await fill('Título', 'Privado de esta sesión');
    await update({ me: { ...member, status: 'removed' } }); expect(form()).toBeNull();
    await update({ me: member }); expect(control('Título').value).toBe('');
    await update({ me: undefined }); expect(form()).toBeNull(); expect(source[module.action]).not.toHaveBeenCalled();
    expect(params().get('crear')).toBe('1');
  });

  it('mantiene el borrador al desconectar y bloquea el envío hasta reconectar', async () => {
    await mount(module); await fill('Título', 'Borrador sin conexión');
    await update({ connection: 'offline' });
    expect(control('Título').value).toBe('Borrador sin conexión'); expect(control('Título').disabled).toBe(true);
    expect(button(module.save).disabled).toBe(true); expect(form()?.textContent).toContain('Tu borrador sigue aquí');
    await submit(); expect(source[module.action]).not.toHaveBeenCalled();
    await update({ connection: 'ready' }); expect(control('Título').value).toBe('Borrador sin conexión'); expect(control('Título').disabled).toBe(false);
  });

  it('conserva el borrador, el parámetro y el identificador del intento tras un error', async () => {
    const create = vi.mocked(source[module.action]);
    create.mockRejectedValueOnce(new Error('No se pudo guardar')).mockResolvedValueOnce(undefined);
    await mount(module); await fill('Título', 'Mi publicación'); await submit();
    expect(form()?.querySelector('[role="alert"]')?.textContent).toBe('No se pudo guardar');
    expect(control('Título').value).toBe('Mi publicación'); expect(params().get('crear')).toBe('1');
    const first = create.mock.calls[0]![0];
    await submit();
    expect(create).toHaveBeenCalledTimes(2); expect(create.mock.calls[1]![0].requestId).toBe(first.requestId);
    expect(form()).toBeNull(); expect(router.state.historyAction).toBe('REPLACE');
    expect(params().has('crear')).toBe(false); expect(params().getAll('etiqueta')).toEqual(['a', 'b']);
    const input = create.mock.calls[1]![0];
    if ('title' in input) expect(input).toMatchObject({ title: 'Mi publicación', subjectId: 'subject' });
    else expect(input.fields.title).toBe('Mi publicación');
  });

  it('bloquea duplicados y cancelar durante el guardado y limpia los parámetros más recientes', async () => {
    const request = deferred(); const create = vi.mocked(source[module.action]); create.mockReturnValueOnce(request.promise);
    await mount(module); await fill('Título', 'Mi publicación');
    await act(async () => {
      form()!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form()!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(create).toHaveBeenCalledTimes(1); expect(button('Cancelar').disabled).toBe(true); expect(control('Título').disabled).toBe(true); expect(form()?.getAttribute('aria-busy')).toBe('true');
    await click('Cancelar'); expect(params().get('crear')).toBe('1');
    await act(async () => router.navigate(`${module.path}?crear=1&origen=actualizado&extra=1`));
    expect(control('Título').value).toBe('Mi publicación');
    await act(async () => request.resolve());
    expect(form()).toBeNull(); expect(params().has('crear')).toBe(false); expect(params().get('origen')).toBe('actualizado'); expect(params().get('extra')).toBe('1');
  });

  it('un guardado de otra cuenta no cierra ni filtra el borrador nuevo', async () => {
    const request = deferred(); vi.mocked(source[module.action]).mockReturnValueOnce(request.promise);
    await mount(module); await fill('Título', 'Borrador de Luis'); await submit();
    await update({ me: { ...member, id: 'other', displayName: 'Ana' } });
    expect(control('Título').value).toBe(''); expect(button(module.save).disabled).toBe(false);
    await fill('Título', 'Borrador de Ana'); await act(async () => request.resolve());
    expect(params().get('crear')).toBe('1'); expect(control('Título').value).toBe('Borrador de Ana');
  });

  it('comprueba la cuenta actual aunque el cambio coincida con la confirmación del guardado', async () => {
    const request = deferred(); vi.mocked(source[module.action]).mockReturnValueOnce(request.promise);
    await mount(module); await fill('Título', 'Borrador de Luis'); await submit();
    await act(async () => {
      snapshot = { ...snapshot, me: { ...member, id: 'other', displayName: 'Ana' } };
      listeners.forEach((listener) => listener()); request.resolve();
    });
    expect(params().get('crear')).toBe('1'); expect(control('Título').value).toBe('');
  });

  it('una respuesta antigua no cierra un editor reabierto después de navegar', async () => {
    const request = deferred(); vi.mocked(source[module.action]).mockReturnValueOnce(request.promise);
    await mount(module); await fill('Título', 'Primera publicación'); await submit();
    await act(async () => router.navigate(`${module.path}?origen=feed`)); expect(form()).toBeNull();
    await act(async () => router.navigate(`${module.path}?crear=1&origen=feed`));
    await fill('Título', 'Nueva publicación'); await act(async () => request.resolve());
    expect(params().get('crear')).toBe('1'); expect(control('Título').value).toBe('Nueva publicación');
  });
});
