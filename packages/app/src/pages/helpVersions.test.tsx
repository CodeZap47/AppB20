// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource, HelpPost, HelpPostInput, HelpPostHistory, Member, Snapshot } from '../data/types';
import { HelpFormPage, HelpPostPage } from './HelpPage';
const at = new Date('2026-10-21T12:00:00Z');
const member = (id: string, isCreator = false): Member => ({ id, displayName: id, status: 'active', isCreator, joinedAt: at });
const initial: HelpPost = { id: '10', authorId: 'author', kind: 'offer', subjectId: '1', topic: 'Ciclos', title: 'Título del servidor v7', description: 'Descripción inicial', level: 'initial', modality: 'messages', availability: '', status: 'open', version: 7, createdAt: at, updatedAt: at };
let root: Root, container: HTMLDivElement, snapshot: Snapshot, listeners: Set<() => void>, source: DataSource;
const save = vi.fn<(_input: HelpPostInput) => Promise<string>>();
const history = vi.fn<(_id: string) => Promise<HelpPostHistory[]>>();
function Location() { return <output data-location>{useLocation().pathname}</output>; }
function publish(changes: Partial<Snapshot>) { snapshot = { ...snapshot, ...changes }; listeners.forEach((fn) => fn()); }
async function show(path: string) { await act(async () => root.render(<DataProvider source={source}><MemoryRouter initialEntries={[path]}><Routes><Route path="/m/ayuda/:postId/editar" element={<HelpFormPage />} /><Route path="/m/ayuda/:postId" element={<HelpPostPage />} /></Routes><Location /></MemoryRouter></DataProvider>)); }
function input(label: string) { const field = [...container.querySelectorAll('label')].find((l) => l.querySelector('.field__label')?.textContent?.trim() === label); const result = field?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea'); expect(result, label).toBeTruthy(); return result!; }
async function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
async function click(label: string) { const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label); expect(button, label).toBeTruthy(); await act(async () => button!.click()); }
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); save.mockReset(); history.mockReset(); save.mockResolvedValue('10'); history.mockResolvedValue([]); listeners = new Set(); snapshot = { ...emptySnapshot('ready'), me: member('author'), members: [member('author'), member('admin', true), member('peer')], subjects: [{ id: '1', name: 'Programación', period: 1 }], helpPosts: [{ ...initial }] }; source = { saveHelpPost: save, getHelpPostHistory: history, getSnapshot: () => snapshot, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); } } as unknown as DataSource; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
describe('versiones de Ayuda desde la interfaz', () => {
  it('mantiene versión de apertura y borrador cuando un snapshot nuevo actualiza el mismo post', async () => {
    save.mockRejectedValue(new Error('La publicación cambió. Recarga sus datos antes de guardar.')); await show('/m/ayuda/10/editar'); await fill(input('Título'), 'Mi título sin guardar'); await fill(input('Descripción'), 'Mi borrador que debe conservarse');
    await act(async () => publish({ helpPosts: [{ ...initial, version: 8, title: 'Cambio remoto v8', description: 'Contenido remoto' }] }));
    expect(input('Título').value).toBe('Mi título sin guardar'); expect(input('Descripción').value).toBe('Mi borrador que debe conservarse'); await submit();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: '10', expectedVersion: 7, title: 'Mi título sin guardar', description: 'Mi borrador que debe conservarse' }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('La publicación cambió'); expect(container.querySelector('[data-location]')?.textContent).toBe('/m/ayuda/10/editar');
    await act(async () => publish({ helpPosts: [{ ...initial, version: 9, title: 'Otro cambio remoto' }] }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('La publicación cambió'); expect(input('Título').value).toBe('Mi título sin guardar'); await submit();
    expect(save.mock.calls[1]![0].expectedVersion).toBe(7); expect(save.mock.calls[1]![0].requestId).toBe(save.mock.calls[0]![0].requestId);
  });
  it('historial sólo aparece y se carga por acto expreso del autor; desaparece al pasar a admin', async () => {
    history.mockResolvedValue([{ version: 6, status: 'open', fields: { kind: 'offer', subjectId: '1', title: 'Título histórico privado', topic: 'Tema anterior privado', description: 'Texto histórico privado del autor', level: 'initial', modality: 'messages', availability: '' }, at }]);
    await show('/m/ayuda/10'); expect(history).not.toHaveBeenCalled(); await click('Consultar mis versiones'); expect(history).toHaveBeenCalledExactlyOnceWith('10'); expect(container.textContent).toContain('Texto histórico privado del autor');
    await act(async () => publish({ me: member('admin', true) })); expect(container.textContent).not.toContain('Texto histórico privado del autor'); expect(container.textContent).not.toContain('Consultar mis versiones'); expect(container.textContent).not.toContain('Mis versiones de la publicación'); expect(history).toHaveBeenCalledTimes(1);
  });
  it('un error de historial se muestra sin abrir datos ni intentar consultarlos automáticamente', async () => {
    history.mockRejectedValue(new Error('No se pudo consultar el historial.')); await show('/m/ayuda/10'); await click('Consultar mis versiones'); expect(container.querySelector('[role="alert"]')?.textContent).toBe('No se pudo consultar el historial.');
    await act(async () => publish({ helpPosts: [{ ...initial, version: 8 }] })); expect(container.querySelector('[role="alert"]')?.textContent).toBe('No se pudo consultar el historial.'); expect(history).toHaveBeenCalledTimes(1);
  });
});
