/**
 * Reglas de acceso compartidas (sección 2 y 5). El servidor (módulo SpacetimeDB y backend)
 * vuelve a validar todo; estas funciones sirven para la interfaz y para pruebas.
 */

export type MemberStatus = 'invited' | 'active' | 'removed';

export interface Membership {
  userId: string;
  status: MemberStatus;
  /** Creadores de la app: administración técnica, altas y bajas. */
  isCreator: boolean;
}

export function isActiveMember(m: Membership | undefined): m is Membership {
  return m?.status === 'active';
}

/** Los mensajes 1 a 1 solo los leen sus dos participantes, sin excepción para creadores. */
export function canReadDirectConversation(
  viewerId: string,
  participants: readonly [string, string],
): boolean {
  return participants.includes(viewerId);
}

/** Autor o coautores editan su trabajo; los demás proponen cambios con registro. */
export function canEditWork(viewerId: string, authorIds: readonly string[]): boolean {
  return authorIds.includes(viewerId);
}

/** Solo los creadores dan altas y bajas del grupo. */
export function canManageMembership(m: Membership | undefined): boolean {
  return isActiveMember(m) && m.isCreator;
}

/**
 * Los administradores son los creadores de la app. Solo ellos fijan las fechas de los
 * parciales, porque de ellas depende lo que ve todo el grupo.
 */
export function canManageCalendar(m: Pick<Membership, 'status' | 'isCreator'> | undefined): boolean {
  return m?.status === 'active' && m.isCreator;
}
