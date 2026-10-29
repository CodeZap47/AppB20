import { FEED_RESOURCE_KINDS, feedPreviewText, type FeedResourceRef, type FeedShareRecord, type FeedThread, type FeedThreadCommand } from '@b20/core';
import type { FeedInteractionActions } from './feedInteractionTypes';

interface Connection { procedures: object }
export interface FeedShareClientOptions { apiUrl: string; getToken(): string | undefined; fetch?: typeof fetch }

function validTarget(value: unknown): value is FeedResourceRef {
  return !!value && typeof value === 'object' && 'kind' in value && 'id' in value && typeof value.id === 'string' && typeof value.kind === 'string' && (FEED_RESOURCE_KINDS as readonly string[]).includes(value.kind);
}
function parseThread(value: unknown, expected: FeedResourceRef): FeedThread {
  const result: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!result || typeof result !== 'object' || !('target' in result) || !validTarget(result.target) || !('comments' in result) || !Array.isArray(result.comments) || !('canComment' in result) || typeof result.canComment !== 'boolean' || !('maxLength' in result) || typeof result.maxLength !== 'number') throw new Error('La conversación devolvió una respuesta incompleta.');
  if (result.target.kind !== expected.kind || result.target.id !== expected.id || !Number.isInteger(result.maxLength) || result.maxLength < 1 || result.maxLength > 4000 || ('reason' in result && typeof result.reason !== 'string') || result.comments.some((row: unknown) => !row || typeof row !== 'object' || !('id' in row) || typeof row.id !== 'string' || !('authorId' in row) || typeof row.authorId !== 'string' || !('text' in row) || typeof row.text !== 'string' || !('createdAt' in row) || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)) || !('canDelete' in row) || typeof row.canDelete !== 'boolean')) throw new Error('La conversación devolvió una respuesta incompleta.');
  return result as FeedThread;
}

export function createFeedInteractionActions(connection: () => Connection, options?: FeedShareClientOptions): FeedInteractionActions {
  const thread = async (command: FeedThreadCommand) => {
    const procedures = connection().procedures as { feedThread?: (args: { payload: string }) => Promise<unknown> };
    if (!procedures.feedThread) throw new Error('La conversación todavía no está disponible.');
    return parseThread(await procedures.feedThread({ payload: JSON.stringify(command) }), command.target);
  };
  const request = async (path: string, method: string, body?: unknown): Promise<unknown> => {
    connection();
    const token = options?.getToken();
    if (!token) throw new Error('Inicia sesión para compartir publicaciones.');
    if (!options?.apiUrl) throw new Error('El servicio para compartir todavía no está disponible.');
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(`${options.apiUrl.replace(/\/$/, '')}/shares${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new Error(method === 'POST' ? 'No se pudo confirmar el enlace. Revisa los enlaces existentes antes de crear otro.' : 'No se pudo contactar al servicio para compartir. Reintenta.'); }
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : 'No se pudo gestionar el enlace.');
    return result;
  };
  return {
    readFeedThread: (target) => thread({ action: 'read', target }),
    addFeedThreadComment: (target, text, requestId) => thread({ action: 'comment', target, text, requestId }),
    deleteFeedThreadComment: (target, commentId) => thread({ action: 'delete', target, commentId }),
    createFeedShare: async (target) => {
      const result = await request('', 'POST', { target });
      if (!result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string' || !('url' in result) || typeof result.url !== 'string' || !('preview' in result) || !result.preview || typeof result.preview !== 'object') throw new Error('El servicio devolvió un enlace incompleto. Revisa los enlaces existentes.');
      const preview = result.preview;
      if (!('title' in preview) || typeof preview.title !== 'string' || !('description' in preview) || typeof preview.description !== 'string' || !('kindLabel' in preview) || typeof preview.kindLabel !== 'string' || !('path' in preview) || typeof preview.path !== 'string' || !/^\/m\/[a-zA-Z0-9]/.test(preview.path) || /[\u0000-\u001f\\]/.test(preview.path) || ('subject' in preview && typeof preview.subject !== 'string')) throw new Error('El servicio devolvió una vista previa incompleta. Revisa los enlaces existentes.');
      const url = new URL(result.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.origin !== new URL(options!.apiUrl).origin || !/^\/s\/[^/\s]+$/.test(url.pathname) || url.search || url.hash || url.username || url.password) throw new Error('El servicio devolvió un enlace no válido.');
      return { id: result.id, url: result.url, preview: { title: feedPreviewText(preview.title, 200), description: feedPreviewText(preview.description, 160), path: preview.path, kindLabel: feedPreviewText(preview.kindLabel, 80), ...('subject' in preview ? { subject: feedPreviewText(preview.subject, 100) } : {}) } };
    },
    listFeedShares: async (target) => {
      const result = await request(`?${new URLSearchParams({ kind: target.kind, id: target.id })}`, 'GET');
      if (!Array.isArray(result) || result.some((row: unknown) => !row || typeof row !== 'object' || !('id' in row) || typeof row.id !== 'string' || !('target' in row) || !validTarget(row.target) || row.target.kind !== target.kind || row.target.id !== target.id || !('createdBy' in row) || typeof row.createdBy !== 'string' || !('createdAt' in row) || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)) || !('active' in row) || typeof row.active !== 'boolean' || !('canRevoke' in row) || typeof row.canRevoke !== 'boolean')) throw new Error('No se pudieron leer los enlaces existentes.');
      return result as FeedShareRecord[];
    },
    revokeFeedShare: async (id) => { await request(`/${encodeURIComponent(id)}`, 'DELETE'); },
  };
}
