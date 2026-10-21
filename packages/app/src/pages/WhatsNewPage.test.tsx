// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { WhatsNewPage } from './WhatsNewPage';

let root: Root, container: HTMLDivElement, source: DemoDataSource;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  source = new DemoDataSource(createDemoState(), 'demo-1');
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); });
const show = (path = '/m/inicio') => act(async () => root.render(
  <MemoryRouter initialEntries={[path]}><DataProvider source={source}><WhatsNewPage /></DataProvider></MemoryRouter>,
));
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const click = async (text: string) => { const target = button(text); expect(target, text).toBeTruthy(); await act(async () => target!.click()); };
const type = async (label: string, value: string) => {
  const element = container.querySelector<HTMLTextAreaElement | HTMLInputElement>(`[aria-label="${label}"]`)!;
  expect(element, label).toBeTruthy();
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
};
const submit = async (text: string) => { await act(async () => button(text)!.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); };

describe('primera vista: Feed y Clásica', () => {
  it('abre en el feed con tarjetas y conserva filtros y pendientes al cambiar a la clásica', async () => {
    await show();
    expect(button('Feed')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('.feed-card').length).toBeGreaterThan(0);
    expect(container.querySelector('[aria-label="Escribe una publicación para el grupo"]')).toBeTruthy();
    await click('Todo');
    await click('Clásica');
    expect(container.querySelectorAll('.feed-card')).toHaveLength(0);
    expect(container.querySelectorAll('.news-item').length).toBeGreaterThan(0);
    expect(button('Todo')?.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('b20:inicio:vista')).toBe('clasica');
  });

  it('recuerda la vista elegida en el dispositivo', async () => {
    localStorage.setItem('b20:inicio:vista', 'clasica');
    await show();
    expect(button('Clásica')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.stories')).toBeNull();
  });

  it('«Marcar todo como visto» funciona igual en el feed', async () => {
    await show();
    await click('Marcar todo como visto');
    expect(source.getSnapshot().lastSeenAt).toBeTruthy();
  });

  it('publica, reacciona y comenta desde el feed', async () => {
    await show('/m/inicio?ver=todo');
    await type('Escribe una publicación para el grupo', 'Mañana repasamos en la biblioteca');
    await submit('Publicar');
    const post = source.getSnapshot().feedPosts.find((p) => p.authorId === 'demo-1');
    expect(post?.text).toBe('Mañana repasamos en la biblioteca');
    const card = container.querySelector<HTMLElement>(`#publicacion-${post!.id}`)!;
    expect(card.textContent).toContain('publicaste en el grupo');

    await act(async () => card.querySelector<HTMLButtonElement>('[aria-label="Reaccionar"]')!.click());
    await act(async () => [...card.querySelectorAll<HTMLButtonElement>('.reaction-picker button')].find((b) => b.textContent === '🎉')!.click());
    expect(source.getSnapshot().feedReactions).toContainEqual({ targetKind: 'post', targetId: post!.id, memberId: 'demo-1', emoji: '🎉' });

    const input = card.querySelector<HTMLInputElement>('[aria-label="Escribe un comentario"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '¿A las 9?'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(source.getSnapshot().feedComments.some((c) => c.postId === post!.id && c.text === '¿A las 9?')).toBe(true);
  });
});
