import { pollStatus, tallyPoll, type PollStatus } from '@b20/core';
import type { Poll, PollVote, Snapshot } from '../data/types';
import { formatClock, formatDayLabel } from './format';

export const POLL_STATUS_LABEL: Record<PollStatus, string> = {
  open: 'Abierta',
  closed: 'Cerrada',
  cancelled: 'Cancelada',
};

/** Todo lo que la lista y el detalle muestran de una votación. */
export function pollView(poll: Poll, data: Snapshot, now = new Date()) {
  const votes = data.pollVotes.filter((v) => v.pollId === poll.id);
  const status = pollStatus(poll, now);
  const tally = tallyPoll(poll.options.length, poll.eligibleIds, votes);
  const meId = data.me?.id;
  const mine: PollVote | undefined = votes.find((v) => v.voterId === meId);
  const eligible = Boolean(meId && poll.eligibleIds.includes(meId));
  return {
    status,
    votes,
    tally,
    mine,
    eligible,
    /** Puede votar ahora (o cambiar su voto, si se anunció). */
    canVote: status === 'open' && eligible && (!mine || poll.allowChange),
    isOwner: poll.createdBy === meId,
    restartedBy: data.polls.find((p) => p.restartOf === poll.id),
  };
}

/** «Cierra hoy a las 18:00», «Cierra en 2 días», «Cerró ayer a las 09:00». */
export function closingLabel(poll: Poll, now = new Date()): string {
  const status = pollStatus(poll, now);
  if (status === 'cancelled' && poll.cancelledAt) {
    return `Cancelada ${whenLabel(poll.cancelledAt, now)}`;
  }
  if (status === 'closed') return `Cerró ${whenLabel(poll.closesAt, now)}`;
  const hours = (poll.closesAt.getTime() - now.getTime()) / 3_600_000;
  if (hours < 1) return 'Cierra en menos de una hora';
  if (hours < 24 && poll.closesAt.getDate() === now.getDate()) {
    return `Cierra hoy a las ${formatClock(poll.closesAt)}`;
  }
  const days = Math.ceil(hours / 24);
  return days <= 1 ? `Cierra mañana a las ${formatClock(poll.closesAt)}` : `Cierra en ${days} días`;
}

/** «hoy a las 09:00», «ayer a las 18:30», «el martes, 6 de octubre a las 10:00». */
export function whenLabel(date: Date, now = new Date()): string {
  const day = formatDayLabel(date, now);
  const prefix = day === 'Hoy' || day === 'Ayer' ? day.toLowerCase() : `el ${day.toLowerCase()}`;
  return `${prefix} a las ${formatClock(date)}`;
}

/** Fecha y hora local para un `<input type="datetime-local">`. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Cierre sugerido: en dos días, a la hora en punto. */
export function defaultClosing(now = new Date()): Date {
  const date = new Date(now.getTime() + 2 * 86_400_000);
  date.setMinutes(0, 0, 0);
  return date;
}

/** Orden de la lista: abiertas que cierran pronto primero, luego lo más reciente. */
export function sortPolls(polls: Poll[], now = new Date()): Poll[] {
  const rank = (p: Poll) => ({ open: 0, closed: 1, cancelled: 2 })[pollStatus(p, now)];
  return [...polls].sort((a, b) => {
    const byStatus = rank(a) - rank(b);
    if (byStatus) return byStatus;
    if (rank(a) === 0) return a.closesAt.getTime() - b.closesAt.getTime();
    return b.closesAt.getTime() - a.closesAt.getTime();
  });
}

export function optionList(poll: Poll, choices: readonly number[]): string {
  return choices.map((c) => poll.options[c] ?? '¿?').join(', ');
}
