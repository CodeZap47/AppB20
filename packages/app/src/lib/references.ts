import { WORK_KIND_LABEL } from '@b20/core';
import type { Id, Snapshot } from '../data/types';
import { formatDate, memberName, parseDay } from './format';
import { matches } from './search';
import { previewText } from './messages';

/**
 * Referencias dentro de un mensaje: `[[tarea:t1]]`, `[[trabajo:w1]]`, `[[sticker:s1]]`…
 * Viven en el texto, así que funcionan igual en el canal, en un 1 a 1 y en cualquier fuente
 * de datos; quien no tenga acceso a lo referido ve «ya no está disponible».
 */
export const REFERENCE_KINDS = [
  'tarea',
  'trabajo',
  'clase',
  'nota',
  'pregunta',
  'sticker',
] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];
/** Las que se muestran como tarjeta con enlace (todas menos los stickers). */
export type LinkKind = Exclude<ReferenceKind, 'sticker'>;

export interface Reference {
  kind: ReferenceKind;
  id: Id;
}

export const LINK_KINDS: Record<LinkKind, { label: string; command: string; hint: string }> = {
  tarea: {
    label: 'Tarea o actividad',
    command: 'tarea',
    hint: 'Citar una tarea, actividad, exposición o examen',
  },
  trabajo: {
    label: 'Trabajo',
    command: 'trabajo',
    hint: 'Citar el trabajo que subió un compañero',
  },
  clase: {
    label: 'Actividad de clase',
    command: 'clase',
    hint: 'Citar lo que se hizo en una clase',
  },
  nota: { label: 'Nota', command: 'nota', hint: 'Citar una nota de clase' },
  pregunta: {
    label: 'Pregunta',
    command: 'pregunta',
    hint: 'Citar una duda de Preguntas y respuestas',
  },
};

const TOKEN = /\[\[(tarea|trabajo|clase|nota|pregunta|sticker):([A-Za-z0-9_-]{1,40})\]\]/g;

export function formatReference(kind: ReferenceKind, id: Id): string {
  return `[[${kind}:${id}]]`;
}

/** Referencias en el orden en que aparecen, sin repetir. */
export function referencesIn(text: string): Reference[] {
  const seen = new Set<string>();
  const refs: Reference[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const key = `${match[1]}:${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ kind: match[1] as ReferenceKind, id: match[2] as Id });
  }
  return refs;
}

/** El texto sin las referencias, para mostrarlas aparte como tarjetas. */
export function stripReferences(text: string): string {
  return text
    .replace(TOKEN, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Si el mensaje es solo un sticker, su id: se dibuja grande y sin burbuja. */
export function stickerOnly(text: string): Id | undefined {
  const match = /^\[\[sticker:([A-Za-z0-9_-]{1,40})\]\]$/.exec(text.trim());
  return match?.[1];
}

export interface ResolvedReference {
  kind: LinkKind;
  id: Id;
  label: string;
  title: string;
  context: string;
  link: string;
}

/** Datos para la tarjeta de una referencia, o undefined si no existe o no tienes acceso. */
export function resolveReference(ref: Reference, data: Snapshot): ResolvedReference | undefined {
  if (ref.kind === 'sticker') return undefined;
  const subject = (id: Id | undefined) => data.subjects.find((s) => s.id === id)?.name ?? '';
  const term = (id: Id | undefined) => data.terms.find((t) => t.id === id)?.name ?? '';
  const join = (...parts: string[]) => parts.filter(Boolean).join(' · ');
  const base = { kind: ref.kind, id: ref.id };
  switch (ref.kind) {
    case 'tarea': {
      const a = data.assignments.find((x) => x.id === ref.id);
      if (!a) return undefined;
      return {
        ...base,
        label: WORK_KIND_LABEL[a.kind],
        title: a.title,
        context: join(
          subject(a.subjectId),
          term(a.termId),
          a.dueDate ? `Entrega ${formatDate(parseDay(a.dueDate))}` : '',
        ),
        link: `/m/tareas/${a.id}`,
      };
    }
    case 'trabajo': {
      const w = data.works.find((x) => x.id === ref.id);
      const a = data.assignments.find((x) => x.id === w?.assignmentId);
      if (!w || !a) return undefined;
      const authors = w.authorIds.map((id) => memberName(data.members, id)).join(', ');
      return {
        ...base,
        label: 'Trabajo',
        title: w.title || a.title,
        context: join(authors, subject(a.subjectId), w.title ? a.title : ''),
        link: `/m/tareas/${a.id}?trabajo=${w.id}`,
      };
    }
    case 'clase': {
      const a = data.activities.find((x) => x.id === ref.id);
      if (!a) return undefined;
      return {
        ...base,
        label: 'Actividad de clase',
        title: a.title,
        context: join(subject(a.subjectId), formatDate(parseDay(a.date))),
        link: `/m/actividades/${a.id}`,
      };
    }
    case 'nota': {
      const n = data.notes.find((x) => x.id === ref.id);
      if (!n) return undefined;
      return {
        ...base,
        label: 'Nota',
        title: n.title,
        context: join(subject(n.subjectId), n.topic),
        link: `/m/notas/${n.id}`,
      };
    }
    case 'pregunta': {
      const q = data.questions.find((x) => x.id === ref.id);
      if (!q) return undefined;
      return {
        ...base,
        label: q.status === 'resolved' ? 'Pregunta resuelta' : 'Pregunta',
        title: q.title,
        context: join(subject(q.subjectId), q.topic),
        link: `/m/preguntas/${q.id}`,
      };
    }
  }
}

/** Opciones para el selector de una referencia, filtradas por lo que se escribe. */
export function searchReferences(
  kind: LinkKind,
  query: string,
  data: Snapshot,
  limit = 8,
): ResolvedReference[] {
  const ids: Id[] = (() => {
    switch (kind) {
      case 'tarea':
        return [...data.assignments]
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .map((x) => x.id);
      case 'trabajo':
        return [...data.works]
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .map((x) => x.id);
      case 'clase':
        return [...data.activities].sort((a, b) => b.date.localeCompare(a.date)).map((x) => x.id);
      case 'nota':
        // Una nota personal no se ofrece: nadie más podría abrirla.
        return data.notes
          .filter((n) => n.visibility === 'group')
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .map((x) => x.id);
      case 'pregunta':
        return [...data.questions]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((x) => x.id);
    }
  })();
  const results: ResolvedReference[] = [];
  for (const id of ids) {
    const ref = resolveReference({ kind, id }, data);
    if (ref && matches(query, ref.title, ref.context, ref.label)) results.push(ref);
    if (results.length >= limit) break;
  }
  return results;
}

/** Vista previa de un mensaje en la lista de conversaciones. */
export function messagePreview(message: { text: string; deletedAt?: Date }): string {
  if (message.deletedAt) return 'Mensaje eliminado';
  if (stickerOnly(message.text)) return 'Sticker';
  const text = previewText(stripReferences(message.text));
  const refs = referencesIn(message.text).filter((r) => r.kind !== 'sticker').length;
  if (!refs) return text || 'Sticker';
  const label = refs === 1 ? '1 referencia' : `${refs} referencias`;
  return text ? `${text} · ${label}` : label;
}
