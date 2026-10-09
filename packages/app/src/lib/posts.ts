import { WORK_KIND_LABEL, workKindGroup, type WorkKindGroup } from '@b20/core';
import type { Activity, Assignment, Evidence, Id, Member, Subject, Term, Work, WorkFile } from '../data/types';
import { participantsOf } from './activities';
import { parseDay, toDay } from './format';
import { matches } from './search';
import { bySubject, NO_TERM, submittersOf } from './works';

/**
 * Una publicación del módulo «Tareas y Actividades»: la página de una tarea, actividad,
 * exposición o examen, o una actividad de clase. Las dos se listan juntas y se pueden ver de
 * dos maneras: por materia o por fecha.
 */
export interface Post {
  /** Único entre los dos tipos. */
  key: string;
  type: 'assignment' | 'activity';
  id: Id;
  subjectId: Id;
  termId?: Id;
  /** «Tarea», «Examen», «Actividad de clase»… */
  label: string;
  group: WorkKindGroup;
  title: string;
  /** Instrucciones u objetivo, para el extracto. */
  text: string;
  topic: string;
  /** Día que la ubica en la vista por fecha: la sesión, la entrega o, si no hay, su creación. */
  day: string;
  dueDate?: string;
  link: string;
  /** Quienes ya subieron trabajo o evidencia. */
  people: Id[];
  /** Trabajos o evidencias subidos. */
  count: number;
  noun: readonly [singular: string, plural: string];
  updatedAt: Date;
  /** Textos de sus trabajos o evidencias, para la búsqueda. */
  extra: string[];
}

export const ACTIVITY_LABEL = 'Actividad de clase';

export function buildPosts(data: {
  assignments: Assignment[];
  works: Work[];
  workFiles?: WorkFile[];
  activities: Activity[];
  evidences: Evidence[];
  members: Member[];
}): Post[] {
  const nameOf = (id: Id) => data.members.find((m) => m.id === id)?.displayName ?? '';
  const fromAssignments = data.assignments.map((a): Post => {
    const own = data.works.filter((w) => w.assignmentId === a.id);
    return {
      key: `t:${a.id}`,
      type: 'assignment',
      id: a.id,
      subjectId: a.subjectId,
      termId: a.termId,
      label: WORK_KIND_LABEL[a.kind],
      group: workKindGroup(a.kind),
      title: a.title,
      text: a.instructions,
      topic: '',
      day: a.dueDate ?? toDay(a.createdAt),
      dueDate: a.dueDate,
      link: `/m/tareas/${a.id}`,
      people: submittersOf(a.id, data.works),
      count: own.length,
      noun: ['trabajo', 'trabajos'],
      updatedAt: own.reduce((latest, w) => (w.updatedAt > latest ? w.updatedAt : latest), a.updatedAt),
      extra: [
        ...own.flatMap((w) => [w.title, w.description, ...w.authorIds.map(nameOf)]),
        ...(data.workFiles ?? []).filter((f) => own.some((w) => w.id === f.workId)).map((f) => f.name),
      ],
    };
  });
  const fromActivities = data.activities.map((a): Post => {
    const own = data.evidences.filter((e) => e.activityId === a.id);
    return {
      key: `a:${a.id}`,
      type: 'activity',
      id: a.id,
      subjectId: a.subjectId,
      termId: a.termId,
      label: ACTIVITY_LABEL,
      group: 'tareas-actividades',
      title: a.title,
      text: a.objective || a.instructions,
      topic: a.topic,
      day: a.date,
      link: `/m/actividades/${a.id}`,
      people: participantsOf(a.id, data.evidences),
      count: own.length,
      noun: ['evidencia', 'evidencias'],
      updatedAt: own.reduce((latest, e) => (e.createdAt > latest ? e.createdAt : latest), a.updatedAt),
      extra: [a.instructions, ...own.flatMap((e) => [e.content, ...e.participantIds.map(nameOf)])],
    };
  });
  return [...fromAssignments, ...fromActivities];
}

export interface PostFilters {
  query: string;
  /** Familia de tipos: tareas y actividades, o exposiciones y exámenes. Vacío para todo. */
  kindGroup: WorkKindGroup | '';
  /** Cuatrimestre de la materia; 0 para todos. */
  period: number;
  subjectId: Id;
  /** Id de un parcial, `NO_TERM` o vacío para todos. */
  termId: Id;
  /** Solo donde esta persona subió un trabajo o aparece en una evidencia. */
  personId: Id;
}

/** La búsqueda mira título, texto, tema, materia, parcial y lo que subió cada quien. */
export function filterPosts(
  posts: Post[],
  filters: PostFilters,
  ctx: { subjects: Subject[]; terms: Term[] },
): Post[] {
  return posts.filter((p) => {
    const subject = ctx.subjects.find((s) => s.id === p.subjectId);
    if (filters.kindGroup && p.group !== filters.kindGroup) return false;
    if (filters.period && subject?.period !== filters.period) return false;
    if (filters.subjectId && p.subjectId !== filters.subjectId) return false;
    if (filters.termId === NO_TERM ? p.termId : filters.termId && p.termId !== filters.termId) return false;
    if (filters.personId && !p.people.includes(filters.personId)) return false;
    return matches(
      filters.query,
      p.title,
      p.text,
      p.topic,
      p.label,
      subject?.name ?? '',
      ctx.terms.find((t) => t.id === p.termId)?.name ?? '',
      ...p.extra,
    );
  });
}

const byRecent = (a: Post, b: Post) => b.updatedAt.getTime() - a.updatedAt.getTime();

export interface PostSection {
  subject: Subject;
  count: number;
  groups: { key: string; name: string; posts: Post[] }[];
}

/** Vista por materia: materia → parcial → publicaciones; omite lo vacío. */
export function groupBySubject(posts: Post[], subjects: Subject[], terms: Term[]): PostSection[] {
  return [...subjects]
    .sort(bySubject)
    .map((subject) => {
      const own = posts.filter((p) => p.subjectId === subject.id).sort(byRecent);
      const subjectTerms = terms
        .filter((t) => t.subjectId === subject.id)
        .sort((a, b) => a.position - b.position);
      const known = new Set(subjectTerms.map((t) => t.id));
      const groups = [
        ...subjectTerms.map((t) => ({ key: t.id, name: t.name, posts: own.filter((p) => p.termId === t.id) })),
        { key: NO_TERM, name: 'Sin parcial', posts: own.filter((p) => !p.termId || !known.has(p.termId)) },
      ].filter((g) => g.posts.length);
      return { subject, count: own.length, groups };
    })
    .filter((section) => section.count);
}

export interface PostMonth {
  /** «AAAA-MM». */
  key: string;
  date: Date;
  posts: Post[];
}

/** Vista por fecha: del día más reciente al más antiguo, agrupado por mes. */
export function groupByMonth(posts: Post[]): PostMonth[] {
  const sorted = [...posts].sort((a, b) => b.day.localeCompare(a.day) || byRecent(a, b));
  const months: PostMonth[] = [];
  for (const post of sorted) {
    const key = post.day.slice(0, 7);
    let month = months.at(-1);
    if (month?.key !== key) {
      month = { key, date: parseDay(post.day), posts: [] };
      months.push(month);
    }
    month.posts.push(post);
  }
  return months;
}
