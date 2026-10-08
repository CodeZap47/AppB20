import type { Id, Snapshot } from '../data/types';

export type NewsKind = 'tarea' | 'trabajo' | 'nota' | 'actividad' | 'evidencia' | 'pregunta' | 'respuesta' | 'resuelta';

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

  const items: NewsItem[] = [
    // Una página nueva la anuncia quien la creó; una edición, quien guardó la última versión.
    ...snapshot.assignments.map((a) => ({
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
        text: n.version > 1 ? `actualizó el apunte «${n.title}»` : `compartió el apunte «${n.title}»`,
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
