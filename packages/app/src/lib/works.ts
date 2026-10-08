import { workKindGroup, type WorkKindGroup } from '@b20/core';
import type { Assignment, Id, Member, Revision, Subject, Term, Work, WorkFile } from '../data/types';
import { matches } from './search';

/** Valor del filtro de parcial para las tareas que no tienen uno. */
export const NO_TERM = 'ninguno';

export interface AssignmentFilters {
  query: string;
  /** Familia de tipos: tareas y actividades, o exposiciones y exámenes. Vacío para todo. */
  kindGroup: WorkKindGroup | '';
  /** Cuatrimestre de la materia; 0 para todos. */
  period: number;
  subjectId: Id;
  /** Id de un parcial, `NO_TERM` o vacío para todos. */
  termId: Id;
  /** Solo las tareas donde esta persona subió un trabajo. */
  authorId: Id;
}

export interface AssignmentContext {
  subjects: Subject[];
  terms: Term[];
  members: Member[];
  works: Work[];
  files?: WorkFile[];
}

/** Trabajos subidos a una página principal, del primero al más reciente. */
export function worksOf(assignmentId: Id, works: Work[]): Work[] {
  return works
    .filter((w) => w.assignmentId === assignmentId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** Personas con al menos un trabajo en la tarea, sin repetir. */
export function submittersOf(assignmentId: Id, works: Work[]): Id[] {
  return [...new Set(worksOf(assignmentId, works).flatMap((w) => w.authorIds))];
}

/**
 * La búsqueda mira el título y las instrucciones de la tarea, su materia y parcial, y de sus
 * trabajos el título, la descripción, los autores y los nombres de archivo.
 */
export function filterAssignments(
  assignments: Assignment[],
  filters: AssignmentFilters,
  ctx: AssignmentContext,
): Assignment[] {
  return assignments.filter((a) => {
    const subject = ctx.subjects.find((s) => s.id === a.subjectId);
    const own = ctx.works.filter((w) => w.assignmentId === a.id);
    if (filters.kindGroup && workKindGroup(a.kind) !== filters.kindGroup) return false;
    if (filters.period && subject?.period !== filters.period) return false;
    if (filters.subjectId && a.subjectId !== filters.subjectId) return false;
    if (filters.termId === NO_TERM ? a.termId : filters.termId && a.termId !== filters.termId) return false;
    if (filters.authorId && !own.some((w) => w.authorIds.includes(filters.authorId))) return false;
    return matches(
      filters.query,
      a.title,
      a.instructions,
      subject?.name ?? '',
      ctx.terms.find((t) => t.id === a.termId)?.name ?? '',
      ...own.flatMap((w) => [
        w.title,
        w.description,
        ...w.authorIds.map((id) => ctx.members.find((m) => m.id === id)?.displayName ?? ''),
      ]),
      ...(ctx.files ?? []).filter((f) => own.some((w) => w.id === f.workId)).map((f) => f.name),
    );
  });
}

/** Último movimiento de una tarea: su edición más reciente o el último trabajo subido. */
export function lastActivity(assignment: Assignment, works: Work[]): Date {
  return works
    .filter((w) => w.assignmentId === assignment.id)
    .reduce((latest, w) => (w.updatedAt > latest ? w.updatedAt : latest), assignment.updatedAt);
}

/** De la tarea con movimiento más reciente a la más antigua, sin modificar el arreglo original. */
export function sortRecent(assignments: Assignment[], works: Work[]): Assignment[] {
  return [...assignments].sort(
    (a, b) => lastActivity(b, works).getTime() - lastActivity(a, works).getTime(),
  );
}

export interface ArchiveGroup {
  key: string;
  name: string;
  assignments: Assignment[];
}

export interface ArchiveSection {
  subject: Subject;
  count: number;
  groups: ArchiveGroup[];
}

/** Orden del plan de estudios: por cuatrimestre y, dentro de él, por nombre. */
export function bySubject(a: Subject, b: Subject): number {
  return a.period - b.period || a.name.localeCompare(b.name, 'es');
}

/** Archivo como materia → parcial → tareas (sección 2); omite materias y parciales vacíos. */
export function groupAssignments(
  assignments: Assignment[],
  works: Work[],
  subjects: Subject[],
  terms: Term[],
): ArchiveSection[] {
  return [...subjects]
    .sort(bySubject)
    .map((subject) => {
      const own = sortRecent(assignments.filter((a) => a.subjectId === subject.id), works);
      const subjectTerms = terms
        .filter((t) => t.subjectId === subject.id)
        .sort((a, b) => a.position - b.position);
      const known = new Set(subjectTerms.map((t) => t.id));
      const groups = [
        ...subjectTerms.map((t) => ({ key: t.id, name: t.name, assignments: own.filter((a) => a.termId === t.id) })),
        { key: NO_TERM, name: 'Sin parcial', assignments: own.filter((a) => !a.termId || !known.has(a.termId)) },
      ].filter((g) => g.assignments.length);
      return { subject, count: own.length, groups };
    })
    .filter((section) => section.count);
}

/** Historial de una página editable, de la versión más reciente a la primera. */
export function revisionsOf(page: Revision['page'], pageId: Id, revisions: Revision[]): Revision[] {
  return revisions
    .filter((r) => r.page === page && r.pageId === pageId)
    .sort((a, b) => b.version - a.version);
}

const listFormat = new Intl.ListFormat('es', { style: 'long', type: 'conjunction' });

/** «Tú y Ana López», «Ana López y 2 más»: quien mira va primero y como «Tú». */
export function authorsLabel(authorIds: Id[], members: Member[], meId?: Id): string {
  const ordered = [...authorIds].sort((a, b) => Number(b === meId) - Number(a === meId));
  const names = ordered.map((id) =>
    id === meId ? 'Tú' : (members.find((m) => m.id === id)?.displayName ?? 'Miembro desconocido'),
  );
  if (names.length <= 2) return listFormat.format(names);
  return `${names[0]} y ${names.length - 1} más`;
}
