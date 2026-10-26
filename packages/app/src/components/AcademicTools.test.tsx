// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider, useSnapshot } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { ActivityRelations, PageHistory, ProgressControl, ResourceSection, ResourceDownloads, WorkHistoryAndReview } from './AcademicTools';

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

describe('selector compacto de recursos', () => {
  it.each([false, true])('conserva descargas y permisos con el selector compacto: %s', async (compactUpload) => {
    const work = source.getSnapshot().works.find((item) => item.authorIds.includes('demo-1'))!;
    await source.attachResourceFile('work', work.id, new File(['datos'], 'disponible.txt'), work.version);
    const current = source.getSnapshot().works.find((item) => item.id === work.id)!;
    await show(<ResourceSection kind="work" id={work.id} version={current.version} canEdit compactUpload={compactUpload} />);
    const picker = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const upload = container.querySelector<HTMLDetailsElement>('.academic-resources__upload');
    const download = container.querySelector('.academic-file-name')!;
    expect(download.textContent).toBe('disponible.txt');
    expect(download.closest('details')).toBeNull();
    if (compactUpload) {
      expect(upload?.open).toBe(false);
      expect(upload?.querySelector('summary')?.textContent).toBe('Adjuntar archivos');
      expect(upload?.contains(picker)).toBe(true);
      expect(upload?.textContent).toContain('Los archivos de versiones anteriores se conservan en el historial.');
      await act(async () => upload!.querySelector('summary')!.click());
      expect(upload?.open).toBe(true);
    } else {
      expect(upload).toBeNull();
      expect(picker.closest('details')).toBeNull();
    }
    await show(<ResourceSection kind="work" id={work.id} version={current.version} canEdit={false} compactUpload={compactUpload} />);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('.academic-resources__upload')).toBeNull();
    expect(container.querySelector('.academic-file-name')?.textContent).toBe('disponible.txt');
  });

  it('muestra el selector desplegado cuando no se solicita el modo compacto', async () => {
    const work = source.getSnapshot().works.find((item) => item.authorIds.includes('demo-1'))!;
    await show(<ResourceSection kind="work" id={work.id} version={work.version} canEdit />);
    expect(container.querySelector('input[type="file"]')?.closest('details')).toBeNull();
    expect(container.querySelector('.academic-resources__upload')).toBeNull();
    expect(container.textContent).toContain('Los archivos de versiones anteriores se conservan en el historial.');
  });

  it('mantiene progreso, errores y reintentos accesibles al colapsar el selector', async () => {
    const work = source.getSnapshot().works.find((item) => item.authorIds.includes('demo-1'))!;
    let fail!: (error: Error) => void;
    const transfer = vi.spyOn(source, 'attachResourceFile').mockImplementationOnce(async (_kind, _id, file, _version, options) => {
      options?.onProgress?.(file.size / 2, file.size);
      return new Promise<string>((_resolve, reject) => { fail = reject; });
    }).mockResolvedValueOnce('archivo-confirmado');
    await show(<ResourceSection kind="work" id={work.id} version={work.version} canEdit compactUpload />);
    const upload = container.querySelector<HTMLDetailsElement>('.academic-resources__upload')!;
    await act(async () => upload.querySelector('summary')!.click());
    const file = new File(['datos'], 'pendiente.txt');
    const input = upload.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await act(async () => upload.querySelector('summary')!.click());
    expect(upload.open).toBe(false);
    const progress = container.querySelector('[role="progressbar"]')!;
    expect(progress.getAttribute('aria-valuenow')).toBe('50');
    expect(progress.closest('details')).toBeNull();
    expect(container.querySelector('button[aria-label="Cancelar pendiente.txt"]')?.closest('details')).toBeNull();
    await act(async () => fail(new Error('No pudimos confirmar el archivo')));
    const alerts = [...container.querySelectorAll('[role="alert"]')];
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every((alert) => alert.closest('details') === null)).toBe(true);
    expect(alerts.some((alert) => alert.textContent?.includes('No pudimos confirmar el archivo'))).toBe(true);
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Reintentar archivos pendientes')!;
    expect(retry.closest('details')).toBeNull();
    expect(container.querySelector('[data-upload-state="failed"]')?.closest('details')).toBeNull();
    await act(async () => retry.click());
    expect(transfer).toHaveBeenCalledTimes(2);
    expect(transfer.mock.calls[1]![2]).toBe(file);
    expect(transfer.mock.calls.map((args) => args[3])).toEqual([work.version, work.version]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain('Reintentar archivos pendientes');
    expect(upload.open).toBe(false);
  });

  it('mantiene los rechazos de validación fuera del selector y los limpia al volver a elegir', async () => {
    const work = source.getSnapshot().works.find((item) => item.authorIds.includes('demo-1'))!;
    const transfer = vi.spyOn(source, 'attachResourceFile');
    await show(<ResourceSection kind="work" id={work.id} version={work.version} canEdit compactUpload />);
    const upload = container.querySelector<HTMLDetailsElement>('.academic-resources__upload')!;
    await act(async () => upload.querySelector('summary')!.click());
    const input = upload.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File([], 'vacio.txt')], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await act(async () => upload.querySelector('summary')!.click());
    expect(upload.open).toBe(false);
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('«vacio.txt» está vacío.');
    expect(alert.closest('details')).toBeNull();
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(transfer).not.toHaveBeenCalled();
    await act(async () => upload.querySelector('summary')!.click());
    Object.defineProperty(input, 'files', { value: [new File(['datos'], 'valido.txt')], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(transfer).toHaveBeenCalledTimes(1);
  });
});


