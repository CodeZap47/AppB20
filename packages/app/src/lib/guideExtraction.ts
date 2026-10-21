import { sha256 } from '@noble/hashes/sha2.js';
import { Inflate } from 'fflate';
import { SaxesParser, type SaxesTagNS } from 'saxes';

export const GUIDE_EXTRACTION_LIMITS = {
  maxDocumentBytes: 10 * 1024 * 1024,
  maxPdfPages: 200,
  maxDocxExpandedBytes: 32 * 1024 * 1024,
  maxCharacters: 120_000,
} as const;

export type GuideDocumentFormat = 'pdf' | 'docx' | 'text' | 'code' | 'unsupported';
export interface GuideTextLocator { kind: 'page' | 'paragraph' | 'lines'; start: number; end: number }
export interface GuideExtractionSegment { id: string; text: string; locator: GuideTextLocator }
export interface GuideExtractionOmission { code: string; reason: string; locator?: GuideTextLocator }
export interface GuideDocumentInput {
  fileId: string;
  /** Version of the source to which this attachment belongs. */
  fileVersion: number;
  /** SHA-256 provided by the authenticated attachment metadata operation. */
  fileHash: string;
  fileName: string;
  mimeType?: string;
  blob: Blob;
  signal?: AbortSignal;
}
export interface GuideDocumentExtraction {
  fileId: string; fileVersion: number; fileHash: string; fileName: string;
  format: GuideDocumentFormat; status: 'ready' | 'omitted'; byteLength: number;
  text: string; segments: GuideExtractionSegment[]; omissions: GuideExtractionOmission[];
}

const textExtensions = new Set(['txt', 'md', 'markdown', 'rst', 'csv', 'tsv', 'log']);
const codeExtensions = new Set(['c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'css', 'dart', 'go', 'html', 'htm',
  'java', 'js', 'jsx', 'json', 'kt', 'kts', 'lua', 'm', 'php', 'pl', 'py', 'r', 'rb', 'rs', 'scala',
  'sh', 'sql', 'swift', 'tex', 'toml', 'ts', 'tsx', 'vue', 'xml', 'yaml', 'yml', 'ipynb']);
const wordNamespaces = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main']);

class ExtractionError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
function reject(code: string, reason: string): never { throw new ExtractionError(code, reason); }
function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Extracción cancelada.', 'AbortError');
}
function formatFor(fileName: string, mimeType = ''): GuideDocumentFormat {
  const extension = fileName.toLowerCase().split('.').at(-1) ?? '';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'docx') return 'docx';
  if (textExtensions.has(extension)) return 'text';
  if (codeExtensions.has(extension)) return 'code';
  if (!fileName.includes('.') && mimeType.toLowerCase().split(';')[0] === 'text/plain') return 'text';
  return 'unsupported';
}
export function supportsGuideExtraction(fileName: string, mimeType?: string) {
  return formatFor(fileName, mimeType) !== 'unsupported';
}
function checkTextLength(length: number) {
  if (length > GUIDE_EXTRACTION_LIMITS.maxCharacters) reject('text_limit',
    'El texto supera los 120 000 caracteres admitidos por guía. Divide el documento antes de prepararlo; no se ha recortado.');
}
function segment(id: string, text: string, kind: GuideTextLocator['kind'], start: number, end = start): GuideExtractionSegment {
  return { id, text, locator: { kind, start, end } };
}
function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return reject('unsupported_encoding', 'El documento no contiene texto UTF-8 válido. Guárdalo como UTF-8 y vuelve a prepararlo.'); }
}
function extractText(bytes: Uint8Array): GuideExtractionSegment[] {
  const text = decodeUtf8(bytes).replace(/\r\n?/g, '\n');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) reject('binary_text',
    'El archivo contiene datos binarios o caracteres de control incompatibles con un documento de texto.');
  checkTextLength(text.length);
  if (!text.trim()) return [];
  const lines = text.split('\n');
  const segments: GuideExtractionSegment[] = [];
  let parts: string[] = [], size = 0, start = 1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (parts.length && size + line.length + 1 > 4000) {
      segments.push(segment(`lines-${start}-${index}`, parts.join('\n'), 'lines', start, index));
      parts = []; size = 0; start = index + 1;
    }
    parts.push(line); size += line.length + (parts.length > 1 ? 1 : 0);
  }
  segments.push(segment(`lines-${start}-${lines.length}`, parts.join('\n'), 'lines', start, lines.length));
  return segments;
}

