import { describe, expect, it } from 'vitest';
import { computeContributionOrigins, type ContributionOriginInput } from './contributionOrigins';

const base: ContributionOriginInput = { kind: 'apunte', refId: '10', memberId: 'a', createdAt: 100n, context: ['materia', 'parcial'], content: ['Título', 'Contenido', 'Tema'] };

describe('procedencia canónica de contribuciones', () => {
  it('elige la primera fecha y desempata IDs u64 sin comparar texto ni convertir a Number', () => {
    const result = computeContributionOrigins([{ ...base, refId: '18446744073709551614', createdAt: 99n }, { ...base, refId: '9007199254740993', createdAt: 99n }, { ...base, refId: '2' }]);
    expect(result).toEqual([
      { kind: 'apunte', refId: '18446744073709551614', memberId: 'a', creditedAt: 99n, duplicateOf: '9007199254740993' },
      { kind: 'apunte', refId: '9007199254740993', memberId: 'a', creditedAt: 99n, duplicateOf: undefined },
      { kind: 'apunte', refId: '2', memberId: 'a', creditedAt: 99n, duplicateOf: '9007199254740993' },
    ]);
  });
  it('normaliza saltos de línea y extremos, conservando mayúsculas, código y espacios internos', () => {
    const result = computeContributionOrigins([
      { ...base, refId: '1', content: [' x\r\ny ', ['const  A = 1;']] },
      { ...base, refId: '2', content: ['x\ny', ['const  A = 1;']] },
      { ...base, refId: '3', content: ['X\ny', ['const  A = 1;']] },
      { ...base, refId: '4', content: ['x\ny', ['const A = 1;']] },
    ]);
    expect(result[1]?.duplicateOf).toBe('1'); expect(result[2]?.duplicateOf).toBeUndefined(); expect(result[3]?.duplicateOf).toBeUndefined();
  });
  it('cada autor, materia, parcial y tipo conserva su propio origen', () => {
    const result = computeContributionOrigins([base, { ...base, refId: '11', memberId: 'b' }, { ...base, refId: '12', context: ['materia', 'otro-parcial'] }, { ...base, refId: '13', kind: 'guia' }]);
    expect(result.every((row) => row.duplicateOf === undefined)).toBe(true);
  });
  it('compara contenido de archivos sin depender de su orden y no colapsa recursos vacíos', () => {
    const result = computeContributionOrigins([
      { ...base, refId: '1', files: ['sha256:A', 'sha256:B'] }, { ...base, refId: '2', files: ['sha256:B', 'sha256:A', 'sha256:A'] },
      { ...base, refId: '3', files: ['sha256:C'] }, { ...base, refId: '4', content: ['', []] }, { ...base, refId: '5', content: ['', []] },
    ]);
    expect(result[1]?.duplicateOf).toBe('1'); expect(result[2]?.duplicateOf).toBeUndefined(); expect(result[3]?.duplicateOf).toBeUndefined(); expect(result[4]?.duplicateOf).toBeUndefined();
  });
  it('la salida solo contiene procedencia, sin texto, contexto ni firmas de archivos', () => {
    const result = computeContributionOrigins([{ ...base, files: ['sha256:secreto'] }]);
    expect(Object.keys(result[0]!).sort()).toEqual(['creditedAt', 'duplicateOf', 'kind', 'memberId', 'refId']);
    expect(JSON.stringify(result, (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value)).not.toMatch(/Contenido|parcial|sha256|secreto/);
  });
});
