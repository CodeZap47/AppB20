import {
  breakdown,
  countLabel,
  rankMembers,
  recognitionsFor,
  scoreContributions,
  type ContributionEvent,
  type ContributionWindow,
  type RankedMember,
  type RecognitionId,
  type ScoredEvent,
  type TermDates,
} from '@b20/core';
import type { Id, Snapshot } from '../data/types';
import { parseDay } from './format';
import { currentPlacement } from './period';

/** Un aporte con lo necesario para verificarlo: qué fue y dónde abrirlo. */
export interface ContributionEntry extends ContributionEvent {
  title: string;
  link: string;
}

export type ScoredEntry = ScoredEvent & ContributionEntry;

/**
 * Todos los aportes que el usuario puede ver, sacados de los registros del grupo. No incluye
 * mensajes, preguntas ni apuntes personales: no suman (ver `NOT_SCORED`).
 */
export function contributionEntries(data: Snapshot): ContributionEntry[] {
  const entries: ContributionEntry[] = [];
  const assignmentTitle = (id: Id) => data.assignments.find((a) => a.id === id)?.title ?? 'Tarea';

  for (const work of data.works) {
    const title = work.title || assignmentTitle(work.assignmentId);
    for (const memberId of new Set(work.authorIds)) {
      entries.push({
        kind: 'trabajo',
        memberId,
        at: work.createdAt,
        refId: work.id,
        title,
        link: `/m/tareas/${work.assignmentId}?trabajo=${work.id}`,
      });
    }
  }

  for (const note of data.notes) {
    if (note.visibility !== 'group') continue;
    entries.push({
      kind: 'apunte',
      memberId: note.authorId,
      at: note.createdAt,
      refId: note.id,
      title: note.title,
      link: `/m/notas/${note.id}`,
    });
  }

  for (const comment of data.noteComments) {
    const note = data.notes.find((n) => n.id === comment.noteId);
    if (!note || note.visibility !== 'group') continue;
    entries.push({
      kind: 'comentario',
      memberId: comment.authorId,
      at: comment.createdAt,
      refId: comment.id,
      limitKey: note.id,
      excluded:
        note.authorId === comment.authorId ? 'Es un comentario en tu propio apunte.' : undefined,
      title: note.title,
      link: `/m/notas/${note.id}`,
    });
  }

  for (const answer of data.answers) {
    const question = data.questions.find((q) => q.id === answer.questionId);
    if (!question) continue;
    const own = question.authorId === answer.authorId;
    const link = `/m/preguntas/${question.id}`;
    entries.push({
      kind: 'respuesta',
      memberId: answer.authorId,
      at: answer.createdAt,
      refId: answer.id,
      limitKey: question.id,
      excluded: own ? 'Respondiste tu propia pregunta.' : undefined,
      title: question.title,
      link,
    });
    if (question.acceptedAnswerId === answer.id && !own) {
      entries.push({
        kind: 'respuesta-aceptada',
        memberId: answer.authorId,
        at: question.resolvedAt ?? answer.createdAt,
        refId: answer.id,
        title: question.title,
        link,
      });
    }
  }

  for (const assignment of data.assignments) {
    entries.push({
      kind: 'pagina',
      memberId: assignment.createdBy,
      at: assignment.createdAt,
      refId: assignment.id,
      title: assignment.title,
      link: `/m/tareas/${assignment.id}`,
    });
  }

  for (const activity of data.activities) {
    entries.push({
      kind: 'pagina',
      memberId: activity.createdBy,
      at: activity.createdAt,
      refId: activity.id,
      title: activity.title,
      link: `/m/actividades/${activity.id}`,
    });
  }

  // La versión 1 es la página registrada; cada versión posterior es una corrección.
  for (const revision of data.revisions) {
    if (revision.version <= 1) continue;
    const isActivity = revision.page === 'activity';
    entries.push({
      kind: 'correccion',
      memberId: revision.editedBy,
      at: revision.editedAt,
      refId: revision.id,
      limitKey: `${revision.page}:${revision.pageId}`,
      title: `${revision.title} (versión ${revision.version})`,
      link: isActivity ? `/m/actividades/${revision.pageId}` : `/m/tareas/${revision.pageId}`,
    });
  }

  for (const evidence of data.evidences) {
    const activity = data.activities.find((a) => a.id === evidence.activityId);
    for (const memberId of new Set([evidence.authorId, ...evidence.participantIds])) {
      entries.push({
        kind: 'evidencia',
        memberId,
        at: evidence.createdAt,
        refId: evidence.id,
        title: activity?.title ?? 'Actividad de clase',
        link: `/m/actividades/${evidence.activityId}`,
      });
    }
  }

  for (const guide of data.guides) {
    entries.push({
      kind: 'guia',
      memberId: guide.createdBy,
      at: guide.createdAt,
      refId: guide.id,
      title: guide.title,
      link: `/m/guias/${guide.id}`,
    });
  }

  for (const source of data.guideSources) {
    const guide = data.guides.find((g) => g.id === source.guideId);
    if (!guide || source.status !== 'processed') continue;
    entries.push({
      kind: 'fuente',
      memberId: source.addedBy,
      at: source.addedAt,
      refId: source.id,
      title: guide.title,
      link: `/m/guias/${guide.id}`,
    });
  }

  for (const review of data.guideReviews) {
    const guide = data.guides.find((g) => g.id === review.guideId);
    if (!guide) continue;
    entries.push({
      kind: 'revision-guia',
      memberId: review.reviewerId,
      at: review.createdAt,
      refId: review.id,
      title: `${guide.title} (versión ${review.guideVersion})`,
      link: `/m/guias/${guide.id}`,
    });
  }

  return entries;
}

