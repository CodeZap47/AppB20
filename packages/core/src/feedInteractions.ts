/** Referencias del feed, independientes de los objetivos de reacciones. */
export const FEED_RESOURCE_KINDS = [
  'assignment', 'activity', 'work', 'evidence', 'note', 'question', 'answer', 'guide',
  'poll', 'help', 'spaced', 'post', 'challenge', 'solution', 'review', 'review-comment',
  'opportunity', 'room', 'exam', 'ranking',
] as const;
export type FeedResourceKind = (typeof FEED_RESOURCE_KINDS)[number];
export interface FeedResourceRef { kind: FeedResourceKind; id: string }
export interface FeedThreadComment {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
  canDelete: boolean;
}
export interface FeedThread {
  target: FeedResourceRef;
  comments: FeedThreadComment[];
  canComment: boolean;
  maxLength: number;
  reason?: string;
}
export type FeedThreadCommand =
  | { action: 'read'; target: FeedResourceRef }
  | { action: 'comment'; target: FeedResourceRef; text: string; requestId: string }
  | { action: 'delete'; target: FeedResourceRef; commentId: string };
export interface FeedSharePreview {
  title: string;
  description: string;
  subject?: string;
  kindLabel: string;
  /** Ruta local validada; nunca una URL suministrada por quien comparte. */
  path: string;
}
export interface FeedShareRecord {
  id: string;
  target: FeedResourceRef;
  createdBy: string;
  createdAt: string;
  active: boolean;
  canRevoke: boolean;
}
export type FeedShareCommand =
  | { action: 'create'; target: FeedResourceRef; tokenHash: string }
  | { action: 'list'; target: FeedResourceRef }
  | { action: 'revoke'; id: string };
export interface CreatedFeedShare { id: string; preview: FeedSharePreview }
export interface FeedShareLink extends CreatedFeedShare { url: string }
export const feedResourceKey = (ref: FeedResourceRef) => `${ref.kind}:${ref.id}`;

/** Accept only canonical references. These values also become database/index keys. */
export function cleanFeedResource(value: unknown): FeedResourceRef {
  if (!value || typeof value !== 'object') throw new Error('Referencia no válida.');
  const ref = value as Record<string, unknown>;
  if (!FEED_RESOURCE_KINDS.includes(ref.kind as FeedResourceKind) || typeof ref.id !== 'string') throw new Error('Referencia no válida.');
  const kind = ref.kind as FeedResourceKind; const id = ref.id;
  if (kind === 'exam') {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) throw new Error('Referencia no válida.');
  } else if (kind === 'ranking') {
    if (!/^(?:parcial:[^|\s]{1,180}|mes:\d{4}-\d{2}-\d{2})\|[a-f0-9]{64}\|\d{1,16}$/.test(id)) throw new Error('Referencia no válida.');
  } else if (!/^[1-9][0-9]{0,19}$/.test(id) || BigInt(id) > 18446744073709551615n) throw new Error('Referencia no válida.');
  return { kind, id };
}

/** Plain, bounded metadata; never return markup, embedded media or stored file references. */
export function feedPreviewText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/```[\s\S]*?```/g, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\([^)]*(?:resource:|file:|attachment:)[^)]*\)/gi, ' ')
    .replace(/\b(?:resource|file|attachment):[^\s)]+/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[#*_`~]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
