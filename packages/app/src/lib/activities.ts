import type { Activity, Evidence, Id, Subject } from '../data/types';
import { parseDay } from './format';
import { matches } from './search';
import { NO_TERM } from './works';

export interface ActivityFilters {
  query: string;
  /** Cuatrimestre de la materia; 0 para todos. */
  period: number;
  subjectId: Id;
  /** Id de un parcial, `NO_TERM` o vacío para todos. */
  termId: Id;
  /** Solo las actividades donde quien mira aparece en alguna evidencia. */
  mine: boolean;
}

export interface ActivityContext {
  subjects: Subject[];
  evidences: Evidence[];
  meId: Id | undefined;
}

/** Personas que aparecen en las evidencias de una actividad, sin repetir. */
export function participantsOf(activityId: Id, evidences: Evidence[]): Id[] {
  return [
    ...new Set(evidences.filter((e) => e.activityId === activityId).flatMap((e) => e.participantIds)),
  ];
}

/** La búsqueda mira título, tema, objetivo, instrucciones y materia. */
export function filterActivities(
  activities: Activity[],
  filters: ActivityFilters,
  ctx: ActivityContext,
): Activity[] {
  return activities.filter((a) => {
    const subject = ctx.subjects.find((s) => s.id === a.subjectId);
    if (filters.period && subject?.period !== filters.period) return false;
    if (filters.subjectId && a.subjectId !== filters.subjectId) return false;
    if (filters.termId === NO_TERM ? a.termId : filters.termId && a.termId !== filters.termId) return false;
    if (filters.mine && !(ctx.meId && participantsOf(a.id, ctx.evidences).includes(ctx.meId))) {
      return false;
    }
    return matches(filters.query, a.title, a.topic, a.objective, a.instructions, subject?.name ?? '');
  });
}

export interface ActivityMonth {
  /** «AAAA-MM». */
  key: string;
  date: Date;
  activities: Activity[];
}

/** De la sesión más reciente a la más antigua, agrupadas por mes. */
export function groupByMonth(activities: Activity[]): ActivityMonth[] {
  const sorted = [...activities].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const months: ActivityMonth[] = [];
  for (const activity of sorted) {
    const key = activity.date.slice(0, 7);
    let month = months.at(-1);
    if (month?.key !== key) {
      month = { key, date: parseDay(activity.date), activities: [] };
      months.push(month);
    }
    month.activities.push(activity);
  }
  return months;
}
