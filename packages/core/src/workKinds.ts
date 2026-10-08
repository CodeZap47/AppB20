/**
 * Tipos de trabajo que se publican en «Tareas y Actividades». Se agrupan en dos familias para
 * filtrar: lo que se hace día a día y lo que se presenta o se evalúa.
 */

export const WORK_KINDS = ['tarea', 'actividad', 'exposicion', 'examen'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export const WORK_KIND_GROUPS = [
  { id: 'tareas-actividades', label: 'Tareas y actividades', kinds: ['tarea', 'actividad'] },
  { id: 'exposiciones-examenes', label: 'Exposiciones y exámenes', kinds: ['exposicion', 'examen'] },
] as const satisfies readonly { id: string; label: string; kinds: readonly WorkKind[] }[];

export type WorkKindGroup = (typeof WORK_KIND_GROUPS)[number]['id'];

export const WORK_KIND_LABEL: Record<WorkKind, string> = {
  tarea: 'Tarea',
  actividad: 'Actividad',
  exposicion: 'Exposición',
  examen: 'Examen',
};

/** Tipo que se asume cuando un trabajo no lo indica. */
export const DEFAULT_WORK_KIND: WorkKind = 'tarea';

export function isWorkKind(value: unknown): value is WorkKind {
  return WORK_KINDS.includes(value as WorkKind);
}

export function isWorkKindGroup(value: unknown): value is WorkKindGroup {
  return WORK_KIND_GROUPS.some((g) => g.id === value);
}

export function workKindGroup(kind: WorkKind): WorkKindGroup {
  return WORK_KIND_GROUPS.find((g) => (g.kinds as readonly WorkKind[]).includes(kind))!.id;
}
