import { celebrationDate, type ExamSummary, type FeedTargetKind } from '@b20/core';
import type { Assignment, Birthday, FeedPost, Id, Note, Snapshot } from '../data/types';
import { formatDate, memberName, parseDay } from './format';
import { unreadMessages as unreadChatMessages } from './chat';
import { leaderChanges } from './contributions';
import { previewText } from './messages';

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
  | 'repaso'
  | 'publicacion'
  | 'ranking'
  | 'reto'
  | 'solucion'
  | 'revision'
  | 'observacion'
  | 'museo'
  | 'oportunidad'
  | 'sala'
  | 'examen';

export interface NewsItem {
  key: string;
  kind: NewsKind;
  subjectId: Id | undefined;
  actorId: Id;
  text: string;
  link: string;
  at: Date;
  /**
   * Contenido al que apunta el aviso; ahí se guardan las reacciones del feed. Los avisos
   * derivados (como el #1 del ranking) no tienen y no admiten reacciones.
   */
  target?: { kind: FeedTargetKind; id: Id };
  /** Recurso del módulo; no amplía los objetivos de reacciones admitidos por el servidor. */
  resource?: { kind: string; id: Id };
  /** Extracto del contenido para la vista Feed; la Clásica no lo muestra. */
  preview?: string;
  /** El mismo aviso en segunda persona, para cuando quien lo ve es quien lo hizo. */
  selfText?: string;
}

export const NEWS_LABEL: Record<NewsKind, string> = {
  tarea: 'Tareas y actividades',
  fecha: 'Cambios de fecha',
  trabajo: 'Trabajos subidos',
  nota: 'Notas de clase',
  actividad: 'Actividades',
  evidencia: 'Evidencias',
  pregunta: 'Preguntas',
  respuesta: 'Respuestas',
  resuelta: 'Resueltas',
  guia: 'Guías',
  votacion: 'Votaciones abiertas',
  ayuda: 'Ayuda entre compañeros',
  repaso: 'Colecciones de repaso',
  publicacion: 'Publicaciones',
  ranking: 'Ranking',
  reto: 'Retos',
  solucion: 'Soluciones de retos',
  revision: 'Revisiones de código',
  observacion: 'Observaciones de código',
  museo: 'Museo de bugs',
  oportunidad: 'Oportunidades',
  sala: 'Salas de estudio',
  examen: 'Exámenes de estudio',
};

/**
 * Novedades del grupo para «¿Qué me perdí?» (7.1), sin IA. Solo usa lo que el snapshot ya
 * permite ver (las notas personales ajenas nunca llegan) y omite lo que hizo el propio usuario.
 */
export function buildNews(snapshot: Snapshot, now = new Date(), sharedExams: ExamSummary[] = []): NewsItem[] {
  return newsCatalog(snapshot, now, sharedExams).filter((item) => item.actorId !== snapshot.me?.id);
}

