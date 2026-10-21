// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider, useSnapshot } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { ActivityRelations, PageHistory, ProgressControl, ResourceSection, WorkHistoryAndReview } from './AcademicTools';

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
async function show(children: React.ReactNode) {
  await act(async () => root.render(<MemoryRouter><DataProvider source={source}>{children}</DataProvider></MemoryRouter>));
}

describe('flujos académicos en la interfaz', () => {
  it('muestra el avance propio y cambia al avance de la otra cuenta simulada', async () => {
    const id = source.getSnapshot().assignments[0]!.id;
    await show(<ProgressControl kind="assignment" id={id} />);
    expect((container.querySelector('select') as HTMLSelectElement).value).toBe('pending');
    await act(async () => source.setProgress('assignment', id, 'done'));
    expect((container.querySelector('select') as HTMLSelectElement).value).toBe('done');
    expect(container.textContent).toContain('Solo tú puedes verlo');
    await act(async () => source.setViewer('demo-4'));
    expect((container.querySelector('select') as HTMLSelectElement).value).toBe('pending');
  });

  it('ofrece revisión a otro compañero y deja de mostrarla como vigente después de editar', async () => {
    const work = source.getSnapshot().works.find((w) => w.authorIds.includes('demo-1'))!;
    source.saveWorkVersion(work.id, { title: work.title, topic: '', description: 'Versión lista', status: 'final' }, work.version);
    function CurrentWork() { const data = useSnapshot(); return <WorkHistoryAndReview work={data.works.find((w) => w.id === work.id)!} />; }
    await show(<CurrentWork />);
    expect(container.textContent).not.toContain('Aprobar esta versión');
    await act(async () => source.setViewer('demo-4'));
    expect(container.textContent).toContain('Aprobar esta versión');
    await act(async () => source.reviewWork(work.id, source.getSnapshot().works.find((w) => w.id === work.id)!.version, 'Comprobé el ejemplo y funciona.'));
    expect(container.textContent).toContain('Revisado');
    expect(container.textContent).toContain('Comprobé el ejemplo y funciona.');
    await act(async () => {
      source.setViewer('demo-1');
      const current = source.getSnapshot().works.find((w) => w.id === work.id)!;
      source.saveWorkVersion(work.id, { title: current.title, topic: '', description: 'Contenido cambiado', status: 'final' }, current.version);
    });
    expect(container.querySelector('.academic-history > p .badge')?.textContent).toBe('Final');
    expect(container.textContent).toContain('Comprobé el ejemplo y funciona.');
  });

  it('restaura la fecha de una consigna con el botón del historial completo', async () => {
    const assignment = source.getSnapshot().assignments[0]!;
    const before = assignment.dueDate;
    source.updateAssignment(assignment.id, { ...assignment, dueDate: '2026-12-21', instructions: 'Cambio de fecha' }, assignment.version);
    function CurrentHistory() { const page = useSnapshot().assignments.find((a) => a.id === assignment.id)!; return <PageHistory kind="assignment" id={page.id} version={page.version} />; }
    await show(<CurrentHistory />);
    const restore = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Restaurar esta versión completa')!;
    expect(restore).toBeTruthy();
    await act(async () => { restore.click(); });
    const restored = source.getSnapshot().assignments.find((a) => a.id === assignment.id)!;
    expect(restored.dueDate).toBe(before);
    expect(restored.version).toBe(assignment.version + 2);
  });
});


describe('concurrencia y recuperación de la interfaz', () => {
  it('no sobrescribe vínculos que cambiaron después de abrir el editor', async () => {
    const id = source.getSnapshot().activities[0]!.id;
    function CurrentRelations() { const activity = useSnapshot().activities.find((a) => a.id === id)!; return <ActivityRelations activityId={id} version={activity.version} />; }
    await show(<CurrentRelations />);
    const open = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Elegir tareas y notas')!;
    await act(async () => { open.click(); });
    const base = source.getSnapshot().activities.find((a) => a.id === id)!.version;
    await act(async () => source.saveActivityLinks(id, [], [], base));
    const save = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Guardar relaciones')!;
    await act(async () => { save.click(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/cambi|actualiza|versión/i);
    expect(source.getSnapshot().activities.find((a) => a.id === id)!.version).toBe(base + 1);
  });

  it('reintenta el mismo objeto File con su versión original tras una respuesta incierta', async () => {
    const work = source.getSnapshot().works.find((w) => w.authorIds.includes('demo-1'))!;
    const transfer = vi.spyOn(source, 'attachResourceFile').mockRejectedValueOnce(new Error('No pudimos confirmar el archivo')).mockResolvedValueOnce('confirmed-file');
    await show(<ResourceSection kind="work" id={work.id} version={work.version} canEdit />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hola'], 'ejemplo.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Reintentar archivos pendientes')!;
    expect(retry).toBeTruthy();
    await act(async () => { retry.click(); });
    expect(transfer).toHaveBeenCalledTimes(2);
    expect(transfer.mock.calls[0]![2]).toBe(file);
    expect(transfer.mock.calls[1]![2]).toBe(file);
    expect(transfer.mock.calls.map((args) => args[3])).toEqual([work.version, work.version]);
    expect(container.textContent).not.toContain('Quedan por confirmar:');
  });
});
