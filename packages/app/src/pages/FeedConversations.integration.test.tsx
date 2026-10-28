// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { WhatsNewPage } from './WhatsNewPage';
import { NotePage } from './NotesPage';
import { AssignmentPage } from './WorksPage';
import { ActivityPage } from './ActivitiesPage';
import { QuestionPage } from './QuestionsPage';

let container: HTMLDivElement;
let root: Root;
let source: DemoDataSource;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  source = new DemoDataSource(createDemoState(), 'demo-1');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); vi.restoreAllMocks(); });
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
async function mount(path = '/m/inicio?ver=todo') {
  const router = createMemoryRouter([
    { path: '/m/inicio', element: <WhatsNewPage /> },
    { path: '/m/notas/:noteId', element: <NotePage /> },
    { path: '/m/tareas/:assignmentId', element: <AssignmentPage /> },
    { path: '/m/actividades/:activityId', element: <ActivityPage /> },
    { path: '/m/preguntas/:questionId', element: <QuestionPage /> },
  ], { initialEntries: [path] });
  await act(async () => root.render(<DataProvider source={source}><RouterProvider router={router} /></DataProvider>));
  await settle();
  return router;
}
async function commentOnCard(path: string, text: string) {
  const card = [...container.querySelectorAll<HTMLElement>('.feed-card')].find((entry) => entry.querySelector(`a[href="${path}"]`));
  expect(card).toBeDefined();
  expect(card!.textContent).toContain('Compartir');
  await act(async () => card!.querySelector<HTMLButtonElement>('.resource-comments__toggle')!.click());
  await settle();
  const input = card!.querySelector<HTMLTextAreaElement>('.resource-comments textarea');
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input!.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await settle();
  expect(card!.textContent).toContain(text);
}

describe('conversaciones compartidas entre el feed y los recursos reales', () => {
  it('publica un comentario desde la tarjeta de una nota en su hilo original', async () => {
    const note = source.getSnapshot().notes.find((row) => row.visibility === 'group')!;
    const router = await mount();
    await commentOnCard(`/m/notas/${note.id}`, 'Aclaración escrita desde el feed para la nota');
    expect(source.getSnapshot().noteComments.filter((row) => row.noteId === note.id && row.text.includes('Aclaración escrita'))).toHaveLength(1);
    await act(async () => router.navigate(`/m/notas/${note.id}`));
    expect(container.querySelector('.notes-comments')?.textContent).toContain('Aclaración escrita desde el feed para la nota');
  });

  it('conserva la nueva conversación de una tarea al abrir su módulo y volver al feed', async () => {
    const assignment = source.getSnapshot().assignments[0]!;
    const router = await mount();
    await commentOnCard(`/m/tareas/${assignment.id}`, '¿Podemos entregar también el pseudocódigo?');
    await act(async () => router.navigate(`/m/tareas/${assignment.id}`));
    await settle();
    expect(container.querySelector('.resource-comments')?.textContent).toContain('¿Podemos entregar también el pseudocódigo?');
    await act(async () => router.navigate('/m/inicio?ver=todo'));
    await settle();
    const thread = await source.readFeedThread({ kind: 'assignment', id: assignment.id });
    expect(thread.comments.filter((row) => row.text === '¿Podemos entregar también el pseudocódigo?')).toHaveLength(1);
  });

  it('enfoca únicamente la evidencia indicada por el enlace compartido', async () => {
    const evidence = source.getSnapshot().evidences[0]!;
    await mount(`/m/actividades/${evidence.activityId}?evidencia=${encodeURIComponent(evidence.id)}`);
    expect(document.activeElement?.id).toBe(`evidencia-${evidence.id}`);
  });

  it('enfoca la respuesta exacta dentro de la pregunta sin abrir otro hilo', async () => {
    const answer = source.getSnapshot().answers[0]!;
    await mount(`/m/preguntas/${answer.questionId}?respuesta=${encodeURIComponent(answer.id)}`);
    expect(document.activeElement?.id).toBe(`respuesta-${answer.id}`);
  });
});
