import { celebrationDate } from '@b20/core';
import type { Assignment, Birthday, Id, Snapshot } from '../data/types';
import { formatDate, parseDay } from './format';
import { unreadMessages as unreadChatMessages } from './chat';

export type NewsKind =
  | 'tarea'
  | 'fecha'
  | 'trabajo'
  | 'nota'
  | 'actividad'
  | 'evidencia'
  | 'pregunta'
  | 'respuesta'
  | 'resuelta'
  | 'guia'
  | 'votacion'
  | 'ayuda'
  | 'repaso';

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
  guia: 'Guías',
  votacion: 'Votaciones abiertas',
  ayuda: 'Ayuda entre compañeros',
  repaso: 'Colecciones de repaso',
};

/**
 * Novedades del grupo para «¿Qué me perdí?» (7.1), sin IA. Solo usa lo que el snapshot ya
 * permite ver (las notas personales ajenas nunca llegan) y omite lo que hizo el propio usuario.
 */
export function buildNews(snapshot: Snapshot, now = new Date()): NewsItem[] {
  if (!snapshot.me || snapshot.me.status !== 'active') return [];
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
    ...snapshot.works.filter((work) => !work.withdrawnAt && work.status !== 'draft').map((w) => {
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
      .filter((n) => n.visibility === 'group' && !n.withdrawnAt)
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
    ...snapshot.evidences.filter((evidence) => !evidence.withdrawnAt).map((e) => ({
      key: `e${e.id}`,
      kind: 'evidencia' as const,
      subjectId: activityOf(e.activityId)?.subjectId,
      actorId: e.authorId,
      text: `subió evidencia a «${activityOf(e.activityId)?.title ?? 'una actividad'}»`,
      link: `/m/actividades/${e.activityId}`,
      at: e.createdAt,
    })),
    ...snapshot.questions.filter((question) => !question.withdrawnAt).map((q) => ({
      key: `q${q.id}`,
      kind: 'pregunta' as const,
      subjectId: q.subjectId,
      actorId: q.authorId,
      text: `preguntó «${q.title}»`,
      link: `/m/preguntas/${q.id}`,
      at: q.createdAt,
    })),
    ...snapshot.answers.filter((answer) => !answer.withdrawnAt && questionOf(answer.questionId) && !questionOf(answer.questionId)!.withdrawnAt).map((r) => ({
      key: `r${r.id}`,
      kind: 'respuesta' as const,
      subjectId: questionOf(r.questionId)?.subjectId,
      actorId: r.authorId,
      text: `respondió «${questionOf(r.questionId)?.title ?? 'una pregunta'}»`,
      link: `/m/preguntas/${r.questionId}`,
      at: r.createdAt,
    })),
    ...snapshot.questions
      .filter((q) => q.status === 'resolved' && q.resolvedAt && !q.withdrawnAt)
      .map((q) => ({
        key: `s${q.id}`,
        kind: 'resuelta' as const,
        subjectId: q.subjectId,
        actorId: q.authorId,
        text: `aceptó una respuesta en «${q.title}»`,
        link: `/m/preguntas/${q.id}`,
        at: q.resolvedAt!,
      })),
    ...snapshot.guides.filter((guide) => !guide.withdrawnAt).map((guide) => ({
      key: `g${guide.id}`,
      kind: 'guia' as const,
      subjectId: guide.subjectId,
      actorId: guide.updatedBy,
      text: `${guide.version > 1 ? 'actualizó' : 'publicó'} la guía «${guide.title}»`,
      link: `/m/guias/${guide.id}`,
      at: guide.updatedAt,
    })),
    ...snapshot.polls
      .filter((poll) => !poll.cancelledAt && poll.closesAt > now)
      .map((poll) => ({
        key: `p${poll.id}`,
        kind: 'votacion' as const,
        subjectId: undefined,
        actorId: poll.createdBy,
        text: `abrió la votación «${poll.title}»`,
        link: `/m/votaciones/${poll.id}`,
        at: poll.updatedAt,
      })),
    ...snapshot.helpPosts
      .filter((post) => post.status === 'open')
      .map((post) => ({
        key: `h${post.id}`,
        kind: 'ayuda' as const,
        subjectId: post.subjectId,
        actorId: post.authorId,
        text: `publicó «${post.title}» en ayuda entre compañeros`,
        link: `/m/ayuda/${post.id}`,
        at: post.updatedAt,
      })),
    ...snapshot.spacedCollections
      .filter((collection) => collection.visibility === 'group' && !collection.archived)
      .map((collection) => ({
        key: `srs${collection.id}`,
        kind: 'repaso' as const,
        subjectId: collection.subjectId,
        actorId: collection.updatedBy,
        text: `${collection.version > 1 ? 'actualizó' : 'compartió'} la colección «${collection.title}»`,
        link: `/m/repaso/colecciones/${collection.id}`,
        at: collection.updatedAt,
      })),
  ];

  return [...new Map(items.filter((i) => i.actorId && i.actorId !== meId).map((i) => [i.key, i])).values()]
    .sort((a, b) => b.at.getTime() - a.at.getTime() || a.key.localeCompare(b.key));
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
  guia: ['guía nueva o editada', 'guías nuevas o editadas'],
  votacion: ['votación abierta', 'votaciones abiertas'],
  ayuda: ['publicación de ayuda', 'publicaciones de ayuda'],
  repaso: ['colección de repaso', 'colecciones de repaso'],
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
export function unreadMessages(snapshot: Snapshot, _since?: Date) {
  const meId = snapshot.me?.id;
  if (!meId) return { group: 0, direct: [], channels: [] };
  const stateOf = (scope: 'group' | 'direct' | 'channel', id: Id) =>
    (snapshot.conversationStates ?? []).find((state) => state.scope === scope && state.conversationId === id);
  const group = unreadChatMessages(snapshot.groupMessages, meId, stateOf('group', 'general')?.readThroughId);
  const direct = snapshot.directConversations
    .filter((c) => Boolean(meId && c.participantIds.includes(meId)))
    .map((c) => ({
      conversation: c,
      otherId: c.participantIds.find((id) => id !== meId) ?? c.participantIds[0],
      count: unreadChatMessages(snapshot.directMessages.filter((m) => m.conversationId === c.id), meId, stateOf('direct', c.id)?.readThroughId).length,
    }))
    .filter((c) => c.count > 0);
  const channels = (snapshot.chatChannels ?? []).filter((channel) => !channel.archivedAt).map((channel) => ({
    channel,
    count: unreadChatMessages((snapshot.channelMessages ?? []).filter((message) => message.channelId === channel.id), meId, stateOf('channel', channel.id)?.readThroughId).length,
  })).filter((entry) => entry.count > 0);
  return { group: group.length, direct, channels };
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
