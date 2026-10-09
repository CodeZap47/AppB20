import { describe, expect, it } from 'vitest';
import {
  canReviewGuide,
  guideCoverage,
  MAX_GUIDE_TOPICS,
  parseTopics,
  sourceStatusError,
} from './guides';

describe('guías de estudio', () => {
  it('limpia el temario: viñetas, renglones vacíos y repetidos', () => {
    expect(parseTopics('1. Variables\n- Ciclos\n\n* ciclos\n  Funciones  ')).toEqual({
      topics: ['Variables', 'Ciclos', 'Funciones'],
    });
    expect(parseTopics('  \n')).toEqual({ problem: 'Escribe al menos un tema del temario.' });
    const many = Array.from({ length: MAX_GUIDE_TOPICS + 1 }, (_, i) => `Tema ${i}`).join('\n');
    expect('problem' in parseTopics(many)).toBe(true);
  });

  it('exige la razón de una fuente pendiente', () => {
    expect(sourceStatusError('pending', '')).toBe('Di por qué la fuente sigue pendiente.');
    expect(sourceStatusError('pending', 'Es un escaneo ilegible')).toBeNull();
    expect(sourceStatusError('processed', '')).toBeNull();
  });

  it('solo da por cubierto un tema con fuentes procesadas', () => {
    const coverage = guideCoverage(
      ['Ciclos', 'Funciones', 'Arreglos'],
      [
        { status: 'processed', topics: ['Ciclos'] },
        { status: 'pending', topics: ['Ciclos', 'Funciones'] },
      ],
    );
    expect(coverage).toEqual([
      { topic: 'Ciclos', processed: 1, pending: 1 },
      { topic: 'Funciones', processed: 0, pending: 1 },
      { topic: 'Arreglos', processed: 0, pending: 0 },
    ]);
  });

  it('nadie revisa la versión que guardó', () => {
    expect(canReviewGuide('a', 'a')).toBe(false);
    expect(canReviewGuide('b', 'a')).toBe(true);
  });
});
