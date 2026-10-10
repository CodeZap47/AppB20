/**
 * Contribuciones y leaderboard (sección 3.6). Los puntos no se guardan: salen de los registros
 * del grupo (trabajos, apuntes, respuestas, guías…), así que cualquiera puede verificar de dónde
 * vino cada punto, y lo que se borra deja de contar. Premia utilidad, no número de mensajes.
 *
 * Los valores son una propuesta; la definición pide ajustarlos después de probarlos con el grupo.
 */

/** En orden de puntos, como se muestran las reglas. */
export const CONTRIBUTION_KINDS = [
  'guia',
  'trabajo',
  'respuesta-aceptada',
  'apunte',
  'evidencia',
  'revision-guia',
  'respuesta',
  'pagina',
  'correccion',
  'fuente',
  'comentario',
] as const;

export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

export interface ContributionRule {
  points: number;
  /** Nombre corto del aporte, para el desglose. */
  label: string;
  /** Cómo se cuenta: «1 trabajo», «2 trabajos». */
  nouns: readonly [singular: string, plural: string];
  /** Regla completa, como se muestra en «Cómo se cuentan los puntos». */
  rule: string;
  /** Límite contra acciones repetitivas, si lo hay. */
  limit?: string;
}

export const CONTRIBUTION_RULES: Record<ContributionKind, ContributionRule> = {
  trabajo: {
    points: 10,
    nouns: ['trabajo', 'trabajos'],
    label: 'Trabajo publicado',
    rule: 'Subir un trabajo a una tarea, actividad, exposición o examen. Cuenta para cada autor.',
  },
  apunte: {
    points: 8,
    nouns: ['apunte', 'apuntes'],
    label: 'Apunte para el grupo',
    rule: 'Publicar un apunte visible para el grupo. Los apuntes personales no cuentan.',
  },
  guia: {
    points: 15,
    nouns: ['guía', 'guías'],
    label: 'Guía de estudio',
    rule: 'Crear la guía de estudio de una materia y parcial.',
  },
  'respuesta-aceptada': {
    points: 10,
    nouns: ['respuesta aceptada', 'respuestas aceptadas'],
    label: 'Respuesta aceptada',
    rule: 'Quien preguntó aceptó tu respuesta. Se suma a los puntos de la respuesta.',
  },
  evidencia: {
    points: 5,
    nouns: ['evidencia', 'evidencias'],
    label: 'Evidencia de clase',
    rule: 'Subir la evidencia de una actividad de clase. Cuenta para cada participante.',
  },
  'revision-guia': {
    points: 5,
    nouns: ['revisión de guía', 'revisiones de guía'],
    label: 'Revisión de guía',
    rule: 'Revisar una versión de la guía que guardó otra persona.',
  },
  respuesta: {
    points: 4,
    nouns: ['respuesta', 'respuestas'],
    label: 'Respuesta',
    rule: 'Responder la pregunta de un compañero.',
    limit: 'Una por pregunta; responder tu propia pregunta no cuenta.',
  },
  pagina: {
    points: 3,
    nouns: ['página registrada', 'páginas registradas'],
    label: 'Página registrada',
    rule: 'Registrar lo que se pidió en una tarea o lo que pasó en una clase.',
  },
  correccion: {
    points: 3,
    nouns: ['corrección', 'correcciones'],
    label: 'Corrección',
    rule: 'Guardar una versión nueva de una página que todos editan.',
    limit: 'Una por página; las siguientes ediciones de la misma página no suman.',
  },
  fuente: {
    points: 2,
    nouns: ['fuente procesada', 'fuentes procesadas'],
    label: 'Fuente procesada',
    rule: 'Agregar a una guía una fuente que ya quedó procesada.',
  },
  comentario: {
    points: 2,
    nouns: ['propuesta de corrección', 'propuestas de corrección'],
    label: 'Propuesta de corrección',
    rule: 'Comentar o proponer una corrección en el apunte de alguien más.',
    limit: 'Una por apunte; comentar tu propio apunte no cuenta.',
  },
};

