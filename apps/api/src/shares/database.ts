import type { FeedShareCommand } from '@b20/core';
import {
  boundedText,
  object,
  ShareApiError,
  type ShareWorkerEnv,
  protocolError,
  shareServiceToken,
} from './protocol.ts';

const ERRORS: Record<string, [ShareApiError['status'], string]> = {
  invalid: [400, 'Revisa los datos del enlace.'],
  invalid_request: [400, 'Revisa los datos del enlace.'],
  unauthorized: [403, 'Ya no tienes acceso a esta publicación.'],
  forbidden: [403, 'No tienes permiso para compartir esta publicación.'],
  not_found: [404, 'Este enlace o publicación no está disponible.'],
  private: [403, 'Esta publicación no se puede compartir.'],
  conflict: [409, 'El enlace cambió. Actualiza la lista antes de reintentar.'],
  quota: [429, 'Hay demasiados enlaces. Revoca alguno antes de crear otro.'],
  rate_limited: [429, 'Espera un momento antes de crear otro enlace.'],
};
const unavailable = () =>
  new ShareApiError(
    503,
    'unavailable',
    'No pudimos confirmar la operación. Revisa tus enlaces antes de intentarlo otra vez.',
  );
function denied(value: string, status: number): ShareApiError {
  if (status === 401)
    return new ShareApiError(401, 'unauthenticated', 'Inicia sesión para gestionar enlaces.');
  const code = /(?:^|[^a-z_])([a-z_]{3,40}):/.exec(value)?.[1];
  const known = code && ERRORS[code];
  return known
    ? new ShareApiError(known[0], code!, known[1])
    : new ShareApiError(
        status === 400 ? 400 : 403,
        'access_changed',
        'Tu acceso o la publicación cambió. Actualiza la página antes de reintentar.',
      );
}
export function createShareDatabase(env: ShareWorkerEnv, fetchFn: typeof fetch = fetch) {
  let origin: string;
  try {
    const uri = new URL(env.SPACETIMEDB_URI);
    if (uri.protocol === 'wss:') uri.protocol = 'https:';
    if (uri.protocol === 'ws:') uri.protocol = 'http:';
    if (
      !['http:', 'https:'].includes(uri.protocol) ||
      uri.username ||
      uri.password ||
      !env.SPACETIMEDB_MODULE?.trim()
    )
      throw new Error();
    origin = uri.origin;
  } catch {
    throw new ShareApiError(
      503,
      'configuration',
      'El servicio de enlaces todavía no está configurado.',
    );
  }
  async function call(
    procedure: 'feed_share_action' | 'feed_share_preview',
    argument: string,
    token?: string,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchFn(
        new URL(
          `/v1/database/${encodeURIComponent(env.SPACETIMEDB_MODULE)}/call/${procedure}`,
          origin,
        ),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify([argument]),
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw unavailable();
    }
    if (!response.ok) {
      if ([400, 401, 403, 404, 409, 429, 530].includes(response.status))
        throw denied(await boundedText(response, 4096), response.status);
      throw unavailable();
    }
    try {
      const raw: unknown = JSON.parse(await boundedText(response, 256 * 1024));
      const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const row = object(value);
      if (row?.ok === false) throw denied(typeof row.code === 'string' ? `${row.code}:` : '', 403);
      return value;
    } catch (error) {
      if (error instanceof ShareApiError) throw error;
      throw protocolError();
    }
  }
  return {
    action: (token: string, command: FeedShareCommand) =>
      call('feed_share_action', JSON.stringify(command), token),
    async preview(tokenHash: string) {
      const service = shareServiceToken(env);
      try {
        return await call('feed_share_preview', tokenHash, service);
      } catch (error) {
        if (error instanceof ShareApiError && [401, 403].includes(error.status)) {
          throw new ShareApiError(
            503,
            'configuration',
            'La vista previa pública no está disponible.',
          );
        }
        throw error;
      }
    },
  };
}