describe('concurrencia y recuperación de la interfaz', () => {
  it('no vuelve a mostrar como completado un archivo de la cola después de retirarlo', async () => {
    const work = source.getSnapshot().works.find((item) => item.authorIds.includes('demo-1'))!;
    function CurrentResources() {
      const current = useSnapshot().works.find((item) => item.id === work.id)!;
      return <ResourceSection kind="work" id={work.id} version={current.version} canEdit />;
    }
    await show(<CurrentResources />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['documento'], 'nuevo-que-se-retira.pdf');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    const stored = source.getSnapshot().resourceFiles.find((item) => item.targetId === work.id && item.name === file.name)!;
    expect(stored).toBeDefined();
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Quitar nuevo-que-se-retira.pdf"]')!;
    expect(remove.disabled).toBe(false);
    await act(async () => remove.click());
    expect(source.getSnapshot().resourceFiles.find((item) => item.id === stored.id)?.removedAt).toBeDefined();
    expect(container.textContent).not.toContain(file.name);
    expect(container.querySelector('[data-upload-state="complete"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Quitar nuevo-que-se-retira.pdf"]')).toBeNull();
  });

  it('bloquea quitar y restaurar adjuntos existentes mientras otro archivo sigue incierto', async () => {
    const activity = source.getSnapshot().activities[0]!;
    const evidenceId = source.addEvidence(activity.id, 'Resultado', []);
    const oldId = await source.attachResourceFile('evidence', evidenceId, new File(['anterior'], 'retirado.txt'), 1);
    source.removeResourceFile(oldId, 2);
    await source.attachResourceFile('evidence', evidenceId, new File(['actual'], 'activo.txt'), 3);
    vi.spyOn(source, 'attachResourceFile').mockRejectedValueOnce(new Error('Confirmación incierta'));
    const removeResource = vi.spyOn(source, 'removeResourceFile');
    const restoreResource = vi.spyOn(source, 'restoreResourceFile');
    function CurrentEvidence() {
      const data = useSnapshot();
      const evidence = data.evidences.find((item) => item.id === evidenceId)!;
      return <ResourceSection kind="evidence" id={evidenceId} version={evidence.version ?? 1} canEdit />;
    }
    await show(<CurrentEvidence />);
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Quitar activo.txt"]')!;
    const restore = container.querySelector<HTMLButtonElement>('button[aria-label="Restaurar retirado.txt"]')!;
    expect(remove.disabled).toBe(false);
    expect(restore.disabled).toBe(false);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['pendiente'], 'incierto.pdf')], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(remove.disabled).toBe(true);
    expect(restore.disabled).toBe(true);
    expect(input.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('.academic-file-name')?.disabled).toBe(false);
    await act(async () => { remove.click(); restore.click(); });
    expect(removeResource).not.toHaveBeenCalled();
    expect(restoreResource).not.toHaveBeenCalled();
    const discard = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Descartar pendientes')!;
    await act(async () => discard.click());
    expect(remove.disabled).toBe(false);
    expect(restore.disabled).toBe(false);
    expect(input.disabled).toBe(false);
  });

  it('descarta la cola anterior cuando cambia el destino de los adjuntos', async () => {
    const work = source.getSnapshot().works.find((w) => w.authorIds.includes('demo-1'))!;
    const nextId = source.publishWork({ assignmentId: work.assignmentId, title: 'Otro trabajo', description: '', coauthorIds: [] });
    const transfer = vi.spyOn(source, 'attachResourceFile').mockRejectedValueOnce(new Error('Sin conexión')).mockResolvedValueOnce('nuevo-adjunto');
    await show(<ResourceSection kind="work" id={work.id} version={work.version} canEdit />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const first = new File(['uno'], 'anterior.txt');
    Object.defineProperty(input, 'files', { value: [first], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(container.textContent).toContain('Reintentar archivos pendientes');
    await show(<ResourceSection kind="work" id={nextId} version={1} canEdit />);
    expect(container.textContent).not.toContain('Reintentar archivos pendientes');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    const nextInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(nextInput.disabled).toBe(false);
    const second = new File(['dos'], 'nuevo.txt');
    Object.defineProperty(nextInput, 'files', { value: [second], configurable: true });
    await act(async () => nextInput.dispatchEvent(new Event('change', { bubbles: true })));
    expect(transfer.mock.calls.map((args) => [args[1], args[2]])).toEqual([[work.id, first], [nextId, second]]);
  });

  it('corta el lote anterior al cambiar de destino aunque su primera confirmación llegue tarde', async () => {
    const work = source.getSnapshot().works.find((w) => w.authorIds.includes('demo-1'))!;
    let finish: ((id: string) => void) | undefined;
    let signal: AbortSignal | undefined;
    const transfer = vi.spyOn(source, 'attachResourceFile').mockImplementation(async (_kind, _id, _file, _version, options) => {
      signal = options?.signal;
      return new Promise<string>((resolve) => { finish = resolve; });
    });
    await show(<ResourceSection kind="work" id={work.id} version={work.version} canEdit />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['uno'], 'primero.txt'), new File(['dos'], 'segundo.txt')], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await show(<ResourceSection kind="assignment" id={work.assignmentId} version={1} canEdit />);
    expect(signal?.aborted).toBe(true);
    await act(async () => finish!('confirmado-antes-de-cancelar'));
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('Reintentar archivos pendientes');
    expect(container.textContent).not.toContain('Subiendo primero.txt');
  });

  it.each([false, true])('reanuda un lote con confirmación perdida sin duplicar la versión (edición externa: %s)', async (editedByCoauthor) => {
    const work = source.getSnapshot().works.find((w) => w.authorIds.includes('demo-1'))!;
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
    function CurrentResources() {
      const current = useSnapshot().works.find((w) => w.id === work.id)!;
      return <ResourceSection kind="work" id={work.id} version={current.version} canEdit />;
    }
    await show(<CurrentResources />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['uno'], 'primero.txt'), new File(['dos'], 'segundo.txt')], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(source.getSnapshot().works.find((w) => w.id === work.id)!.version).toBe(work.version + 1);
    if (editedByCoauthor) {
      await act(async () => {
        const current = source.getSnapshot().works.find((w) => w.id === work.id)!;
        source.saveWorkVersion(work.id, { title: current.title, topic: '', description: 'Cambio simultáneo del equipo', status: 'draft' }, current.version);
      });
    }
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Reintentar archivos pendientes')!;
    await act(async () => retry.click());
    expect(transfer.mock.calls.map((args) => args[3])).toEqual([work.version, work.version, work.version + 1]);
    const snapshot = source.getSnapshot();
    const current = snapshot.works.find((w) => w.id === work.id)!;
    expect(snapshot.resourceFiles.filter((f) => f.targetId === work.id && f.name === 'primero.txt')).toHaveLength(1);
    if (editedByCoauthor) {
      expect(snapshot.resourceFiles.some((f) => f.targetId === work.id && f.name === 'segundo.txt')).toBe(false);
      expect(current.description).toBe('Cambio simultáneo del equipo');
      expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/cambi|actualiza|versión/i);
    } else {
      expect(snapshot.resourceFiles.filter((f) => f.targetId === work.id && f.name === 'segundo.txt')).toHaveLength(1);
      expect(container.textContent).not.toContain('Reintentar archivos pendientes');
    }
    expect(current.version).toBe(work.version + 2);
  });

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


