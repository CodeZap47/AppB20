// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { LiveDraftStack } from './LiveDraftStack';

let root: Root; let container: HTMLDivElement; let sources: DemoDataSource[];
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sources = []; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); for (const source of sources) source.dispose(); container.remove(); });
it('deduplica personas, muestra tres tarjetas y permite ampliar texto y participantes', async () => {
  const state = createDemoState();
  const make = (id: string) => { const source = new DemoDataSource(state, id); sources.push(source); return source; };
  const viewer = make('demo-1'); const authors = ['demo-2', 'demo-3', 'demo-4', 'demo-5'].map(make); const secondTab = make('demo-2');
  await act(async () => root.render(<DataProvider source={viewer}><LiveDraftStack scope="group" conversationId="general" /></DataProvider>));
  await act(async () => {
    for (const author of authors) author.liveDrafts.publish('group', 'general', 'Esta es una explicación provisional bastante larga que necesita varias líneas para mostrarse. '.repeat(4));
    secondTab.liveDrafts.publish('group', 'general', 'Una segunda pestaña del mismo autor');
  });
  expect(container.querySelectorAll('article')).toHaveLength(3);
  const read = container.querySelector<HTMLButtonElement>('.live-drafts__read')!;
  expect(read).not.toBeNull(); await act(async () => read.click()); expect(read.getAttribute('aria-expanded')).toBe('true');
  const expand = container.querySelector<HTMLButtonElement>('.live-drafts__expand')!;
  expect(expand.textContent).toBe('Ver 1 más escribiendo'); await act(async () => expand.click());
  expect(container.querySelectorAll('article')).toHaveLength(4);
  expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
});
