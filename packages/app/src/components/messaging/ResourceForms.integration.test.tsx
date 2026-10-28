// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../../data/DataContext';
import { createDemoState, DemoDataSource } from '../../data/demo';
import { AssignmentForm, SubmitWorkForAssignment } from '../../pages/WorksPage';
import { ActivityForm } from '../../pages/ActivitiesPage';
import { NoteForm } from '../../pages/NotesPage';
import { AskQuestionPage } from '../../pages/QuestionsPage';
import { ChatResourceCreatePanel } from './ChatResourceCreatePanel';

let container: HTMLDivElement;
let root: Root;
let source: DemoDataSource;
const saved = vi.fn<(id: string, shareable: boolean) => void>();
const cancel = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, char => `\\${char.codePointAt(0)!.toString(16)} `) });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  source = new DemoDataSource(createDemoState(), 'demo-1');
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); vi.unstubAllGlobals(); });
function Location() { return <output data-location>{useLocation().pathname}</output>; }
async function show(element: ReactNode) {
  const subject = source.getSnapshot().subjects[0]!.id;
  await act(async () => root.render(<DataProvider source={source}><MemoryRouter initialEntries={[`/m/mensajes?materia=${subject}`]}>{element}<Location /></MemoryRouter></DataProvider>));
}
function field(name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const label = [...document.querySelectorAll('label')].find(element => element.querySelector('.field__label')?.textContent?.trim() === name || element.textContent?.trim() === name);
  const control = label?.control ?? label?.querySelector('input, textarea, select');
  if (!control) throw new Error(`Falta ${name}`);
  return control as ReturnType<typeof field>;
}
async function fill(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() { await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
const location = () => expect(container.querySelector('[data-location]')?.textContent).toBe('/m/mensajes');

describe('formularios de módulos reutilizados dentro del chat', () => {
  it('crea una tarea y devuelve su id sin navegar fuera del chat', async () => {
    await show(<AssignmentForm initialTitle="Tarea desde conversación" onSaved={saved} onCancel={cancel} />);
    await submit();
    expect(saved).toHaveBeenCalledOnce();
    expect(source.getSnapshot().assignments.find(row => row.id === saved.mock.calls[0]![0])?.title).toBe('Tarea desde conversación');
    expect(saved.mock.calls[0]![1]).toBe(true); location();
  });
  it('crea una actividad de clase con el mismo formulario del módulo', async () => {
    await show(<ActivityForm initialTitle="Actividad desde conversación" onSaved={saved} onCancel={cancel} />);
    await submit();
    expect(saved).toHaveBeenCalledOnce();
    expect(source.getSnapshot().activities.find(row => row.id === saved.mock.calls[0]![0])?.title).toBe('Actividad desde conversación');
    location();
  });
  it('crea una pregunta desde el chat sin publicar un mensaje automáticamente', async () => {
    const messages = source.getSnapshot().groupMessages.length;
    await show(<AskQuestionPage initialTitle="¿Cómo se comparte un recurso?" onSaved={saved} onCancel={cancel} />);
    await submit();
    expect(saved).toHaveBeenCalledOnce();
    expect(source.getSnapshot().questions.find(row => row.id === saved.mock.calls[0]![0])?.title).toBe('¿Cómo se comparte un recurso?');
    expect(source.getSnapshot().groupMessages).toHaveLength(messages); location();
  });
  it('mantiene explícito el estado del trabajo y devuelve una referencia al trabajo de la tarea elegida', async () => {
    const assignment = source.getSnapshot().assignments[0]!;
    await show(<SubmitWorkForAssignment assignmentId={assignment.id} initialTitle="Trabajo compartido" onSaved={saved} onCancel={cancel} />);
    expect(container.textContent).toContain('Borrador');
    await submit();
    expect(saved).toHaveBeenCalledOnce();
    expect(source.getSnapshot().works.find(row => row.id === saved.mock.calls[0]![0])).toMatchObject({ title: 'Trabajo compartido', assignmentId: assignment.id, status: 'draft' });
    location();
  });
  it('propone una nota del grupo y devuelve la visibilidad al compositor', async () => {
    await show(<NoteForm initialTitle="Nota del chat" onSaved={saved} onCancel={cancel} />);
    const visibility = document.querySelector<HTMLSelectElement>('select[aria-label="Visibilidad de la nota"]') ?? [...document.querySelectorAll<HTMLSelectElement>('select')].find(select => [...select.options].some(option => option.value === 'personal'))!;
    expect(visibility.value).toBe('group');
    await fill(field('Contenido') as HTMLTextAreaElement, 'Un contenido compartido');
    await submit();
    expect(saved).toHaveBeenCalledOnce();
    expect(source.getSnapshot().notes.find(row => row.id === saved.mock.calls[0]![0])).toMatchObject({ title: 'Nota del chat', visibility: 'group' });
    expect(saved.mock.calls[0]![1]).toBe(true); location();
  });
  it('reintenta archivos de una nota sin duplicarla ni retornar antes de completar la subida', async () => {
    const create = vi.spyOn(source, 'saveNote');
    const upload = source.attachResourceFile.bind(source);
    const transfer = vi.spyOn(source, 'attachResourceFile').mockRejectedValueOnce(new Error('Sin conexión')).mockImplementation(upload);
    await show(<NoteForm initialTitle="Nota con archivo" onSaved={saved} onCancel={cancel} />);
    await fill(field('Contenido') as HTMLTextAreaElement, 'Mantener este contenido');
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['contenido'], 'nota.txt', { type: 'text/plain' });
    Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
    await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })));
    await submit();
    expect(saved).not.toHaveBeenCalled(); expect(create).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Sin conexión');
    await submit();
    expect(create).toHaveBeenCalledOnce(); expect(transfer).toHaveBeenCalledTimes(2); expect(saved).toHaveBeenCalledOnce();
    expect(transfer.mock.calls[0]![1]).toBe(transfer.mock.calls[1]![1]); location();
  });
  it('el panel de trabajo exige elegir una tarea antes de mostrar el formulario', async () => {
    await show(<ChatResourceCreatePanel kind="trabajo" onCreated={saved} onClose={cancel} />);
    expect(document.querySelector('form')).toBeNull();
    const picker = document.querySelector<HTMLSelectElement>('[aria-label="Tarea del trabajo"]')!;
    const assignment = source.getSnapshot().assignments[0]!;
    await act(async () => { picker.value = assignment.id; picker.dispatchEvent(new Event('change', { bubbles: true })); });
    await vi.waitFor(() => expect(document.querySelector('form')).not.toBeNull());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(assignment.title);
    expect(saved).not.toHaveBeenCalled();
  });
});
