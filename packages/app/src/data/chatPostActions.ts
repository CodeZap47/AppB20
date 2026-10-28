import { chatPostKey, cleanChatPostRef, feedPreviewText, type ChatPostKind, type ChatPostPreview, type ChatPostRef } from '@b20/core';

export interface ChatPostActions {
  resolveChatPosts(targets: readonly ChatPostRef[]): Promise<ChatPostPreview[]>;
  searchChatPosts(query: string, kind?: ChatPostKind): Promise<ChatPostPreview[]>;
}

interface Connection { procedures: object }
function parsePreviews(value: unknown): ChatPostPreview[] {
  const result: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(result) || result.length > 50) throw new Error('No se pudieron cargar las publicaciones.');
  return result.map((raw: unknown): ChatPostPreview => {
    if (!raw || typeof raw !== 'object' || !('target' in raw) || !('available' in raw) || typeof raw.available !== 'boolean') throw new Error('La publicación está incompleta.');
    const target = cleanChatPostRef(raw.target);
    if (!raw.available) return { target, available: false };
    if (!('title' in raw) || typeof raw.title !== 'string' || !('description' in raw) || typeof raw.description !== 'string'
      || !('kindLabel' in raw) || typeof raw.kindLabel !== 'string' || !('path' in raw) || typeof raw.path !== 'string'
      || !/^\/m\/[a-zA-Z0-9]/.test(raw.path) || /[\u0000-\u001f\\]/.test(raw.path)
      || ('subject' in raw && typeof raw.subject !== 'string')) throw new Error('La publicación está incompleta.');
    return { target, available: true, title: feedPreviewText(raw.title, 200), description: feedPreviewText(raw.description, 160),
      kindLabel: feedPreviewText(raw.kindLabel, 80), path: raw.path, ...('subject' in raw ? { subject: feedPreviewText(raw.subject, 100) } : {}) };
  });
}
export function createChatPostActions(connection: () => Connection): ChatPostActions {
  const request = async (command: unknown) => {
    const procedures = connection().procedures as { chatPostAction?: (args: { payload: string }) => Promise<unknown> };
    if (!procedures.chatPostAction) throw new Error('Las publicaciones del chat todavía no están disponibles.');
    return parsePreviews(await procedures.chatPostAction({ payload: JSON.stringify(command) }));
  };
  return {
    resolveChatPosts: async targets => {
      const clean = targets.map(target => cleanChatPostRef(target));
      const rows = await request({ action: 'resolve', targets: clean });
      if (rows.length !== clean.length || rows.some((row, index) => chatPostKey(row.target) !== chatPostKey(clean[index]!))) throw new Error('La respuesta de publicaciones no coincide.');
      return rows;
    },
    searchChatPosts: (query, kind) => request({ action: 'search', query, ...(kind ? { kind } : {}) }),
  };
}
