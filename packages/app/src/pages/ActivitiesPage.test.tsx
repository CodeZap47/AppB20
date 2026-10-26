// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { ActivityFormPage, ActivityPage } from './ActivitiesPage';

let container: HTMLDivElement;
let root: Root;
let source: DemoDataSource;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  source = new DemoDataSource(createDemoState(), 'demo-1');
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); vi.restoreAllMocks(); });

function Location() { return <output data-location>{useLocation().pathname}</output>; }
async function renderForm(activityId?: string) {
  const subjectId = source.getSnapshot().activities[0]!.subjectId;
  const path = activityId ? `/m/actividades/${activityId}/editar` : `/m/actividades/nueva?materia=${subjectId}`;
  await act(async () => root.render(<DataProvider source={source}><MemoryRouter initialEntries={[path]}>
    <Routes><Route path="/m/actividades/nueva" element={<ActivityFormPage />} />
      <Route path="/m/actividades/:activityId/editar" element={<ActivityFormPage />} />
      <Route path="/m/actividades/:activityId" element={<p>Actividad guardada</p>} /></Routes><Location />
  </MemoryRouter></DataProvider>));
}
const form = () => container.querySelector<HTMLFormElement>('form.panel.form')!;
async function enterText(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!;
  await act(async () => { setter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function selectFile(file: File) {
  const input = form().querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
async function submit() {
  await act(async () => form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

describe('archivos de actividades y evidencias', () => {
  it('crea la actividad una sola vez cuando hay que reintentar el adjunto', async () => {
    const create = vi.spyOn(source, 'createActivity');
    const original = source.attachResourceFile.bind(source);
    const transfer = vi.spyOn(source, 'attachResourceFile').mockRejectedValueOnce(new Error('Sin conexión')).mockImplementation(original);
    await renderForm();
    const title = [...form().querySelectorAll('label')].find((label) => label.querySelector('.field__label')?.textContent === 'Título')!.querySelector('input')!;
    await enterText(title, 'Práctica con evidencia documental');
    await selectFile(new File(['documento'], 'instrucciones.pdf'));
    await submit();
    const id = transfer.mock.calls[0]![1];
    expect(create).toHaveBeenCalledTimes(1);
    expect(form().querySelector('fieldset')?.disabled).toBe(true);
    expect(container.textContent).toContain('La actividad ya está guardada');
    await submit();
    expect(create).toHaveBeenCalledTimes(1);
    expect(transfer.mock.calls.map(([kind, target, , version]) => [kind, target, version])).toEqual([['activity', id, 1], ['activity', id, 1]]);
    expect(source.getSnapshot().resourceFiles.filter((file) => file.targetKind === 'activity' && file.targetId === id)).toHaveLength(1);
    expect(container.querySelector('[data-location]')?.textContent).toBe(`/m/actividades/${id}`);
  });

  it('añade un archivo a una actividad existente sin reeditar el texto', async () => {
    const activity = source.getSnapshot().activities[0]!;
    const update = vi.spyOn(source, 'updateActivity');
    const transfer = vi.spyOn(source, 'attachResourceFile');
    await renderForm(activity.id);
    expect(form().querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await selectFile(new File(['documento'], 'recurso.pdf'));
    expect(form().querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    await submit();
    // La demo también pasa por updateActivity al versionar el adjunto.
    expect(update.mock.calls.filter((args) => args[2] !== undefined)).toHaveLength(0);
    expect(transfer).toHaveBeenCalledWith('activity', activity.id, expect.any(File), activity.version, expect.any(Object));
    expect(source.getSnapshot().activities.find((item) => item.id === activity.id)?.version).toBe(activity.version + 1);
  });

  it('mantiene la evidencia publicada y su formulario al fallar el adjunto, sin duplicarla al reintentar', async () => {
    const activity = source.getSnapshot().activities[0]!;
    const create = vi.spyOn(source, 'addEvidence');
    const original = source.attachResourceFile.bind(source);
    const transfer = vi.spyOn(source, 'attachResourceFile').mockRejectedValueOnce(new Error('Sin conexión')).mockImplementation(original);
    await act(async () => root.render(<DataProvider source={source}><MemoryRouter initialEntries={[`/m/actividades/${activity.id}`]}>
      <Routes><Route path="/m/actividades/:activityId" element={<ActivityPage />} /></Routes>
    </MemoryRouter></DataProvider>));
    const add = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Agregar evidencia'))!;
    await act(async () => add.click());
    await enterText(form().querySelector('textarea')!, 'El equipo completó la práctica.');
    await selectFile(new File(['imagen'], 'resultado.png', { type: 'image/png' }));
    await submit();
    const id = transfer.mock.calls[0]![1];
    expect(create).toHaveBeenCalledTimes(1);
    expect(form().querySelector('fieldset')?.disabled).toBe(true);
    expect(container.textContent).toContain('La evidencia ya está publicada');
    await submit();
    expect(create).toHaveBeenCalledTimes(1);
    expect(source.getSnapshot().evidences.filter((item) => item.id === id)).toHaveLength(1);
    expect(source.getSnapshot().resourceFiles.filter((file) => file.targetKind === 'evidence' && file.targetId === id)).toHaveLength(1);
    expect(container.querySelector('form.panel.form')).toBeNull();
  });
});
