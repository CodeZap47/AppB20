// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoState, DemoDataSource } from '../data/demo';
import { DataProvider } from '../data/DataContext';
import { replayWelcomeTour, WelcomeTour } from './WelcomeTour';

let container: HTMLDivElement;
let root: Root;
let source: DemoDataSource;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  source = new DemoDataSource(createDemoState(), 'demo-1');
});
afterEach(async () => {
  await act(async () => root.unmount());
  source.dispose();
  container.remove();
  vi.restoreAllMocks();
});
async function mount() {
  const router = createMemoryRouter([{ path: '*', element: <WelcomeTour /> }], {
    initialEntries: ['/'],
  });
  await act(async () =>
    root.render(
      <DataProvider source={source}>
        <RouterProvider router={router} />
      </DataProvider>,
    ),
  );
  return router;
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((entry) =>
    entry.textContent?.includes(label),
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
describe('primer recorrido', () => {
  it('abre automáticamente para un usuario nuevo y guarda el recorrido antes de personalizar', async () => {
    let snapshot = { ...source.getSnapshot(), onboardingCompleted: false };
    vi.spyOn(source, 'getSnapshot').mockImplementation(() => snapshot);
    const complete = vi.spyOn(source, 'completeOnboarding').mockImplementation(() => {
      snapshot = { ...snapshot, onboardingCompleted: true };
    });
    const router = await mount();
    expect(container.querySelector('dialog[open]')).not.toBeNull();
    for (let step = 0; step < 3; step++) await click('Continuar');
    await click('Personalizar mi perfil');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe('/perfil/demo-1');
    expect(router.state.location.search).toBe('?personalizar=1');
    expect(container.querySelector('dialog')).toBeNull();
  });
  it('permite volver a ver el tutorial sin alterar el contenido del perfil', async () => {
    await mount();
    expect(container.querySelector('dialog')).toBeNull();
    const profileBefore = source.getSnapshot().memberProfiles;
    await act(async () => replayWelcomeTour());
    expect(container.textContent).toContain('Tu grupo. Tu espacio.');
    for (let step = 0; step < 3; step++) await click('Continuar');
    await click('Ir al inicio');
    expect(source.getSnapshot().onboardingCompleted).toBe(true);
    expect(source.getSnapshot().memberProfiles).toEqual(profileBefore);
    expect(container.querySelector('dialog')).toBeNull();
  });
});
