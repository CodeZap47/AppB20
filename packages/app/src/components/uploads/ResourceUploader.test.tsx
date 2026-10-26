// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../../data/DataContext';
import { createDemoState, DemoDataSource } from '../../data/demo';
import { AttachmentUploader, useResourceUploadQueue, type ResourceUploadQueue } from './ResourceUploader';

let container: HTMLDivElement;
let root: Root;
let source: DemoDataSource;
let queue: ResourceUploadQueue;
let workId: string;

function Harness() {
  queue = useResourceUploadQueue();
  return <AttachmentUploader queue={queue} />;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (failure: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  source = new DemoDataSource(createDemoState(), 'demo-1');
  const assignment = source.getSnapshot().assignments[0]!;
  workId = await source.publishWork({ assignmentId: assignment.id, title: 'Trabajo de prueba', description: '', coauthorIds: [], status: 'draft' });
  await act(async () => root.render(<DataProvider source={source}><Harness /></DataProvider>));
});

afterEach(async () => {
  await act(async () => root.unmount()); source.dispose(); container.remove(); vi.restoreAllMocks();
});

const version = () => source.getSnapshot().works.find((work) => work.id === workId)!.version;
async function add(...files: File[]) { await act(async () => queue.addFiles(files)); }
async function upload(expectedVersion = 1) {
  let result = false;
  await act(async () => { result = await queue.upload('work', workId, expectedVersion); });
  return result;
}

