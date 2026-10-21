import type { Id, MessageFields } from '../data/types';

const MENTION = /\[\[mencion:([A-Za-z0-9_-]{1,128})\]\]/g;

/** Las menciones usan la identidad estable; el nombre visible puede cambiar. */
export function mentionToken(memberId: Id): string {
  return `[[mencion:${memberId}]]`;
}

export function mentionedMembers(text: string): Id[] {
  return [...new Set([...text.matchAll(MENTION)].map((match) => match[1]!))];
}

export function mentionParts(text: string): ({ kind: 'text'; text: string } | { kind: 'mention'; memberId: Id })[] {
  const parts: ReturnType<typeof mentionParts> = [];
  let position = 0;
  for (const match of text.matchAll(MENTION)) {
    if (match.index > position) parts.push({ kind: 'text', text: text.slice(position, match.index) });
    parts.push({ kind: 'mention', memberId: match[1]! });
    position = match.index + match[0].length;
  }
  if (position < text.length) parts.push({ kind: 'text', text: text.slice(position) });
  return parts;
}

/** Los avisos cuentan mensajes ajenos posteriores al último leído de esta conversación. */
export function unreadMessages(messages: MessageFields[], meId: Id | undefined, readThroughId?: Id): MessageFields[] {
  if (readThroughId && /^\d+$/.test(readThroughId) && messages.every((message) => /^\d+$/.test(message.id))) {
    const through = BigInt(readThroughId);
    return messages.filter((message) => BigInt(message.id) > through && message.senderId !== meId && !message.deletedAt);
  }
  const readIndex = readThroughId ? messages.findIndex((message) => message.id === readThroughId) : -1;
  return messages.slice(readIndex + 1).filter((message) => message.senderId !== meId && !message.deletedAt);
}

export function chatTarget(scope: 'group' | 'direct' | 'channel'): 'group_message' | 'direct_message' | 'channel_message' {
  return scope === 'group' ? 'group_message' : scope === 'direct' ? 'direct_message' : 'channel_message';
}
