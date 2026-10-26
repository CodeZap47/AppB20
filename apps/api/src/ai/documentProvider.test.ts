import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { selectOcrMedia } from './documentProvider.ts';

describe('OCR: envío limitado al original y páginas elegidas', () => {
  it('construye un PDF nuevo solo con páginas seleccionadas en orden', async () => {
    const original = await PDFDocument.create(); for (let i = 1; i <= 6; i++) original.addPage([100 + i, 200]);
    const result = await selectOcrMedia(await original.save(), [2, 5]);
    expect(result.mimeType).toBe('application/pdf'); const selected = await PDFDocument.load(result.bytes);
    expect(selected.getPageCount()).toBe(2); expect(selected.getPages().map((p) => p.getSize().width)).toEqual([102, 105]);
  });
  it('rechaza PDFs dañados, páginas inexistentes y más de 200 páginas', async () => {
    await expect(selectOcrMedia(new TextEncoder().encode('%PDF-dañado'), [1])).rejects.toThrow();
    const original = await PDFDocument.create(); original.addPage(); await expect(selectOcrMedia(await original.save(), [2])).rejects.toThrow();
    for (let i = 0; i < 200; i++) original.addPage(); await expect(selectOcrMedia(await original.save(), [1])).rejects.toThrow('200');
  });
  it('no confía en el MIME del cliente ni envía documentos no visuales a OCR', async () => {
    await expect(selectOcrMedia(new TextEncoder().encode('texto falso.png'), [1])).rejects.toThrow('PNG');
    await expect(selectOcrMedia(new Uint8Array([255, 216, 255, 0]), [2])).rejects.toThrow();
    expect((await selectOcrMedia(new Uint8Array([255, 216, 255, 0]), [1])).mimeType).toBe('image/jpeg');
  });
});