export function scoreEntries(
  entries: ContributionEntry[],
  window: ContributionWindow,
): ScoredEntry[] {
  return scoreContributions(entries, window) as ScoredEntry[];
}

export type PeriodId = 'parcial' | 'cuatrimestre' | 'mes' | 'todo';

export interface LeaderboardPeriod {
  id: PeriodId;
  label: string;
  /** Explicación corta del rango, para el encabezado. */
  detail: string;
  window: ContributionWindow;
}

/**
 * Periodos del leaderboard. Con fechas en Ajustes: parcial y cuatrimestre vigentes; sin ellas,
 * los últimos 30 días. «Todo» siempre está.
 */
export function leaderboardPeriods(
  calendar: readonly TermDates[],
  now = new Date(),
): LeaderboardPeriod[] {
  const placement = currentPlacement(calendar, now);
  const all: LeaderboardPeriod = {
    id: 'todo',
    label: 'Todo',
    detail: 'Desde el inicio',
    window: {},
  };
  if (!placement) {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    return [
      { id: 'mes', label: 'Últimos 30 días', detail: 'Últimos 30 días', window: { from } },
      all,
    ];
  }
  const terms = calendar.filter((entry) => entry.period === placement.period);
  const periodStart = terms.reduce(
    (min, t) => (t.startDate < min ? t.startDate : min),
    placement.startDate,
  );
  // Sin fecha de fin: el parcial vigente sigue contando hasta que empiece el siguiente.
  return [
    {
      id: 'parcial',
      label: `Parcial ${placement.term}`,
      detail: `Parcial ${placement.term} del cuatrimestre ${placement.period}`,
      window: { from: parseDay(placement.startDate) },
    },
    {
      id: 'cuatrimestre',
      label: 'Cuatrimestre',
      detail: `Cuatrimestre ${placement.period}`,
      window: { from: parseDay(periodStart) },
    },
    all,
  ];
}

export interface MemberStanding extends RankedMember {
  events: ScoredEntry[];
  recognitions: RecognitionId[];
}

/** Leaderboard del periodo con los aportes de cada quien, para verificar cada punto. */
export function buildLeaderboard(data: Snapshot, window: ContributionWindow): MemberStanding[] {
  const active = data.members.filter((m) => m.status === 'active');
  const scored = scoreEntries(contributionEntries(data), window);
  const nameOf = (id: Id) => active.find((m) => m.id === id)?.displayName ?? '';
  return rankMembers(
    active.map((m) => m.id),
    scored,
    nameOf,
  ).map((entry) => {
    const events = scored.filter((e) => e.memberId === entry.memberId);
    return { ...entry, events, recognitions: recognitionsFor(events) };
  });
}

/** Lo que más aportó alguien, en una línea: «2 trabajos · 1 apunte». */
export function standingSummary(standing: MemberStanding, max = 2): string {
  return breakdown(standing.events)
    .filter((row) => row.counted)
    .sort((a, b) => b.points - a.points)
    .slice(0, max)
    .map((row) => countLabel(row.kind, row.counted))
    .join(' · ');
}
