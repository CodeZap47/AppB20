export const ROOM_LIMITS = { title: 160, topic: 120, objective: 4_000, entry: 4_000, summary: 24_000 } as const;
export const ROOM_STATUS_LABELS = { scheduled: 'Programada', active: 'En curso', completed: 'Finalizada', cancelled: 'Cancelada' } as const;
export const ROOM_VISIBILITY_LABELS = { group: 'Abierta al grupo', private: 'Privada por invitación' } as const;
export const roomStatusLabel = (status: keyof typeof ROOM_STATUS_LABELS) => ROOM_STATUS_LABELS[status];
export const roomVisibilityLabel = (visibility: keyof typeof ROOM_VISIBILITY_LABELS) => ROOM_VISIBILITY_LABELS[visibility];

export interface StudyRoomFields {
  title: string; topic: string; objective: string; startsAt: Date; endsAt: Date; capacity?: number;
}
export function studyRoomFieldsError(input: StudyRoomFields): string | undefined {
  for (const key of ['title', 'topic', 'objective'] as const) {
    const label = { title: 'El título', topic: 'El tema', objective: 'El objetivo' }[key];
    if (!input[key].trim()) return `${label} no puede estar vacío.`;
    if (input[key].trim().length > ROOM_LIMITS[key]) return `${label} excede ${ROOM_LIMITS[key]} caracteres.`;
  }
  if (!Number.isFinite(input.startsAt.getTime()) || !Number.isFinite(input.endsAt.getTime()) || input.startsAt.getTime() < 0) return 'El horario no es válido.';
  if (input.endsAt <= input.startsAt) return 'La hora de fin debe ser posterior al inicio.';
  if (input.capacity !== undefined && (!Number.isSafeInteger(input.capacity) || input.capacity < 1 || input.capacity > 10_000)) return 'El cupo debe ser un entero entre 1 y 10000.';
  return undefined;
}
export function roomTimerMinutesError(studyMinutes: number, breakMinutes: number): string | undefined {
  if (![studyMinutes, breakMinutes].every((value) => Number.isSafeInteger(value) && value >= 1 && value <= 180)) return 'Cada bloque debe durar entre 1 y 180 minutos.';
  return undefined;
}
/** El reloj del cliente se ajusta con getStudyRoomClock; no se persiste cada segundo. */
export function roomRemainingMs(timer: { state: string; remainingMs: number; startedAt?: Date }, now: Date | number = Date.now()): number {
  const elapsed = timer.state === 'running' && timer.startedAt ? Math.max(0, Number(now) - timer.startedAt.getTime()) : 0;
  return Math.max(0, timer.remainingMs - elapsed);
}