describe('transferencias y recuperación de evidencias', () => {
  it('muestra progreso por archivo y conserva el archivo cancelado para reintentar', async () => {
    const work = source.getSnapshot().works.find((item) => item.authorIds.includes('demo-1'))!;
    let signal: AbortSignal | undefined;
    vi.spyOn(source, 'attachResourceFile').mockImplementation(async (_kind, _id, file, _version, transfer) => {
      signal = transfer?.signal;
      transfer?.onProgress?.(file.size / 2, file.size);
      return new Promise<string>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('Cancelaste la transferencia.', 'AbortError'))));
    });
    await show(<ResourceSection kind="work" id={work.id} version={work.version} canEdit />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['hola'], 'ejemplo.txt')], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    const cancel = container.querySelector<HTMLButtonElement>('button[aria-label="Cancelar ejemplo.txt"]')!;
    await act(async () => cancel.click());
    expect(signal?.aborted).toBe(true);
    expect(container.textContent).toContain('Reintentar archivos pendientes');
    expect(container.querySelector('[data-upload-state="cancelled"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Reintentar ejemplo.txt"]')).not.toBeNull();
  });

  it('permite cancelar descargas sin crear un enlace parcial', async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(source, 'downloadResourceFile').mockImplementation(async (_id, transfer) => {
      signal = transfer?.signal;
      transfer?.onProgress?.(2, 4);
      return new Promise<Blob>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('Cancelaste la transferencia.', 'AbortError'))));
    });
    await show(<ResourceDownloads files={[{ id: 'file', targetKind: 'work', targetId: '1', name: 'datos.txt', size: 4,
      contentType: 'text/plain', uploadedBy: 'demo-1', createdAt: new Date() }]} />);
    await act(async () => container.querySelector<HTMLButtonElement>('.academic-file-name')!.click());
    expect(container.textContent).toContain('50 %');
    await act(async () => [...container.querySelectorAll('button')].find((item) => item.textContent === 'Cancelar descarga')!.click());
    expect(signal?.aborted).toBe(true);
    expect(container.querySelector('a[download]')).toBeNull();
  });

  it('ofrece archivos retirados de evidencia y restaura el mismo adjunto versionando la evidencia', async () => {
    const activity = source.getSnapshot().activities[0]!;
    const evidenceId = source.addEvidence(activity.id, 'Resultado', []);
    const fileId = await source.attachResourceFile('evidence', evidenceId, new File(['datos'], 'retirado.txt'), 1);
    source.removeResourceFile(fileId, 2);
    function CurrentEvidence() {
      const data = useSnapshot();
      const evidence = data.evidences.find((item) => item.id === evidenceId)!;
      return <ResourceSection kind="evidence" id={evidenceId} version={evidence.version ?? 1} canEdit={data.me?.id === evidence.authorId} />;
    }
    await show(<CurrentEvidence />);
    expect(container.textContent).toContain('Archivos retirados (1)');
    expect(container.querySelector('.academic-file-name')?.textContent).toBe('retirado.txt');
    await act(async () => [...container.querySelectorAll('button')].find((item) => item.textContent === 'Restaurar adjunto')!.click());
    expect(source.getSnapshot().resourceFiles.find((item) => item.id === fileId)?.removedAt).toBeUndefined();
    expect(source.getSnapshot().evidences.find((item) => item.id === evidenceId)?.version).toBe(4);
    expect(container.textContent).not.toContain('Archivos retirados');
    await act(async () => { source.removeResourceFile(fileId, 4); source.setViewer('demo-4'); });
    expect(container.textContent).toContain('Archivos retirados (1)');
    expect(container.textContent).not.toContain('Restaurar adjunto');
  });
});
