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
  it('refleja una exposición propia creada desde Tareas sin contarla como novedad ajena', async () => {
    await show('/m/inicio?ver=todo');
    const before = container.querySelector('[aria-label="Qué mostrar"]')?.textContent;
    let id = '';
    await act(async () => { id = await source.createAssignment({
      subjectId: source.getSnapshot().subjects[0]!.id, kind: 'exposicion',
      title: 'Exposición propia de interfaces', instructions: 'Presentar las decisiones de diseño', dueDate: '2026-11-02',
    }); });
    const cards = [...container.querySelectorAll('.feed-card')].filter((node) => node.querySelector(`h3 a[href="/m/tareas/${id}"]`));
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card?.querySelector('.feed-type')?.textContent).toBe('Exposición');
    expect(card?.textContent).toContain('Presentar las decisiones de diseño');
    expect(card?.querySelector('.feed-card__author')?.textContent).toBe('Tú');
    expect(card?.querySelector('.feed-card__new')).toBeNull();
    expect(container.querySelector('[aria-label="Qué mostrar"]')?.textContent).toBe(before);
    await click('Clásica');
    expect([...container.querySelectorAll('.news-item')].some((node) => node.textContent?.includes('Exposición propia de interfaces'))).toBe(false);
  });

  it('reinicia el borrador del compositor al cambiar de perfil', async () => {
    await show('/m/inicio?ver=todo');
    await type('Escribe una publicación para el grupo', 'Borrador privado del primer perfil');
    await act(async () => { source.setViewer('demo-2'); });
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Escribe una publicación para el grupo"]')?.value).toBe('');
    expect(source.getSnapshot().feedPosts.some((post) => post.text === 'Borrador privado del primer perfil')).toBe(false);
  });

  it('un enlace a una publicación propia anterior sigue visible después de marcar novedades', async () => {
    await source.createFeedPost({ text: 'Publicación propia enlazada', requestId: crypto.randomUUID() });
    const postId = source.getSnapshot().feedPosts.find((post) => post.text === 'Publicación propia enlazada')!.id;
    await source.markSeen();
    await show(`/m/inicio?vista=feed&publicacion=${postId}`);
    const card = container.querySelector(`#publicacion-${postId}`);
    expect(card?.textContent).toContain('Publicación propia enlazada');
    expect(card?.classList.contains('feed-card--highlighted')).toBe(true);
  });

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

    await act(async () => { card.querySelector<HTMLButtonElement>('.resource-comments__toggle')!.click(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    const input = card.querySelector<HTMLTextAreaElement>('[aria-label="Escribe un comentario"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '¿A las 9?'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(source.getSnapshot().feedComments.some((c) => c.postId === post!.id && c.text === '¿A las 9?')).toBe(true);
  });

  it('muestra tus notas de clase compartidas y el #1 del ranking sin reacciones', async () => {
    await show('/m/inicio?ver=todo');
    const note = source.getSnapshot().notes.find((n) => n.authorId === 'demo-1' && n.visibility === 'group' && !n.withdrawnAt);
    if (note) expect(container.textContent).toContain(`compartiste la nota de clase «${note.title}»`);
    const chip = [...container.querySelectorAll('button.chip')].find((b) => b.textContent?.startsWith('Ranking'));
    expect(chip).toBeTruthy();
    await act(async () => (chip as HTMLButtonElement).click());
    const cards = [...container.querySelectorAll('.feed-card--ranking')];
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => !card.querySelector('[aria-label="Reaccionar"]'))).toBe(true);
    await click('Clásica');
    expect(container.querySelectorAll('.news-item').length).toBeGreaterThan(0);
  });
});