/** Catálogo común: una sola tarjeta por recurso, tanto para actividad propia como ajena. */
function newsCatalog(snapshot: Snapshot, now: Date, sharedExams: ExamSummary[]): NewsItem[] {
  if (!snapshot.me || snapshot.me.status !== 'active') return [];
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
      target: { kind: 'assignment' as const, id: assignment.id },
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
        target: { kind: 'assignment' as const, id: a.id },
        preview: excerpt(a.instructions),
      })),
    ...snapshot.works.filter((work) => !work.withdrawnAt && work.status !== 'draft').map((w) => {
      const assignment = assignmentOf(w.assignmentId);
      return {
        key: `w${w.id}`,
        kind: 'trabajo' as const,
        subjectId: assignment?.subjectId,
        actorId: w.authorIds[0] ?? '',
        text: `subió su trabajo a «${assignment?.title ?? 'una tarea'}»`,
        selfText: `subiste tu trabajo a «${assignment?.title ?? 'una tarea'}»`,
        link: `/m/tareas/${w.assignmentId}?trabajo=${w.id}`,
        at: w.createdAt,
        target: { kind: 'work' as const, id: w.id },
        preview: excerpt(w.description),
      };
    }),
    ...sharedNotes(snapshot).map(noteNews),
    ...snapshot.activities.map((a) => ({
      key: `a${a.id}`,
      kind: 'actividad' as const,
      subjectId: a.subjectId,
      actorId: a.createdBy,
      text: `registró la actividad «${a.title}»`,
      link: `/m/actividades/${a.id}`,
      at: a.createdAt,
      target: { kind: 'activity' as const, id: a.id },
      preview: excerpt(a.instructions),
    })),
    ...snapshot.evidences.filter((evidence) => !evidence.withdrawnAt).map((e) => ({
      key: `e${e.id}`,
      kind: 'evidencia' as const,
      subjectId: activityOf(e.activityId)?.subjectId,
      actorId: e.authorId,
      text: `subió evidencia a «${activityOf(e.activityId)?.title ?? 'una actividad'}»`,
      link: `/m/actividades/${e.activityId}`,
      at: e.createdAt,
      target: { kind: 'evidence' as const, id: e.id },
      preview: excerpt(e.content),
    })),
    ...snapshot.questions.filter((question) => !question.withdrawnAt).map((q) => {
      const museum = snapshot.museumEntries.find((entry) => entry.questionId === q.id);
      return ({
      key: `q${q.id}`,
      kind: museum ? 'museo' as const : 'pregunta' as const,
      subjectId: q.subjectId,
      actorId: museum?.updatedBy ?? q.authorId,
      text: museum ? `${museum.version > 1 ? 'actualizó' : 'compartió'} el bug «${q.title}»` : `preguntó «${q.title}»`,
      link: `/m/preguntas/${q.id}`,
      at: museum?.updatedAt ?? q.createdAt,
      target: { kind: 'question' as const, id: q.id },
      resource: museum ? { kind: 'museum', id: q.id } : undefined,
      preview: excerpt(museum?.symptom ?? q.body),
    }); }),
    ...snapshot.answers.filter((answer) => !answer.withdrawnAt && questionOf(answer.questionId) && !questionOf(answer.questionId)!.withdrawnAt).map((r) => ({
      key: `r${r.id}`,
      kind: 'respuesta' as const,
      subjectId: questionOf(r.questionId)?.subjectId,
      actorId: r.authorId,
      text: `respondió «${questionOf(r.questionId)?.title ?? 'una pregunta'}»`,
      link: `/m/preguntas/${r.questionId}`,
      at: r.createdAt,
      target: { kind: 'answer' as const, id: r.id },
      preview: excerpt(r.body),
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
        target: { kind: 'question' as const, id: q.id },
      })),
    ...snapshot.guides.filter((guide) => !guide.withdrawnAt).map((guide) => ({
      key: `g${guide.id}`,
      kind: 'guia' as const,
      subjectId: guide.subjectId,
      actorId: guide.updatedBy,
      text: `${guide.version > 1 ? 'actualizó' : 'publicó'} la guía «${guide.title}»`,
      link: `/m/guias/${guide.id}`,
      at: guide.updatedAt,
      target: { kind: 'guide' as const, id: guide.id },
      preview: excerpt(guide.topics.join(' · ')),
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
        target: { kind: 'poll' as const, id: poll.id },
        preview: excerpt(poll.description),
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
        target: { kind: 'help' as const, id: post.id },
        preview: excerpt(post.description),
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
        target: { kind: 'spaced' as const, id: collection.id },
      })),
    ...moduleNews(snapshot, sharedExams),
    ...snapshot.feedPosts.map(postNews),
    ...rankingNews(snapshot, now),
  ];

  return [...new Map(items.filter((item) => item.actorId).map((item) => [item.key, { ...item, selfText: item.selfText ?? ownText(item.text) }])).values()]
    .sort((a, b) => b.at.getTime() - a.at.getTime() || a.key.localeCompare(b.key));
}

/** Una publicación del feed como novedad; su texto completo lo muestra la tarjeta. */
function postNews(post: FeedPost): NewsItem {
  return {
    key: `fp${post.id}`,
    kind: 'publicacion',
    subjectId: post.subjectId,
    actorId: post.authorId,
    text: 'publicó en el grupo',
    link: `/m/inicio?vista=feed&publicacion=${post.id}`,
    at: post.createdAt,
    target: { kind: 'post', id: post.id },
    preview: excerpt(post.text),
  };
}

const sharedNotes = (snapshot: Snapshot) => snapshot.notes.filter((n) => n.visibility === 'group' && !n.withdrawnAt);