interface ZipEntry { name: string; flags: number; method: number; crc: number; size: number; compressed: number; offset: number; start: number }
function zipEntries(bytes: Uint8Array): ZipEntry[] {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) reject('protected',
    'El DOCX está cifrado o protegido y no se puede preparar. Guarda una copia sin protección.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0) reject('damaged_docx', 'El DOCX está dañado o no es un archivo DOCX válido.');
  const count = u16(end + 10), centralSize = u32(end + 12), centralStart = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || count === 0xffff || centralStart === 0xffffffff || centralSize === 0xffffffff)
    reject('unsupported_docx', 'Este DOCX utiliza un contenedor ZIP multipartes o ZIP64 incompatible.');
  if (!count || count > 8192 || centralStart + centralSize !== end) reject('damaged_docx', 'La estructura ZIP del DOCX es inválida o contiene demasiadas partes.');
  const decodeName = (start: number, length: number, flags: number) => {
    const raw = bytes.subarray(start, start + length);
    return flags & 2048 ? decodeUtf8(raw) : Array.from(raw, (value) => String.fromCharCode(value)).join('');
  };
  const entries: ZipEntry[] = [], names = new Set<string>();
  let cursor = centralStart, total = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50) reject('damaged_docx', 'El índice ZIP del DOCX está dañado.');
    const flags = u16(cursor + 8), method = u16(cursor + 10), crc = u32(cursor + 16);
    const compressed = u32(cursor + 20), size = u32(cursor + 24), length = u16(cursor + 28);
    const extra = u16(cursor + 30), comment = u16(cursor + 32), offset = u32(cursor + 42);
    const next = cursor + 46 + length + extra + comment;
    if (next > end || offset + 30 > centralStart || size === 0xffffffff || compressed === 0xffffffff || offset === 0xffffffff)
      reject('damaged_docx', 'El índice ZIP del DOCX contiene límites inválidos.');
    if (flags & (1 | 64 | 8192)) reject('protected', 'El DOCX está cifrado o protegido. Guarda una copia sin protección.');
    if (method !== 0 && method !== 8) reject('unsupported_docx', 'El método de compresión del DOCX no es compatible.');
    const name = decodeName(cursor + 46, length, flags);
    if (!name || name.includes('\\') || name.startsWith('/') || name.includes('\0') || name.split('/').some((part) => part === '..' || part === '.') || names.has(name))
      reject('damaged_docx', 'El DOCX contiene nombres de partes duplicados o inválidos.');
    names.add(name);
    if (u32(offset) !== 0x04034b50 || u16(offset + 6) !== flags || u16(offset + 8) !== method)
      reject('damaged_docx', 'La cabecera de una parte del DOCX no coincide con su índice.');
    const localLength = u16(offset + 26), localExtra = u16(offset + 28), start = offset + 30 + localLength + localExtra;
    if (start + compressed > centralStart || start > centralStart || decodeName(offset + 30, localLength, flags) !== name)
      reject('damaged_docx', 'Una parte del DOCX está incompleta o tiene un nombre inconsistente.');
    if (!(flags & 8) && (u32(offset + 14) !== crc || u32(offset + 18) !== compressed || u32(offset + 22) !== size))
      reject('damaged_docx', 'Los tamaños de una parte del DOCX no coinciden con su índice.');
    total += size;
    if (total > GUIDE_EXTRACTION_LIMITS.maxDocxExpandedBytes) reject('docx_expansion_limit', 'El DOCX supera los 32 MiB descomprimidos admitidos para la extracción.');
    entries.push({ name, flags, method, crc, size, compressed, offset, start });
    cursor = next;
  }
  if (cursor !== end) reject('damaged_docx', 'El índice del DOCX contiene datos inconsistentes.');
  const ordered = [...entries].sort((left, right) => left.offset - right.offset);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.offset < ordered[index - 1]!.start + ordered[index - 1]!.compressed)
      reject('damaged_docx', 'Las partes del DOCX se superponen.');
  }
  if (!names.has('[Content_Types].xml') || !names.has('word/document.xml')) reject('damaged_docx', 'El archivo ZIP no contiene un documento DOCX.');
  return entries;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function decodeXml(bytes: Uint8Array) {
  let encoding = 'utf-8';
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 60 && bytes[1] === 0)) encoding = 'utf-16le';
  if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 60)) encoding = 'utf-16be';
  let xml: string;
  try { xml = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { return reject('damaged_docx', 'El DOCX contiene una parte XML con codificación inválida.'); }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(xml)) reject('unsafe_xml', 'El DOCX declara entidades o un DTD XML externo. Esas declaraciones no se admiten.');
  return xml;
}
function xmlParser() {
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', () => reject('damaged_docx', 'El DOCX contiene XML dañado o incompatible.'));
  parser.on('doctype', () => reject('unsafe_xml', 'El DOCX declara un DTD XML y no se admite para la extracción.'));
  return parser;
}
function isWord(tag: SaxesTagNS, name: string) { return tag.local === name && wordNamespaces.has(tag.uri); }
function compactParagraphSegments(segments: GuideExtractionSegment[]) {
  if (segments.length <= 512) return segments;
  const grouped: GuideExtractionSegment[] = [];
  let active: GuideExtractionSegment | undefined;
  for (const next of segments) {
    if (!active || active.text.length + next.text.length + 2 > 4000) {
      active = { ...next, locator: { ...next.locator } }; grouped.push(active);
    } else {
      active.text += `\n\n${next.text}`; active.locator.end = next.locator.end;
      active.id = `paragraphs-${active.locator.start}-${active.locator.end}`;
    }
  }
  return grouped;
}

