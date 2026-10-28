import { cleanFeedResource, FEED_RESOURCE_KINDS, type FeedResourceKind } from './feedInteractions';

export const CHAT_POST_KINDS = [...FEED_RESOURCE_KINDS, 'signal-dictionary', 'visual-project'] as const;
export type ChatPostKind = (typeof CHAT_POST_KINDS)[number];
export interface ChatPostRef { kind: ChatPostKind; id: string }
export interface ChatPostPreview {
  target: ChatPostRef;
  available: boolean;
  title?: string;
  description?: string;
  kindLabel?: string;
  subject?: string;
  path?: string;
}
export const chatPostKey = (target: ChatPostRef) => `${target.kind}:${target.id}`;

/** Shape validation works with real IDs and synthetic demo IDs. Server uses strict=true. */
export function cleanChatPostRef(value: unknown, strict = false): ChatPostRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Publicación no válida.');
  const input = value as Record<string, unknown>;
  if (!(CHAT_POST_KINDS as readonly unknown[]).includes(input.kind) || typeof input.id !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9_:|.\-]{0,511}$/.test(input.id)) throw new Error('Publicación no válida.');
  const target = { kind: input.kind as ChatPostKind, id: input.id };
  if (strict) {
    if (target.kind === 'visual-project') {
      if (!/^[1-9][0-9]{0,19}$/.test(target.id) || BigInt(target.id) > 18446744073709551615n) throw new Error('Publicación no válida.');
    } else if (target.kind === 'signal-dictionary') {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(target.id)) throw new Error('Publicación no válida.');
    } else cleanFeedResource(target);
  }
  return target;
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function encodeChatPostRef(value: ChatPostRef): string {
  const target = cleanChatPostRef(value);
  const text = JSON.stringify({ v: 1, ...target });
  let result = '';
  for (let i = 0; i < text.length; i += 3) {
    const a = text.charCodeAt(i), b = text.charCodeAt(i + 1), c = text.charCodeAt(i + 2);
    result += alphabet[a >> 2]! + alphabet[((a & 3) << 4) | (Number.isNaN(b) ? 0 : b >> 4)]!;
    if (!Number.isNaN(b)) result += alphabet[((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6)]!;
    if (!Number.isNaN(c)) result += alphabet[c & 63]!;
  }
  return result;
}
export function decodeChatPostRef(value: string): ChatPostRef | undefined {
  if (!/^[A-Za-z0-9_-]{1,1536}$/.test(value) || value.length % 4 === 1) return;
  let text = '';
  for (let i = 0; i < value.length; i += 4) {
    const a = alphabet.indexOf(value[i]!), b = alphabet.indexOf(value[i + 1]!);
    const c = value[i + 2] === undefined ? -1 : alphabet.indexOf(value[i + 2]!);
    const d = value[i + 3] === undefined ? -1 : alphabet.indexOf(value[i + 3]!);
    text += String.fromCharCode((a << 2) | (b >> 4));
    if (c >= 0) text += String.fromCharCode(((b & 15) << 4) | (c >> 2));
    if (d >= 0) text += String.fromCharCode(((c & 3) << 6) | d);
  }
  try {
    const input: unknown = JSON.parse(text);
    if (!input || typeof input !== 'object' || !('v' in input) || input.v !== 1) return;
    const target = cleanChatPostRef(input);
    if (encodeChatPostRef(target) !== value) return;
    return target;
  } catch { return; }
}
export const formatChatPostReference = (target: ChatPostRef) => `[[recurso:${encodeChatPostRef(target)}]]`;
export function chatPostReferencesIn(text: string): ChatPostRef[] {
  const seen = new Set<string>(); const targets: ChatPostRef[] = [];
  for (const match of text.matchAll(/\[\[recurso:([A-Za-z0-9_-]{1,1536})\]\]/g)) {
    const target = decodeChatPostRef(match[1]!);
    if (target && !seen.has(chatPostKey(target))) { seen.add(chatPostKey(target)); targets.push(target); }
  }
  return targets;
}
export const isFeedChatPost = (target: ChatPostRef): target is { kind: FeedResourceKind; id: string } =>
  (FEED_RESOURCE_KINDS as readonly string[]).includes(target.kind);
