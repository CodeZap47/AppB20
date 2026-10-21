/**
 * Feed de la primera vista (7.1): reacciones con emoji al contenido del grupo y publicaciones
 * propias con comentarios. Compartido por la app y el módulo de SpacetimeDB.
 */

/** Lista cerrada: el feed no es un chat, basta con un puñado de reacciones reconocibles. */
export const FEED_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '🙏'] as const;
export type FeedReactionEmoji = (typeof FEED_REACTIONS)[number];

/** Contenido al que se puede reaccionar desde el feed; `post` son las publicaciones propias. */
export const FEED_TARGET_KINDS = [
  'assignment', 'work', 'note', 'activity', 'evidence', 'question', 'answer',
  'guide', 'poll', 'help', 'spaced', 'post',
] as const;
export type FeedTargetKind = (typeof FEED_TARGET_KINDS)[number];

export const FEED_LIMITS = { post: 1000, comment: 500 } as const;

export const isFeedReaction = (value: string): value is FeedReactionEmoji =>
  (FEED_REACTIONS as readonly string[]).includes(value);

export const isFeedTargetKind = (value: string): value is FeedTargetKind =>
  (FEED_TARGET_KINDS as readonly string[]).includes(value);

function text(value: string, field: string, max: number) {
  if (typeof value !== 'string') throw new Error(`${field} no es válido.`);
  const result = value.replace(/\r\n?/g, '\n').trim();
  if (!result) throw new Error(`${field} no puede quedar vacío.`);
  if (result.length > max) throw new Error(`${field}: máximo ${max} caracteres.`);
  return result;
}

export function cleanFeedReaction(kind: string, emoji: string): { kind: FeedTargetKind; emoji: FeedReactionEmoji } {
  if (!isFeedTargetKind(kind)) throw new Error('No se puede reaccionar a ese contenido.');
  if (!isFeedReaction(emoji)) throw new Error('Esa reacción no está disponible.');
  return { kind, emoji };
}

export const cleanFeedPost = (value: string) => text(value, 'La publicación', FEED_LIMITS.post);
export const cleanFeedComment = (value: string) => text(value, 'El comentario', FEED_LIMITS.comment);

/** Clave estable de una reacción: una por persona y contenido. */
export const feedReactionKey = (kind: FeedTargetKind, targetId: string, memberId: string) =>
  `${kind}:${targetId}:${memberId}`;