/** Una nota de clase compartida con el grupo; las personales nunca son novedad. */
function noteNews(note: Note): NewsItem {
  const verb = note.version > 1 ? ['actualizó', 'actualizaste'] : ['compartió', 'compartiste'];
  return {
    key: `n${note.id}`,
    kind: 'nota',
    subjectId: note.subjectId,
    actorId: note.authorId,
    text: `${verb[0]} la nota de clase «${note.title}»`,
    selfText: `${verb[1]} la nota de clase «${note.title}»`,
    link: `/m/notas/${note.id}`,
    at: note.updatedAt,
    target: { kind: 'note', id: note.id },
    preview: excerpt([note.topic, note.body].filter(Boolean).join(' · ')),
  };
}

/** Quién llegó al #1 del ranking del periodo vigente, sin reacciones: es un aviso derivado. */
function rankingNews(snapshot: Snapshot, now: Date): NewsItem[] {
  const meId = snapshot.me?.id;
  const names = (ids: Id[]) => listFormat.format(ids.map((id) => (id === meId ? 'contigo' : memberName(snapshot.members, id))));
  return leaderChanges(snapshot, now).map((change) => ({
    key: `rk${change.memberId}-${change.at.getTime()}`,
    kind: 'ranking',
    subjectId: undefined,
    actorId: change.memberId,
    text: change.tiedWith.length
      ? `empató el #1 del ranking con ${names(change.tiedWith)} · ${change.periodLabel}`
      : `llegó al #1 del ranking · ${change.periodLabel}`,
    selfText: change.tiedWith.length
      ? `empataste el #1 del ranking con ${names(change.tiedWith)} · ${change.periodLabel}`
      : `llegaste al #1 del ranking · ${change.periodLabel}`,
    link: '/m/leaderboard',
    at: change.at,
    preview: `${change.points} ${change.points === 1 ? 'punto' : 'puntos'} en ese momento`,
  }));
}

/** Todos los aportes propios publicados; los borradores y recursos privados quedan fuera. */
export function ownFeedNews(snapshot: Snapshot, now = new Date(), sharedExams: ExamSummary[] = []): NewsItem[] {
  return newsCatalog(snapshot, now, sharedExams).filter((item) => item.actorId === snapshot.me?.id);
}

/** Los verbos del catálogo se conjugan una sola vez, sin cambiar el contenido de los títulos. */
function ownText(text: string): string {
  const verbs: Record<string, string> = { cambió: 'cambiaste', quitó: 'quitaste', editó: 'editaste', creó: 'creaste', subió: 'subiste',
    compartió: 'compartiste', actualizó: 'actualizaste', registró: 'registraste', preguntó: 'preguntaste', respondió: 'respondiste',
    aceptó: 'aceptaste', publicó: 'publicaste', abrió: 'abriste', organizó: 'organizaste', propuso: 'propusiste' };
  return text.replace(/^\S+/, (verb) => verbs[verb] ?? verb);
}

