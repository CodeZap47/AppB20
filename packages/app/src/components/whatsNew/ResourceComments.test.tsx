// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedThread } from '@b20/core';
import { DataProvider } from '../../data/DataContext';
import { createDemoState, DemoDataSource } from '../../data/demo';
import type { DataSource } from '../../data/types';
import { ResourceComments } from './ResourceComments';

let root: Root, container: HTMLDivElement, source: DemoDataSource;
const target = { kind: 'assignment', id: 'a' } as const;
const thread = (text = 'Comentario existente'): FeedThread => ({ target, canComment: true, maxLength: 2000, comments: [{ id: 'c', authorId: 'demo-2', text, createdAt: '2026-10-26T18:00:00Z', canDelete: true }] });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  source = new DemoDataSource(createDemoState(), 'demo-1'); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); vi.restoreAllMocks(); });
async function show(value: DataSource = source, open = true) { await act(async () => root.render(<StrictMode><DataProvider source={value}><ResourceComments target={target} initiallyOpen={open} autoFocus /></DataProvider></StrictMode>)); }
async function settle(ms = 20) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
async function click(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent)?.trim() === label || b.textContent?.startsWith(`${label}`));
  expect(button).toBeDefined(); await act(async () => button!.click());
}
async function type(text: string) { const input = container.querySelector('textarea')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))); }

describe('conversación reutilizable del recurso', () => {
  it('no lee hilos cerrados y al abrir enfoca el editor bajo StrictMode', async () => {
    const read = vi.spyOn(source, 'readFeedThread').mockResolvedValue(thread());
    await show(source, false); await settle(); expect(read).not.toHaveBeenCalled();
    await click('Comentar'); await settle();
    expect(read).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('Comentario existente');
    expect(document.activeElement).toBe(container.querySelector('textarea'));
    await click('Comentar'); await settle(); expect(container.querySelector('textarea')).toBeNull();
  });

  it('conserva borrador y requestId tras error y cambia la solicitud al cambiar el texto', async () => {
    vi.spyOn(source, 'readFeedThread').mockResolvedValue(thread());
    const add = vi.spyOn(source, 'addFeedThreadComment').mockRejectedValue(new Error('Sin conexión temporal'));
    await show(); await settle(); await type('Mi duda'); await submit();
    expect(container.querySelector('textarea')?.value).toBe('Mi duda'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('Sin conexión');
    const firstId = add.mock.calls[0]![2]; await submit(); expect(add.mock.calls[1]![2]).toBe(firstId);
    await type('Mi duda corregida'); add.mockResolvedValue(thread('Mi duda corregida')); await submit();
    expect(add.mock.calls[2]![2]).not.toBe(firstId); expect(container.querySelector('textarea')?.value).toBe('');
    expect(container.textContent).toContain('Mi duda corregida');
  });

  it('oculta los comentarios anteriores al perder permiso y conserva el borrador', async () => {
    const read = vi.spyOn(source, 'readFeedThread').mockResolvedValue(thread());
    await show(); await settle(); await type('Borrador que conservo');
    read.mockRejectedValue(new Error('Contenido retirado'));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(container.textContent).not.toContain('Comentario existente'); expect(container.textContent).toContain('Contenido retirado');
    read.mockResolvedValue(thread()); await click('Reintentar');
    expect(container.querySelector('textarea')?.value).toBe('Borrador que conservo');
  });

  it('descarta respuestas de una fuente anterior aunque conserve el mismo usuario', async () => {
    let finish!: (value: FeedThread) => void;
    vi.spyOn(source, 'readFeedThread').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await show(); await settle();
    const other = new DemoDataSource(createDemoState(), 'demo-1'); vi.spyOn(other, 'readFeedThread').mockResolvedValue(thread('Fuente nueva'));
    await show(other); await settle(); await act(async () => finish(thread('Fuente vieja')));
    expect(container.textContent).toContain('Fuente nueva'); expect(container.textContent).not.toContain('Fuente vieja'); other.dispose();
  });

  it('tolera adapters anteriores y respeta conversaciones de solo lectura', async () => {
    const legacy = Object.create(source) as DataSource; legacy.readFeedThread = undefined as unknown as DataSource['readFeedThread']; legacy.getSnapshot = source.getSnapshot.bind(source); legacy.subscribe = source.subscribe.bind(source);
    await show(legacy); expect(container.textContent).toContain('todavía no está disponible');
    vi.spyOn(source, 'readFeedThread').mockResolvedValue({ ...thread(), canComment: false, reason: 'El reto está cerrado.' });
    await show(); await settle(); expect(container.textContent).toContain('El reto está cerrado'); expect(container.querySelector('form')).toBeNull();
  });
});
