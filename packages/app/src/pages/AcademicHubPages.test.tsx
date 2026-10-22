// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from '../data/demo';
import { DataProvider } from '../data/DataContext';
import { AssignmentCalendarPage, SubjectsPage } from './AcademicHubPages';

let container: HTMLDivElement;
let root: Root;
let source: DemoDataSource;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  source?.dispose();
  container.remove();
});
async function render(state: ReturnType<typeof createDemoState>, path: string) {
  source = new DemoDataSource(state, 'demo-1');
  const router = createMemoryRouter(
    [
      { path: '/m/calendario', element: <AssignmentCalendarPage /> },
      { path: '/m/materias/:subjectId?', element: <SubjectsPage /> },
    ],
    { initialEntries: [path] },
  );
  await act(async () =>
    root.render(
      <DataProvider source={source}>
        <RouterProvider router={router} />
      </DataProvider>,
    ),
  );
  return router;
}
describe('calendario y materias', () => {
  it('coloca la tarea en su fecha civil y conserva las tareas sin fecha en una lista aparte', async () => {
    const state = createDemoState(new Date(2026, 9, 22, 12));
    await render(state, '/m/calendario?mes=2026-10&dia=2026-10-27');
    expect(container.querySelector('.calendar-agenda')?.textContent).toContain('Tarea de prueba 1');
    expect(container.querySelector('.calendar-unscheduled')?.textContent).toContain(
      'Actividad de prueba',
    );
    expect(container.querySelector('td[data-selected="true"] a')?.getAttribute('href')).toBe(
      '/m/tareas/t1',
    );
  });
  it('cambia el mes sin perder el filtro de materia', async () => {
    const state = createDemoState(new Date(2026, 9, 22, 12));
    const router = await render(state, '/m/calendario?mes=2026-12&materia=IDSE-05010103');
    const next = container.querySelector<HTMLButtonElement>('button[aria-label="Mes siguiente"]')!;
    await act(async () => next.click());
    expect(router.state.location.search).toContain('mes=2027-01');
    expect(router.state.location.search).toContain('materia=IDSE-05010103');
  });
  it('vincula solo apuntes compartidos a la tarea, manteniendo privados los personales', async () => {
    const state = createDemoState();
    const task = state.assignments[0]!;
    const note = state.notes.find((entry) => entry.visibility === 'group')!;
    note.subjectId = task.subjectId;
    note.assignmentIds = [task.id];
    note.title = 'Referencia pública';
    state.notes.push({
      ...note,
      id: 'secret-note',
      authorId: 'demo-1',
      visibility: 'personal',
      title: 'Referencia personal privada',
    });
    await render(state, `/m/materias/${task.subjectId}`);
    expect(container.querySelector('.subject-assignment__references')?.textContent).toContain(
      'Referencia pública',
    );
    expect(container.textContent).not.toContain('Referencia personal privada');
    const notes = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Apuntes del grupo',
    )!;
    await act(async () => notes.click());
    expect(container.textContent).toContain('Referencia pública');
    expect(container.textContent).not.toContain('Referencia personal privada');
  });
  it('cambia de cuatrimestre y deja de mostrar la materia del anterior', async () => {
    const state = createDemoState();
    const router = await render(state, `/m/materias/${state.assignments[0]!.subjectId}`);
    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Cuatrimestre de materias"]',
    )!;
    await act(async () => {
      select.value = '2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(router.state.location.pathname).toBe('/m/materias');
    expect(router.state.location.search).toBe('?cuatri=2');
    expect(container.querySelector('.subject-content__header')?.textContent).toContain(
      '2º cuatrimestre',
    );
  });
});
