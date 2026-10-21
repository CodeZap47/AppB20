import { sha256 } from '@noble/hashes/sha2.js';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { extractGuideDocument, GUIDE_EXTRACTION_LIMITS, supportsGuideExtraction, type GuideDocumentInput } from './guideExtraction';

function input(bytes: Uint8Array | string, fileName: string, options: Partial<GuideDocumentInput> = {}): GuideDocumentInput {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return { fileId: 'file-1', fileVersion: 3, fileHash: Array.from(sha256(data), (value) => value.toString(16).padStart(2, '0')).join(''),
    fileName, blob: new Blob([Uint8Array.from(data)]), ...options };
}
const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function docx(body: string, parts: Record<string, Uint8Array> = {}) {
  return zipSync({ '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${wordNamespace}"><w:body>${body}</w:body></w:document>`), ...parts });
}

/** A complete, deterministic PDF fixture with an actual xref table and text streams. */
function pdf(pages: (string | null)[], extra = '') {
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let index = 0; index < pages.length; index += 1) {
    const stream = pages[index] == null ? 'q 100 0 0 100 20 20 cm /Im1 Do Q' : `BT /F1 12 Tf 20 100 Td (${pages[index]!.replace(/[()\\]/g, '\\$&')}) Tj ET`;
    const imageResource = pages[index] == null ? `/XObject << /Im1 ${4 + pages.length * 2} 0 R >>` : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 3 0 R >> ${imageResource} >> /Contents ${5 + index * 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  if (pages.includes(null)) objects.push('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 3 >>\nstream\nff>\nendstream');
  let body = '%PDF-1.7\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) { offsets.push(body.length); body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${extra} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe('preparación local de documentos para guías', () => {
  it('mantiene identidad, huella, versión y líneas sin ejecutar código ni visitar vínculos', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No debe consultar la red'));
    const source = 'const url = "https://example.invalid/datos";\nthrow new Error("no ejecutar");\n';
    const result = await extractGuideDocument(input(source, 'ejemplo.ts'));
    expect(result).toMatchObject({ fileId: 'file-1', fileVersion: 3, format: 'code', status: 'ready', text: source,
      segments: [{ locator: { kind: 'lines', start: 1, end: 3 }, text: source }] });
    expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
  });

  it('preserva Unicode y números de línea al normalizar saltos y dividir texto largo', async () => {
    const source = `${'á'.repeat(3995)}\r\nlínea dos\rfin\n`;
    const result = await extractGuideDocument(input(source, 'apuntes.md'));
    expect(result.status).toBe('ready');
    expect(result.text).toBe(source.replace(/\r\n?/g, '\n'));
    expect(result.segments.map((part) => part.locator)).toEqual([{ kind: 'lines', start: 1, end: 1 }, { kind: 'lines', start: 2, end: 4 }]);
  });

  it.each(['pantalla.png', 'presentacion.pptx', 'tabla.xlsx', 'archivo.pdf.exe', 'archivo.zip'])('explica el formato omitido %s', async (name) => {
    expect(supportsGuideExtraction(name)).toBe(false);
    const result = await extractGuideDocument(input('archivo', name));
    expect(result).toMatchObject({ status: 'omitted', text: '', segments: [], omissions: [{ code: 'unsupported_format' }] });
  });

  it('rechaza metadatos inválidos, otra huella y archivos superiores al límite antes de leerlos', async () => {
    expect((await extractGuideDocument(input('abc', 'a.txt', { fileHash: 'x' }))).omissions[0]?.code).toBe('invalid_metadata');
    expect((await extractGuideDocument(input('abc', 'a.txt', { fileHash: '0'.repeat(64) }))).omissions[0]?.code).toBe('hash_mismatch');
    const blob = new Blob([new Uint8Array(GUIDE_EXTRACTION_LIMITS.maxDocumentBytes + 1)]);
    const read = vi.spyOn(blob, 'arrayBuffer');
    const result = await extractGuideDocument(input('abc', 'a.txt', { blob }));
    expect(result.omissions[0]?.code).toBe('document_size_limit'); expect(read).not.toHaveBeenCalled();
  });

  it('rechaza texto binario o mal codificado y comunica vacíos sin contenido parcial', async () => {
    expect((await extractGuideDocument(input('', 'a.txt'))).omissions[0]?.code).toBe('empty');
    expect((await extractGuideDocument(input(' \n\t', 'a.txt'))).omissions[0]?.code).toBe('empty_text');
    expect((await extractGuideDocument(input(new Uint8Array([0xff]), 'a.txt'))).omissions[0]?.code).toBe('unsupported_encoding');
    expect((await extractGuideDocument(input('texto\0otro', 'a.py'))).omissions[0]?.code).toBe('binary_text');
    const tooLong = await extractGuideDocument(input('x'.repeat(120_001), 'a.md'));
    expect(tooLong).toMatchObject({ status: 'omitted', text: '', segments: [], omissions: [{ code: 'text_limit' }] });
  });

  it('extrae párrafos reales de DOCX, conserva tablas, tabulaciones y entidades XML seguras', async () => {
    const bytes = docx('<w:p><w:r><w:t>Hola &amp; mundo</w:t><w:tab/><w:t>ñ</w:t></w:r></w:p><w:p/>'
      + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>En una tabla</w:t><w:br/><w:t>otra línea</w:t></w:r></w:p></w:tc></w:tr></w:tbl>');
    const result = await extractGuideDocument(input(bytes, 'texto.docx'));
    expect(result).toMatchObject({ status: 'ready', format: 'docx', text: 'Hola & mundo\tñ\n\nEn una tabla\notra línea',
      segments: [{ locator: { kind: 'paragraph', start: 1, end: 1 } }, { locator: { kind: 'paragraph', start: 3, end: 3 } }] });
  });

  it('explica imágenes, secciones secundarias y texto eliminado, sin incluirlos en la transcripción', async () => {
    const bytes = docx('<w:p><w:r><w:t>Vigente</w:t></w:r><w:del><w:r><w:delText>Secreto eliminado</w:delText></w:r></w:del>'
      + '<w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>Diagrama</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r></w:p>',
    { 'word/media/image1.png': new Uint8Array([1, 2, 3]), 'word/header1.xml': strToU8(`<w:hdr xmlns:w="${wordNamespace}"><w:p><w:r><w:t>Encabezado</w:t></w:r></w:p></w:hdr>`) });
    const result = await extractGuideDocument(input(bytes, 'texto.docx'));
    expect(result).toMatchObject({ status: 'ready', text: 'Vigente' });
    expect(result.omissions.map((issue) => issue.code)).toEqual(['docx_nontext', 'docx_deleted_text', 'docx_secondary_parts']);
  });

  it('agrupa documentos con muchos párrafos sin perder texto ni sus intervalos de localización', async () => {
    const paragraphs = Array.from({ length: 2000 }, (_, index) => `Párrafo ${index + 1}`);
    const result = await extractGuideDocument(input(docx(paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')), 'muchos.docx'));
    expect(result.status).toBe('ready'); expect(result.text).toBe(paragraphs.join('\n\n'));
    expect(result.segments.length).toBeLessThan(20);
    expect(result.segments[0]?.locator).toMatchObject({ kind: 'paragraph', start: 1 });
    expect(result.segments.at(-1)?.locator).toMatchObject({ kind: 'paragraph', end: 2000 });
    for (let index = 1; index < result.segments.length; index += 1)
      expect(result.segments[index]!.locator.start).toBe(result.segments[index - 1]!.locator.end + 1);
  });

  it('rechaza DOCX vacío, dañado o protegido con razones explícitas', async () => {
    const empty = await extractGuideDocument(input(docx('<w:p/>'), 'a.docx'));
    expect(empty.omissions[0]?.code).toBe('empty_text');
    expect((await extractGuideDocument(input('no es un zip', 'a.docx'))).omissions[0]?.code).toBe('damaged_docx');
    const settings = strToU8(`<w:settings xmlns:w="${wordNamespace}"><w:documentProtection w:enforcement="1"/></w:settings>`);
    expect((await extractGuideDocument(input(docx('<w:p/>', { 'word/settings.xml': settings }), 'a.docx'))).omissions[0]?.code).toBe('protected');
    expect((await extractGuideDocument(input(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'a.docx'))).omissions[0]?.code).toBe('protected');
  });

  it('rechaza entidades y DTD tanto en el cuerpo como en partes auxiliares, sin resolverlos', async () => {
    const unsafe = strToU8('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY data SYSTEM "https://example.invalid/secret">]><x>&data;</x>');
    const external = await extractGuideDocument(input(docx('<w:p/>', { 'word/comments.xml': unsafe }), 'a.docx'));
    expect(external).toMatchObject({ status: 'omitted', text: '', omissions: [{ code: 'unsafe_xml' }] });
    const entity = await extractGuideDocument(input(docx('<w:p><w:r><w:t>&externo;</w:t></w:r></w:p>'), 'a.docx'));
    expect(entity.omissions[0]?.code).toBe('damaged_docx');
  });

  it('rechaza archivos expansivos incluso si se falsifican los tamaños declarados en ambas cabeceras', async () => {
    const bytes = docx('<w:p><w:r><w:t>Seguro</w:t></w:r></w:p>', { 'word/media/bomb.bin': new Uint8Array(33 * 1024 * 1024) });
    expect(bytes.length).toBeLessThan(GUIDE_EXTRACTION_LIMITS.maxDocumentBytes);
    expect((await extractGuideDocument(input(bytes, 'bomba.docx'))).omissions[0]?.code).toBe('docx_expansion_limit');
    const forged = Uint8Array.from(bytes), view = new DataView(forged.buffer);
    for (let offset = 0; offset <= forged.length - 46; offset += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue;
      const nameLength = view.getUint16(offset + 28, true);
      const name = new TextDecoder().decode(forged.subarray(offset + 46, offset + 46 + nameLength));
      if (name !== 'word/media/bomb.bin') continue;
      view.setUint32(offset + 24, 1, true);
      const local = view.getUint32(offset + 42, true); view.setUint32(local + 22, 1, true);
    }
    const result = await extractGuideDocument(input(forged, 'bomba.docx'));
    expect(result).toMatchObject({ status: 'omitted', text: '', segments: [], omissions: [{ code: 'docx_expansion_limit' }] });
  }, 20_000);

  it('comprueba CRC y no acepta un ZIP simplemente porque su XML parece legible', async () => {
    const bytes = docx('<w:p><w:r><w:t>Texto válido</w:t></w:r></w:p>');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue;
      const nameLength = view.getUint16(offset + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      if (name !== 'word/document.xml') continue;
      const local = view.getUint32(offset + 42, true);
      view.setUint32(offset + 16, 123, true); view.setUint32(local + 14, 123, true);
    }
    expect((await extractGuideDocument(input(bytes, 'a.docx'))).omissions[0]?.code).toBe('damaged_docx');
  });

  it('extrae un PDF auténtico y cita páginas, incluyendo las páginas sin texto como omisiones', async () => {
    const result = await extractGuideDocument(input(pdf(['Primera pagina', null, 'Tercera pagina']), 'material.pdf'));
    expect(result).toMatchObject({ status: 'ready', text: 'Primera pagina\n\nTercera pagina',
      segments: [{ locator: { kind: 'page', start: 1, end: 1 } }, { locator: { kind: 'page', start: 3, end: 3 } }] });
    expect(result.omissions).toContainEqual(expect.objectContaining({ code: 'pdf_no_text_page', locator: { kind: 'page', start: 2, end: 2 } }));
  });

  it('explica PDF escaneado/vacío, corrupto y superior a 200 páginas sin devolver recortes', async () => {
    const empty = await extractGuideDocument(input(pdf([null]), 'escaneo.pdf'));
    expect(empty.status).toBe('omitted'); expect(empty.omissions.at(-1)?.code).toBe('scanned_or_empty_pdf');
    expect((await extractGuideDocument(input('%PDF-1.7\nroto', 'a.pdf'))).omissions[0]?.code).toBe('damaged_pdf');
    const many = await extractGuideDocument(input(pdf(Array.from({ length: 201 }, () => 'Hola')), 'a.pdf'));
    expect(many).toMatchObject({ status: 'omitted', text: '', segments: [], omissions: [{ code: 'pdf_page_limit' }] });
  });

  it('conserva cancelación como AbortError y no publica una extracción parcial', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(extractGuideDocument(input('Texto', 'a.txt', { signal: controller.signal }))).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('permite cancelar durante la expansión local de un DOCX comprimido', async () => {
    const bytes = docx('<w:p><w:r><w:t>Texto</w:t></w:r></w:p>', { 'word/media/big.bin': new Uint8Array(16 * 1024 * 1024) });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 0);
    try { await expect(extractGuideDocument(input(bytes, 'grande.docx', { signal: controller.signal }))).rejects.toMatchObject({ name: 'AbortError' }); }
    finally { clearTimeout(timer); }
  });
});
