import type { Evidence, Id } from '../data/types';

/** Personas que aparecen en las evidencias de una actividad, sin repetir. */
export function participantsOf(activityId: Id, evidences: Evidence[]): Id[] {
  return [
    ...new Set(evidences.filter((e) => e.activityId === activityId).flatMap((e) => e.participantIds)),
  ];
}
