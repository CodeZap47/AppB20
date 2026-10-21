import { fileSizeError, MAX_FILE_BYTES } from '@b20/core';
import type { Id, ResourceTargetKind, ResourceTransferOptions } from './types';

export interface LegacyResourceTransportOptions {
  apiUrl: string;
  getToken(): string | undefined;
  fetch?: typeof fetch;
}

export const RESOURCE_CHUNK_BYTES = 1024 * 1024;
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
const RECEIPT_PREFIX = 'b20:file-upload:';

type UploadState = { uploadId: string; state: 'pending' | 'ready' | 'cancelled' | 'expired';
  fileId?: string; receivedIndexes: number[]; sha256: string };
type Manifest = { storageKind: 'spacetime' | 'legacy'; fileId: string; name: string; mime: string;
  bytes: string; chunkCount: number; sha256: string };

/** Solo las operaciones privadas que necesitan bytes; no se agregan tablas binarias a suscripciones. */
export interface ResourceConnection {
  reducers: {
    beginResourceUpload(input: { uploadId: string; targetKind: string; targetId: bigint; expectedVersion: number;
      name: string; mime: string; bytes: bigint; sha256: string }): Promise<unknown>;
    putResourceChunk(input: { uploadId: string; index: number; bytes: Uint8Array; sha256: string }): Promise<unknown>;
    finalizeResourceUpload(input: { uploadId: string }): Promise<unknown>;
    cancelResourceUpload(input: { uploadId: string }): Promise<unknown>;
  };
  procedures: {
    getResourceUploadStatus(input: { uploadId: string }): Promise<string>;
    getResourceManifest(input: { fileId: string }): Promise<string>;
    readResourceChunk(input: { fileId: string; index: number }): Promise<{ index: number; bytes: Uint8Array; sha256: string }>;
  };
}
export interface SpacetimeResourceTransportOptions {
  getConnection(): ResourceConnection;
  getIdentity(): string;
  /** Se consulta solo después de que SpacetimeDB autorice un manifiesto heredado. */
  legacy?: LegacyResourceTransportOptions;
  receiptStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}
export type ResourceTransportOptions = LegacyResourceTransportOptions | SpacetimeResourceTransportOptions;

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
}
function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Cancelaste la transferencia.', 'AbortError');
}

/** Transferencias nativas por fragmentos; HTTP queda disponible únicamente para archivos anteriores. */
export class ResourceTransport {
  private attempts = new WeakMap<File, Map<string, string>>();
  private receipts = new Map<string, { uploadId: string; expiresAt: number; expectedVersion: number }>();
  private hashes = new WeakMap<File, Promise<string>>();

  constructor(private options: ResourceTransportOptions) {}

  private authorization() {
    if ('getConnection' in this.options) throw new Error('Esta transferencia requiere la conexión con el grupo.');
    const token = this.options.getToken();
    if (!token) throw new Error('Inicia sesión de nuevo para transferir archivos.');
    return `Bearer ${token}`;
  }

  private url(path: string) {
    if ('getConnection' in this.options) throw new Error('Esta transferencia requiere la conexión con el grupo.');
    return `${this.options.apiUrl.replace(/\/$/, '')}${path}`;
  }

  private async error(response: Response): Promise<never> {
    const body = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
    if (response.status === 401) throw new Error('Tu sesión venció. Inicia sesión de nuevo.');
    throw new Error(typeof body?.error === 'string' ? body.error : 'No se pudo transferir el archivo. Vuelve a intentarlo.');
  }

  private async committed(uploadId: string, params: URLSearchParams): Promise<string | undefined> {
    if ('getConnection' in this.options) return undefined;
    try {
      const response = await (this.options.fetch ?? fetch)(this.url(`/files/uploads/${uploadId}?${params}`), {
        headers: { Authorization: this.authorization() },
      });
      if (!response.ok) return undefined;
      const body = await response.json() as { fileId?: unknown };
      return typeof body.fileId === 'string' && body.fileId ? body.fileId : undefined;
    } catch {
      return undefined;
    }
  }

