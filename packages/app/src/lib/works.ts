import type { Id, Member, Revision, Subject, Work } from '../data/types';

/** Valor del filtro de parcial para las tareas que no tienen uno. */
export const NO_TERM = 'ninguno';

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

/** Orden del plan de estudios: por cuatrimestre y, dentro de él, por nombre. */
export function bySubject(a: Subject, b: Subject): number {
  return a.period - b.period || a.name.localeCompare(b.name, 'es');
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
