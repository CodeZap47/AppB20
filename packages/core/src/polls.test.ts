import { describe, expect, it } from 'vitest';
import {
  cleanPollOptions,
  closingError,
  pollStatus,
  tallyPoll,
  voteError,
  type VoteCheck,
} from './polls';

const now = new Date(2026, 9, 9, 12);
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

describe('votaciones', () => {
  it('limpia las opciones y rechaza repetidas o insuficientes', () => {
    expect(cleanPollOptions([' Sí ', '', 'No'])).toEqual({ options: ['Sí', 'No'] });
    expect(cleanPollOptions(['Sí', 'sí'])).toEqual({ problem: 'La opción «sí» está repetida.' });
    expect(cleanPollOptions(['Solo una', '  '])).toEqual({
      problem: 'Escribe al menos dos opciones.',
    });
    expect('problem' in cleanPollOptions(Array.from({ length: 11 }, (_, i) => `Opción ${i}`))).toBe(
      true,
    );
  });

  it('pide un cierre con margen para votar', () => {
    expect(closingError(later(5), now)).toMatch(/10 minutos/);
    expect(closingError(later(60), now)).toBeNull();
    expect(closingError(new Date(Number.NaN), now)).toMatch(/fecha/);
  });

  it('está abierta hasta su cierre y la cancelación manda', () => {
    expect(pollStatus({ closesAt: later(1) }, now)).toBe('open');
    expect(pollStatus({ closesAt: now }, now)).toBe('closed');
    expect(pollStatus({ closesAt: later(60), cancelledAt: now }, now)).toBe('cancelled');
  });

  it('solo votan los elegibles, antes del cierre y una vez salvo que se anuncie el cambio', () => {
    const base: VoteCheck = {
      status: 'open',
      multiple: false,
      allowChange: false,
      optionCount: 3,
      eligible: true,
      alreadyVoted: false,
    };
    expect(voteError(base, [1])).toBeNull();
    expect(voteError({ ...base, eligible: false }, [1])).toMatch(/participantes/);
    expect(voteError({ ...base, status: 'closed' }, [1])).toMatch(/cerró/);
    expect(voteError({ ...base, alreadyVoted: true }, [1])).toMatch(/no permite cambiar/);
    expect(voteError({ ...base, alreadyVoted: true, allowChange: true }, [2])).toBeNull();
  });

  it('valida las opciones elegidas según el tipo de votación', () => {
    const base: VoteCheck = {
      status: 'open',
      multiple: false,
      allowChange: false,
      optionCount: 3,
      eligible: true,
      alreadyVoted: false,
    };
    expect(voteError(base, [])).toMatch(/Elige/);
    expect(voteError(base, [0, 1])).toMatch(/una opción/);
    expect(voteError({ ...base, multiple: true }, [0, 1])).toBeNull();
    expect(voteError({ ...base, multiple: true }, [1, 1])).toMatch(/dos veces/);
    expect(voteError(base, [3])).toMatch(/no existe/);
  });

  it('cuenta los votos con nombre, quién falta y qué va adelante', () => {
    const tally = tallyPoll(
      3,
      ['a', 'b', 'c', 'd'],
      [
        { voterId: 'a', choices: [0] },
        { voterId: 'b', choices: [1] },
        { voterId: 'c', choices: [0, 1] },
        { voterId: 'x', choices: [2] },
      ],
    );
    expect(tally.counts).toEqual([2, 2, 0]);
    expect(tally.voters[0]).toEqual(['a', 'c']);
    expect(tally.voted).toBe(3);
    expect(tally.pending).toEqual(['d']);
    expect(tally.leading).toEqual([0, 1]);
    expect(tallyPoll(2, ['a'], []).leading).toEqual([]);
  });
});
