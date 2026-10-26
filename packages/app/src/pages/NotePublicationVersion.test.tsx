// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { NoteFormPage, NotePage, NotesPage } from './NotesPage';

let root: Root;
let container: HTMLDivElement;
let source: DemoDataSource;
let state: ReturnType<typeof createDemoState>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  state = createDemoState();
  state.notes = [];
  source = new DemoDataSource(state, 'demo-1');
});

afterEach(async () => {
  await act(async () => root.unmount());
  source.dispose();
  container.remove();
});

async function show(path: string) {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}>
      <DataProvider source={source}>
        <Routes>
          <Route path="/m/notas" element={<NotesPage />} />
          <Route path="/m/notas/nueva" element={<NoteFormPage />} />
          <Route path="/m/notas/:noteId/editar" element={<NoteFormPage />} />
          <Route path="/m/notas/:noteId" element={<NotePage />} />
        </Routes>
      </DataProvider>
    </MemoryRouter>,
  ));
}

function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  const match = [...container.querySelectorAll('label')].find((node) =>
    node.querySelector('.field__label')?.textContent?.trim() === label || node.textContent?.trim() === label);
  const control = match?.control ?? match?.querySelector('input, textarea');
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) throw new Error(`Falta el campo ${label}`);
  return control;
}

async function change(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function publicationVersion() {
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="Versión de la publicación"]');
  expect(select).not.toBeNull();
  return select!;
}

async function selectVersion(value: 'v1' | 'final') {
  await act(async () => {
    const select = publicationVersion();
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function submit() {
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

async function follow(label: string) {
  const link = [...container.querySelectorAll<HTMLAnchorElement>('a')]
    .find((item) => (item.getAttribute('aria-label') ?? item.textContent)?.trim() === label);
  expect(link, `Enlace ${label}`).toBeTruthy();
  await act(async () => link!.click());
}

function noteCard(id: string) {
  const card = container.querySelector<HTMLAnchorElement>(`li a[href="/m/notas/${id}"]`);
  expect(card).not.toBeNull();
  return card!;
}

describe('versión editorial de las notas', () => {
  it('ofrece V1 por defecto y guarda una versión final visible en su tarjeta', async () => {
    await show('/m/notas/nueva');
    expect(publicationVersion().value).toBe('v1');
    expect([...publicationVersion().options].map(({ value, text }) => ({ value, text }))).toEqual([
      { value: 'v1', text: 'V1' }, { value: 'final', text: 'Versión final' },
    ]);
    await change(field('Título'), 'Apunte listo para compartir');
    await change(field('Contenido'), 'Explicación completa y revisada.');
    await selectVersion('final');
    await submit();
    const note = source.getSnapshot().notes[0]!;
    expect(note).toMatchObject({ title: 'Apunte listo para compartir', version: 1, isFinal: true });
    await follow('Notas de clase');
    expect(noteCard(note.id).textContent).toContain('Versión final');
    expect(noteCard(note.id).textContent).not.toContain('Versión 1');
  });

  it('conserva la versión final al abrir la edición y guardar una corrección', async () => {
    const id = source.saveNote({ subjectId: state.subjects[0]!.id, topic: '', title: 'Nota final',
      body: 'Explicación revisada.', tags: [], visibility: 'personal', source: 'student', isFinal: true });
    await show(`/m/notas/${id}/editar`);
    expect(publicationVersion().value).toBe('final');
    await change(field('Contenido'), 'Explicación revisada con una corrección.');
    await submit();
    expect(source.getSnapshot().notes.find((note) => note.id === id)).toMatchObject({ version: 2, isFinal: true });
    await follow('Notas de clase');
    expect(noteCard(id).textContent).toContain('Versión final');
    expect(noteCard(id).textContent).not.toContain('Versión 2');
  });

  it('conserva la presentación numérica de una nota anterior sin estado editorial', async () => {
    const now = new Date();
    state.notes.push({ id: 'legacy', subjectId: state.subjects[0]!.id, topic: '', title: 'Apunte anterior',
      body: 'Contenido previo.', tags: [], visibility: 'group', source: 'student', authorId: 'demo-1',
      version: 1, createdAt: now, updatedAt: now });
    await show('/m/notas');
    expect(noteCard('legacy').textContent).toContain('Versión 1');
    expect(noteCard('legacy').textContent).not.toContain('Versión final');
    await act(async () => noteCard('legacy').click());
    await follow('Editar');
    expect(publicationVersion().value).toBe('v1');
  });
});
