// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import type { DataSource } from '../data/types';
import { NoteFormPage } from './NotesPage';
import { GuideFormPage } from './GuidesPage';
import { AskQuestionPage, QuestionPage } from './QuestionsPage';

let root: Root;
let container: HTMLDivElement;
let source: DemoDataSource;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  source = new DemoDataSource(createDemoState(), 'demo-1');
});

afterEach(async () => {
  await act(async () => root.unmount());
  source.dispose();
  container.remove();
});

function Location() { return <output data-location>{useLocation().pathname}</output>; }

async function renderForm(path: string) {
  await act(async () => root.render(<DataProvider source={source}><MemoryRouter initialEntries={[path]}>
    <Link to="/salir">Salir del formulario</Link>
    <Routes>
      <Route path="/m/notas/nueva" element={<NoteFormPage />} />
      <Route path="/m/notas/:noteId/editar" element={<NoteFormPage />} />
      <Route path="/m/notas/:noteId" element={<p>Nota guardada</p>} />
      <Route path="/m/guias/nueva" element={<GuideFormPage />} />
      <Route path="/m/guias/:guideId/editar" element={<GuideFormPage />} />
      <Route path="/m/guias/:guideId" element={<p>Guía guardada</p>} />
      <Route path="/m/preguntas/nueva" element={<AskQuestionPage />} />
      <Route path="/m/preguntas/:questionId" element={<QuestionPage />} />
      <Route path="/salir" element={<p>Otra página</p>} />
    </Routes>
    <Location />
  </MemoryRouter></DataProvider>));
}

function field(label: string, within: ParentNode = container): HTMLInputElement | HTMLTextAreaElement {
  const match = [...within.querySelectorAll('label')].find((node) =>
    node.querySelector('.field__label')?.textContent?.trim() === label || node.textContent?.trim() === label);
  const control = match?.control ?? match?.querySelector('input, textarea');
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) throw new Error(`Falta el campo ${label}`);
  return control;
}