describe('cola de archivos', () => {
  it('distingue preparación, progreso y confirmación; completa solo después de recibir el ID', async () => {
    const completion = deferred<string>();
    let progress!: (done: number, total: number) => void;
    vi.spyOn(source, 'attachResourceFile').mockImplementation(async (_kind, _id, _file, _version, transfer) => {
      progress = transfer!.onProgress!;
      return completion.promise;
    });
    const file = new File(['abcd'], 'documento.pdf');
    await add(file);
    let result!: Promise<boolean>;
    await act(async () => { result = queue.upload('work', workId, 1); });
    expect(queue.busy).toBe(true);
    expect(queue.items[0]?.state).toBe('preparing');
    await act(async () => progress(2, 4));
    expect(queue.items[0]?.state).toBe('uploading');
    expect(queue.items[0]?.progress).toBe(50);
    await act(async () => progress(4, 4));
    expect(queue.items[0]?.state).toBe('confirming');
    expect(container.querySelector('[data-upload-state="complete"]')).toBeNull();
    await act(async () => { completion.resolve('archivo-confirmado'); expect(await result).toBe(true); });
    expect(queue.items[0]).toMatchObject({ state: 'complete', progress: 100, fileId: 'archivo-confirmado' });
    expect(queue.busy).toBe(false);
  });

  it('reintenta el File original con la misma versión y conserva los anteriores ya confirmados', async () => {
    const first = new File(['uno'], 'primero.pdf');
    const second = new File(['dos'], 'segundo.png');
    const original = source.attachResourceFile.bind(source);
    const transfer = vi.spyOn(source, 'attachResourceFile').mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('Sin conexión')).mockImplementation(original);
    await add(first, second);
    expect(await upload()).toBe(false);
    expect(queue.items.map((item) => item.state)).toEqual(['complete', 'failed']);
    expect(queue.pendingCount).toBe(1);
    expect(await upload()).toBe(true);
    expect(transfer.mock.calls.map((args) => args[2])).toEqual([first, second, second]);
    expect(transfer.mock.calls[2]![2]).toBe(second);
    expect(transfer.mock.calls.map((args) => args[3])).toEqual([1, 2, 2]);
    expect(version()).toBe(3);
    expect(source.getSnapshot().resourceFiles.filter((file) => file.targetId === workId)).toHaveLength(2);
  });

  it('conserva un intento fallido si no se confirma que puede descartarse', async () => {
    const file = new File(['documento'], 'incierto.pdf');
    vi.spyOn(source, 'attachResourceFile').mockRejectedValue(new Error('Confirmación perdida'));
    const discard = vi.spyOn(source, 'discardResourceUpload').mockRejectedValueOnce(new Error('Cancelación sin confirmar')).mockResolvedValueOnce(undefined);
    const remove = vi.spyOn(source, 'removeResourceFile');
    await add(file);
    expect(await upload()).toBe(false);
    const id = queue.items[0]!.id;
    await act(async () => queue.remove(id));
    expect(discard).toHaveBeenCalledWith('work', workId, file);
    expect(queue.items).toHaveLength(1);
    expect(queue.error).toBe('Cancelación sin confirmar');
    expect(remove).not.toHaveBeenCalled();
    await act(async () => queue.remove(id));
    expect(queue.items).toHaveLength(0);
    expect(discard.mock.calls[1]![2]).toBe(file);
  });

  it('reconcilia un intento ready al quitarlo y conserva la versión para el siguiente archivo', async () => {
    const first = new File(['uno'], 'confirmado.pdf');
    const second = new File(['dos'], 'siguiente.pdf');
    const original = source.attachResourceFile.bind(source);
    let confirmedId = '';
    const transfer = vi.spyOn(source, 'attachResourceFile').mockImplementationOnce(async (...args) => {
      confirmedId = await original(...args);
      throw new Error('Confirmación perdida');
    }).mockImplementation(original);
    const discard = vi.spyOn(source, 'discardResourceUpload').mockImplementation(async () => confirmedId);
    const remove = vi.spyOn(source, 'removeResourceFile');
    await add(first);
    expect(await upload()).toBe(false);
    await act(async () => queue.remove(queue.items[0]!.id));
    expect(discard).toHaveBeenCalledWith('work', workId, first);
    expect(remove).toHaveBeenCalledWith(confirmedId, 2);
    expect(version()).toBe(3);
    await add(second);
    expect(await upload(1)).toBe(true);
    expect(transfer.mock.calls[1]![3]).toBe(3);
    expect(source.getSnapshot().resourceFiles.find((file) => file.id === confirmedId)?.removedAt).toBeDefined();
    expect(version()).toBe(4);
  });

  it.each(['retirar', 'editar'] as const)('toma la versión vigente para otro lote después de %s fuera de la cola', async (action) => {
    const transfer = vi.spyOn(source, 'attachResourceFile');
    await add(new File(['uno'], 'primero.pdf'));
    expect(await upload()).toBe(true);
    const fileId = queue.items[0]!.fileId!;
    await act(async () => {
      if (action === 'retirar') source.removeResourceFile(fileId, version());
      else {
        const work = source.getSnapshot().works.find((item) => item.id === workId)!;
        source.saveWorkVersion(workId, { title: work.title, topic: work.topic ?? '', description: 'Texto revisado', status: 'draft' }, work.version);
      }
    });
    const current = version();
    await add(new File(['dos'], 'segundo.pdf'));
    expect(await upload(current)).toBe(true);
    expect(transfer.mock.calls[1]![3]).toBe(current);
    expect(version()).toBe(current + 1);
  });

  it('recupera un archivo ya confirmado con versión anterior sin adelantar la del archivo siguiente', async () => {
    const first = new File(['uno'], 'recuperado.pdf');
    const second = new File(['dos'], 'nuevo.pdf');
    const original = source.attachResourceFile.bind(source);
    let existingId = '';
    await act(async () => { existingId = await original('work', workId, first, 1); });
    const transfer = vi.spyOn(source, 'attachResourceFile').mockImplementation(async (kind, id, file, expected, options) => {
      if (file === first) return existingId;
      return original(kind, id, file, expected, options);
    });
    await add(first, second);
    expect(await upload(version())).toBe(true);
    expect(transfer.mock.calls.map((args) => args[3])).toEqual([2, 2]);
    expect(source.getSnapshot().resourceFiles.filter((file) => file.targetId === workId)).toHaveLength(2);
    expect(version()).toBe(3);
  });

  it('comparte el envío en curso solo para el mismo destino y rechaza otro destino', async () => {
    const completion = deferred<string>();
    const transfer = vi.spyOn(source, 'attachResourceFile').mockImplementation(async () => completion.promise);
    const discard = vi.spyOn(source, 'discardResourceUpload');
    await add(new File(['uno'], 'documento.pdf'));
    let first!: Promise<boolean>;
    let duplicate!: Promise<boolean>;
    let other!: Promise<boolean>;
    await act(async () => {
      first = queue.upload('work', workId, 1);
      duplicate = queue.upload('work', workId, 1);
      other = queue.upload('assignment', source.getSnapshot().assignments[0]!.id, 1);
      void queue.remove(queue.items[0]!.id);
    });
    expect(duplicate).toBe(first);
    expect(other).not.toBe(first);
    expect(await other).toBe(false);
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(discard).not.toHaveBeenCalled();
    await act(async () => { completion.resolve('archivo-confirmado'); expect(await first).toBe(true); });
  });

  it('reconcilia los intentos fallidos antes de quitar un completado y actualiza la versión pendiente', async () => {
    const first = new File(['uno'], 'confirmado.pdf');
    const second = new File(['dos'], 'pendiente.pdf');
    const original = source.attachResourceFile.bind(source);
    const transfer = vi.spyOn(source, 'attachResourceFile').mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('Confirmación perdida')).mockImplementation(original);
    const discard = vi.spyOn(source, 'discardResourceUpload').mockResolvedValue(undefined);
    await add(first, second);
    expect(await upload()).toBe(false);
    await act(async () => queue.remove(queue.items[0]!.id));
    expect(discard).toHaveBeenCalledWith('work', workId, second);
    expect(version()).toBe(3);
    expect(await upload(1)).toBe(true);
    expect(transfer.mock.calls.map((args) => args[3])).toEqual([1, 2, 3]);
    expect(transfer.mock.calls[2]![2]).toBe(second);
    expect(version()).toBe(4);
  });

  it('mantiene el completado cuando otro intento no se puede reconciliar antes de quitarlo', async () => {
    const original = source.attachResourceFile.bind(source);
    vi.spyOn(source, 'attachResourceFile').mockImplementationOnce(original).mockRejectedValueOnce(new Error('Confirmación perdida'));
    vi.spyOn(source, 'discardResourceUpload').mockRejectedValue(new Error('No se pudo consultar el intento pendiente'));
    const remove = vi.spyOn(source, 'removeResourceFile');
    await add(new File(['uno'], 'confirmado.pdf'), new File(['dos'], 'pendiente.pdf'));
    expect(await upload()).toBe(false);
    const firstId = queue.items[0]!.id;
    await act(async () => queue.remove(firstId));
    expect(remove).not.toHaveBeenCalled();
    expect(queue.items).toHaveLength(2);
    expect(queue.items[0]).toMatchObject({ id: firstId, state: 'complete' });
    expect(queue.error).toContain('No se pudo consultar');
    expect(version()).toBe(2);
  });

  it('cancela y separa la cola al cambiar de cuenta, ignorando una confirmación tardía', async () => {
    const completion = deferred<string>();
    let signal: AbortSignal | undefined;
    vi.spyOn(source, 'attachResourceFile').mockImplementation(async (_kind, _id, _file, _version, options) => {
      signal = options?.signal;
      return completion.promise;
    });
    await add(new File(['uno'], 'cuenta-anterior.pdf'));
    let uploadResult!: Promise<boolean>;
    await act(async () => { uploadResult = queue.upload('work', workId, 1); });
    await act(async () => source.setViewer('demo-2'));
    expect(signal?.aborted).toBe(true);
    expect(queue.items).toHaveLength(0);
    await add(new File(['dos'], 'cuenta-nueva.pdf'));
    await act(async () => { completion.resolve('confirmado-tarde'); expect(await uploadResult).toBe(false); });
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({ name: 'cuenta-nueva.pdf', state: 'selected' });
    expect(queue.busy).toBe(false);
  });

  it('no bloquea la cuenta nueva por un descarte pendiente de la cuenta anterior', async () => {
    const discarded = deferred<string | undefined>();
    vi.spyOn(source, 'attachResourceFile').mockRejectedValue(new Error('Confirmación perdida'));
    vi.spyOn(source, 'discardResourceUpload').mockImplementation(async () => discarded.promise);
    await add(new File(['uno'], 'cuenta-anterior.pdf'));
    expect(await upload()).toBe(false);
    let removal!: Promise<void>;
    await act(async () => { removal = queue.remove(queue.items[0]!.id); });
    expect(queue.busy).toBe(true);
    await act(async () => source.setViewer('demo-2'));
    await add(new File(['dos'], 'cuenta-nueva.pdf'));
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]?.name).toBe('cuenta-nueva.pdf');
    await act(async () => { discarded.resolve(undefined); await removal; });
    expect(queue.items[0]?.name).toBe('cuenta-nueva.pdf');
    expect(queue.busy).toBe(false);
  });

  it('aborta al desmontarse y no confirma la cola anterior después de salir', async () => {
    const completion = deferred<string>();
    let signal: AbortSignal | undefined;
    vi.spyOn(source, 'attachResourceFile').mockImplementation(async (_kind, _id, _file, _version, options) => {
      signal = options?.signal;
      return completion.promise;
    });
    await add(new File(['uno'], 'anterior.pdf'));
    let uploadResult!: Promise<boolean>;
    await act(async () => { uploadResult = queue.upload('work', workId, 1); });
    await act(async () => root.render(<p>Otra página</p>));
    expect(signal?.aborted).toBe(true);
    await act(async () => { completion.resolve('confirmado-tarde'); expect(await uploadResult).toBe(false); });
    expect(container.textContent).toBe('Otra página');
  });
});
