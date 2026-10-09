import { celebrationDate } from '@b20/core';
import type { Assignment, Birthday, Id, Snapshot } from '../data/types';
import { formatDate, parseDay } from './format';

export type NewsKind =
  | 'tarea'
  | 'fecha'
  | 'trabajo'
  | 'nota'
  | 'actividad'
  | 'evidencia'
  | 'pregunta'
  | 'respuesta'
  | 'resuelta';

export interface NewsItem {
  key: string;
  kind: NewsKind;
  subjectId: Id | undefined;
  actorId: Id;
  text: string;
  link: string;
  at: Date;
}

export const NEWS_LABEL: Record<NewsKind, string> = {
  tarea: 'Tareas y actividades',
  fecha: 'Cambios de fecha',
  trabajo: 'Trabajos subidos',
  nota: 'Apuntes',
  actividad: 'Actividades',
  evidencia: 'Evidencias',
  pregunta: 'Preguntas',
  respuesta: 'Respuestas',
  resuelta: 'Resueltas',
};

/**
 * Novedades del grupo para «¿Qué me perdí?» (7.1), sin IA. Solo usa lo que el snapshot ya
 * permite ver (las notas personales ajenas nunca llegan) y omite lo que hizo el propio usuario.
 */
export function buildNews(snapshot: Snapshot): NewsItem[] {
  const meId = snapshot.me?.id;
  const assignmentOf = (id: Id) => snapshot.assignments.find((a) => a.id === id);
  const questionOf = (id: Id) => snapshot.questions.find((q) => q.id === id);
  const activityOf = (id: Id) => snapshot.activities.find((a) => a.id === id);
  const dateChanges = dueDateChanges(snapshot);

  const items: NewsItem[] = [
    ...dateChanges.map(({ assignment, revision }) => ({
      key: `f${revision.id}`,
      kind: 'fecha' as const,
      subjectId: assignment.subjectId,
      actorId: revision.editedBy,
      text: revision.dueDate
        ? `cambió la entrega de «${assignment.title}» al ${formatDate(parseDay(revision.dueDate))}`
        : `quitó la fecha de entrega de «${assignment.title}»`,
      link: `/m/tareas/${assignment.id}`,
      at: revision.editedAt,
    })),
    // Una página nueva la anuncia quien la creó; una edición, quien guardó la última versión.
    // Si esa edición fue un cambio de fecha, ya lo anuncia el aviso de arriba.
    ...snapshot.assignments
      .filter(
        (a) =>
          !dateChanges.some((c) => c.assignment.id === a.id && c.revision.version === a.version),
      )
      .map((a) => ({
        key: `t${a.id}`,
        kind: 'tarea' as const,
        subjectId: a.subjectId,
        actorId: a.updatedBy,
        text: `${a.version > 1 ? 'editó' : 'creó'} la página de «${a.title}»`,
        link: `/m/tareas/${a.id}`,
        at: a.updatedAt,
      })),
    ...snapshot.works.map((w) => {
      const assignment = assignmentOf(w.assignmentId);
      return {
        key: `w${w.id}`,
        kind: 'trabajo' as const,
        subjectId: assignment?.subjectId,
        actorId: w.authorIds[0] ?? '',
        text: `subió su trabajo a «${assignment?.title ?? 'una tarea'}»`,
        link: `/m/tareas/${w.assignmentId}?trabajo=${w.id}`,
        at: w.createdAt,
      };
    }),
    ...snapshot.notes
      .filter((n) => n.visibility === 'group')
      .map((n) => ({
        key: `n${n.id}`,
        kind: 'nota' as const,
        subjectId: n.subjectId,
        actorId: n.authorId,
        text:
          n.version > 1 ? `actualizó el apunte «${n.title}»` : `compartió el apunte «${n.title}»`,
        link: `/m/notas/${n.id}`,
        at: n.updatedAt,
      })),
    ...snapshot.activities.map((a) => ({
      key: `a${a.id}`,
      kind: 'actividad' as const,
      subjectId: a.subjectId,
      actorId: a.createdBy,
      text: `registró la actividad «${a.title}»`,
      link: `/m/actividades/${a.id}`,
      at: a.createdAt,
    })),
    ...snapshot.evidences.map((e) => ({
      key: `e${e.id}`,
      kind: 'evidencia' as const,
      subjectId: activityOf(e.activityId)?.subjectId,
      actorId: e.authorId,
      text: `subió evidencia a «${activityOf(e.activityId)?.title ?? 'una actividad'}»`,
      link: `/m/actividades/${e.activityId}`,
      at: e.createdAt,
    })),
    ...snapshot.questions.map((q) => ({
      key: `q${q.id}`,
      kind: 'pregunta' as const,
      subjectId: q.subjectId,
      actorId: q.authorId,
      text: `preguntó «${q.title}»`,
      link: `/m/preguntas/${q.id}`,
      at: q.createdAt,
    })),
    ...snapshot.answers.map((r) => ({
      key: `r${r.id}`,
      kind: 'respuesta' as const,
      subjectId: questionOf(r.questionId)?.subjectId,
      actorId: r.authorId,
      text: `respondió «${questionOf(r.questionId)?.title ?? 'una pregunta'}»`,
      link: `/m/preguntas/${r.questionId}`,
      at: r.createdAt,
    })),
    ...snapshot.questions
      .filter((q) => q.status === 'resolved' && q.resolvedAt)
      .map((q) => ({
        key: `s${q.id}`,
        kind: 'resuelta' as const,
        subjectId: q.subjectId,
        actorId: q.authorId,
        text: `aceptó una respuesta en «${q.title}»`,
        link: `/m/preguntas/${q.id}`,
        at: q.resolvedAt!,
      })),
  ];

  return items.filter((i) => i.actorId !== meId).sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Versiones de tareas que movieron o quitaron la fecha de entrega respecto a la anterior. */
function dueDateChanges(snapshot: Snapshot) {
  const changes: { assignment: Assignment; revision: Snapshot['revisions'][number] }[] = [];
  for (const assignment of snapshot.assignments) {
    const history = snapshot.revisions
      .filter((r) => r.page === 'assignment' && r.pageId === assignment.id)
      .sort((a, b) => a.version - b.version);
    for (let i = 1; i < history.length; i++) {
      const before = history[i - 1]!;
      const after = history[i]!;
      if ((before.dueDate || '') !== (after.dueDate || '')) {
        changes.push({ assignment, revision: after });
      }
    }
  }
  return changes;
}

const NOUNS: Record<NewsKind, [string, string]> = {
  tarea: ['tarea nueva o editada', 'tareas nuevas o editadas'],
  fecha: ['cambio de fecha', 'cambios de fecha'],
  trabajo: ['trabajo subido', 'trabajos subidos'],
  nota: ['apunte', 'apuntes'],
  actividad: ['actividad de clase', 'actividades de clase'],
  evidencia: ['evidencia', 'evidencias'],
  pregunta: ['pregunta', 'preguntas'],
  respuesta: ['respuesta', 'respuestas'],
  resuelta: ['pregunta resuelta', 'preguntas resueltas'],
};

const listFormat = new Intl.ListFormat('es-MX', { style: 'long', type: 'conjunction' });

/**
 * Resumen en una frase, sin IA: «2 apuntes, 1 cambio de fecha y 3 respuestas». Vacío si no hay
 * nada.
 */
export function summarizeNews(items: NewsItem[]): string {
  const counts = new Map<NewsKind, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const parts = (Object.keys(NOUNS) as NewsKind[])
    .filter((kind) => counts.has(kind))
    .map((kind) => {
      const n = counts.get(kind)!;
      return `${n} ${NOUNS[kind][n === 1 ? 0 : 1]}`;
    });
  return listFormat.format(parts);
}

/** Mensajes de otros desde `since` en el canal del salón y en tus conversaciones 1 a 1. */
export function unreadMessages(snapshot: Snapshot, since: Date | undefined) {
  const meId = snapshot.me?.id;
  const isNew = (m: { senderId: Id; sentAt: Date }) =>
    m.senderId !== meId && (!since || m.sentAt > since);
  const group = snapshot.groupMessages.filter(isNew);
  const direct = snapshot.directConversations
    .map((c) => ({
      conversation: c,
      otherId: c.participantIds.find((id) => id !== meId) ?? c.participantIds[0],
      count: snapshot.directMessages.filter((m) => m.conversationId === c.id && isNew(m)).length,
    }))
    .filter((c) => c.count > 0);
  return { group: group.length, direct };
}

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Entregas de hoy a `days` días, de la más próxima a la más lejana. */
export function upcomingDue(assignments: Assignment[], now: Date, days = 7) {
  const today = startOfDay(now).getTime();
  return assignments
    .filter((a) => a.dueDate)
    .map((a) => ({
      assignment: a,
      inDays: Math.round((parseDay(a.dueDate!).getTime() - today) / DAY_MS),
    }))
    .filter((d) => d.inDays >= 0 && d.inDays <= days)
    .sort((a, b) => a.inDays - b.inDays || a.assignment.title.localeCompare(b.assignment.title));
}

/** Quién cumple años hoy. */
export function birthdaysToday(birthdays: Birthday[], now: Date): Birthday[] {
  const today = startOfDay(now).getTime();
  return birthdays.filter((b) => celebrationDate(b, now.getFullYear()).getTime() === today);
}
