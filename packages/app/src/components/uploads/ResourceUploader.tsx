import { useEffect, useRef, useState } from 'react';
import { fileSizeError } from '@b20/core';
import { useDataSource, useSnapshot } from '../../data/DataContext';
import type { ResourceTargetKind, Snapshot } from '../../data/types';
import { FilePicker } from '../FilePicker';
import { UploadFileList, type UploadFileItem } from './UploadFileList';
import './uploads.css';

interface QueuedFile extends UploadFileItem {
  file: File;
  fileId?: string;
  attempted?: boolean;
  expectedVersion?: number;
}
interface Destination { kind: ResourceTargetKind; id: string; version: number }

export function resourceVersion(data: Snapshot, kind: ResourceTargetKind, id: string): number {
  const rows: readonly { id: string; version?: number }[] = kind === 'assignment' ? data.assignments
    : kind === 'activity' ? data.activities : kind === 'work' ? data.works : kind === 'evidence' ? data.evidences
    : kind === 'note' ? data.notes : kind === 'guide' ? data.guides : kind === 'question' ? data.questions
    : kind === 'answer' ? data.answers : kind === 'group_message' ? data.groupMessages
    : kind === 'direct_message' ? data.directMessages : kind === 'channel_message' ? data.channelMessages : data.memberProfiles;
  return rows.find((row) => row.id === id)?.version ?? 1;
}