async function change(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function selectFiles(files: File[], within: ParentNode = container) {
  const input = within.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(input).not.toBeNull();
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

async function submit(within: ParentNode = container) {
  const form = within instanceof HTMLFormElement ? within : within.querySelector('form')!;
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

function ownNote() {
  return source.saveNote({ subjectId: source.getSnapshot().subjects[0]!.id, topic: '', title: 'Nota propia',
    body: 'Contenido inicial', tags: [], visibility: 'personal', source: 'student' });
}

describe('adjuntos al guardar contenido', () => {
  it('crea una nota una sola vez y reintenta solo el archivo pendiente con el File y versión originales', async () => {
    const save = vi.spyOn(source, 'saveNote');
    const original = source.attachResourceFile.bind(source);
    const transfer = vi.spyOn(source, 'attachResourceFile').mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('Sin conexión')).mockImplementation(original);
    await renderForm('/m/notas/nueva');
    await change(field('Título'), 'Apunte con documentos');
    await change(field('Contenido'), 'Contenido que debe conservarse');
    const files = [new File(['primero'], 'primero.txt'), new File(['segundo'], 'segundo.txt')];
    await selectFiles(files);
    await submit();
    const noteId = transfer.mock.calls[0]![1];
    expect(save).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-location]')?.textContent).toBe('/m/notas/nueva');
    expect(field('Título').matches(':disabled')).toBe(true);
    expect(field('Contenido').value).toBe('Contenido que debe conservarse');
    expect(container.textContent).toContain('Sin conexión');
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe('Reintentar archivos pendientes');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Reintentar segundo.txt"]')!.click());
    expect(container.querySelector('[data-location]')?.textContent).toBe('/m/notas/nueva');
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe('Continuar');
    await submit();
    expect(save).toHaveBeenCalledTimes(1);
    expect(transfer.mock.calls.map((call) => call.slice(0, 4))).toEqual([
      ['note', noteId, files[0], 1], ['note', noteId, files[1], 2], ['note', noteId, files[1], 2],
    ]);
    expect(source.getSnapshot().resourceFiles.filter((file) => file.targetId === noteId)).toHaveLength(2);
    expect(container.querySelector('[data-location]')?.textContent).toBe(`/m/notas/${noteId}`);
  });

  it('edita una nota una sola vez y permite continuar tras fallar adjuntos aunque avanzó su versión', async () => {
    const noteId = ownNote();
    const save = vi.spyOn(source, 'saveNote');
    const original = source.attachResourceFile.bind(source);
    const transfer = vi.spyOn(source, 'attachResourceFile').mockRejectedValueOnce(new Error('Intenta otra vez')).mockImplementation(original);
    await renderForm(`/m/notas/${noteId}/editar`);
    await change(field('Contenido'), 'Contenido revisado');
    const file = new File(['adjunto'], 'revision.txt');
    await selectFiles([file]);
    await submit();
    expect(source.getSnapshot().notes.find((note) => note.id === noteId)?.version).toBe(2);
    expect(container.textContent).not.toContain('La nota cambió mientras la editabas');
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    await submit();
    expect(save).toHaveBeenCalledTimes(1);
    expect(transfer.mock.calls.map((call) => call.slice(0, 4))).toEqual([
      ['note', noteId, file, 2], ['note', noteId, file, 2],
    ]);
    expect(source.getSnapshot().notes.find((note) => note.id === noteId)).toMatchObject({ version: 3, body: 'Contenido revisado' });
    expect(container.querySelector('[data-location]')?.textContent).toBe(`/m/notas/${noteId}`);
  });

  it('crea una guía una sola vez cuando su adjunto necesita un reintento', async () => {
    const create = vi.spyOn(source, 'createGuide');
    const original = source.attachResourceFile.bind(source);
    const transfer = vi.spyOn(source, 'attachResourceFile').mockRejectedValueOnce(new Error('Sin conexión')).mockImplementation(original);
    const subjectId = source.getSnapshot().subjects[0]!.id;
    await renderForm(`/m/guias/nueva?materia=${subjectId}`);
    await change(field('Título de la guía'), 'Guía con documento');
    await change(field('Temas, uno por renglón'), 'Tema inicial');
    await selectFiles([new File(['material'], 'material.txt')]);
    await submit();
    expect(create).toHaveBeenCalledTimes(1);
    expect(field('Título de la guía').matches(':disabled')).toBe(true);
    const guideId = transfer.mock.calls[0]![1];
    await submit();
    expect(create).toHaveBeenCalledTimes(1);
    expect(transfer.mock.calls.map((call) => call[3])).toEqual([1, 1]);
    expect(container.querySelector('[data-location]')?.textContent).toBe(`/m/guias/${guideId}`);
  });

  it('edita una guía y sube a la versión guardada sin repetir la edición tras un fallo', async () => {
    const guide = source.getSnapshot().guides[0]!;
    const update = vi.spyOn(source, 'updateGuide');
    const original = source.attachResourceFile.bind(source);
    const transfer = vi.spyOn(source, 'attachResourceFile').mockRejectedValueOnce(new Error('Sin conexión')).mockImplementation(original);
    await renderForm(`/m/guias/${guide.id}/editar`);
    await change(field('Título de la guía'), 'Guía revisada');
    await selectFiles([new File(['material'], 'revision.txt')]);
    await submit();
    expect(container.textContent).not.toContain('La guía cambió mientras la editabas');
    await submit();
    expect(update).toHaveBeenCalledTimes(1);
    expect(transfer.mock.calls.map((call) => call[3])).toEqual([guide.version + 1, guide.version + 1]);
    expect(source.getSnapshot().guides.find((item) => item.id === guide.id)).toMatchObject({ title: 'Guía revisada', version: guide.version + 2 });
    expect(container.querySelector('[data-location]')?.textContent).toBe(`/m/guias/${guide.id}`);
  });

  it('conserva una pregunta publicada y sus campos bloqueados hasta confirmar los archivos', async () => {
    const create = vi.spyOn(source, 'askQuestion');
    const original = source.attachResourceFile.bind(source);
    const transfer = vi.spyOn(source, 'attachResourceFile').mockRejectedValueOnce(new Error('Sin conexión')).mockImplementation(original);
    await renderForm(`/m/preguntas/nueva?materia=${source.getSnapshot().subjects[0]!.id}`);
    await change(field('Pregunta'), '¿Cómo adjunto mi código?');
    const file = new File(['código'], 'codigo.txt');
    await selectFiles([file]);
    await submit();
    const questionId = transfer.mock.calls[0]![1];
    expect(field('Pregunta').matches(':disabled')).toBe(true);
    await submit();
    expect(create).toHaveBeenCalledTimes(1);
    expect(transfer.mock.calls.map((call) => call.slice(0, 4))).toEqual([
      ['question', questionId, file, 1], ['question', questionId, file, 1],
    ]);
    expect(container.querySelector('[data-location]')?.textContent).toBe(`/m/preguntas/${questionId}`);
  });

  it('no duplica una respuesta cuando falla su archivo y limpia el formulario solo al terminar', async () => {
    const question = source.getSnapshot().questions.find((item) => item.authorId !== 'demo-1')!;
    const answer = vi.spyOn(source, 'answerQuestion');
    const original = source.attachResourceFile.bind(source);
    const transfer = vi.spyOn(source, 'attachResourceFile').mockRejectedValueOnce(new Error('Sin conexión')).mockImplementation(original);
    await renderForm(`/m/preguntas/${question.id}`);
    const reply = container.querySelector<HTMLFormElement>('#responder')!;
    await change(field('Tu respuesta', reply), 'Esta es mi explicación');
    const file = new File(['ejemplo'], 'ejemplo.txt');
    await selectFiles([file], reply);
    await submit(reply);
    const answerId = transfer.mock.calls[0]![1];
    expect(field('Tu respuesta', reply).value).toBe('Esta es mi explicación');
    expect(field('Tu respuesta', reply).matches(':disabled')).toBe(true);
    await submit(reply);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(transfer.mock.calls.map((call) => call.slice(0, 4))).toEqual([
      ['answer', answerId, file, 1], ['answer', answerId, file, 1],
    ]);
    expect(field('Tu respuesta', reply).value).toBe('');
    expect(field('Tu respuesta', reply).matches(':disabled')).toBe(false);
    expect(reply.textContent).not.toContain('ejemplo.txt');
  });

  it('no inicia adjuntos ni navega si el guardado de una nota responde después de salir', async () => {
    let finish!: (id: string) => void;
    vi.spyOn(source as DataSource, 'saveNote').mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const transfer = vi.spyOn(source, 'attachResourceFile');
    await renderForm('/m/notas/nueva');
    await change(field('Título'), 'Nota en curso');
    await change(field('Contenido'), 'Contenido en curso');
    await selectFiles([new File(['archivo'], 'archivo.txt')]);
    await submit();
    await act(async () => [...container.querySelectorAll('a')].find((link) => link.textContent === 'Salir del formulario')!.click());
    await act(async () => finish('nota-confirmada'));
    expect(transfer).not.toHaveBeenCalled();
    expect(container.querySelector('[data-location]')?.textContent).toBe('/salir');
  });
});
