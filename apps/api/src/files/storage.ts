import { FileApiError, type AuthorizedUpload, type FinalizedUpload } from './database.ts';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
const PREFIX = 'files/';
const CURSOR_KEY = '_maintenance/orphan-cursor';

export function objectKey(actor: string, uploadId: string): string {
  return `${PREFIX}${actor}/${uploadId}`;
}

/** Stable metadata binds every retry to its original author, resource, and version. */
export function metadata(upload: AuthorizedUpload, name: string, contentType: string, size: number): Record<string, string> {
  return { actor: upload.actor, uploadId: upload.uploadId, targetKind: upload.targetKind,
    targetId: upload.targetId, expectedVersion: String(upload.expectedVersion), name,
    contentType, size: String(size) };
}

export function matchesMetadata(actual: Record<string, string> | undefined, expected: Record<string, string>): boolean {
  return Boolean(actual && Object.entries(expected).every(([key, value]) => actual[key] === value));
}

/** Pipe through a bounded native stream, so a false size header cannot bypass the limit. */
export async function storeFile(bucket: R2Bucket, body: ReadableStream<Uint8Array>,
  upload: AuthorizedUpload, name: string, contentType: string, size: number): Promise<FinalizedUpload> {
  const storageKey = objectKey(upload.actor, upload.uploadId);
  const expected = metadata(upload, name, contentType, size);
  const existing = await bucket.head(storageKey);
  if (existing) {
    await body.cancel();
    if (!matchesMetadata(existing.customMetadata, expected)) {
      throw new FileApiError(409, 'Ese intento ya se usó para otro archivo. Elígelo de nuevo.');
    }
    return { ...upload, name, contentType, size: existing.size, storageKey, etag: existing.etag };
  }
  const fixed = new FixedLengthStream(size);
  // Start both ends concurrently: awaiting pipeTo before put would deadlock on backpressure.
  let transferred = 0;
  const counted = body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      transferred += chunk.byteLength;
      if (transferred > size) controller.error(new Error('File size mismatch'));
      else controller.enqueue(chunk);
    },
    flush(controller) {
      if (transferred !== size) controller.error(new Error('File size mismatch'));
    },
  }));
  const writing = counted.pipeTo(fixed.writable);
  const storing = bucket.put(storageKey, fixed.readable, {
    onlyIf: new Headers({ 'If-None-Match': '*' }),
    httpMetadata: { contentType: 'application/octet-stream', contentDisposition: 'attachment' },
    customMetadata: expected,
  });
  const [written, stored] = await Promise.allSettled([writing, storing]);
  if (written.status === 'rejected') {
    throw new FileApiError(400, 'El archivo no llegó completo o su tamaño cambió. Vuelve a intentarlo.');
  }
  if (stored.status === 'rejected') throw new FileApiError(503, 'No se pudo guardar el archivo. Vuelve a intentarlo.');
  let object = stored.value;
  if (!object) {
    // Another request with the same uploadId won the conditional write.
    object = await bucket.head(storageKey);
    if (!object || !matchesMetadata(object.customMetadata, expected)) {
      throw new FileApiError(409, 'Otra subida está usando ese intento. Vuelve a intentarlo.');
    }
  }
  if (object.size !== size || object.size <= 0 || object.size > MAX_FILE_BYTES) {
    throw new FileApiError(400, 'El tamaño guardado no coincide con el archivo.');
  }
  return { ...upload, name, contentType, size: object.size, storageKey, etag: object.etag };
}

/** One bounded page per run. Unknown database outcomes always keep the object for retry. */
export async function cleanOrphans(bucket: R2Bucket,
  registered: (actor: string, uploadId: string) => Promise<{ storageKey: string } | null>, now = Date.now()): Promise<number> {
  const cursorObject = await bucket.get(CURSOR_KEY);
  const cursor = cursorObject ? await cursorObject.text() : undefined;
  const page = await bucket.list({ prefix: PREFIX, limit: 20, include: ['customMetadata'], ...(cursor ? { cursor } : {}) });
  let deleted = 0;
  for (const object of page.objects) {
    if (object.uploaded.getTime() > now - 24 * 60 * 60_000) continue;
    const { actor, uploadId } = object.customMetadata ?? {};
    if (!actor || !uploadId || objectKey(actor, uploadId) !== object.key) continue;
    const record = await registered(actor, uploadId);
    if (record) continue;
    await bucket.delete(object.key);
    deleted++;
  }
  if (page.truncated) await bucket.put(CURSOR_KEY, page.cursor);
  else await bucket.delete(CURSOR_KEY);
  return deleted;
}
