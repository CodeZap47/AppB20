// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import type { DataSource } from '../data/types';
import { AssignmentFormPage, AssignmentPage, SubmitWorkPage } from './WorksPage';

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

async function renderAssignmentForm(assignmentId?: string) {
  const subjectId = source.getSnapshot().assignments[0]!.subjectId;
  const path = assignmentId ? `/m/tareas/${assignmentId}/editar` : `/m/tareas/nueva?materia=${subjectId}`;
  await act(async () => root.render(<DataProvider source={source}><MemoryRouter initialEntries={[path]}>
    <Routes><Route path="/m/tareas/nueva" element={<AssignmentFormPage />} />
      <Route path="/m/tareas/:assignmentId/editar" element={<AssignmentFormPage />} />
      <Route path="/m/tareas/:assignmentId" element={<p>Página guardada</p>} /></Routes><Location />
  </MemoryRouter></DataProvider>));
}

async function typeTitle(value: string) {
  const label = [...container.querySelectorAll('label')].find((element) => element.querySelector('.field__label')?.textContent === 'Título')!;
  const input = label.querySelector('input')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('adjuntos de la consigna', () => {
  it('guarda una tarea una sola vez y reintenta únicamente los archivos pendientes', async () => {
    const create = vi.spyOn(source, 'createAssignment');
    const original = source.attachResourceFile.bind(source);
    const transfer = vi.spyOn(source, 'attachResourceFile').mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('Sin conexión')).mockImplementation(original);
    await renderAssignmentForm();
    await typeTitle('Consigna con documentos');
    await selectFiles([new File(['uno'], 'consigna.pdf'), new File(['dos'], 'ejemplo.png')]);
    await submitForm();

    expect(create).toHaveBeenCalledTimes(1);
    const id = transfer.mock.calls[0]![1];
    expect(container.textContent).toContain('La página ya está guardada');
    expect(container.querySelector('fieldset')?.disabled).toBe(true);
    expect(container.querySelector('[data-location]')?.textContent).toContain('/m/tareas/nueva');
    expect(source.getSnapshot().resourceFiles.filter((file) => file.targetId === id)).toHaveLength(1);

    await submitForm();
    expect(create).toHaveBeenCalledTimes(1);
    expect(transfer.mock.calls.map(([kind, targetId, file, version]) => [kind, targetId, file.name, version])).toEqual([
      ['assignment', id, 'consigna.pdf', 1], ['assignment', id, 'ejemplo.png', 2], ['assignment', id, 'ejemplo.png', 2],
    ]);
    expect(source.getSnapshot().resourceFiles.filter((file) => file.targetId === id)).toHaveLength(2);
    expect(container.querySelector('[data-location]')?.textContent).toBe(`/m/tareas/${id}`);
  });

  it('adjunta al editar sin guardar otra versión de texto cuando no cambió', async () => {
    const assignment = source.getSnapshot().assignments[0]!;
    const update = vi.spyOn(source, 'updateAssignment');
    const transfer = vi.spyOn(source, 'attachResourceFile');
    await renderAssignmentForm(assignment.id);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await selectFiles([new File(['documento'], 'recurso.pdf')]);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    await submitForm();
    // La demo también pasa por updateAssignment al versionar el adjunto.
    expect(update.mock.calls.filter((args) => args[2] !== undefined)).toHaveLength(0);
    expect(transfer).toHaveBeenCalledWith('assignment', assignment.id, expect.any(File), assignment.version, expect.any(Object));
    expect(source.getSnapshot().assignments.find((item) => item.id === assignment.id)?.version).toBe(assignment.version + 1);
  });

  it('mantiene guardada la edición textual y no la vuelve a enviar si falla un adjunto', async () => {
    const assignment = source.getSnapshot().assignments[0]!;
    const update = vi.spyOn(source, 'updateAssignment');
    const original = source.attachResourceFile.bind(source);
    const transfer = vi.spyOn(source, 'attachResourceFile').mockRejectedValueOnce(new Error('Sin conexión')).mockImplementation(original);
    await renderAssignmentForm(assignment.id);
    await typeTitle('Consigna corregida');
    await selectFiles([new File(['documento'], 'recurso.pdf')]);
    await submitForm();
    expect(update.mock.calls.filter((args) => args[2] !== undefined)).toHaveLength(1);
    expect(source.getSnapshot().assignments.find((item) => item.id === assignment.id)?.title).toBe('Consigna corregida');
    await submitForm();
    expect(update.mock.calls.filter((args) => args[2] !== undefined)).toHaveLength(1);
    expect(transfer.mock.calls.map((args) => args[3])).toEqual([assignment.version + 1, assignment.version + 1]);
    expect(container.querySelector('[data-location]')?.textContent).toBe(`/m/tareas/${assignment.id}`);
  });

  it('adjunta al editar el trabajo sin guardar una revisión textual sin cambios', async () => {
    const assignment = source.getSnapshot().assignments[0]!;
    const workId = await source.publishWork({ assignmentId: assignment.id, title: 'Mi trabajo', description: 'Descripción', coauthorIds: [], status: 'draft' });
    const update = vi.spyOn(source, 'saveWorkVersion');
    const transfer = vi.spyOn(source, 'attachResourceFile');
    await act(async () => root.render(<DataProvider source={source}><MemoryRouter initialEntries={[`/m/tareas/${assignment.id}`]}>
      <Routes><Route path="/m/tareas/:assignmentId" element={<AssignmentPage />} /></Routes>
    </MemoryRouter></DataProvider>));
    const card = container.querySelector<HTMLElement>(`#trabajo-${workId}`)!;
    await act(async () => card.querySelector<HTMLButtonElement>('button[aria-label="Editar mi trabajo"]')!.click());
    const editForm = card.querySelector<HTMLFormElement>('form.form')!;
    const input = editForm.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['documento'], 'recurso.pdf')], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await act(async () => editForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(update).not.toHaveBeenCalled();
    expect(transfer).toHaveBeenCalledWith('work', workId, expect.any(File), 1, expect.any(Object));
    expect(source.getSnapshot().works.find((item) => item.id === workId)?.version).toBe(2);
    expect(card.querySelector('fieldset.academic-publish-fields')).toBeNull();
  });
});

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
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Cancelar primero.txt"]')!.click());
    expect(signal?.aborted).toBe(true);
    await act(async () => finish!('confirmado-antes-de-cancelar'));
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-location]')?.textContent).toBe(`/m/tareas/${assignment.id}/subir`);
    expect(container.querySelector('[data-upload-state="complete"]')?.textContent).toContain('primero.txt');
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
