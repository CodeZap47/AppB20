// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatPostPreview, ChatPostRef } from '@b20/core';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import type { DataSource } from '../data/types';
import { ChatPostCard } from './ChatPostCard';

let root: Root; let container: HTMLDivElement; let demo: DemoDataSource;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  demo = new DemoDataSource(createDemoState(), 'demo-1');
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); demo.dispose(); });
function sourceFixture() {
  let snapshot = demo.getSnapshot(); const listeners = new Set<() => void>();
  const resolveChatPosts = vi.fn<(targets: readonly ChatPostRef[]) => Promise<ChatPostPreview[]>>().mockImplementation(async targets => targets.map(target => ({
    target, available: true, title: `Publicación ${target.id}`, description: '', kindLabel: 'Pregunta', path: `/m/preguntas/${target.id}`,
  })));
  return { source: { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); }, resolveChatPosts } as unknown as DataSource,
    resolveChatPosts, changeSnapshot: () => { snapshot = { ...snapshot }; listeners.forEach(listener => listener()); } };
}
describe('tarjetas autenticadas de publicaciones', () => {
  it('agrupa las tarjetas montadas y vuelve a comprobar disponibilidad al cambiar el estado', async () => {
    const fixture = sourceFixture(); const a = { kind: 'question', id: '1' } as const; const b = { kind: 'question', id: '2' } as const;
    await act(async () => root.render(<DataProvider source={fixture.source}><MemoryRouter><ChatPostCard target={a} /><ChatPostCard target={b} /></MemoryRouter></DataProvider>));
    expect(fixture.resolveChatPosts).toHaveBeenCalledTimes(1);
    expect(fixture.resolveChatPosts.mock.calls[0]?.[0]).toEqual([a, b]);
    expect([...container.querySelectorAll('a')].map(link => link.getAttribute('href'))).toEqual(['/m/preguntas/1', '/m/preguntas/2']);
    fixture.resolveChatPosts.mockImplementation(async targets => targets.map(target => ({ target, available: false })));
    await act(async () => fixture.changeSnapshot());
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent?.match(/Publicación no disponible/g)).toHaveLength(2);
    expect(container.textContent).not.toContain('Publicación 1');
  });
  it('no muestra el recurso anterior mientras resuelve otro destino en el mismo estado', async () => {
    const fixture = sourceFixture(); const view = (target: ChatPostRef) => <DataProvider source={fixture.source}><MemoryRouter><ChatPostCard target={target} /></MemoryRouter></DataProvider>;
    await act(async () => root.render(view({ kind: 'question', id: '1' })));
    let finish!: (rows: ChatPostPreview[]) => void;
    fixture.resolveChatPosts.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => root.render(view({ kind: 'question', id: '2' })));
    expect(container.querySelector('a')).toBeNull(); expect(container.textContent).toContain('Cargando publicación');
    await act(async () => finish([{ target: { kind: 'question', id: '2' }, available: false }]));
    expect(container.textContent?.trim()).toBe('Publicación no disponible');
  });
});
