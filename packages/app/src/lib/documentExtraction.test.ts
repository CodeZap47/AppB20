import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';
import { extractExamDocument } from './documentExtraction';
import { extractGuideDocument } from './guideExtraction';

describe('extracción documental compartida EX-3', () => {
  it('permite seleccionar secciones de archivos grandes sin recortar y conserva límites de Guías', async () => {
    const text = `${'const ejemplo = true;\n'.repeat(7000)}línea final conservada`;
    const bytes = new TextEncoder().encode(text), fileHash = Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
    const input = { fileId: 'file', fileHash, fileVersion: 1, fileName: 'codigo.ts', blob: new Blob([bytes]) };
    const exam = await extractExamDocument(input), guide = await extractGuideDocument(input);
    expect(exam.status).toBe('ready'); expect(exam.text).toBe(text); expect(exam.segments.at(-1)?.text).toContain('línea final conservada');
    expect(exam.segments.every((s) => s.text.length <= 4000)).toBe(true); expect(exam.segments[0]?.locator.kind).toBe('lines');
    expect(guide.status).toBe('omitted'); expect(guide.omissions[0]?.code).toBe('text_limit');
  });
  it('divide líneas largas en partes seleccionables conservando su procedencia completa', async () => {
    const text = 'a'.repeat(45_000), bytes = new TextEncoder().encode(text), fileHash = Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
    const result = await extractExamDocument({ fileId: 'file', fileHash, fileVersion: 2, fileName: 'nota.txt', blob: new Blob([bytes]) });
    expect(result.segments.map((s) => s.text).join('')).toBe(text); expect(result.segments.length).toBe(12);
    expect(result.segments.every((s) => s.locator.start === 1 && s.locator.end === 1)).toBe(true);
  });
});