async function extractDocx(bytes: Uint8Array, signal?: AbortSignal): Promise<{ segments: GuideExtractionSegment[]; omissions: GuideExtractionOmission[] }> {
  const entries = zipEntries(bytes), xmlParts = new Map<string, string>();
  let expanded = 0, yieldedExpanded = 0;
  for (const entry of entries) {
    abort(signal);
    const chunks: Uint8Array[] = [], isXml = /\.(?:xml|rels)$/iu.test(entry.name);
    let length = 0, crc = 0xffffffff, failure: Error | undefined;
    const receive = (chunk: Uint8Array) => {
      if (failure) return;
      expanded += chunk.length; length += chunk.length;
      if (expanded > GUIDE_EXTRACTION_LIMITS.maxDocxExpandedBytes) { failure = new ExtractionError('docx_expansion_limit', 'El DOCX supera los 32 MiB descomprimidos admitidos para la extracción.'); throw failure; }
      for (const value of chunk) crc = crcTable[(crc ^ value) & 255]! ^ (crc >>> 8);
      if (isXml) chunks.push(chunk);
    };
    const inflator = entry.method === 8 ? new Inflate((chunk) => receive(chunk)) : undefined;
    for (let offset = 0; offset < entry.compressed; offset += 1024) {
      abort(signal);
      const chunk = bytes.subarray(entry.start + offset, entry.start + Math.min(offset + 1024, entry.compressed));
      if (inflator) inflator.push(chunk, offset + 1024 >= entry.compressed);
      else receive(chunk);
      if (failure) throw failure;
      // Yield between bounded input chunks so cancellation remains actionable in a browser.
      if (expanded - yieldedExpanded >= 1024 * 1024) {
        yieldedExpanded = expanded;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    if (inflator && !entry.compressed) inflator.push(new Uint8Array(), true);
    if (length !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) reject('damaged_docx', 'Una parte del DOCX está dañada: su tamaño o huella CRC no coincide.');
    if (isXml) {
      const collected = new Uint8Array(length); let position = 0;
      for (const chunk of chunks) { collected.set(chunk, position); position += chunk.length; }
      const xml = decodeXml(collected), parser = xmlParser();
      if (entry.name === 'word/settings.xml') parser.on('opentag', (tag) => {
        if (isWord(tag, 'documentProtection')) {
          const enforcement = Object.values(tag.attributes).find((attribute) => attribute.local === 'enforcement')?.value;
          if (enforcement === '1' || enforcement === 'true' || enforcement === 'on') reject('protected', 'El DOCX tiene protección activa. Guarda una copia sin protección antes de prepararlo.');
        }
      });
      parser.write(xml).close();
      if (entry.name === 'word/document.xml') xmlParts.set(entry.name, xml);
    }
  }
  abort(signal);
  const segments: GuideExtractionSegment[] = [], omissions: GuideExtractionOmission[] = [];
  let paragraph = 0, body = 0, depth = 0, textDepth = 0, excluded = 0, active: { index: number; text: string } | undefined;
  let totalText = 0, documentRoot = false, omittedDrawings = false, omittedDeleted = false;
  const parser = xmlParser();
  parser.on('opentag', (tag) => {
    depth += 1;
    if (depth === 1) documentRoot = isWord(tag, 'document');
    if (isWord(tag, 'body')) body = depth;
    if (!body) return;
    if (isWord(tag, 'drawing') || isWord(tag, 'pict') || isWord(tag, 'object') || isWord(tag, 'del')) {
      if (!excluded) excluded = depth;
      if (isWord(tag, 'del')) omittedDeleted = true; else omittedDrawings = true;
    }
    if (excluded) return;
    if (isWord(tag, 'p')) { paragraph += 1; active = { index: paragraph, text: '' }; }
    if (isWord(tag, 't')) textDepth = depth;
    if (active && (isWord(tag, 'tab') || isWord(tag, 'br') || isWord(tag, 'cr'))) {
      active.text += isWord(tag, 'tab') ? '\t' : '\n'; totalText += 1; checkTextLength(totalText);
    }
  });
  const append = (value: string) => {
    if (active && textDepth && !excluded) { active.text += value; totalText += value.length; checkTextLength(totalText); }
  };
  parser.on('text', append); parser.on('cdata', append);
  parser.on('closetag', (tag) => {
    if (textDepth === depth) textDepth = 0;
    if (active && isWord(tag, 'p') && !excluded) {
      if (active.text.trim()) { checkTextLength(totalText + segments.length); segments.push(segment(`paragraph-${active.index}`, active.text, 'paragraph', active.index)); }
      active = undefined;
    }
    if (excluded === depth) excluded = 0;
    if (body === depth) body = 0;
    depth -= 1;
  });
  parser.write(xmlParts.get('word/document.xml')!).close();
  if (!documentRoot) reject('damaged_docx', 'El archivo no contiene el cuerpo de un documento Word compatible.');
  if (omittedDrawings || entries.some((entry) => entry.name.startsWith('word/media/') || entry.name.startsWith('word/embeddings/')))
    omissions.push({ code: 'docx_nontext', reason: 'Se omitieron imágenes, objetos incrustados y sus cuadros de texto; esta entrega extrae el texto principal.' });
  if (omittedDeleted) omissions.push({ code: 'docx_deleted_text', reason: 'Se omitió el texto marcado como eliminado en el control de cambios.' });
  if (entries.some((entry) => /^word\/(?:header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/u.test(entry.name)))
    omissions.push({ code: 'docx_secondary_parts', reason: 'Se omitieron encabezados, pies de página, notas y comentarios del documento; revisa el texto principal extraído.' });
  return { segments: compactParagraphSegments(segments), omissions };
}

/** PDF.js receives bytes only; its asset factory cannot fetch document-linked resources. */
class LocalOnlyPdfAssets {
  async fetch(): Promise<Uint8Array> { throw new Error('Los recursos externos no se descargan al preparar una guía.'); }
}
async function extractPdf(bytes: Uint8Array, signal?: AbortSignal): Promise<{ segments: GuideExtractionSegment[]; omissions: GuideExtractionOmission[] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined') {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  abort(signal);
  const task = pdfjs.getDocument({ data: bytes, useWorkerFetch: false, useWasm: false,
    disableAutoFetch: true, disableRange: true, disableStream: true, enableXfa: false,
    disableFontFace: true, isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
    stopAtErrors: true, maxImageSize: 0, verbosity: 0, BinaryDataFactory: LocalOnlyPdfAssets });
  const cancel = () => { void task.destroy(); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const pdf = await task.promise;
    abort(signal);
    if (pdf.numPages > GUIDE_EXTRACTION_LIMITS.maxPdfPages) reject('pdf_page_limit', 'El PDF supera las 200 páginas admitidas para la extracción.');
    if (await pdf.getPermissions()) reject('protected', 'El PDF está protegido. Guarda una copia sin protección para prepararlo.');
    const segments: GuideExtractionSegment[] = [], omissions: GuideExtractionOmission[] = [];
    let length = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      abort(signal);
      const page = await pdf.getPage(pageNumber);
      const parts: string[] = [];
      const reader = page.streamTextContent().getReader();
      let pageLength = 0, previousItem: { transform: number[]; width: number; height: number } | undefined;
      const add = (text: string) => { pageLength += text.length; checkTextLength(length + pageLength); parts.push(text); };
      try {
        while (true) {
          abort(signal);
          const chunk = await reader.read();
          if (chunk.done) break;
          for (const item of chunk.value.items) {
            if (!('str' in item)) continue;
            const previous = parts.at(-1);
            if (previous && previousItem && !previous.endsWith('\n') && !/\s$/u.test(previous) && item.str && !/^\s/u.test(item.str)) {
              const verticalGap = Math.abs(item.transform[5]! - previousItem.transform[5]!);
              const horizontalGap = item.transform[4]! - previousItem.transform[4]! - previousItem.width;
              if (verticalGap > Math.max(2, previousItem.height / 2)) add('\n');
              else if (horizontalGap > Math.max(0.5, previousItem.height * 0.15)) add(' ');
            }
            add(item.str);
            if (item.hasEOL) add('\n');
            previousItem = item;
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const text = parts.join('').replace(/\n$/u, '');
      length += text.length + (segments.length ? 2 : 0); checkTextLength(length);
      if (text.trim()) segments.push(segment(`page-${pageNumber}`, text, 'page', pageNumber));
      else omissions.push({ code: 'pdf_no_text_page', reason: `La página ${pageNumber} no tiene texto extraíble; puede estar escaneada o contener solo imágenes.`, locator: { kind: 'page', start: pageNumber, end: pageNumber } });
      if (text.includes('\ufffd')) omissions.push({ code: 'pdf_unknown_characters', reason: `La página ${pageNumber} contiene caracteres que no se pudieron interpretar. Revisa y corrige la transcripción antes de utilizarla.`, locator: { kind: 'page', start: pageNumber, end: pageNumber } });
      page.cleanup();
    }
    omissions.push({ code: 'pdf_text_only', reason: 'Solo se preparó el texto del PDF. Las imágenes, diagramas y vínculos externos no se han interpretado ni descargado.' });
    return { segments, omissions };
  } catch (error) {
    abort(signal);
    if (error instanceof ExtractionError) throw error;
    if (error instanceof Error && error.name === 'PasswordException') reject('protected', 'El PDF requiere contraseña y no se puede preparar. Guarda una copia sin protección.');
    return reject('damaged_pdf', 'El PDF está dañado, contiene texto incompatible o no pudo leerse de forma segura.');
  } finally {
    signal?.removeEventListener('abort', cancel);
    await task.destroy();
  }
}

/** No network upload is performed. Only reviewed text from this result may be sent to preparation. */
export async function extractGuideDocument(input: GuideDocumentInput): Promise<GuideDocumentExtraction> {
  const format = formatFor(input.fileName, input.mimeType);
  const result: GuideDocumentExtraction = { fileId: input.fileId, fileVersion: input.fileVersion,
    fileHash: input.fileHash.toLowerCase(), fileName: input.fileName, format, status: 'omitted',
    byteLength: input.blob.size, text: '', segments: [], omissions: [] };
  try {
    abort(input.signal);
    if (!input.fileId || !Number.isSafeInteger(input.fileVersion) || input.fileVersion < 1 || !/^[a-f\d]{64}$/iu.test(input.fileHash))
      reject('invalid_metadata', 'Falta una identidad, huella o versión válida del archivo compartido. Vuelve a consultar el adjunto.');
    if (input.blob.size > GUIDE_EXTRACTION_LIMITS.maxDocumentBytes) reject('document_size_limit', 'El archivo supera los 10 MiB admitidos para extraer texto. Puede seguir almacenado como adjunto, pero no se preparará para IA.');
    if (!input.blob.size) reject('empty', 'El archivo está vacío y no aporta texto a la guía.');
    if (format === 'unsupported') reject('unsupported_format', 'Formato no compatible. Se admiten PDF con texto, DOCX, TXT, Markdown y código; no se aplica reconocimiento de imágenes.');
    const bytes = new Uint8Array(await input.blob.arrayBuffer());
    abort(input.signal);
    const hash = Array.from(sha256(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
    if (hash !== result.fileHash) reject('hash_mismatch', 'La huella del archivo descargado no coincide con la del adjunto. Recarga la fuente antes de prepararla.');
    const extracted = format === 'pdf' ? await extractPdf(bytes, input.signal) : format === 'docx'
      ? await extractDocx(bytes, input.signal) : { segments: extractText(bytes), omissions: [] };
    abort(input.signal);
    if (!extracted.segments.length) {
      const reason = format === 'pdf' ? 'El PDF no contiene texto extraíble. Puede ser un escaneo; esta entrega no aplica OCR.' : 'El documento no contiene texto utilizable.';
      result.omissions = [...extracted.omissions, { code: format === 'pdf' ? 'scanned_or_empty_pdf' : 'empty_text', reason }];
      return result;
    }
    const text = extracted.segments.map((item) => item.text).join(format === 'text' || format === 'code' ? '\n' : '\n\n');
    checkTextLength(text.length);
    return { ...result, status: 'ready', text, ...extracted };
  } catch (error) {
    if (input.signal?.aborted || error instanceof DOMException && error.name === 'AbortError') throw new DOMException('Extracción cancelada.', 'AbortError');
    const issue = error instanceof ExtractionError ? { code: error.code, reason: error.message }
      : { code: 'damaged_document', reason: 'El documento está dañado o utiliza una estructura incompatible. No se ha enviado su contenido.' };
    return { ...result, omissions: [issue] };
  }
}
