// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { NotePage } from './NotesPage';
import { GuidePage } from './GuidesPage';
import { QuestionPage } from './QuestionsPage';

let root: Root; let container: HTMLDivElement; let source: DemoDataSource;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  source = new DemoDataSource(createDemoState(), 'demo-1');
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); });
async function show(path: string, pattern: string, page: ReactNode) {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><DataProvider source={source}><Routes><Route path={pattern} element={page} /></Routes></DataProvider></MemoryRouter>));
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
  expect(button, label).toBeTruthy(); expect(button?.disabled, label).toBe(false);
  await act(async () => button!.click());
}

describe('flujos de conocimiento completos desde la interfaz', () => {
  it('revisa y publica una copia de la nota sin abrir el original personal ni sus cambios futuros', async () => {
    const subjectId = source.getSnapshot().subjects[0]!.id;
    const noteId = source.saveNote({ subjectId, title: 'Mi apunte', topic: 'Tema', body: 'Versión que quiero compartir', tags: [], visibility: 'personal', source: 'student', session: '2026-10-21' });
    const before = source.getSnapshot().notes.length;
    await show(`/m/notas/${noteId}`, '/m/notas/:noteId', <NotePage />);
    await click('Revisar publicación');
    expect(source.getSnapshot().notes).toHaveLength(before);
    expect(container.textContent).toContain('sus cambios futuros siguen siendo personales');
    await click('Publicar esta versión para el grupo');
    const published = source.getSnapshot().notes.find((note) => note.publishedFromId === noteId)!;
    expect(published).toBeTruthy(); expect(published.visibility).toBe('group'); expect(published.body).toBe('Versión que quiero compartir');
    const personal = source.getSnapshot().notes.find((note) => note.id === noteId)!;
    await act(async () => source.saveNote({ ...personal, body: 'Cambio privado después de publicar', expectedVersion: personal.version }));
    await act(async () => source.setViewer('demo-4'));
    expect(container.querySelector('h1')?.textContent).toBe('Mi apunte');
    expect(container.textContent).not.toContain('Cambio privado después de publicar');
    expect(source.getSnapshot().notes.some((note) => note.id === noteId)).toBe(false);
  });

  it('restaura clasificación y contenido de una nota desde su historial visible', async () => {
    const subjectId = source.getSnapshot().subjects[0]!.id;
    const noteId = source.saveNote({ subjectId, title: 'Versión original', topic: 'Tema', body: 'Texto inicial', tags: [], visibility: 'personal', source: 'student', session: '2026-10-20' });
    const first = source.getSnapshot().notes.find((note) => note.id === noteId)!;
    source.saveNote({ ...first, title: 'Versión cambiada', body: 'Texto cambiado', session: '2026-10-21', expectedVersion: first.version });
    await show(`/m/notas/${noteId}`, '/m/notas/:noteId', <NotePage />);
    await click('Restaurar esta versión completa');
    expect(source.getSnapshot().notes.find((note) => note.id === noteId)).toMatchObject({ title: 'Versión original', body: 'Texto inicial', session: '2026-10-20', version: 3, authorId: 'demo-1' });
    expect(container.textContent).toContain('Restaurada de v1');
  });

  it('las aclaraciones y señales de utilidad no resuelven la pregunta hasta aceptar una respuesta', async () => {
    const subjectId = source.getSnapshot().subjects[0]!.id;
    const questionId = source.askQuestion({ subjectId, title: '¿Cómo funciona?', topic: 'Tema', body: 'Contexto de la duda' });
    source.setViewer('demo-4'); source.answerQuestion(questionId, 'Explicación paso a paso'); source.setViewer('demo-1');
    await show(`/m/preguntas/${questionId}`, '/m/preguntas/:questionId', <QuestionPage />);
    const clarification = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Aclaración sobre la pregunta"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(clarification, '¿Qué versión se utilizó?'); clarification.dispatchEvent(new Event('input', { bubbles: true })); });
    const form = clarification.closest('form')!;
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(source.getSnapshot().questionComments.filter((comment) => comment.questionId === questionId)).toHaveLength(1);
    expect(source.getSnapshot().answers.filter((answer) => answer.questionId === questionId)).toHaveLength(1);
    await click('Esta explicación es útil');
    expect(source.getSnapshot().answerUsefulness).toHaveLength(1);
    expect(source.getSnapshot().questions.find((question) => question.id === questionId)?.status).toBe('open');
    await click('Me ayudó esta respuesta');
    expect(source.getSnapshot().questions.find((question) => question.id === questionId)?.status).toBe('resolved');
  });

  it('restaura una guía manual completa desde su pestaña de historial', async () => {
    const subjectId = source.getSnapshot().subjects[0]!.id;
    const id = source.createGuide({ subjectId, title: 'Guía inicial', topicsText: 'Tema original', sections: ['Objetivo inicial'] }, []);
    source.updateGuide(id, { subjectId, title: 'Guía cambiada', topicsText: 'Tema nuevo', sections: ['Objetivo cambiado'] }, 1);
    await show(`/m/guias/${id}?pestana=historial`, '/m/guias/:guideId', <GuidePage />);
    await click('Restaurar guía completa como versión nueva');
    expect(source.getSnapshot().guides.find((guide) => guide.id === id)).toMatchObject({ title: 'Guía inicial', topics: ['Tema original'], version: 3 });
    expect(source.getSnapshot().guideVersions.filter((version) => version.guideId === id)).toHaveLength(3);
    expect(container.textContent).toContain('Restaurada de v1');
  });
});
