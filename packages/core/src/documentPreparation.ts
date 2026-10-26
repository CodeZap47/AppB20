import { AiError, aiRecord, aiUuid, sanitizeAiText } from './ai';

export const DOCUMENT_LIMITS = Object.freeze({ maxBytes: 10 * 1024 * 1024, maxPdfPages: 200,
  maxDocxExpandedBytes: 32 * 1024 * 1024, maxSelectedCharacters: 40_000, maxPreparedCharacters: 120_000,
  maxOcrPages: 5, maxOcrOutputTokens: 8000 });
export interface DocumentLocator { kind: 'page' | 'paragraph' | 'lines'; start: number; end: number }
export interface DocumentSegment { id: string; text: string; locator: DocumentLocator }
export interface DocumentFileMetadata {
  fileId: string; fileHash: string; targetKind: string; targetId: string; targetVersion: number;
  name: string; size: number; contentType: string;
}
export interface DocumentTranscriptionInput extends Pick<DocumentFileMetadata, 'fileId' | 'fileHash' | 'targetKind' | 'targetId' | 'targetVersion'> {
  id: string; reviewed: true; segments: DocumentSegment[]; omissions: string[]; ocrDraftId?: string;
}
export interface DocumentTranscription extends DocumentTranscriptionInput { createdAt: number; label: string; fileEtag: string }
export interface DocumentOcrInput { fileId: string; fileHash: string; targetVersion: number; pages: number[] }
export interface DocumentOcrDraft {
  id: string; revision: number; state: 'prepared' | 'running' | 'ready' | 'failed' | 'unknown' | 'cancelled';
  file: DocumentFileMetadata; pages: number[]; model: string; fingerprint: string;
  estimatedInputTokens: number; estimatedOutputTokens: number; createdAt: number; expiresAt: number;
  generationId?: string; startedAt?: number; result?: { segments: DocumentSegment[]; omissions: string[] };
  error?: string; usage?: { inputTokens: number; outputTokens: number };
  authorization?: { generationId: string; keyId: string; acknowledgeUnknown: boolean };
}
export interface DocumentOcrClaim { claimed: boolean; actor: string; draft: DocumentOcrDraft;
  key?: { keyId: string; provider: 'gemini'; ciphertext: string; iv: string; masterVersion: string } }
export function validateDocumentSegments(value: unknown, maxCharacters: number = DOCUMENT_LIMITS.maxPreparedCharacters): DocumentSegment[] {
  if (!Array.isArray(value) || !value.length || value.length > 20_000) throw new AiError('invalid', 'Selecciona segmentos de texto para preparar.');
  let characters = 0;
  const segments = value.map((raw): DocumentSegment => {
    if (!aiRecord(raw) || typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 120 || typeof raw.text !== 'string' || !aiRecord(raw.locator)) throw new AiError('invalid', 'Segmento de documento inválido.');
    const locator = raw.locator;
    if (!['page', 'paragraph', 'lines'].includes(String(locator.kind)) || !Number.isSafeInteger(locator.start) || !Number.isSafeInteger(locator.end)
      || Number(locator.start) < 1 || Number(locator.end) < Number(locator.start) || Number(locator.end) > (locator.kind === 'page' ? 200 : 1_000_000)) throw new AiError('invalid', 'Conserva los localizadores de páginas, párrafos o líneas.');
    const text = sanitizeAiText(raw.text); characters += text.length;
    return { id: raw.id, text, locator: { kind: locator.kind as DocumentLocator['kind'], start: Number(locator.start), end: Number(locator.end) } };
  });
  if (!segments.some((s) => s.text.trim()) || characters > maxCharacters) throw new AiError('quota', `Selecciona hasta ${maxCharacters.toLocaleString('es')} caracteres. No se ha recortado el texto.`);
  if (new Set(segments.map((s) => s.id)).size !== segments.length) throw new AiError('invalid', 'No repitas segmentos.');
  return segments;
}
export function validateDocumentOcrInput(raw: unknown): DocumentOcrInput {
  if (!aiRecord(raw) || typeof raw.fileId !== 'string' || !raw.fileId || raw.fileId.length > 300 || typeof raw.fileHash !== 'string'
    || !/^[a-f\d]{64}$/iu.test(raw.fileHash) || !Number.isSafeInteger(raw.targetVersion) || Number(raw.targetVersion) < 1
    || !Array.isArray(raw.pages) || !raw.pages.length || raw.pages.length > DOCUMENT_LIMITS.maxOcrPages
    || raw.pages.some((p) => !Number.isSafeInteger(p) || Number(p) < 1 || Number(p) > DOCUMENT_LIMITS.maxPdfPages)
    || new Set(raw.pages).size !== raw.pages.length) throw new AiError('invalid', 'Elige de una a cinco páginas sin repetirlas para OCR.');
  return { fileId: raw.fileId, fileHash: raw.fileHash.toLowerCase(), targetVersion: Number(raw.targetVersion), pages: [...raw.pages as number[]].sort((a, b) => a - b) };
}
export function validateDocumentOcrResult(raw: unknown, pages: number[]) {
  if (!aiRecord(raw) || !Array.isArray(raw.segments) || raw.segments.length !== pages.length || !Array.isArray(raw.omissions)
    || raw.omissions.length > 100 || raw.omissions.some((o) => typeof o !== 'string' || o.length > 500)) throw new AiError('invalid', 'El OCR debe conservar todas las páginas seleccionadas y sus omisiones.');
  const segments = validateDocumentSegments(raw.segments);
  if (segments.some((s, i) => s.locator.kind !== 'page' || s.locator.start !== pages[i] || s.locator.end !== pages[i])) throw new AiError('invalid', 'El OCR cambió los localizadores originales.');
  return { segments, omissions: raw.omissions.map((o) => sanitizeAiText(String(o))) };
}
export const DOCUMENT_OCR_SCHEMA = { type: 'object', required: ['segments', 'omissions'], properties: {
  segments: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'object', required: ['id', 'text', 'locator'], properties: {
    id: { type: 'string' }, text: { type: 'string' }, locator: { type: 'object', required: ['kind', 'start', 'end'], properties: { kind: { type: 'string', enum: ['page'] }, start: { type: 'integer' }, end: { type: 'integer' } } } } } },
  omissions: { type: 'array', items: { type: 'string' } } } };
export function documentUuid(raw: unknown) { if (!aiUuid(raw)) throw new AiError('invalid', 'Identificador de preparación inválido.'); return raw.toLowerCase(); }
