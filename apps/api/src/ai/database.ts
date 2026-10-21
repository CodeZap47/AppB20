import type { AiCiphertext } from './crypto.ts';

export interface AiSecrets { AI_SERVICE_TOKEN?: string; AI_MASTER_KEYS_JSON?: string }
export type AiWorkerEnv = FileWorkerEnv & AiSecrets;
export class AiApiError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503, readonly code: string, message: string) { super(message); }
}
export interface AiDatabase {
  user<T = unknown>(token: string, procedure: string, payload: unknown): Promise<T>;
  service<T = unknown>(procedure: string, payload: unknown): Promise<T>;
}
export interface AiAuthorizedKey { actor: string; intentId: string; keyId: string; expiresAt: number }
export interface AiEncryptedKey extends AiCiphertext { keyId: string; provider: 'gemini' }
const USER_PROCEDURES = new Set(['guide_ai', 'ai_status', 'ai_key_status', 'ai_set_consent', 'ai_authorize_key', 'ai_delete_key', 'ai_prepare', 'ai_authorize_generation', 'ai_get_generation', 'ai_list_generations', 'ai_publish_generation']);
const SERVICE_PROCEDURES = new Set(['guide_ai', 'ai_commit_key', 'ai_claim_generation', 'ai_finish_generation']);
const ERRORS: Record<string, [AiApiError['status'], string]> = {
  invalid: [400, 'Revisa los datos de la solicitud.'], unauthorized: [403, 'Ya no tienes acceso a este material.'],
  unavailable: [503, 'El servicio IA no está disponible.'], quota: [429, 'Llegaste al límite de generación. Intenta más tarde.'],
  consent: [409, 'Acepta el consentimiento vigente antes de generar.'],
  invalid_request: [400, 'Revisa los datos de la solicitud.'], invalid_key: [400, 'Revisa tu clave personal.'],
  request_too_large: [413, 'La solicitud supera el límite permitido.'],
  forbidden: [403, 'Ya no tienes acceso a este material.'], not_found: [404, 'La operación no está disponible.'],
  stale_sources: [409, 'El material cambió. Prepara nuevamente la selección.'], expired: [409, 'La preparación venció. Prepara nuevamente el material.'],
  source_changed: [409, 'El material cambió. Prepara nuevamente la selección.'],
  key_changed: [409, 'La clave cambió antes del envío. Revisa la configuración.'],
  conflict: [409, 'El identificador ya se usó con otra solicitud.'], consent_required: [409, 'Acepta el consentimiento vigente antes de generar.'],
  key_required: [409, 'Configura tu clave de Gemini primero.'], disabled: [503, 'La generación con IA aún no está habilitada.'],
  ai_disabled: [503, 'La generación con IA aún no está habilitada.'],
  quota_exceeded: [429, 'Llegaste al límite de generación. Intenta más tarde.'],
  rate_limited: [429, 'Llegaste al límite de generación. Intenta más tarde.'],
  unknown_confirmation_required: [409, 'Hay un envío de resultado incierto. Crear otra operación puede consumir cuota adicional; confirma expresamente para continuar.'],
};
function procedureError(value: string, fallbackStatus = 409): AiApiError {
  // Only recognize a bounded code, never relay logs or arbitrary backend text.
  const code = /(?:^|[^a-z_])([a-z_]{3,40}):/.exec(value)?.[1] ?? 'access_changed';
  const known = ERRORS[code];
  return new AiApiError(known?.[0] ?? fallbackStatus as AiApiError['status'], code,
    known?.[1] ?? 'Tu acceso o la versión cambió. Actualiza la página antes de reintentar.');
}
async function boundedText(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new AiApiError(503, 'protocol', 'La respuesta del servicio IA supera el límite permitido.'); }
      chunks.push(chunk.value);
    }
    const combined = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(combined);
  } finally { reader.releaseLock(); }
}
export function createAiDatabase(env: AiWorkerEnv, fetchFn: typeof fetch = fetch): AiDatabase {
  let uri: URL;
  try {
    uri = new URL(env.SPACETIMEDB_URI);
    if (uri.protocol === 'wss:') uri.protocol = 'https:';
    if (uri.protocol === 'ws:') uri.protocol = 'http:';
    if (!['http:', 'https:'].includes(uri.protocol) || uri.username || uri.password) throw new Error();
  } catch { throw new AiApiError(503, 'configuration', 'El servicio IA todavía no está configurado.'); }
  async function call<T>(name: string, token: string | undefined, payload: unknown): Promise<T> {
    if (!token) throw new AiApiError(503, 'configuration', 'El servicio IA todavía no está configurado.');
    let response: Response;
    try {
      response = await fetchFn(new URL(`/v1/database/${encodeURIComponent(env.SPACETIMEDB_MODULE)}/call/${name}`, uri.origin), {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([JSON.stringify(payload)]), redirect: 'manual', signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new AiApiError(503, 'database_unavailable', 'No pudimos confirmar la operación. Consulta su estado antes de repetirla.'); }
    if (!response.ok) {
      if ([400, 401, 403, 530].includes(response.status)) throw procedureError(await boundedText(response, 4096));
      throw new AiApiError(503, 'database_unavailable', 'No pudimos confirmar la operación. Consulta su estado antes de repetirla.');
    }
    try {
      const data: unknown = JSON.parse(await boundedText(response, name === 'guide_ai' ? 4 * 1024 * 1024 : 1024 * 1024));
      const parsed: unknown = typeof data === 'string' ? JSON.parse(data) : data;
      if (parsed && typeof parsed === 'object' && 'ok' in parsed && parsed.ok === false) {
        const code = 'code' in parsed ? String(parsed.code) : 'access_changed';
        throw procedureError(`${code}:`);
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof AiApiError) throw error;
      throw new AiApiError(503, 'protocol', 'La versión del servicio IA no coincide con la app.');
    }
  }
  return {
    user<T>(token: string, procedure: string, payload: unknown) {
      if (!USER_PROCEDURES.has(procedure)) throw new AiApiError(403, 'forbidden', 'Operación no permitida.');
      return call<T>(procedure, token, payload);
    },
    service<T>(procedure: string, payload: unknown) {
      if (!SERVICE_PROCEDURES.has(procedure)) throw new AiApiError(403, 'forbidden', 'Operación no permitida.');
      return call<T>(procedure, env.AI_SERVICE_TOKEN, payload);
    },
  };
}