/** «1 trabajo», «3 trabajos». */
export function countLabel(kind: ContributionKind, count: number): string {
  const [singular, plural] = CONTRIBUTION_RULES[kind].nouns;
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Lo que nunca suma, para decirlo junto a las reglas. */
export const NOT_SCORED = [
  'mensajes del chat',
  'preguntas que haces',
  'calificaciones',
  'apuntes personales',
  'préstamos o disponibilidad',
] as const;

/** Un aporte tal como sale de los registros, antes de aplicar límites. */
export interface ContributionEvent {
  kind: ContributionKind;
  memberId: string;
  at: Date;
  /** Registro de origen: lo que se abre para verificar el punto. */
  refId: string;
  /**
   * Agrupa acciones repetitivas: de los eventos con la misma clave y persona solo cuenta el
   * primero (una respuesta por pregunta, una corrección por página…).
   */
  limitKey?: string;
  /** Aporte que no cuenta aunque se registre, con la razón (p. ej. responder tu pregunta). */
  excluded?: string;
}

export interface ScoredEvent extends ContributionEvent {
  /** Puntos que sumó; 0 si no contó. */
  points: number;
  /** Por qué no sumó, si no sumó. */
  skipped?: string;
}

export interface ContributionWindow {
  /** Inclusive. Sin `from` cuenta desde el principio. */
  from?: Date;
  /** Exclusivo. Sin `to` cuenta hasta hoy. */
  to?: Date;
}

const LIMIT_REASON: Partial<Record<ContributionKind, string>> = {
  respuesta: 'Ya contó una respuesta tuya en esta pregunta.',
  correccion: 'Ya contó una corrección tuya en esta página.',
  comentario: 'Ya contó un comentario tuyo en este apunte.',
};

/**
 * Aplica el periodo y los límites. Devuelve los eventos del periodo, del más reciente al más
 * antiguo, cada uno con sus puntos o con la razón por la que no sumó.
 */
export function scoreContributions(
  events: readonly ContributionEvent[],
  window: ContributionWindow = {},
): ScoredEvent[] {
  const inWindow = events
    .filter((e) => (!window.from || e.at >= window.from) && (!window.to || e.at < window.to))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.refId.localeCompare(b.refId));
  const used = new Set<string>();
  const scored = inWindow.map((event): ScoredEvent => {
    if (event.excluded) return { ...event, points: 0, skipped: event.excluded };
    if (event.limitKey) {
      const key = `${event.memberId}|${event.kind}|${event.limitKey}`;
      if (used.has(key)) {
        return {
          ...event,
          points: 0,
          skipped: LIMIT_REASON[event.kind] ?? 'Ya contó un aporte igual.',
        };
      }
      used.add(key);
    }
    return { ...event, points: CONTRIBUTION_RULES[event.kind].points };
  });
  return scored.reverse();
}

export interface RankedMember {
  memberId: string;
  points: number;
  /** Lugar en el leaderboard; empates comparten lugar (1, 2, 2, 4). 0 si no tiene puntos. */
  rank: number;
}

/**
 * Leaderboard: más puntos primero; los empates comparten lugar y se ordenan por nombre. Quien
 * no tiene puntos en el periodo aparece al final, sin lugar.
 */
export function rankMembers(
  memberIds: readonly string[],
  scored: readonly ScoredEvent[],
  nameOf: (id: string) => string = (id) => id,
): RankedMember[] {
  const totals = new Map(memberIds.map((id) => [id, 0]));
  for (const event of scored) {
    if (totals.has(event.memberId)) {
      totals.set(event.memberId, (totals.get(event.memberId) ?? 0) + event.points);
    }
  }
  const sorted = [...totals]
    .map(([memberId, points]) => ({ memberId, points }))
    .sort(
      (a, b) => b.points - a.points || nameOf(a.memberId).localeCompare(nameOf(b.memberId), 'es'),
    );
  return sorted.map((entry) => ({
    ...entry,
    rank: entry.points ? sorted.findIndex((other) => other.points === entry.points) + 1 : 0,
  }));
}

/** Desglose por tipo de aporte, en el orden de las reglas. */
export function breakdown(scored: readonly ScoredEvent[]) {
  return CONTRIBUTION_KINDS.map((kind) => {
    const events = scored.filter((e) => e.kind === kind);
    return {
      kind,
      counted: events.filter((e) => e.points > 0).length,
      skipped: events.filter((e) => e.points === 0).length,
      points: events.reduce((sum, e) => sum + e.points, 0),
    };
  }).filter((row) => row.counted || row.skipped);
}

export type RecognitionId = 'explicaciones' | 'apoyo' | 'constancia';

export const RECOGNITIONS: Record<RecognitionId, { title: string; rule: string }> = {
  explicaciones: {
    title: 'Buenas explicaciones',
    rule: 'Dos o más respuestas aceptadas en el periodo.',
  },
  apoyo: {
    title: 'Apoyo entre compañeros',
    rule: 'Tres o más aportes sobre material de otros: respuestas, revisiones, correcciones o comentarios.',
  },
  constancia: {
    title: 'Constancia',
    rule: 'Aportes que sumaron en tres semanas distintas del periodo.',
  },
};

const SUPPORT_KINDS: readonly ContributionKind[] = [
  'respuesta',
  'revision-guia',
  'correccion',
  'comentario',
];

/** Semana del aporte, contada desde una fecha fija (lunes), para medir constancia. */
function weekOf(date: Date): number {
  const monday = Date.UTC(2024, 0, 1);
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((day - monday) / (7 * 86_400_000));
}

/** Reconocimientos que ganó una persona con los eventos del periodo (solo los que sumaron). */
export function recognitionsFor(scored: readonly ScoredEvent[]): RecognitionId[] {
  const counted = scored.filter((e) => e.points > 0);
  const result: RecognitionId[] = [];
  if (counted.filter((e) => e.kind === 'respuesta-aceptada').length >= 2)
    result.push('explicaciones');
  if (counted.filter((e) => SUPPORT_KINDS.includes(e.kind)).length >= 3) result.push('apoyo');
  if (new Set(counted.map((e) => weekOf(e.at))).size >= 3) result.push('constancia');
  return result;
}