  async upload(kind: ResourceTargetKind, targetId: Id, file: File, expectedVersion: number, transfer: ResourceTransferOptions = {}): Promise<Id> {
    const problem = fileSizeError(file.name, file.size);
    if (problem) throw new Error(problem);
    if (!file.name.trim() || file.name.length > 200) throw new Error('El nombre del archivo debe tener entre 1 y 200 caracteres.');
    abort(transfer.signal);
    if ('getConnection' in this.options) return this.uploadNative(this.options, kind, targetId, file, expectedVersion, transfer);
    const authorization = this.authorization();
    const key = `${kind}:${targetId}:${expectedVersion}`;
    const attempts = this.attempts.get(file) ?? new Map<string, string>();
    const uploadId = attempts.get(key) ?? crypto.randomUUID();
    attempts.set(key, uploadId);
    this.attempts.set(file, attempts);
    const params = new URLSearchParams({ targetKind: kind, targetId, expectedVersion: String(expectedVersion) });
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(this.url(`/files/uploads/${uploadId}?${params}`), {
        method: 'PUT', headers: {
          Authorization: authorization, 'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name), 'X-File-Size': String(file.size),
        }, body: file, signal: transfer.signal,
      });
    } catch {
      abort(transfer.signal);
      const recovered = await this.committed(uploadId, params);
      if (recovered) return recovered;
      throw new Error('No se pudo confirmar la subida. Reintenta con el mismo archivo para evitar duplicados.');
    }
    if (!response.ok) {
      if (response.status >= 500) {
        const recovered = await this.committed(uploadId, params);
        if (recovered) return recovered;
      }
      return this.error(response);
    }
    const body = await response.json().catch(() => undefined) as { fileId?: unknown } | undefined;
    if (typeof body?.fileId !== 'string' || !body.fileId) {
      const recovered = await this.committed(uploadId, params);
      if (recovered) return recovered;
      throw new Error('Se transfirió el archivo, pero falta confirmar el registro. Reintenta con el mismo archivo.');
    }
    return body.fileId;
  }

  async download(fileId: Id, transfer: ResourceTransferOptions = {}): Promise<Blob> {
    abort(transfer.signal);
    if ('getConnection' in this.options) return this.downloadNative(this.options, fileId, transfer);
    const response = await (this.options.fetch ?? fetch)(this.url(`/files/${encodeURIComponent(fileId)}`), {
      headers: { Authorization: this.authorization() }, ...(transfer.signal ? { signal: transfer.signal } : {}),
    });
    if (!response.ok) return this.error(response);
    return response.blob();
  }

  private storage(options: SpacetimeResourceTransportOptions) {
    try { return options.receiptStorage ?? globalThis.localStorage; } catch { return undefined; }
  }

  private receipt(options: SpacetimeResourceTransportOptions, key: string, expectedVersion: number) {
    let receipt = this.receipts.get(key);
    if (!receipt) {
      try {
        const saved: unknown = JSON.parse(this.storage(options)?.getItem(key) ?? 'null');
        if (saved && typeof saved === 'object' && 'uploadId' in saved && 'expiresAt' in saved &&
          typeof saved.uploadId === 'string' && /^[0-9a-f-]{36}$/i.test(saved.uploadId) &&
          typeof saved.expiresAt === 'number' && 'expectedVersion' in saved &&
          typeof saved.expectedVersion === 'number' && Number.isInteger(saved.expectedVersion) && saved.expectedVersion > 0) {
          receipt = { uploadId: saved.uploadId, expiresAt: saved.expiresAt, expectedVersion: saved.expectedVersion };
        }
      } catch { /* El almacenamiento local puede estar bloqueado; se conserva la reanudación en memoria. */ }
    }
    if (!receipt || receipt.expiresAt <= Date.now()) {
      receipt = { uploadId: crypto.randomUUID(), expiresAt: Date.now() + RECEIPT_TTL_MS, expectedVersion };
    }
    this.receipts.set(key, receipt);
    try { this.storage(options)?.setItem(key, JSON.stringify(receipt)); } catch { /* Sin espacio local. */ }
    return receipt;
  }

  private forget(options: SpacetimeResourceTransportOptions, key: string) {
    this.receipts.delete(key);
    try { this.storage(options)?.removeItem(key); } catch { /* La limpieza remota es independiente. */ }
  }

  private connection(options: SpacetimeResourceTransportOptions, actor: string, signal?: AbortSignal) {
    abort(signal);
    if (!actor || options.getIdentity() !== actor) throw new Error('Tu sesión cambió. Inicia de nuevo la transferencia.');
    return options.getConnection();
  }

  private async status(options: SpacetimeResourceTransportOptions, actor: string, uploadId: string, sha256: string, signal?: AbortSignal): Promise<UploadState | null> {
    const raw: unknown = JSON.parse(await this.connection(options, actor, signal).procedures.getResourceUploadStatus({ uploadId }));
    this.connection(options, actor, signal);
    if (raw === null) return null;
    if (!raw || typeof raw !== 'object') throw new Error('No se pudo confirmar el estado de la subida.');
    const state = raw as UploadState;
    if (state.uploadId !== uploadId || state.sha256 !== sha256 ||
      !['pending', 'ready', 'cancelled', 'expired'].includes(state.state) || !Array.isArray(state.receivedIndexes) ||
      state.receivedIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= MAX_FILE_BYTES / RESOURCE_CHUNK_BYTES) ||
      (state.state === 'ready' && (typeof state.fileId !== 'string' || !state.fileId))) {
      throw new Error('El registro de la subida no coincide con este archivo.');
    }
    this.connection(options, actor, signal);
    return state;
  }

  private async uploadNative(options: SpacetimeResourceTransportOptions, kind: ResourceTargetKind, targetId: Id,
    file: File, expectedVersion: number, transfer: ResourceTransferOptions): Promise<Id> {
    const actor = options.getIdentity();
    this.connection(options, actor, transfer.signal);
    let hash = this.hashes.get(file);
    if (!hash) { hash = file.arrayBuffer().then((buffer) => digest(new Uint8Array(buffer))); this.hashes.set(file, hash); }
    const sha256 = await hash;
    this.connection(options, actor, transfer.signal);
    const mime = file.type || 'application/octet-stream';
    // La versión se guarda en el recibo: una confirmación perdida puede haber avanzado la página.
    const key = `${RECEIPT_PREFIX}${JSON.stringify([actor, kind, targetId, sha256, file.name, mime])}`;
    let receipt = this.receipt(options, key, expectedVersion);
    let { uploadId } = receipt;
    const confirmed = (fileId: string) => {
      this.forget(options, key);
      transfer.onProgress?.(file.size, file.size);
      return fileId;
    };
    const committed = async () => {
      try {
        const result = await this.status(options, actor, uploadId, sha256, transfer.signal);
        if (!result || result.state === 'cancelled' || result.state === 'expired') this.forget(options, key);
        return result?.state === 'ready' ? result.fileId : undefined;
      } catch { return undefined; }
    };
    try {
      if (receipt.expectedVersion !== expectedVersion) {
        const prior = await this.status(options, actor, uploadId, sha256, transfer.signal);
        if (prior?.state === 'ready') return confirmed(prior.fileId!);
        if (prior?.state === 'pending') {
          await this.connection(options, actor, transfer.signal).reducers.cancelResourceUpload({ uploadId });
          const cancelled = await this.status(options, actor, uploadId, sha256, transfer.signal);
          if (cancelled?.state === 'ready') return confirmed(cancelled.fileId!);
          if (!cancelled || cancelled.state === 'cancelled' || cancelled.state === 'expired') this.forget(options, key);
          throw new Error('La publicación cambió mientras subías el archivo. Se canceló la subida anterior; revisa la publicación y vuelve a intentarlo.');
        }
        // Ausente/caducado/cancelado confirma que no hay un archivo pendiente de identificar.
        this.forget(options, key);
        receipt = this.receipt(options, key, expectedVersion);
        uploadId = receipt.uploadId;
      }
      try {
        await this.connection(options, actor, transfer.signal).reducers.beginResourceUpload({ uploadId, targetKind: kind,
          targetId: BigInt(targetId), expectedVersion: receipt.expectedVersion, name: file.name, mime, bytes: BigInt(file.size), sha256 });
      } catch (failure) {
        const recovered = await committed();
        if (recovered) return confirmed(recovered);
        throw failure;
      }
      const state = await this.status(options, actor, uploadId, sha256, transfer.signal);
      if (state?.state === 'ready') return confirmed(state.fileId!);
      if (state?.state !== 'pending') {
        this.forget(options, key);
        throw new Error('La subida anterior terminó o venció. Vuelve a seleccionar el archivo.');
      }
      const count = Math.ceil(file.size / RESOURCE_CHUNK_BYTES);
      const received = new Set(state.receivedIndexes);
      if ([...received].some((index) => index >= count)) throw new Error('El registro contiene fragmentos inesperados.');
      let completed = [...received].reduce((sum, index) => sum + Math.min(RESOURCE_CHUNK_BYTES, file.size - index * RESOURCE_CHUNK_BYTES), 0);
      transfer.onProgress?.(completed, file.size);
      for (let index = 0; index < count; index++) {
        if (received.has(index)) continue;
        this.connection(options, actor, transfer.signal);
        const bytes = new Uint8Array(await file.slice(index * RESOURCE_CHUNK_BYTES, (index + 1) * RESOURCE_CHUNK_BYTES).arrayBuffer());
        const chunkHash = await digest(bytes);
        await this.connection(options, actor, transfer.signal).reducers.putResourceChunk({ uploadId, index, bytes, sha256: chunkHash });
        this.connection(options, actor, transfer.signal);
        completed += bytes.byteLength;
        transfer.onProgress?.(completed, file.size);
      }
      try { await this.connection(options, actor, transfer.signal).reducers.finalizeResourceUpload({ uploadId }); }
      catch (failure) {
        const recovered = await committed();
        if (recovered) return confirmed(recovered);
        throw failure;
      }
      const result = await this.status(options, actor, uploadId, sha256, transfer.signal);
      if (result?.state !== 'ready') throw new Error('Falta confirmar el archivo. Reintenta para recuperar la subida.');
      return confirmed(result.fileId!);
    } catch (failure) {
      if (transfer.signal?.aborted) {
        // Si el servidor terminó antes de recibir Cancelar, reconocemos el archivo existente.
        try {
          const result = await this.status(options, actor, uploadId, sha256);
          if (result?.state === 'ready') return confirmed(result.fileId!);
          if (!result || result.state === 'cancelled' || result.state === 'expired') this.forget(options, key);
        } catch { /* Si falta confirmación conservamos el recibo para reconocer un commit posterior. */ }
        // No usamos la señal abortada para cancelar; sí comprobamos la cuenta y el estado final.
        try {
          await this.connection(options, actor).reducers.cancelResourceUpload({ uploadId });
          const result = await this.status(options, actor, uploadId, sha256);
          if (result?.state === 'ready') return confirmed(result.fileId!);
          if (!result || result.state === 'cancelled' || result.state === 'expired') this.forget(options, key);
        } catch { /* Una cancelación incierta conserva el recibo hasta poder verificarla o caducar. */ }
        abort(transfer.signal);
      }
      throw failure;
    }
  }

  private async downloadNative(options: SpacetimeResourceTransportOptions, fileId: Id, transfer: ResourceTransferOptions): Promise<Blob> {
    const actor = options.getIdentity();
    const raw: unknown = JSON.parse(await this.connection(options, actor, transfer.signal).procedures.getResourceManifest({ fileId }));
    this.connection(options, actor, transfer.signal);
    if (!raw || typeof raw !== 'object') throw new Error('No se pudo consultar el archivo.');
    const manifest = raw as Manifest;
    if (manifest.fileId !== fileId) throw new Error('El registro no corresponde al archivo solicitado.');
    if (manifest.storageKind === 'legacy') {
      if (!options.legacy) throw new Error('Este archivo anterior requiere configurar el servicio de archivos heredados.');
      const blob = await new ResourceTransport(options.legacy).download(fileId, transfer);
      this.connection(options, actor, transfer.signal);
      return blob;
    }
    const size = Number(manifest.bytes);
    if (manifest.storageKind !== 'spacetime' || !Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES ||
      manifest.chunkCount !== Math.ceil(size / RESOURCE_CHUNK_BYTES) || !/^[0-9a-f]{64}$/.test(manifest.sha256) || typeof manifest.mime !== 'string') {
      throw new Error('El registro del archivo está incompleto o es inválido.');
    }
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let completed = 0;
    transfer.onProgress?.(0, size);
    for (let index = 0; index < manifest.chunkCount; index++) {
      const part = await this.connection(options, actor, transfer.signal).procedures.readResourceChunk({ fileId, index });
      this.connection(options, actor, transfer.signal);
      const expected = Math.min(RESOURCE_CHUNK_BYTES, size - completed);
      if (part.index !== index || !(part.bytes instanceof Uint8Array) || part.bytes.byteLength !== expected || await digest(part.bytes) !== part.sha256) {
        throw new Error('Un fragmento del archivo está incompleto o dañado. Vuelve a descargarlo.');
      }
      parts.push(new Uint8Array(part.bytes));
      completed += part.bytes.byteLength;
      transfer.onProgress?.(completed, size);
    }
    const blob = new Blob(parts, { type: manifest.mime });
    if (await digest(new Uint8Array(await blob.arrayBuffer())) !== manifest.sha256) {
      throw new Error('El archivo descargado no coincide con el original. Vuelve a descargarlo.');
    }
    this.connection(options, actor, transfer.signal);
    return blob;
  }
}
