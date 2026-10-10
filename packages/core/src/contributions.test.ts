import { describe, expect, it } from 'vitest';
import {
  breakdown,
  rankMembers,
  recognitionsFor,
  scoreContributions,
  type ContributionEvent,
} from './contributions';

const day = (d: number) => new Date(2026, 9, d, 12);

describe('contribuciones', () => {
  it('suma los puntos de cada regla', () => {
    const scored = scoreContributions([
      { kind: 'trabajo', memberId: 'a', at: day(1), refId: 'w1' },
      { kind: 'respuesta', memberId: 'a', at: day(2), refId: 'r1', limitKey: 'q1' },
    ]);
    expect(scored.map((e) => e.points)).toEqual([4, 10]);
  });

  it('cuenta solo el primero de los aportes repetidos y dice por qué', () => {
    const scored = scoreContributions([
      { kind: 'respuesta', memberId: 'a', at: day(3), refId: 'r2', limitKey: 'q1' },
      { kind: 'respuesta', memberId: 'a', at: day(2), refId: 'r1', limitKey: 'q1' },
      { kind: 'respuesta', memberId: 'b', at: day(4), refId: 'r3', limitKey: 'q1' },
    ]);
    const byRef = Object.fromEntries(scored.map((e) => [e.refId, e]));
    expect(byRef.r1?.points).toBe(4);
    expect(byRef.r2?.points).toBe(0);
    expect(byRef.r2?.skipped).toMatch(/Ya contó/);
    expect(byRef.r3?.points).toBe(4);
  });

  it('muestra los aportes excluidos sin puntos', () => {
    const [event] = scoreContributions([
      {
        kind: 'respuesta',
        memberId: 'a',
        at: day(1),
        refId: 'r1',
        excluded: 'Es tu propia pregunta.',
      },
    ]);
    expect(event?.points).toBe(0);
    expect(event?.skipped).toBe('Es tu propia pregunta.');
  });

  it('respeta el periodo: desde inclusivo, hasta exclusivo', () => {
    const events: ContributionEvent[] = [1, 5, 10].map((d) => ({
      kind: 'apunte',
      memberId: 'a',
      at: day(d),
      refId: `n${d}`,
    }));
    const scored = scoreContributions(events, { from: day(5), to: day(10) });
    expect(scored.map((e) => e.refId)).toEqual(['n5']);
  });

  it('ordena por puntos, empata lugares y deja sin lugar a quien no tiene puntos', () => {
    const scored = scoreContributions([
      { kind: 'trabajo', memberId: 'b', at: day(1), refId: 'w1' },
      { kind: 'trabajo', memberId: 'c', at: day(1), refId: 'w2' },
      { kind: 'guia', memberId: 'a', at: day(1), refId: 'g1' },
      { kind: 'pagina', memberId: 'd', at: day(1), refId: 't1' },
    ]);
    const ranking = rankMembers(['a', 'b', 'c', 'd', 'e'], scored);
    expect(ranking.map((r) => [r.memberId, r.points, r.rank])).toEqual([
      ['a', 15, 1],
      ['b', 10, 2],
      ['c', 10, 2],
      ['d', 3, 4],
      ['e', 0, 0],
    ]);
  });

  it('ignora a quien ya no es miembro', () => {
    const scored = scoreContributions([
      { kind: 'trabajo', memberId: 'x', at: day(1), refId: 'w1' },
    ]);
    expect(rankMembers(['a'], scored)).toEqual([{ memberId: 'a', points: 0, rank: 0 }]);
  });

  it('desglosa por tipo con lo que contó y lo que no', () => {
    const scored = scoreContributions([
      { kind: 'correccion', memberId: 'a', at: day(1), refId: 'r1', limitKey: 't1' },
      { kind: 'correccion', memberId: 'a', at: day(2), refId: 'r2', limitKey: 't1' },
      { kind: 'trabajo', memberId: 'a', at: day(2), refId: 'w1' },
    ]);
    expect(breakdown(scored)).toEqual([
      { kind: 'trabajo', counted: 1, skipped: 0, points: 10 },
      { kind: 'correccion', counted: 1, skipped: 1, points: 3 },
    ]);
  });

  it('otorga reconocimientos solo con aportes que sumaron', () => {
    const accepted = (d: number): ContributionEvent => ({
      kind: 'respuesta-aceptada',
      memberId: 'a',
      at: day(d),
      refId: `r${d}`,
    });
    const support = (d: number, excluded?: string): ContributionEvent => ({
      kind: 'respuesta',
      memberId: 'a',
      at: day(d),
      refId: `s${d}`,
      excluded,
    });
    expect(recognitionsFor(scoreContributions([accepted(1)]))).toEqual([]);
    expect(recognitionsFor(scoreContributions([accepted(1), accepted(2)]))).toEqual([
      'explicaciones',
    ]);
    expect(
      recognitionsFor(scoreContributions([support(1), support(2), support(3, 'Propia.')])),
    ).toEqual([]);
    // 1, 8 y 15 de octubre caen en semanas distintas.
    expect(recognitionsFor(scoreContributions([support(1), support(8), support(15)]))).toEqual([
      'apoyo',
      'constancia',
    ]);
  });
});
