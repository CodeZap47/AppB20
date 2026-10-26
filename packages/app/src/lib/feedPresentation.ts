import { HELP_KIND_LABEL, HELP_LEVEL_LABEL, HELP_MODALITY_LABEL, type ExamSummary } from '@b20/core';
import type { IconName } from '../components/Icon';
import type { Id, Snapshot } from '../data/types';
import { leaderChanges } from './contributions';
import { formatMediumDate, memberName, parseDay } from './format';
import { NEWS_LABEL, type NewsItem } from './whatsNew';

export interface FeedPresentation {
  layout: 'assignment' | 'date' | 'submission' | 'document' | 'question' | 'answer' | 'guide' | 'poll' | 'help' | 'spaced' | 'challenge' | 'code' | 'museum' | 'opportunity' | 'room' | 'exam' | 'social' | 'achievement';
  label: string;
  icon: IconName;
  tone: 'blue' | 'violet' | 'amber' | 'green' | 'rose' | 'cyan' | 'slate';
  title: string;
  excerpt?: string;
  eyebrow?: string;
  status?: string;
  tags: string[];
  facts: { label: string; value: string }[];
  bullets?: string[];
  blocks?: { label: string; text: string }[];
  code?: string;
  files?: { id: string; name: string; size: number; contentType: string }[];
  dateChange?: { before?: string; after?: string };
  cta: string;
}

