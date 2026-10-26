// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExamActionRequest, ExamSummary } from '@b20/core';
import { DataProvider } from '../../data/DataContext';
import type { DataSource, Snapshot } from '../../data/types';
import { useSharedFeedExams } from './useSharedFeedExams';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const sharedExam: ExamSummary = { id: 'exam-public', revision: 1, title: 'Versión compartida', subjectId: '1', ownerId: 'member-a',
  visibility: 'group', archived: false, readyVersion: 1, questionCount: 2, topics: ['Ciclos'], createdAt: 100, updatedAt: 100, canEdit: true, sourceIssues: [] };
function fixture() {
  let snapshot = { connection: 'ready', me: { id: 'member-a', status: 'active' } } as Snapshot;
  const listeners = new Set<() => void>();
  const action = vi.fn<(request: ExamActionRequest) => Promise<ExamSummary[]>>(() => Promise.resolve([]));
  const source = { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); }, examAction: action } as unknown as DataSource;
  const update = (patch: Partial<Snapshot>) => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
  return { source, action, update, get snapshot() { return snapshot; } };
}

let root: Root;
let container: HTMLDivElement;
let result: ReturnType<typeof useSharedFeedExams>;
let visibility: DocumentVisibilityState;
function Harness({ enabled }: { enabled: boolean }) { result = useSharedFeedExams(enabled); return <span>{result.exams.length}</span>; }
async function show(source: DataSource, enabled = true) {
  await act(async () => root.render(<DataProvider source={source}><Harness enabled={enabled} /></DataProvider>));
}
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  visibility = 'visible'; vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('exámenes públicos del feed', () => {
  it('rechaza resúmenes privados, borradores o archivados si el servidor ignora sharedOnly', async () => {
    const f = fixture(); f.action.mockResolvedValueOnce([
      sharedExam, { ...sharedExam, id: 'personal', visibility: 'personal' }, { ...sharedExam, id: 'draft', readyVersion: undefined },
      { ...sharedExam, id: 'owner-draft', draftVersion: 2 }, { ...sharedExam, id: 'archived', archived: true }, { ...sharedExam, id: 'zero', readyVersion: 0 },
    ]);
    await show(f.source); expect(result.exams).toEqual([sharedExam]);
  });

  it('carga resúmenes públicos, agrupa refrescos concurrentes y no depende del snapshot completo', async () => {
    const f = fixture(); const first = deferred<ExamSummary[]>(); const second = deferred<ExamSummary[]>();
    f.action.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await show(f.source); expect(result.loading).toBe(true);
    expect(f.action).toHaveBeenCalledExactlyOnceWith({ action: 'listExams', sharedOnly: true });
    await act(async () => { result.refresh(); window.dispatchEvent(new Event('focus')); vi.advanceTimersByTime(30_000); });
    expect(f.action).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve([sharedExam])); expect(result.exams).toEqual([sharedExam]); expect(result.loading).toBe(false);
    await act(async () => f.update({ members: [] })); expect(f.action).toHaveBeenCalledTimes(1); expect(result.exams).toEqual([sharedExam]);
    await act(async () => vi.advanceTimersByTime(15_000)); expect(f.action).toHaveBeenCalledTimes(2);
    await act(async () => { window.dispatchEvent(new Event('focus')); result.refresh(); }); expect(f.action).toHaveBeenCalledTimes(2);
    await act(async () => second.reject(new Error('sin conexión')));
    expect(result.exams).toEqual([]); expect(result.loading).toBe(false); expect(result.error).toContain('No se pudieron actualizar');
    await act(async () => result.refresh()); expect(f.action).toHaveBeenCalledTimes(3); expect(result.error).toBe('');
  });

  it('pausa peticiones ocultas y actualiza al volver a ser visible o recuperar el foco', async () => {
    const f = fixture(); visibility = 'hidden';
    await show(f.source);
    await act(async () => { window.dispatchEvent(new Event('focus')); result.refresh(); vi.advanceTimersByTime(45_000); });
    expect(f.action).not.toHaveBeenCalled();
    await act(async () => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
    expect(f.action).toHaveBeenCalledTimes(1);
    await act(async () => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(30_000); });
    expect(f.action).toHaveBeenCalledTimes(1);
    await act(async () => { visibility = 'visible'; window.dispatchEvent(new Event('focus')); });
    expect(f.action).toHaveBeenCalledTimes(2);
  });

  it('invalida inmediatamente permisos de fuentes y espera la lectura anterior antes de volver a consultar', async () => {
    const f = fixture(); const firstLate = deferred<ExamSummary[]>(); const currentRead = deferred<ExamSummary[]>();
    const note: Snapshot['notes'][number] = { id: 'note', subjectId: '1', authorId: 'member-a', visibility: 'group', title: 'Nota', topic: 'Ciclos', body: 'Texto', tags: [], source: 'student', version: 1, createdAt: new Date(100), updatedAt: new Date(100) };
    f.update({ notes: [note, { ...note, id: 'other' }] });
    f.action.mockResolvedValueOnce([sharedExam]).mockReturnValueOnce(firstLate.promise).mockReturnValueOnce(currentRead.promise);
    await show(f.source);
    // Reordering and content edits keep access unchanged and must not trigger requests.
    await act(async () => f.update({ notes: [{ ...note, id: 'other', title: 'Editada', body: 'Nuevo texto', version: 2 }, note] }));
    expect(f.action).toHaveBeenCalledTimes(1); expect(result.exams).toEqual([sharedExam]);
    await act(async () => window.dispatchEvent(new Event('focus'))); expect(f.action).toHaveBeenCalledTimes(2);
    await act(async () => f.update({ notes: [note, { ...note, id: 'other', visibility: 'personal' }] }));
    expect(result.exams).toEqual([]); expect(result.loading).toBe(true); expect(f.action).toHaveBeenCalledTimes(2);
    await act(async () => { result.refresh(); window.dispatchEvent(new Event('focus')); vi.advanceTimersByTime(30_000); });
    expect(f.action).toHaveBeenCalledTimes(2);
    await act(async () => firstLate.resolve([{ ...sharedExam, title: 'Lectura antes de retirar permisos' }]));
    expect(f.action).toHaveBeenCalledTimes(3); expect(result.exams).toEqual([]);
    await act(async () => currentRead.resolve([{ ...sharedExam, title: 'Lectura autorizada actual' }]));
    expect(result.exams[0]?.title).toBe('Lectura autorizada actual');
    await act(async () => f.update({ notes: [note] })); expect(f.action).toHaveBeenCalledTimes(4);
  });

  it('no solapa lecturas de una cuenta al volver a ella mientras otra identidad tiene una consulta pendiente', async () => {
    const f = fixture(); const accountA = deferred<ExamSummary[]>(); const accountB = deferred<ExamSummary[]>();
    f.action.mockReturnValueOnce(accountA.promise).mockReturnValueOnce(accountB.promise).mockResolvedValueOnce([{ ...sharedExam, title: 'A actual' }]);
    await show(f.source);
    await act(async () => f.update({ me: { ...f.snapshot.me!, id: 'member-b' } })); expect(f.action).toHaveBeenCalledTimes(2);
    await act(async () => f.update({ me: { ...f.snapshot.me!, id: 'member-a' } })); expect(f.action).toHaveBeenCalledTimes(2);
    await act(async () => accountA.resolve([{ ...sharedExam, title: 'A antigua' }]));
    expect(f.action).toHaveBeenCalledTimes(3); expect(result.exams[0]?.title).toBe('A actual');
    await act(async () => accountB.resolve([{ ...sharedExam, title: 'B antigua' }]));
    expect(result.exams[0]?.title).toBe('A actual');
  });

  it('aísla errores síncronos del transporte sin conservar metadata anterior', async () => {
    const f = fixture(); f.action.mockResolvedValueOnce([sharedExam]).mockImplementationOnce(() => { throw new Error('Transporte cerrado'); });
    await show(f.source); expect(result.exams).toEqual([sharedExam]);
    await act(async () => result.refresh()); expect(result.exams).toEqual([]); expect(result.error).not.toBe(''); expect(result.loading).toBe(false);
  });

  it.each(['cuenta', 'membresía', 'desconexión', 'desactivación', 'fuente'] as const)('limpia metadata y descarta respuestas tardías al cambiar %s', async (transition) => {
    const f = fixture(); const late = deferred<ExamSummary[]>();
    f.action.mockResolvedValueOnce([sharedExam]).mockReturnValueOnce(late.promise);
    await show(f.source); expect(result.exams).toEqual([sharedExam]);
    await act(async () => window.dispatchEvent(new Event('focus'))); expect(f.action).toHaveBeenCalledTimes(2);
    if (transition === 'cuenta') {
      const pending = deferred<ExamSummary[]>(); f.action.mockReturnValueOnce(pending.promise);
      await act(async () => f.update({ me: { ...f.snapshot.me!, id: 'member-b' } }));
    } else if (transition === 'membresía') await act(async () => f.update({ me: { ...f.snapshot.me!, status: 'removed' } }));
    else if (transition === 'desconexión') await act(async () => f.update({ connection: 'offline' }));
    else if (transition === 'desactivación') await show(f.source, false);
    else await show(fixture().source);
    expect(result.exams).toEqual([]); expect(result.error).toBe('');
    await act(async () => late.resolve([{ ...sharedExam, title: 'Respuesta anterior' }]));
    expect(result.exams).toEqual([]);
    if (transition === 'membresía' || transition === 'desconexión') {
      await act(async () => f.update({ connection: 'ready', me: { ...f.snapshot.me!, status: 'active' } }));
      expect(f.action).toHaveBeenCalledTimes(3);
    }
  });

  it('descarta una lectura pendiente después de desmontar', async () => {
    const f = fixture(); const pending = deferred<ExamSummary[]>(); f.action.mockReturnValueOnce(pending.promise);
    await show(f.source);
    await act(async () => root.render(<span>Fuera del feed</span>));
    await act(async () => { pending.resolve([sharedExam]); window.dispatchEvent(new Event('focus')); vi.advanceTimersByTime(30_000); });
    expect(f.action).toHaveBeenCalledTimes(1); expect(container.textContent).toBe('Fuera del feed');
  });
});
