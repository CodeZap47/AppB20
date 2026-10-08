import { workKindGroup, type WorkKindGroup } from '@b20/core';
import type { Id, Member, Subject, Term, Work, WorkFile } from '../data/types';
import { matches } from './search';

/** Valor del filtro de parcial para los trabajos que no tienen uno. */
export const NO_TERM = 'ninguno';

export interface WorkFilters {
  query: string;
  /** Familia de tipos: tareas y actividades, o exposiciones y exámenes. Vacío para todo. */
  kindGroup: WorkKindGroup | '';
  /** Cuatrimestre de la materia; 0 para todos. */
  period: number;
  subjectId: Id;
  /** Id de un parcial, `NO_TERM` o vacío para todos. */
  termId: Id;
  authorId: Id;
}

export interface WorkContext {
  subjects: Subject[];
  terms: Term[];
  members: Member[];
  files?: WorkFile[];
}

/**
 * La búsqueda mira título, consigna, descripción, materia, parcial, nombres de los autores y
 * nombres de los archivos adjuntos.
 */
export function filterWorks(works: Work[], filters: WorkFilters, ctx: WorkContext): Work[] {
  return works.filter((w) => {
    const subject = ctx.subjects.find((s) => s.id === w.subjectId);
    if (filters.kindGroup && workKindGroup(w.kind) !== filters.kindGroup) return false;
    if (filters.period && subject?.period !== filters.period) return false;
    if (filters.subjectId && w.subjectId !== filters.subjectId) return false;
    if (filters.termId === NO_TERM ? w.termId : filters.termId && w.termId !== filters.termId) return false;
    if (filters.authorId && !w.authorIds.includes(filters.authorId)) return false;
    return matches(
      filters.query,
      w.title,
      w.assignment,
      w.description,
      subject?.name ?? '',
      ctx.terms.find((t) => t.id === w.termId)?.name ?? '',
      ...w.authorIds.map((id) => ctx.members.find((m) => m.id === id)?.displayName ?? ''),
      ...(ctx.files ?? []).filter((f) => f.workId === w.id).map((f) => f.name),
    );
  });
}

/** Del más recientemente actualizado al más antiguo, sin modificar el arreglo original. */
export function sortRecent(works: Work[]): Work[] {
  return [...works].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export interface ArchiveGroup {
  key: string;
  name: string;
  works: Work[];
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

/** Archivo como materia → parcial → trabajos (sección 2); omite materias y parciales vacíos. */
export function groupWorks(works: Work[], subjects: Subject[], terms: Term[]): ArchiveSection[] {
  return [...subjects]
    .sort(bySubject)
    .map((subject) => {
      const own = sortRecent(works.filter((w) => w.subjectId === subject.id));
      const subjectTerms = terms
        .filter((t) => t.subjectId === subject.id)
        .sort((a, b) => a.position - b.position);
      const known = new Set(subjectTerms.map((t) => t.id));
      const groups = [
        ...subjectTerms.map((t) => ({ key: t.id, name: t.name, works: own.filter((w) => w.termId === t.id) })),
        { key: NO_TERM, name: 'Sin parcial', works: own.filter((w) => !w.termId || !known.has(w.termId)) },
      ].filter((g) => g.works.length);
      return { subject, count: own.length, groups };
    })
    .filter((section) => section.count);
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