/** Nuevos módulos compartidos: nunca se usan prácticas, progreso ni conversaciones privadas. */
function moduleNews(snapshot: Snapshot, sharedExams: ExamSummary[]): NewsItem[] {
  const challengeOf = (id: Id) => snapshot.codingChallenges.find((entry) => entry.id === id);
  const reviewOf = (id: Id) => snapshot.codeReviews.find((entry) => entry.id === id);
  return [
    ...snapshot.codingChallenges.map((entry) => ({
      key: `ch${entry.id}`, kind: 'reto' as const, subjectId: entry.subjectId, actorId: entry.authorId,
      text: `${entry.version > 1 ? 'actualizó' : 'publicó'} el reto «${entry.title}»`, link: `/m/retos/${entry.id}`,
      at: entry.updatedAt, resource: { kind: 'challenge', id: entry.id }, preview: excerpt(entry.objective),
    })),
    ...snapshot.challengeSolutions.filter((entry) => challengeOf(entry.challengeId)).map((entry) => ({
      key: `cs${entry.id}`, kind: 'solucion' as const, subjectId: challengeOf(entry.challengeId)!.subjectId, actorId: entry.authorId,
      text: `${entry.version > 1 ? 'actualizó' : 'compartió'} una solución de «${challengeOf(entry.challengeId)!.title}»`,
      link: `/m/retos/${entry.challengeId}?solucion=${encodeURIComponent(entry.id)}`, at: entry.updatedAt,
      resource: { kind: 'solution', id: entry.id }, preview: excerpt(entry.explanation),
    })),
    ...snapshot.codeReviews.map((entry) => ({
      key: `cr${entry.id}`, kind: 'revision' as const, subjectId: entry.subjectId, actorId: entry.authorId,
      text: `${entry.currentVersion > 1 ? 'actualizó' : 'publicó'} la revisión de código «${entry.title}»`,
      link: `/m/revision-codigo/${entry.id}`, at: entry.updatedAt,
      resource: { kind: 'review', id: entry.id },
      preview: excerpt(snapshot.codeReviewVersions.find((version) => version.reviewId === entry.id && version.number === entry.currentVersion)?.summary),
    })),
    ...snapshot.codeReviewComments.filter((entry) => reviewOf(entry.reviewId)).map((entry) => ({
      key: `cc${entry.id}`, kind: 'observacion' as const, subjectId: reviewOf(entry.reviewId)!.subjectId, actorId: entry.authorId,
      text: `publicó una observación en «${reviewOf(entry.reviewId)!.title}»`, link: `/m/revision-codigo/${entry.reviewId}?observacion=${encodeURIComponent(entry.id)}`,
      at: entry.updatedAt, resource: { kind: 'review-comment', id: entry.id }, preview: excerpt(entry.body),
    })),
    ...snapshot.opportunities.filter((entry) => !entry.withdrawn).map((entry) => ({
      key: `op${entry.id}`, kind: 'oportunidad' as const, subjectId: undefined, actorId: entry.updatedBy,
      text: `${entry.version > 1 ? 'actualizó' : 'compartió'} la oportunidad «${entry.title}»`, link: `/m/oportunidades?oportunidad=${encodeURIComponent(entry.id)}`,
      at: entry.updatedAt, resource: { kind: 'opportunity', id: entry.id }, preview: excerpt(entry.requirements),
    })),
    ...snapshot.studyRooms.filter((entry) => entry.visibility === 'group').map((entry) => ({
      key: `room${entry.id}`, kind: 'sala' as const, subjectId: entry.subjectId, actorId: entry.organizerId,
      text: `${entry.version > 1 ? 'actualizó' : 'organizó'} la sala «${entry.title}»`, link: `/m/salas/${entry.id}`,
      at: entry.updatedAt, resource: { kind: 'room', id: entry.id }, preview: excerpt(entry.objective),
    })),
    ...sharedExams.filter((entry) => entry.visibility === 'group' && entry.readyVersion && !entry.archived).map((entry) => ({
      key: `exam${entry.id}`, kind: 'examen' as const, subjectId: entry.subjectId, actorId: entry.ownerId,
      text: `compartió el examen de estudio «${entry.title}»`, link: `/m/examenes/${entry.id}`,
      at: new Date(entry.updatedAt), resource: { kind: 'exam', id: entry.id }, preview: excerpt(entry.topics.join(' · ')),
    })),
  ];
}

const PREVIEW_LENGTH = 280;

/** Extracto de una línea para la tarjeta del feed; vacío si no hay texto. */
function excerpt(text: string | undefined): string | undefined {
  const clean = previewText(text ?? '');
  if (!clean) return undefined;
  return clean.length > PREVIEW_LENGTH ? `${clean.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…` : clean;
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
  nota: ['nota de clase', 'notas de clase'],
  actividad: ['actividad de clase', 'actividades de clase'],
  evidencia: ['evidencia', 'evidencias'],
  pregunta: ['pregunta', 'preguntas'],
  respuesta: ['respuesta', 'respuestas'],
  resuelta: ['pregunta resuelta', 'preguntas resueltas'],
  guia: ['guía nueva o editada', 'guías nuevas o editadas'],
  votacion: ['votación abierta', 'votaciones abiertas'],
  ayuda: ['publicación de ayuda', 'publicaciones de ayuda'],
  repaso: ['colección de repaso', 'colecciones de repaso'],
  publicacion: ['publicación', 'publicaciones'],
  ranking: ['cambio en el #1 del ranking', 'cambios en el #1 del ranking'],
  reto: ['reto', 'retos'],
  solucion: ['solución de reto', 'soluciones de retos'],
  revision: ['revisión de código', 'revisiones de código'],
  observacion: ['observación de código', 'observaciones de código'],
  museo: ['bug documentado', 'bugs documentados'],
  oportunidad: ['oportunidad', 'oportunidades'],
  sala: ['sala de estudio', 'salas de estudio'],
  examen: ['examen de estudio', 'exámenes de estudio'],
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
