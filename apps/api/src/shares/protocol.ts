import {
  cleanFeedResource,
  type CreatedFeedShare,
  type FeedResourceRef,
  type FeedSharePreview,
  type FeedShareRecord,
} from '@b20/core';

/** Public links always use the configured production API, never the caller's Host header. */
export const SHARE_PUBLIC_ORIGIN = 'https://api.b20.mx';
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,199}$/;
export const SHARE_TOKEN = /^[a-zA-Z0-9_-]{43}$/;
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export interface ShareWorkerEnv extends Pick<
  FileWorkerEnv,
  'SPACETIMEDB_URI' | 'SPACETIMEDB_MODULE' | 'APP_URL'
> {
  /** Exclusive projection-reader identity; never fall back to another service or a visitor JWT. */
  SHARE_SERVICE_TOKEN?: string;
}

export class ShareApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const protocolError = () =>
  new ShareApiError(503, 'protocol', 'La respuesta del servicio de enlaces no es válida.');
export function shareServiceToken(env: ShareWorkerEnv): string {
  const token = env.SHARE_SERVICE_TOKEN;
  if (!token || token.length > 16_384 || !/^[a-zA-Z0-9._~-]+$/.test(token)) {
    throw new ShareApiError(
      503,
      'configuration',
      'La vista previa pública todavía no está configurada.',
    );
  }
  return token;
}
export function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
export function identifier(value: unknown): string | undefined {
  return typeof value === 'string' && IDENTIFIER.test(value) ? value : undefined;
}
export function resourceRef(value: unknown): FeedResourceRef | undefined {
  try {
    return cleanFeedResource(value);
  } catch {
    return undefined;
  }
}
function text(value: unknown, max: number, empty = false): value is string {
  return (
    typeof value === 'string' &&
    value.length <= max &&
    (empty || Boolean(value.trim())) &&
    !CONTROLS.test(value)
  );
}
function routeId(value: string): boolean {
  try {
    const decoded = decodeURIComponent(value);
    return (
      Boolean(identifier(decoded)) &&
      !['nueva', 'nuevo', 'editar', 'compendio', 'contactos', 'intentos'].includes(decoded)
    );
  } catch {
    return false;
  }
}
/** Accept only resource destinations; no origins, fragments, redirects or creation routes. */
export function safeSharePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1024 || /[\s\\#]/.test(value)) return false;
  const parts = value.split('?');
  if (parts.length > 2) return false;
  const path = parts[0]!;
  const params = new URLSearchParams(parts[1] ?? '');
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return false;
  if (path === '/m/leaderboard')
    return (
      keys.length === 0 ||
      (keys.length === 1 &&
        keys[0] === 'aviso' &&
        Boolean(resourceRef({ kind: 'ranking', id: params.get('aviso') })))
    );
  if (path === '/m/inicio')
    return (
      keys.length === 2 &&
      params.get('vista') === 'feed' &&
      Boolean(identifier(params.get('publicacion')))
    );
  if (path === '/m/oportunidades')
    return keys.length === 1 && Boolean(identifier(params.get('oportunidad')));
  const collection = /^\/m\/repaso\/colecciones\/([^/]+)$/.exec(path);
  if (collection) return keys.length === 0 && routeId(collection[1]!);
  const resource =
    /^\/m\/(tareas|actividades|notas|preguntas|guias|votaciones|ayuda|retos|revision-codigo|salas|examenes)\/([^/]+)$/.exec(
      path,
    );
  if (!resource || !routeId(resource[2]!)) return false;
  const allowed: Record<string, string[]> = {
    tareas: ['trabajo'],
    actividades: ['evidencia'],
    preguntas: ['respuesta'],
    retos: ['solucion'],
    'revision-codigo': ['observacion'],
  };
  return (
    keys.length <= 1 &&
    keys.every(
      (key) => allowed[resource[1]!]?.includes(key) && Boolean(identifier(params.get(key))),
    )
  );
}
export function sharePreview(value: unknown): FeedSharePreview {
  const row = object(value);
  if (
    !row ||
    !text(row.title, 300) ||
    !text(row.description, 800, true) ||
    !text(row.kindLabel, 100) ||
    (row.subject !== undefined && !text(row.subject, 240)) ||
    !safeSharePath(row.path)
  )
    throw protocolError();
  // Project known fields only: backend extras must never expose full content or private metadata.
  return {
    title: row.title,
    description: row.description,
    kindLabel: row.kindLabel,
    path: row.path,
    ...(row.subject === undefined ? {} : { subject: row.subject as string }),
  };
}
export function createdShare(value: unknown): CreatedFeedShare {
  const row = object(value);
  if (!row || !identifier(row.id)) throw protocolError();
  return { id: row.id as string, preview: sharePreview(row.preview) };
}
export function shareRecords(value: unknown, expected: FeedResourceRef): FeedShareRecord[] {
  if (!Array.isArray(value) || value.length > 500) throw protocolError();
  return value.map((entry) => {
    const row = object(entry);
    const target = resourceRef(row?.target);
    if (
      !row ||
      !identifier(row.id) ||
      !target ||
      target.kind !== expected.kind ||
      target.id !== expected.id ||
      !text(row.createdBy, 200) ||
      typeof row.createdAt !== 'string' ||
      row.createdAt.length > 40 ||
      !/^\d{4}-\d\d-\d\dT/.test(row.createdAt) ||
      !Number.isFinite(Date.parse(row.createdAt)) ||
      typeof row.active !== 'boolean' ||
      typeof row.canRevoke !== 'boolean'
    )
      throw protocolError();
    return {
      id: row.id as string,
      target,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      active: row.active,
      canRevoke: row.canRevoke,
    };
  });
}
export function appAddress(env: ShareWorkerEnv): URL {
  try {
    const url = new URL(env.APP_URL);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    )
      throw new Error();
    return url;
  } catch {
    throw new ShareApiError(
      503,
      'configuration',
      'La dirección de la aplicación todavía no está configurada.',
    );
  }
}
export function generateShareToken(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export async function shareTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
/** Limits real streamed bytes, even if Content-Length is absent or forged. */
export async function boundedText(
  message: Request | Response,
  limit: number,
  request = false,
): Promise<string> {
  const tooLarge = () =>
    request
      ? new ShareApiError(413, 'request_too_large', 'La solicitud es demasiado grande.')
      : protocolError();
  const length = message.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw tooLarge();
  const reader = message.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(next.value);
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(data);
  } finally {
    reader.releaseLock();
  }
}
