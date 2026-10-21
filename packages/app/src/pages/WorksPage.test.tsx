// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import type { DataSource } from '../data/types';
import { SubmitWorkPage } from './WorksPage';

let root: Root;
let container: HTMLDivElement;
let source: DemoDataSource;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  source = new DemoDataSource(createDemoState(), 'demo-1');
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); });

function Location() { return <output data-location>{useLocation().pathname}{useLocation().search}</output>; }
async function renderForm(assignmentId: string, nextId?: string) {
  await act(async () => root.render(<DataProvider source={source}><MemoryRouter initialEntries={[`/m/tareas/${assignmentId}/subir`]}>
    {nextId && <Link to={`/m/tareas/${nextId}/subir`}>Otra tarea</Link>}
    <Routes><Route path="/m/tareas/:assignmentId/subir" element={<SubmitWorkPage />} />
      <Route path="/m/tareas/:assignmentId" element={<p>Trabajo publicado</p>} /></Routes><Location />
  </MemoryRouter></DataProvider>));
}
async function selectFiles(files: File[]) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
async function submitForm() {
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}
async function openOtherTask() {
  await act(async () => [...container.querySelectorAll('a')].find((link) => link.textContent === 'Otra tarea')!.click());
}

describe('publicar un trabajo con varios archivos', () => {
  it('inicia un formulario nuevo al cambiar de tarea sin reutilizar el trabajo ni los archivos anteriores', async () => {
    const [assignment, next] = source.getSnapshot().assignments;
    const publish = vi.spyOn(source, 'publishWork');
    const original = source.attachResourceFile.bind(source);
    const transfer = vi.spyOn(source, 'attachResourceFile').mockImplementationOnce(async (kind, id, file, expected, options) => {
      await original(kind, id, file, expected, options);
      throw new Error('Confirmación perdida');
    });
    await renderForm(assignment!.id, next!.id);
    await selectFiles([new File(['uno'], 'anterior.txt')]);
    await submitForm();
    const firstId = transfer.mock.calls[0]![1];
    expect(container.textContent).toContain('Reintentar archivos pendientes');
    await openOtherTask();
    expect(container.textContent).not.toContain('Tu trabajo ya está publicado');
    expect(container.textContent).not.toContain('anterior.txt');
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(false);
    transfer.mockImplementation(original);
    await selectFiles([new File(['dos'], 'nuevo.txt')]);
    await submitForm();
    const secondId = transfer.mock.calls[1]![1];
    expect(secondId).not.toBe(firstId);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls.map(([input]) => input.assignmentId)).toEqual([assignment!.id, next!.id]);
    expect(source.getSnapshot().works.find((work) => work.id === secondId)?.assignmentId).toBe(next!.id);
    expect(container.querySelector('[data-location]')?.textContent).toBe(`/m/tareas/${next!.id}?trabajo=${secondId}`);
  });

  it('permanece en la nueva tarea si se confirma tarde una subida de la página anterior', async () => {
    const [assignment, next] = source.getSnapshot().assignments;
    let finish: ((id: string) => void) | undefined;
    let signal: AbortSignal | undefined;
    const transfer = vi.spyOn(source, 'attachResourceFile').mockImplementation(async (_kind, _id, _file, _version, options) => {
      signal = options?.signal;
      return new Promise<string>((resolve) => { finish = resolve; });
    });
    await renderForm(assignment!.id, next!.id);
    await selectFiles([new File(['uno'], 'primero.txt'), new File(['dos'], 'segundo.txt')]);
    await submitForm();
    await openOtherTask();
    expect(signal?.aborted).toBe(true);
    await act(async () => finish!('confirmado-antes-de-cancelar'));
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-location]')?.textContent).toBe(`/m/tareas/${next!.id}/subir`);
    expect(container.textContent).not.toContain('Tu trabajo ya está publicado');
  });

  it('no empieza archivos ni navega si la creación del trabajo responde después de salir', async () => {
    const [assignment, next] = source.getSnapshot().assignments;
    let finish: ((id: string) => void) | undefined;
    vi.spyOn(source as DataSource, 'publishWork').mockImplementation(async () => new Promise<string>((resolve) => { finish = resolve; }));
    const transfer = vi.spyOn(source, 'attachResourceFile');
    await renderForm(assignment!.id, next!.id);
    await selectFiles([new File(['uno'], 'primero.txt')]);
    await submitForm();
    await openOtherTask();
    await act(async () => finish!('trabajo-creado-antes-de-salir'));
    expect(transfer).not.toHaveBeenCalled();
    expect(container.querySelector('[data-location]')?.textContent).toBe(`/m/tareas/${next!.id}/subir`);
    expect(container.textContent).not.toContain('Tu trabajo ya está publicado');
  });

  it('respeta Cancelar cuando el transporte recupera un archivo que ya había confirmado', async () => {
    const assignment = source.getSnapshot().assignments[0]!;
    let finish: ((id: string) => void) | undefined;
    let signal: AbortSignal | undefined;
    const transfer = vi.spyOn(source, 'attachResourceFile').mockImplementation(async (_kind, _id, _file, _version, options) => {
      signal = options?.signal;
      return new Promise<string>((resolve) => { finish = resolve; });
    });
    await renderForm(assignment.id);
    await selectFiles([new File(['uno'], 'primero.txt')]);
    await submitForm();
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Cancelar subida')!.click());
    expect(signal?.aborted).toBe(true);
    await act(async () => finish!('confirmado-antes-de-cancelar'));
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-location]')?.textContent).toBe(`/m/tareas/${assignment.id}/subir`);
    expect(container.textContent).toContain('Los archivos ya confirmados permanecen guardados');
    expect(container.querySelector('form')).not.toBeNull();
  });

  it.each([false, true])('recupera el primer archivo confirmado sin adelantar la versión del siguiente (edición externa: %s)', async (editedByCoauthor) => {
    const assignment = source.getSnapshot().assignments[0]!;
    const publish = vi.spyOn(source, 'publishWork');
    const original = source.attachResourceFile.bind(source);
    let confirmedId: string | undefined;
    const transfer = vi.spyOn(source, 'attachResourceFile').mockImplementation(async (kind, id, file, expected, options) => {
      if (file.name === 'primero.txt') {
        if (confirmedId) return confirmedId;
        confirmedId = await original(kind, id, file, expected, options);
        throw new Error('Se perdió la confirmación');
      }
      return original(kind, id, file, expected, options);
    });
    await act(async () => root.render(<DataProvider source={source}><MemoryRouter initialEntries={[`/m/tareas/${assignment.id}/subir`]}><Routes>
      <Route path="/m/tareas/:assignmentId/subir" element={<SubmitWorkPage />} />
      <Route path="/m/tareas/:assignmentId" element={<p>Trabajo publicado</p>} />
    </Routes></MemoryRouter></DataProvider>));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['uno'], 'primero.txt'), new File(['dos'], 'segundo.txt')], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    const submit = async () => { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); };
    await submit();
    const workId = transfer.mock.calls[0]![1];
    expect(source.getSnapshot().works.find((w) => w.id === workId)!.version).toBe(2);
    expect(container.textContent).toContain('Reintentar archivos pendientes');
    if (editedByCoauthor) {
      await act(async () => {
        const current = source.getSnapshot().works.find((w) => w.id === workId)!;
        source.saveWorkVersion(workId, { title: current.title, topic: '', description: 'Cambio simultáneo del equipo', status: 'draft' }, current.version);
      });
    }
    await submit();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(transfer.mock.calls.map((args) => args[3])).toEqual([1, 1, 2]);
    const snapshot = source.getSnapshot();
    const current = snapshot.works.find((w) => w.id === workId)!;
    expect(snapshot.resourceFiles.filter((f) => f.targetId === workId && f.name === 'primero.txt')).toHaveLength(1);
    if (editedByCoauthor) {
      expect(snapshot.resourceFiles.some((f) => f.targetId === workId && f.name === 'segundo.txt')).toBe(false);
      expect(current.description).toBe('Cambio simultáneo del equipo');
      expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/cambi|actualiza|versión/i);
    } else {
      expect(snapshot.resourceFiles.filter((f) => f.targetId === workId && f.name === 'segundo.txt')).toHaveLength(1);
      expect(container.textContent).toContain('Trabajo publicado');
      expect(container.querySelector('form')).toBeNull();
    }
    expect(current.version).toBe(3);
  });
});
