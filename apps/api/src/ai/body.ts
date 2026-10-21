import { AiApiError } from './database.ts';

/** Bound actual streamed bytes too; Content-Length alone is controlled by the caller. */
export async function readAiBody(request: Request, maxBytes = 32_768): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new AiApiError(400, 'invalid_request', 'Envía una solicitud JSON.');
  }
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new AiApiError(413, 'body_too_large', 'La solicitud supera el límite permitido.');
  const reader = request.body?.getReader();
  if (!reader) throw new AiApiError(400, 'invalid_request', 'Faltan los datos de la solicitud.');
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new AiApiError(413, 'body_too_large', 'La solicitud supera el límite permitido.'); }
      chunks.push(chunk.value);
    }
    const combined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(combined));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AiApiError) throw error;
    throw new AiApiError(400, 'invalid_request', 'Los datos de la solicitud no son válidos.');
  } finally { reader.releaseLock(); }
}
