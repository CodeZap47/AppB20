import type { Id } from '../data/types';

export interface ChatMessage {
  id: Id;
  senderId: Id;
  text: string;
  sentAt: Date;
}

/** Mensajes seguidos del mismo autor, que se dibujan juntos bajo un solo nombre. */
export interface MessageRun {
  key: Id;
  senderId: Id;
  messages: ChatMessage[];
}

export interface MessageDay {
  key: string;
  date: Date;
  runs: MessageRun[];
}

/** Pasado este tiempo sin escribir, el mismo autor empieza un grupo nuevo. */
const RUN_GAP_MS = 5 * 60_000;

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Agrupa mensajes ya ordenados por fecha en días y, dentro de cada día, por autor. */
export function groupByDay(messages: ChatMessage[]): MessageDay[] {
  const days: MessageDay[] = [];
  for (const message of messages) {
    const key = dayKey(message.sentAt);
    let day = days.at(-1);
    if (day?.key !== key) {
      day = { key, date: message.sentAt, runs: [] };
      days.push(day);
    }
    const run = day.runs.at(-1);
    const previous = run?.messages.at(-1);
    if (
      run &&
      previous &&
      run.senderId === message.senderId &&
      message.sentAt.getTime() - previous.sentAt.getTime() < RUN_GAP_MS
    ) {
      run.messages.push(message);
    } else {
      day.runs.push({ key: message.id, senderId: message.senderId, messages: [message] });
    }
  }
  return days;
}

export type InlinePart =
  | { kind: 'plain'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type TextBlock = { kind: 'code'; text: string } | { kind: 'text'; parts: InlinePart[] };

const INLINE = /`([^`\n]+)`|(https?:\/\/[^\s<>"'`]+)/g;
/** Puntuación que suele quedar pegada al final de un enlace sin ser parte de él. */
const TRAILING = /[.,;:!?)\]»”]+$/;

function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let cursor = 0;
  const plain = (value: string) => {
    if (!value) return;
    const last = parts.at(-1);
    if (last?.kind === 'plain') last.text += value;
    else parts.push({ kind: 'plain', text: value });
  };
  for (const match of text.matchAll(INLINE)) {
    plain(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    if (match[1] !== undefined) {
      parts.push({ kind: 'code', text: match[1] });
      continue;
    }
    const raw = match[2] ?? '';
    const href = raw.replace(TRAILING, '');
    parts.push({ kind: 'link', text: href, href });
    plain(raw.slice(href.length));
  }
  plain(text.slice(cursor));
  return parts;
}

/**
 * Divide el texto de un mensaje en párrafos y bloques de código delimitados por ```.
 * Dentro de los párrafos reconoce enlaces http(s) y `código en línea`. Nunca interpreta HTML.
 */
export function parseMessageText(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  text.split(/```[^\n]*\n?/).forEach((chunk, i) => {
    if (i % 2 === 1) {
      const code = chunk.replace(/\n$/, '');
      if (code) blocks.push({ kind: 'code', text: code });
    } else if (chunk.trim()) {
      blocks.push({ kind: 'text', parts: parseInline(chunk.trim()) });
    }
  });
  return blocks;
}

/** Vista previa de una línea para la lista de conversaciones. */
export function previewText(text: string): string {
  return text.replace(/```[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
}
