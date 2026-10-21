import { describe, expect, it } from 'vitest';
import { normalizeChallenge, normalizeCodeReview, normalizeCodeSource, practiceId, validateCodeLines } from './practice';
const challenge = { requestId: 'one', subjectId: 'ALG1', title: 'Sumar', topic: 'Listas', difficulty: 'basic' as const, objective: 'Recorrer', instructions: 'Suma elementos', examples: '[1,2] → 3', hints: ['Recorre', 'Acumula'] };
describe('Retos y revisión: contratos de contenido', () => {
  it('exige objetivo, instrucciones, ejemplos y pistas válidas', () => { expect(normalizeChallenge(challenge).hints).toEqual(challenge.hints); expect(() => normalizeChallenge({ ...challenge, examples: '' })).toThrow(); expect(() => normalizeChallenge({ ...challenge, hints: Array(9).fill('Pista') })).toThrow(); });
  it('conserva sangría, espacios y líneas vacías para anclar la versión exacta', () => { expect(normalizeCodeSource('  a()\r\n\r\n', '').code).toBe('  a()\n\n'); });
  it('admite código o referencia HTTPS y rechaza credenciales, scripts y tamaños excesivos', () => {
    expect(normalizeCodeSource('', 'https://github.com/grupo/repo/tree/hash').repositoryUrl).toContain('/hash');
    for (const url of ['javascript:alert(1)', 'http://github.com/a', 'https://user:pass@github.com/a', 'https://github.com\\@evil.test/a', 'https://github.com\n.evil.test/a']) expect(() => normalizeCodeSource('', url)).toThrow();
    expect(() => normalizeCodeSource('', '')).toThrow(); expect(() => normalizeCodeSource('a'.repeat(60001), '')).toThrow();
  });
  it('valida comentarios generales y límites contra el código de cada versión', () => {
    expect(() => validateCodeLines('a\nb', 1, 2)).not.toThrow(); expect(() => validateCodeLines('', 0, 0)).not.toThrow();
    for (const [start, end] of [[0, 1], [2, 1], [1, 3], [-1, 0], [1.5, 2]]) expect(() => validateCodeLines('a\nb', start!, end!)).toThrow();
    expect(() => validateCodeLines('', 1, 1)).toThrow();
  });
  it('limita IDs del servidor a u64 sin pérdidas de precisión', () => { expect(practiceId('18446744073709551615')).toBe('18446744073709551615'); expect(() => practiceId('18446744073709551616')).toThrow(); expect(() => practiceId('1.5')).toThrow(); });
  it('una revisión requiere contexto y lenguaje', () => { expect(() => normalizeCodeReview({ requestId: 'x', subjectId: '1', title: 'Prueba', language: '', summary: 'Contexto', code: 'a()', repositoryUrl: '' })).toThrow(); });
});