const assignmentLabels = { tarea: 'Tarea', actividad: 'Actividad académica', exposicion: 'Exposición', examen: 'Examen académico' };
const difficultyLabels = { basic: 'Básico', intermediate: 'Intermedio', advanced: 'Avanzado' };
const roomStatuses = { scheduled: 'Programada', active: 'En curso', completed: 'Finalizada', cancelled: 'Cancelada' };
const opportunityLabels: Record<string, string> = { contest: 'Concurso', course: 'Curso', scholarship: 'Beca', event: 'Evento', internship: 'Prácticas', other: 'Oportunidad' };
const modalityLabels: Record<string, string> = { online: 'En línea', in_person: 'Presencial', hybrid: 'Híbrida' };
const commentLabels = { error: 'Error', suggestion: 'Sugerencia', question: 'Pregunta de código' };
const resolutionLabels = { pending: 'Pendiente', applied: 'Aplicada', dismissed: 'Descartada' };
const dateTime = (value: Date) => value.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayLabel = (value?: string) => value ? formatMediumDate(parseDay(value)) : 'Sin fecha';
const cleanTags = (...values: (string | undefined)[]) => [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
const fact = (label: string, value: string | number | undefined) => ({ label, value: value === undefined || value === '' ? 'Sin especificar' : String(value) });

/** Modelo de lectura del feed. Obtiene los datos originales y nunca interpreta el texto del aviso. */
export function getFeedPresentation(item: NewsItem, snapshot: Snapshot, sharedExams: ExamSummary[] = []): FeedPresentation {
  const id = item.resource?.id ?? item.target?.id;
  const subject = snapshot.subjects.find((entry) => entry.id === item.subjectId)?.name;
  const termName = (termId?: Id) => snapshot.terms.find((entry) => entry.id === termId)?.name;
  const names = (ids: Id[]) => [...new Set(ids)].map((memberId) => memberName(snapshot.members, memberId)).join(', ');
  const base: FeedPresentation = { layout: 'social', label: NEWS_LABEL[item.kind], icon: 'file', tone: 'slate', title: NEWS_LABEL[item.kind], tags: cleanTags(subject), facts: [], cta: 'Ver publicación' };
  const present = (fields: Partial<FeedPresentation>): FeedPresentation => ({ ...base, ...fields });
  const filesFor = (kind: string, targetId: Id): NonNullable<FeedPresentation['files']> => {
    const linkedFiles = snapshot.resourceFiles.filter((file) => file.targetKind === kind && file.targetId === targetId);
    const files = linkedFiles.filter((file) => !file.removedAt);
    const current = files.map(({ id: fileId, name, size, contentType }) => ({ id: fileId, name, size, contentType }));
    if (kind !== 'work') return current;
    const legacy = snapshot.workFiles.filter((file) => file.workId === targetId && !linkedFiles.some((entry) => entry.id === file.id || entry.id === `legacy:${file.id}`));
    return [...current, ...legacy.map(({ id: fileId, name, size, contentType }) => ({ id: fileId, name, size, contentType }))];
  };

  switch (item.kind) {
    case 'tarea':
    case 'fecha': {
      const assignment = snapshot.assignments.find((entry) => entry.id === id);
      if (!assignment) break;
      const title = assignment.title;
      const label = assignmentLabels[assignment.kind];
      const tags = cleanTags(subject, termName(assignment.termId), assignment.topic);
      if (item.kind === 'fecha') {
        const revisions = snapshot.revisions.filter((entry) => entry.page === 'assignment' && entry.pageId === assignment.id).sort((a, b) => a.version - b.version);
        const index = revisions.findIndex((entry) => `f${entry.id}` === item.key);
        const revision = revisions[index];
        const before = revisions[index - 1];
        return present({ layout: 'date', label: 'Cambio de fecha', icon: 'calendar', tone: 'amber', title, tags,
          eyebrow: label, status: revision?.dueDate ? 'Entrega actualizada' : 'Fecha retirada',
          dateChange: { before: before?.dueDate, after: revision?.dueDate },
          facts: [fact('Entrega vigente', dayLabel(assignment.dueDate))], cta: 'Consultar entrega' });
      }
      return present({ layout: 'assignment', label, icon: 'calendar', tone: assignment.kind === 'examen' ? 'rose' : assignment.kind === 'exposicion' ? 'violet' : 'blue',
        title, excerpt: assignment.instructions, tags, status: assignment.dueDate ? 'Con fecha de entrega' : 'Sin fecha de entrega',
        facts: [fact('Entrega', dayLabel(assignment.dueDate)), fact('Versión', assignment.version)], cta: `Ver ${assignment.kind === 'exposicion' ? 'exposición' : assignment.kind === 'actividad' ? 'actividad' : assignment.kind}` });
    }
    case 'actividad': {
      const activity = snapshot.activities.find((entry) => entry.id === id);
      if (!activity) break;
      return present({ layout: 'assignment', label: 'Actividad de clase', icon: 'book', tone: 'cyan', title: activity.title,
        excerpt: activity.instructions, status: 'Registrada', tags: cleanTags(subject, termName(activity.termId), activity.topic),
        blocks: activity.objective ? [{ label: 'Objetivo', text: activity.objective }] : undefined,
        facts: [fact('Sesión', dayLabel(activity.date)), fact('Versión', activity.version)], cta: 'Ver actividad' });
    }
    case 'trabajo': {
      const work = snapshot.works.find((entry) => entry.id === id && !entry.withdrawnAt && entry.status !== 'draft');
      if (!work) break;
      const assignment = snapshot.assignments.find((entry) => entry.id === work.assignmentId);
      return present({ layout: 'submission', label: 'Trabajo', icon: 'upload', tone: 'green', title: work.title || assignment?.title || 'Trabajo compartido',
        excerpt: work.description, eyebrow: assignment?.title, status: work.status === 'reviewed' ? 'Revisado' : work.status === 'final' ? 'Versión final' : 'Compartido', tags: cleanTags(subject, work.topic),
        facts: [fact('Autores', names(work.authorIds)), fact('Versión', work.version)], files: filesFor('work', work.id), cta: 'Ver trabajo' });
    }
    case 'evidencia': {
      const evidence = snapshot.evidences.find((entry) => entry.id === id && !entry.withdrawnAt);
      if (!evidence) break;
      const activity = snapshot.activities.find((entry) => entry.id === evidence.activityId);
      return present({ layout: 'submission', label: 'Evidencia', icon: 'clip', tone: 'cyan', title: activity?.title ?? 'Evidencia de clase',
        excerpt: evidence.content, eyebrow: 'Actividad de origen', status: 'Compartida', tags: cleanTags(subject, activity?.topic),
        facts: [fact('Participantes', names([evidence.authorId, ...evidence.participantIds])), fact('Versión', evidence.version ?? 1)],
        files: filesFor('evidence', evidence.id), cta: 'Ver evidencia' });
    }
    case 'nota': {
      const note = snapshot.notes.find((entry) => entry.id === id && entry.visibility === 'group' && !entry.withdrawnAt);
      if (!note) break;
      const teaching = note.tags.includes('aprende-ensenando');
      const room = note.tags.includes('sala-de-estudio');
      const origin = teaching ? 'Aprende enseñando' : room ? 'Sala de estudio' : undefined;
      const sources = { student: 'Apunte de estudiante', teacher: 'Material del docente', ai: 'Generada con IA' };
      return present({ layout: 'document', label: 'Nota de clase', icon: 'file', tone: 'amber', title: note.title, excerpt: note.body,
        eyebrow: origin ?? note.topic, status: 'Compartida', tags: cleanTags(subject, note.topic, termName(note.termId), ...note.tags.filter((tag) => !['aprende-ensenando', 'sala-de-estudio'].includes(tag)), origin),
        facts: [fact('Versión', note.version), fact('Fuente', sources[note.source])], files: filesFor('note', note.id), cta: 'Leer nota' });
    }
    case 'pregunta':
    case 'resuelta':
    case 'museo': {
      const question = snapshot.questions.find((entry) => entry.id === id && !entry.withdrawnAt);
      if (!question) break;
      const answers = snapshot.answers.filter((entry) => entry.questionId === question.id && !entry.withdrawnAt);
      const accepted = answers.find((entry) => entry.id === question.acceptedAnswerId);
      const museum = snapshot.museumEntries.find((entry) => entry.questionId === question.id);
      if (item.kind === 'museo' && museum) {
        return present({ layout: 'museum', label: 'Museo de bugs', icon: 'search', tone: 'rose', title: question.title,
          excerpt: museum.intention, status: question.status === 'resolved' ? 'Resuelto' : 'En investigación',
          tags: cleanTags(subject, museum.language, museum.bugType, museum.topic),
          blocks: [{ label: 'Síntoma', text: museum.symptom }, { label: 'Aprendizaje', text: museum.learning }], code: museum.minimalCode || undefined,
          facts: [fact('Respuestas', answers.length), fact('Versión', museum.version)], cta: 'Explorar bug' });
      }
      if (item.kind === 'resuelta') {
        return present({ layout: 'answer', label: 'Pregunta resuelta', icon: 'check', tone: 'green', title: question.title,
          excerpt: question.body, status: 'Respuesta aceptada', tags: cleanTags(subject, question.topic),
          blocks: accepted ? [{ label: 'Respuesta aceptada', text: accepted.body }] : [], facts: [fact('Respuestas', answers.length)], cta: 'Ver solución aceptada' });
      }
      return present({ layout: 'question', label: 'Pregunta', icon: 'chat', tone: 'violet', title: question.title, excerpt: question.body,
        status: question.status === 'resolved' ? 'Resuelta' : 'Abierta', tags: cleanTags(subject, question.topic),
        facts: [fact('Respuestas', answers.length)], cta: 'Abrir pregunta' });
    }
    case 'respuesta': {
      const answer = snapshot.answers.find((entry) => entry.id === id && !entry.withdrawnAt);
      const question = snapshot.questions.find((entry) => entry.id === answer?.questionId && !entry.withdrawnAt);
      if (!answer || !question) break;
      const accepted = question.acceptedAnswerId === answer.id;
      return present({ layout: 'answer', label: 'Respuesta', icon: accepted ? 'check' : 'chat', tone: accepted ? 'green' : 'violet', title: question.title,
        eyebrow: 'En respuesta a', blocks: [{ label: accepted ? 'Respuesta aceptada' : 'Respuesta', text: answer.body }],
        status: accepted ? 'Aceptada' : 'Compartida', tags: cleanTags(subject, question.topic),
        facts: [fact('Respuestas en el hilo', snapshot.answers.filter((entry) => entry.questionId === question.id && !entry.withdrawnAt).length)], cta: 'Ver conversación' });
    }
    case 'guia': {
      const guide = snapshot.guides.find((entry) => entry.id === id && !entry.withdrawnAt);
      if (!guide) break;
      return present({ layout: 'guide', label: 'Guía de estudio', icon: 'book', tone: 'blue', title: guide.title,
        excerpt: guide.sections.find(Boolean), status: 'Compartida', eyebrow: termName(guide.termId), tags: cleanTags(subject, termName(guide.termId)), bullets: guide.topics,
        facts: [fact('Temas', guide.topics.length), fact('Fuentes', snapshot.guideSources.filter((entry) => entry.guideId === guide.id).length), fact('Versión', guide.version)], cta: 'Estudiar guía' });
    }
    case 'votacion': {
      const poll = snapshot.polls.find((entry) => entry.id === id && !entry.cancelledAt);
      if (!poll) break;
      const votes = snapshot.pollVotes.filter((entry) => entry.pollId === poll.id);
      const own = votes.find((entry) => entry.voterId === snapshot.me?.id);
      return present({ layout: 'poll', label: 'Votación', icon: 'check', tone: 'violet', title: poll.title, excerpt: poll.description,
        status: poll.closesAt.getTime() > Date.now() ? 'Abierta' : 'Cerrada', tags: cleanTags(subject, 'Voto nominal', poll.multiple ? 'Varias opciones' : 'Una opción'), bullets: poll.options,
        facts: [fact('Participación', `${votes.length} de ${poll.eligibleIds.length}`), fact('Cierre', dateTime(poll.closesAt)), fact('Tu selección', own ? own.choices.map((choice) => poll.options[choice]).filter(Boolean).join(', ') : 'Aún no has votado')], cta: 'Ver votación' });
    }
    case 'ayuda': {
      const help = snapshot.helpPosts.find((entry) => entry.id === id && entry.status === 'open');
      if (!help) break;
      return present({ layout: 'help', label: HELP_KIND_LABEL[help.kind], icon: 'users', tone: help.kind === 'request' ? 'rose' : 'green', title: help.title,
        excerpt: help.description, status: 'Abierta', tags: cleanTags(subject, help.topic, HELP_LEVEL_LABEL[help.level]),
        facts: [fact('Modalidad', HELP_MODALITY_LABEL[help.modality]), fact('Disponibilidad', help.availability || 'Por acordar')], cta: help.kind === 'request' ? 'Ofrecer ayuda' : 'Solicitar ayuda' });
    }
    case 'repaso': {
      const collection = snapshot.spacedCollections.find((entry) => entry.id === id && entry.visibility === 'group' && !entry.archived);
      if (!collection) break;
      const cards = snapshot.spacedCards.filter((entry) => entry.collectionId === collection.id && !entry.archived);
      return present({ layout: 'spaced', label: 'Repaso espaciado', icon: 'book', tone: 'cyan', title: collection.title,
        status: 'Compartida', tags: cleanTags(subject, termName(collection.termId)), bullets: cards.slice(0, 3).map((entry) => entry.question),
        facts: [fact('Tarjetas compartidas', cards.length), fact('Versión', collection.version)], cta: 'Repasar colección' });
    }
    case 'reto': {
      const challenge = snapshot.codingChallenges.find((entry) => entry.id === id);
      if (!challenge) break;
      return present({ layout: 'challenge', label: 'Reto', icon: 'edit', tone: 'blue', title: challenge.title, excerpt: challenge.instructions,
        status: challenge.closed ? 'Cerrado' : 'Abierto', tags: cleanTags(subject, difficultyLabels[challenge.difficulty], challenge.topic),
        blocks: [{ label: 'Objetivo', text: challenge.objective }], facts: [fact('Dificultad', difficultyLabels[challenge.difficulty]), fact('Soluciones', snapshot.challengeSolutions.filter((entry) => entry.challengeId === challenge.id).length)], cta: 'Resolver reto' });
    }
    case 'solucion': {
      const solution = snapshot.challengeSolutions.find((entry) => entry.id === id);
      const challenge = snapshot.codingChallenges.find((entry) => entry.id === solution?.challengeId);
      if (!solution || !challenge) break;
      return present({ layout: 'code', label: 'Solución de reto', icon: 'edit', tone: 'green', title: challenge.title, eyebrow: 'Una forma de resolverlo',
        excerpt: solution.explanation, code: solution.body, status: 'Compartida', tags: cleanTags(subject, challenge.topic, difficultyLabels[challenge.difficulty]),
        facts: [fact('Versión', solution.version)], cta: 'Ver solución' });
    }
    case 'revision':
    case 'observacion': {
      const comment = item.kind === 'observacion' ? snapshot.codeReviewComments.find((entry) => entry.id === id) : undefined;
      const review = snapshot.codeReviews.find((entry) => entry.id === (comment?.reviewId ?? id));
      if (!review || item.kind === 'observacion' && !comment) break;
      const version = snapshot.codeReviewVersions.find((entry) => entry.reviewId === review.id && entry.number === (comment?.versionNumber ?? review.currentVersion));
      const code = comment?.lineStart ? version?.code.split('\n').slice(comment.lineStart - 1, comment.lineEnd).join('\n') : version?.code;
      const lines = comment?.lineStart ? (comment.lineStart === comment.lineEnd ? `Línea ${comment.lineStart}` : `Líneas ${comment.lineStart}–${comment.lineEnd}`) : 'Comentario general';
      return present({ layout: 'code', label: comment ? 'Observación de código' : 'Revisión de código', icon: 'edit', tone: comment ? 'amber' : 'violet', title: review.title,
        eyebrow: comment ? commentLabels[comment.kind] : review.language, excerpt: comment?.body ?? version?.summary, code,
        status: comment ? resolutionLabels[comment.status] : review.closed ? 'Cerrada' : 'Abierta', tags: cleanTags(subject, review.language),
        facts: [fact('Versión', comment?.versionNumber ?? review.currentVersion), ...(comment ? [fact('Ubicación', lines)] : [fact('Observaciones', snapshot.codeReviewComments.filter((entry) => entry.reviewId === review.id).length)])], cta: comment ? 'Ver observación' : 'Revisar código' });
    }
    case 'oportunidad': {
      const opportunity = snapshot.opportunities.find((entry) => entry.id === id && !entry.withdrawn);
      if (!opportunity) break;
      return present({ layout: 'opportunity', label: opportunityLabels[opportunity.kind] ?? 'Oportunidad', icon: 'calendar', tone: 'amber', title: opportunity.title,
        excerpt: opportunity.requirements, eyebrow: opportunity.organizer, status: opportunity.deadline && Date.parse(opportunity.deadline) <= Date.now() ? 'Vencida' : 'Vigente',
        tags: cleanTags(subject, opportunity.topic, modalityLabels[opportunity.modality]), facts: [fact('Organiza', opportunity.organizer), fact('Modalidad', modalityLabels[opportunity.modality]),
          fact('Fecha límite', opportunity.deadline ? dateTime(new Date(opportunity.deadline)) : 'Por confirmar'), fact('Costo', opportunity.costKnown ? opportunity.cost : 'Por confirmar')], cta: 'Ver oportunidad' });
    }
    case 'sala': {
      const room = snapshot.studyRooms.find((entry) => entry.id === id && entry.visibility === 'group');
      if (!room) break;
      return present({ layout: 'room', label: 'Sala de estudio', icon: 'users', tone: 'green', title: room.title, excerpt: room.objective, status: roomStatuses[room.status], tags: cleanTags(subject, room.topic),
        facts: [fact('Inicio', dateTime(room.startsAt)), fact('Fin', dateTime(room.endsAt)), fact('Participantes', room.capacity ? `${room.participantCount} de ${room.capacity}` : room.participantCount),
          fact('Plazas disponibles', room.capacity ? Math.max(0, room.capacity - room.participantCount) : 'Sin límite')], cta: 'Abrir sala' });
    }
    case 'examen': {
      const exam = sharedExams.find((entry) => entry.id === id && entry.visibility === 'group' && !entry.archived && entry.readyVersion);
      if (!exam) break;
      return present({ layout: 'exam', label: 'Examen de estudio', icon: 'check', tone: 'rose', title: exam.title, status: 'Versión aprobada',
        tags: cleanTags(subject, termName(exam.termId)), bullets: exam.topics, facts: [fact('Preguntas', exam.questionCount), fact('Versión aprobada', exam.readyVersion)], cta: 'Resolver examen' });
    }
    case 'publicacion': {
      const post = snapshot.feedPosts.find((entry) => entry.id === id);
      if (!post) break;
      return present({ layout: 'social', label: 'Publicación', icon: 'chat', tone: 'slate', title: 'Conversación del grupo', excerpt: post.text, cta: 'Ver publicación' });
    }
    case 'ranking': {
      const change = leaderChanges(snapshot).find((entry) => `rk${entry.memberId}-${entry.at.getTime()}` === item.key);
      return present({ layout: 'achievement', label: 'Ranking', icon: 'check', tone: 'amber', title: 'Llegó al primer lugar', status: change?.tiedWith.length ? 'Primer lugar compartido' : 'Primer lugar',
        eyebrow: change?.periodLabel, facts: change ? [fact('Puntos', change.points), fact('Periodo', change.periodLabel), ...(change.tiedWith.length ? [fact('Comparte con', names(change.tiedWith))] : [])] : [], cta: 'Ver ranking' });
    }
  }
  return base;
}
