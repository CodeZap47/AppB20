// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { NoteFormPage } from './NotesPage';
import { SpacedCollectionFormPage } from './SpacedPage';

let root: Root, container: HTMLDivElement, source: DemoDataSource;
const modules = [
  { kind: 'note', create: '/m/notas/nueva', edit: (id: string) => `/m/notas/${id}/editar`, title: 'Título' },
  { kind: 'collection', create: '/m/repaso/nueva', edit: (id: string) => `/m/repaso/colecciones/${id}/editar`, title: 'Título de la colección' },
] as const;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  source = new DemoDataSource(createDemoState(), 'demo-1');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); });

async function show(path: string) {
  await act(async () => root.render(<MemoryRouter key={path} initialEntries={[path]}><DataProvider source={source}><Routes>
    <Route path="/m/notas/nueva" element={<NoteFormPage />} />
    <Route path="/m/notas/:noteId/editar" element={<NoteFormPage />} />
    <Route path="/m/notas/:noteId" element={<p>Guardado</p>} />
    <Route path="/m/repaso/nueva" element={<SpacedCollectionFormPage />} />
    <Route path="/m/repaso/colecciones/:collectionId/editar" element={<SpacedCollectionFormPage />} />
    <Route path="/m/repaso/colecciones/:collectionId" element={<p>Guardado</p>} />
  </Routes></DataProvider></MemoryRouter>));
}
function field(label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const node = [...container.querySelectorAll('label')].find((item) =>
    item.querySelector('.field__label')?.textContent?.trim() === label || item.textContent?.trim().startsWith(label));
  const control = node?.control ?? node?.querySelector('input, textarea, select');
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) throw new Error(`Falta campo ${label}`);
  return control;
}
async function change(control: ReturnType<typeof field>, value: string) {
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
function rows(kind: typeof modules[number]['kind']) { const snapshot = source.getSnapshot(); return kind === 'note' ? snapshot.notes : snapshot.spacedCollections; }

describe.each(modules)('visibilidad inicial de $kind desde el feed', (module) => {
  it.each(['', '?visibilidad=incorrecta'])('mantiene Personal sin una petición válida de grupo: %s', async (query) => {
    await show(`${module.create}${query}`);
    expect(field('Visibilidad').value).toBe('personal');
  });

  it('abre en grupo y permite elegir Personal antes de guardar', async () => {
    await show(`${module.create}?visibilidad=grupo`);
    expect(field('Visibilidad').value).toBe('group');
    await change(field('Visibilidad'), 'personal');
    await change(field(module.title), `Creación personal ${module.kind}`);
    if (module.kind === 'note') await change(field('Contenido'), 'Contenido que he decidido mantener personal.');
    await submit();
    expect(rows(module.kind).find((row) => row.title === `Creación personal ${module.kind}`)?.visibility).toBe('personal');
    expect(container.textContent).toContain('Guardado');
  });

  it('guarda para el grupo cuando se conserva esa elección', async () => {
    await show(`${module.create}?visibilidad=grupo`);
    await change(field(module.title), `Creación compartida ${module.kind}`);
    if (module.kind === 'note') await change(field('Contenido'), 'Contenido que he decidido compartir.');
    await submit();
    expect(rows(module.kind).find((row) => row.title === `Creación compartida ${module.kind}`)?.visibility).toBe('group');
    expect(container.textContent).toContain('Guardado');
  });

  it.each(['personal', 'group'] as const)('ignora el parámetro al editar un recurso %s', async (visibility) => {
    const subjectId = source.getSnapshot().subjects[0]!.id;
    const id = module.kind === 'note'
      ? source.saveNote({ subjectId, title: 'Original', body: 'Contenido original.', topic: 'Tema', tags: [], source: 'student', visibility })
      : source.saveSpacedCollection({ subjectId, title: 'Original', visibility });
    await show(`${module.edit(id)}?visibilidad=${visibility === 'personal' ? 'grupo' : 'personal'}`);
    if (module.kind === 'note') { expect(field('Visibilidad').value).toBe(visibility); expect((field('Visibilidad') as HTMLSelectElement).disabled).toBe(true); }
    else expect([...container.querySelectorAll('select')].some((select) => [...select.options].some((option) => option.value === 'group'))).toBe(false);
    await change(field(module.title), 'Corregido'); await submit();
    expect(rows(module.kind).find((row) => row.id === id)).toMatchObject({ title: 'Corregido', visibility, version: 2 });
    expect(container.textContent).toContain('Guardado');
  });
});
