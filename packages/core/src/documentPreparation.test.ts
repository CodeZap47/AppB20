import { describe, expect, it } from 'vitest';
import { validateDocumentOcrInput, validateDocumentOcrResult, validateDocumentSegments } from './documentPreparation';

describe('documentos EX-3: presupuestos explícitos y OCR íntegro', () => {
  const segment = { id: 'page-3', text: 'Texto revisado', locator: { kind: 'page', start: 3, end: 3 } };
  it('rechaza lotes de más de cinco páginas, duplicados y páginas fuera del original', () => {
    const input = { fileId: 'file', fileHash: 'a'.repeat(64), targetVersion: 1, pages: [3, 1] };
    expect(validateDocumentOcrInput(input).pages).toEqual([1, 3]);
    for (const pages of [[1, 1], [0], [201], [1, 2, 3, 4, 5, 6]]) expect(() => validateDocumentOcrInput({ ...input, pages })).toThrow();
  });
  it('no recorta una selección que excede presupuesto ni acepta localizadores inventados', () => {
    expect(validateDocumentSegments([segment], 40_000)).toEqual([segment]);
    expect(() => validateDocumentSegments([{ ...segment, text: 'x'.repeat(40_001) }], 40_000)).toThrow('No se ha recortado');
    expect(() => validateDocumentSegments([{ ...segment, locator: { kind: 'page', start: 4, end: 3 } }])).toThrow();
  });
  it('exige todas las páginas seleccionadas en orden y no acepta OCR parcial', () => {
    expect(validateDocumentOcrResult({ segments: [segment], omissions: [] }, [3]).segments[0]?.locator.start).toBe(3);
    expect(() => validateDocumentOcrResult({ segments: [segment], omissions: [] }, [2, 3])).toThrow();
    expect(() => validateDocumentOcrResult({ segments: [segment], omissions: [] }, [2])).toThrow('localizadores');
  });
});