/** Una cola por formulario/destino. Un reintento conserva File, versión y recibo originales. */
export function useResourceUploadQueue() {
  const source = useDataSource();
  const actor = useSnapshot().me?.id;
  const [items, setItems] = useState<QueuedFile[]>([]);
  const files = useRef<QueuedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const destination = useRef<Destination | null>(null);
  const controller = useRef<AbortController | null>(null);
  const running = useRef<Promise<boolean> | null>(null);
  const removing = useRef(false);
  const alive = useRef(true);
  const epoch = useRef(0);

  useEffect(() => {
    alive.current = true;
    files.current = []; destination.current = null; running.current = null; removing.current = false;
    setItems([]); setError(null); setBusy(false);
    return () => { alive.current = false; epoch.current++; controller.current?.abort(); };
  }, [source, actor]);

  const publish = () => { if (alive.current) setItems([...files.current]); };
  const change = (id: string, patch: Partial<QueuedFile>) => {
    files.current = files.current.map((file) => file.id === id ? { ...file, ...patch } : file);
    publish();
  };
  const addFiles = (selected: File[]) => {
    if (running.current || removing.current) return;
    setError(null);
    files.current = [...files.current, ...selected.map((file): QueuedFile => ({ id: crypto.randomUUID(), file,
      name: file.name, size: file.size, type: file.type, progress: 0, state: 'selected' }))];
    publish();
  };

  const upload = (kind: ResourceTargetKind, id: string, version?: number): Promise<boolean> => {
    if (destination.current && (destination.current.kind !== kind || destination.current.id !== id)) {
      setError('La cola pertenece a otra publicación. Vuelve a abrir el formulario.');
      return Promise.resolve(false);
    }
    if (running.current) return running.current;
    if (removing.current || !alive.current) return Promise.resolve(false);
    const target = destination.current ?? { kind, id, version: version ?? resourceVersion(source.getSnapshot(), kind, id) };
    if (destination.current && !files.current.some((file) => file.state !== 'complete' && file.attempted)) {
      target.version = Math.max(target.version, version ?? 1, resourceVersion(source.getSnapshot(), kind, id));
    }
    destination.current = target;
    const current = new AbortController(); controller.current = current;
    const generation = epoch.current;
    const valid = () => alive.current && generation === epoch.current && source.getSnapshot().me?.id === actor;
    const task = async () => {
      setBusy(true); setError(null);
      files.current = files.current.map((file) => file.state === 'complete' ? file : { ...file, state: 'queued', error: undefined });
      publish();
      try {
        for (const queued of files.current) {
          if (queued.state === 'complete') continue;
          if (!valid() || current.signal.aborted) return false;
          const problem = fileSizeError(queued.name, queued.size);
          if (problem) { change(queued.id, { state: 'failed', error: problem }); setError(problem); return false; }
          const expected = queued.expectedVersion ?? target.version;
          const existingIds = new Set(source.getSnapshot().resourceFiles.map((file) => file.id));
          let confirmedVersion: number | undefined;
          change(queued.id, { state: 'preparing', error: undefined, expectedVersion: expected, attempted: true });
          try {
            const fileId = await source.attachResourceFile(kind, id, queued.file, expected, { signal: current.signal,
              onConfirmed: (_fileId, resultingVersion) => { confirmedVersion = resultingVersion; },
              onProgress: (done, total) => {
                if (!valid()) return;
                const percent = total > 0 ? Math.round(done / total * 100) : 0;
                change(queued.id, { progress: percent, state: done >= total && total > 0 ? 'confirming' : 'uploading' });
              } });
            if (!valid()) return false;
            change(queued.id, { state: 'complete', progress: 100, fileId, error: undefined });
            // El mismo intento recuperado confirma una sola versión, aunque el snapshot ya avanzara.
            target.version = confirmedVersion ?? (queued.expectedVersion === undefined && existingIds.has(fileId) ? expected : expected + 1);
            if (current.signal.aborted) return false;
          } catch (failure) {
            if (!valid()) return false;
            const cancelled = current.signal.aborted;
            const message = cancelled ? 'Cancelaste la subida. Puedes reintentar el archivo.'
              : failure instanceof Error ? failure.message : `No se pudo subir «${queued.name}».`;
            change(queued.id, { state: cancelled ? 'cancelled' : 'failed', error: message });
            setError(message);
            return false;
          }
        }
        return valid() && !current.signal.aborted;
      } finally {
        if (valid()) { setBusy(false); controller.current = null; }
      }
    };
    const promise = task().finally(() => { if (running.current === promise) running.current = null; });
    running.current = promise;
    return promise;
  };

  const remove = async (id: string) => {
    if (running.current || removing.current) return;
    const file = files.current.find((item) => item.id === id);
    if (!file) return;
    removing.current = true; setBusy(true); setError(null);
    const generation = epoch.current;
    const valid = () => alive.current && generation === epoch.current && source.getSnapshot().me?.id === actor;
    try {
      const target = destination.current;
      let fileId = file.fileId;
      if (!fileId && file.attempted && target) fileId = await source.discardResourceUpload(target.kind, target.id, file.file);
      if (!valid()) return;
      if (fileId && target) {
        change(id, { fileId });
        // Retirar un archivo cambia la versión: primero resuelve otros intentos inciertos.
        for (const other of files.current.filter((item) => item.id !== id && item.attempted && item.state !== 'complete')) {
          const recovered = await source.discardResourceUpload(target.kind, target.id, other.file);
          if (!valid()) return;
          if (recovered) {
            change(other.id, { fileId: recovered, state: 'complete', progress: 100, error: undefined });
            target.version = Math.max(target.version, (other.expectedVersion ?? target.version) + 1);
          } else change(other.id, { attempted: false, expectedVersion: undefined, state: 'selected', error: undefined, progress: 0 });
        }
        const expected = Math.max(target.version, resourceVersion(source.getSnapshot(), target.kind, target.id), (file.expectedVersion ?? 0) + 1);
        await source.removeResourceFile(fileId, expected);
        if (!valid()) return;
        target.version = expected + 1;
      }
      files.current = files.current.filter((item) => item.id !== id); publish();
    } catch (failure) {
      if (valid()) { const message = failure instanceof Error ? failure.message : 'No se pudo quitar el archivo.'; setError(message); change(id, { error: message }); }
    } finally { if (valid()) { removing.current = false; setBusy(false); } }
  };
  const cancel = () => controller.current?.abort();
  const retry = async (_id?: string) => {
    const target = destination.current;
    if (target) return upload(target.kind, target.id, target.version);
    return false;
  };
  const reset = () => {
    if (running.current || removing.current) return;
    files.current = []; destination.current = null; setError(null); publish();
  };
  return { items, addFiles, upload, busy, hasFiles: items.length > 0,
    pendingCount: items.filter((file) => file.state !== 'complete').length, error, remove, retry, cancel, reset };
}

export type ResourceUploadQueue = ReturnType<typeof useResourceUploadQueue>;

export function AttachmentUploader({ queue, disabled = false, title = 'Archivos adjuntos' }: {
  queue: ResourceUploadQueue; disabled?: boolean; title?: string;
}) {
  return <section className="attachment-uploader" aria-label={title} aria-busy={queue.busy}>
    <h3 className="label">{title}</h3>
    <FilePicker onFiles={queue.addFiles} disabled={disabled} busy={queue.busy} />
    <UploadFileList items={queue.items} onRemove={(id) => void queue.remove(id)}
      onRetry={(id) => void queue.retry(id)} onCancel={() => queue.cancel()} disabled={queue.busy} />
    {queue.error && <p className="error" role="alert">{queue.error}</p>}
  </section>;
}
