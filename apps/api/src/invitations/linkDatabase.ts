import type { InvitationEnvelope, InvitationSecrets } from './linkCrypto.ts';

export type InvitationWorkerEnv = FileWorkerEnv & InvitationSecrets;
export type InvitationProcedure = 'invitation_link_create' | 'invitation_link_copy' | 'invitation_link_replace';
export interface InvitationLinkRecord extends InvitationEnvelope {
  id: string;
  name?: string;
  status?: string;
  active?: boolean;
  createdAt?: number;
  expiresAt?: number | null;
  maxUses?: number | null;
  usedCount?: number;
  version?: number;
}
export class InvitationApiError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 503, readonly code: string, message: string) { super(message); }
}
export interface InvitationDatabase { call(token: string, procedure: InvitationProcedure, payload: unknown): Promise<InvitationLinkRecord> }
const errorMessages: Record<string, [InvitationApiError['status'], string]> = {
  forbidden: [403, 'Necesitas acceso de administrador para gestionar enlaces.'],
  unauthorized: [403, 'Tu acceso cambió. Vuelve a iniciar sesión.'],
  not_found: [404, 'No se encontró este enlace de invitación.'],
  invalid: [400, 'Revisa los datos del enlace.'],
  invalid_request: [400, 'Revisa los datos del enlace.'],
  conflict: [409, 'Ese intento ya corresponde a otra operación. Actualiza la página.'],
  inactive: [409, 'Este enlace ya no está activo.'],
  expired: [409, 'Este enlace ya venció.'],
  exhausted: [409, 'Este enlace ya alcanzó su cupo.'],
};
async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16_384) { await reader.cancel(); throw new InvitationApiError(503, 'protocol', 'La respuesta del servicio no es válida.'); }
      chunks.push(chunk.value);
    }
    const data = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(data);
  } finally { reader.releaseLock(); }
}
function denied(text: string, status: number): InvitationApiError {
  if (status === 401) return new InvitationApiError(401, 'unauthenticated', 'Vuelve a iniciar sesión para gestionar enlaces.');
  const code = /(?:^|[^a-z_])([a-z_]{3,40}):/.exec(text)?.[1] ?? 'access_changed';
  const known = errorMessages[code];
  return new InvitationApiError(known?.[0] ?? (status === 403 ? 403 : 409), code,
    known?.[1] ?? 'Tu acceso o el enlace cambió. Actualiza la página antes de reintentar.');
}
export function createInvitationDatabase(env: InvitationWorkerEnv, fetchFn: typeof fetch = fetch): InvitationDatabase {
  let uri: URL;
  try {
    uri = new URL(env.SPACETIMEDB_URI);
    if (uri.protocol === 'wss:') uri.protocol = 'https:';
    if (uri.protocol === 'ws:') uri.protocol = 'http:';
    if (!['http:', 'https:'].includes(uri.protocol) || uri.username || uri.password || !env.SPACETIMEDB_MODULE) throw new Error();
  } catch { throw new InvitationApiError(503, 'configuration', 'El servicio de invitaciones todavía no está configurado.'); }
  return { async call(token, procedure, payload) {
    // JWT validation and the administrator check both belong to SpacetimeDB. This preserves
    // its two accepted login providers instead of narrowing access to one local issuer.
    let response: Response;
    try {
      response = await fetchFn(new URL(`/v1/database/${encodeURIComponent(env.SPACETIMEDB_MODULE)}/call/${procedure}`, uri.origin), {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([JSON.stringify(payload)]), redirect: 'manual', signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new InvitationApiError(503, 'database_unavailable', 'No pudimos confirmar la operación. Reintenta sin cambiar el intento.'); }
    if (!response.ok) {
      if ([400, 401, 403, 530].includes(response.status)) throw denied(await boundedText(response), response.status);
      throw new InvitationApiError(503, 'database_unavailable', 'No pudimos confirmar la operación. Reintenta sin cambiar el intento.');
    }
    try {
      const raw: unknown = JSON.parse(await boundedText(response));
      const data: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (data && typeof data === 'object' && 'ok' in data && data.ok === false) {
        throw denied(`${'code' in data ? String(data.code) : 'access_changed'}:`, 409);
      }
      if (!data || typeof data !== 'object' || !('id' in data) || typeof data.id !== 'string'
        || !('ciphertext' in data) || typeof data.ciphertext !== 'string' || data.ciphertext.length > 512
        || !('iv' in data) || typeof data.iv !== 'string' || data.iv.length > 64
        || !('keyVersion' in data) || typeof data.keyVersion !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(data.keyVersion)) throw new Error();
      return data as InvitationLinkRecord;
    } catch (error) {
      if (error instanceof InvitationApiError) throw error;
      throw new InvitationApiError(503, 'protocol', 'La versión del servicio de invitaciones no coincide con la app.');
    }
  } };
}
