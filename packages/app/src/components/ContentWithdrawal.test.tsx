// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import type { DataSource } from '../data/types';
import { ContentWithdrawal } from './ContentWithdrawal';

const snapshot = { trashEntries: [] };
let root: Root; let container: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('conserva la versión al retirar y permite restaurar sin borrar el contenido', async () => {
  const withdrawContent = vi.fn().mockResolvedValue(undefined); const source = { withdrawContent, getTrashClock: async () => new Date('2026-10-22T16:00:00Z'), getSnapshot: () => snapshot, subscribe: () => () => {} } as unknown as DataSource;
  await act(async () => root.render(<DataProvider source={source}><ContentWithdrawal kind="note" id="70" version={3} canEdit /></DataProvider>));
  await act(async () => container.querySelector('button')!.click());
  expect(withdrawContent).not.toHaveBeenCalled();
  await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Confirmar retirada')!.click());
  expect(withdrawContent).toHaveBeenCalledWith('note', '70', true, 3, '');
  await act(async () => root.render(<DataProvider source={source}><ContentWithdrawal kind="note" id="70" version={4} canEdit withdrawnAt={new Date('2026-10-21T16:00:00Z')} /></DataProvider>));
  expect(container.textContent).toContain('versiones y adjuntos');
  await act(async () => container.querySelector('button')!.click());
  expect(withdrawContent).toHaveBeenLastCalledWith('note', '70', false, 4);
});

it('oculta el control sin permiso y exige motivo al moderar otra publicación', async () => {
  const withdrawContent = vi.fn(); const source = { withdrawContent, getTrashClock: async () => new Date('2026-10-22T16:00:00Z'), getSnapshot: () => snapshot, subscribe: () => () => {} } as unknown as DataSource;
  await act(async () => root.render(<DataProvider source={source}><ContentWithdrawal kind="note" id="70" version={1} /></DataProvider>));
  expect(container.querySelector('button')).toBeNull();
  await act(async () => root.render(<DataProvider source={source}><ContentWithdrawal kind="note" id="70" version={1} canEdit reasonRequired /></DataProvider>));
  await act(async () => container.querySelector('button')!.click());
  expect([...container.querySelectorAll('button')].find((button) => button.textContent === 'Confirmar retirada')?.disabled).toBe(true);
  expect(withdrawContent).not.toHaveBeenCalled();
});


it('bloquea restaurar exactamente al vencer los 30 días y falla cerrado sin reloj confiable', async () => {
  const withdrawContent = vi.fn();
  const source = { withdrawContent, getTrashClock: async () => new Date('2026-11-20T16:00:00Z'), getSnapshot: () => snapshot, subscribe: () => () => {} } as unknown as DataSource;
  await act(async () => root.render(<DataProvider source={source}><ContentWithdrawal kind="note" id="70" version={2} canEdit withdrawnAt={new Date('2026-10-21T16:00:00Z')} /></DataProvider>));
  expect(container.querySelector('button')!.disabled).toBe(true);
  expect(container.textContent).toContain('Terminó el plazo');
  await act(async () => root.render(<DataProvider source={{ ...source, getTrashClock: async () => { throw new Error('Sin conexión'); } }}><ContentWithdrawal kind="note" id="70" version={2} canEdit withdrawnAt={new Date('2026-10-21T16:00:00Z')} /></DataProvider>));
  expect(container.querySelector('button')!.disabled).toBe(true);
  expect(withdrawContent).not.toHaveBeenCalled();
});
