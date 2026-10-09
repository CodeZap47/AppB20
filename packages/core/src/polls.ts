/**
 * Votaciones y encuestas transparentes (sección 3.8). Son nominales: el grupo ve quién votó y
 * qué eligió. La primera versión no tiene votaciones anónimas.
 *
 * El módulo del servidor repite estas reglas (no importa `@b20/core`); si cambian aquí, deben
 * cambiar allá.
 */

export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 10;
export const MAX_POLL_TITLE_LENGTH = 200;
export const MAX_POLL_DESCRIPTION_LENGTH = 2_000;
export const MAX_POLL_OPTION_LENGTH = 120;
export const MAX_POLL_NOTE_LENGTH = 2_000;
/** Margen mínimo para votar: una votación no puede cerrar en menos de 10 minutos. */
export const MIN_POLL_DURATION_MS = 10 * 60_000;

export type PollStatus = 'open' | 'closed' | 'cancelled';

export interface PollTiming {
  closesAt: Date;
  cancelledAt?: Date;
}

/** Abierta hasta su fecha de cierre; cancelada si alguien la canceló antes. */
export function pollStatus(poll: PollTiming, now: Date): PollStatus {
  if (poll.cancelledAt) return 'cancelled';
  return now < poll.closesAt ? 'open' : 'closed';
}

/** Opciones limpias: sin espacios sobrantes ni vacías ni repetidas, dentro de los límites. */
export function cleanPollOptions(
  options: readonly string[],
): { options: string[] } | { problem: string } {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of options) {
    const option = raw.trim();
    if (!option) continue;
    if (option.length > MAX_POLL_OPTION_LENGTH) {
      return { problem: `Cada opción debe tener a lo más ${MAX_POLL_OPTION_LENGTH} caracteres.` };
    }
    const key = option.toLocaleLowerCase('es');
    if (seen.has(key)) return { problem: `La opción «${option}» está repetida.` };
    seen.add(key);
    cleaned.push(option);
  }
  if (cleaned.length < MIN_POLL_OPTIONS) return { problem: 'Escribe al menos dos opciones.' };
  if (cleaned.length > MAX_POLL_OPTIONS) {
    return { problem: `Una votación admite hasta ${MAX_POLL_OPTIONS} opciones.` };
  }
  return { options: cleaned };
}

/** La fecha de cierre debe dejar tiempo para votar. */
export function closingError(closesAt: Date, now: Date): string | null {
  if (Number.isNaN(closesAt.getTime())) return 'Elige la fecha y hora de cierre.';
  if (closesAt.getTime() - now.getTime() < MIN_POLL_DURATION_MS) {
    return 'El cierre debe ser al menos 10 minutos después de ahora.';
  }
  return null;
}

export interface VoteCheck {
  status: PollStatus;
  multiple: boolean;
  allowChange: boolean;
  optionCount: number;
  eligible: boolean;
  alreadyVoted: boolean;
}

/** Por qué no se puede emitir este voto, o `null` si se puede. */
export function voteError(check: VoteCheck, choices: readonly number[]): string | null {
  if (check.status === 'cancelled') return 'La votación fue cancelada.';
  if (check.status === 'closed') return 'La votación ya cerró.';
  if (!check.eligible) return 'No estás entre los participantes de esta votación.';
  if (check.alreadyVoted && !check.allowChange) {
    return 'Ya votaste y esta votación no permite cambiar el voto.';
  }
  if (!choices.length) return 'Elige una opción.';
  if (!check.multiple && choices.length > 1) return 'Solo puedes elegir una opción.';
  if (new Set(choices).size !== choices.length) return 'Elegiste la misma opción dos veces.';
  if (choices.some((c) => !Number.isInteger(c) || c < 0 || c >= check.optionCount)) {
    return 'La opción no existe.';
  }
  return null;
}

export interface PollBallot {
  voterId: string;
  choices: readonly number[];
}

/**
 * Resultado nominal: cuántos votos y quiénes por opción, quiénes faltan y qué opciones van
 * adelante (varias si empatan; ninguna si nadie ha votado).
 */
export function tallyPoll(
  optionCount: number,
  eligibleIds: readonly string[],
  ballots: readonly PollBallot[],
) {
  const counted = ballots.filter((b) => eligibleIds.includes(b.voterId));
  const voters = Array.from({ length: optionCount }, (_, option) =>
    counted.filter((b) => b.choices.includes(option)).map((b) => b.voterId),
  );
  const counts = voters.map((ids) => ids.length);
  const top = Math.max(0, ...counts);
  const voted = new Set(counted.map((b) => b.voterId));
  return {
    counts,
    voters,
    voted: voted.size,
    pending: eligibleIds.filter((id) => !voted.has(id)),
    leading: top ? counts.flatMap((count, option) => (count === top ? [option] : [])) : [],
  };
}
