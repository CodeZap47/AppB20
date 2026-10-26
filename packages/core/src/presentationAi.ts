import { aiHash, aiRecord, sanitizeAiText } from './ai';
import { normalizePresentationBody, normalizePresentationConfiguration, normalizePresentationQuestion, type PresentationConfiguration } from './presentations';

export type PresentationAiPurpose = 'outline' | 'questions' | 'feedback' | 'transcription';
export type PresentationAiState = 'prepared' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'accepted' | 'cancelled';
export interface PresentationAiMaterial { kind: 'note' | 'guide'; id: string; version: number; text: string; hash: string }
export interface PresentationAiContext extends PresentationConfiguration {
  practiceId: string; attemptId: string; attemptVersion: number; body: string;
  material?: PresentationAiMaterial; transcript?: PresentationAiTranscript;
  audio?: { id: string; sha256: string; durationSeconds: number; mime: string; bytes: number };
}
export interface PresentationAiTranscript { segments: { startSeconds: number; endSeconds: number; text: string }[] }
export interface PresentationAiFeedback {
  clarity: string; examples: string; decisions: string; limitations: string; duration: string;
  oral: { atSeconds: number; comment: string }[];
}
export type PresentationAiResult = { outline: string; orientative: boolean } | { questions: string[] } | PresentationAiFeedback | PresentationAiTranscript;
export interface PresentationAiDraft {
  id: string; actor: string; purpose: PresentationAiPurpose; state: PresentationAiState; revision: number;
  context: PresentationAiContext; fingerprint: string; model: string; estimatedTokens: number;
  createdAt: number; expiresAt: number; generationId?: string; keyId?: string; acknowledgeUnknown?: boolean;
  startedAt?: number; result?: PresentationAiResult; error?: string; acceptedAt?: number; acceptanceHash?: string;
  usage?: { inputTokens: number; outputTokens: number };
}
export type PresentationAiDraftSummary = Pick<PresentationAiDraft, 'id' | 'purpose' | 'state' | 'revision' | 'createdAt'>;
function fail(message: string): never { throw new Error(message); }
function clean(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label} inválido o demasiado largo.`);
  const text = sanitizeAiText(value).trim(); if (!text) fail(`${label} no contiene texto.`); return text;
}
export function validatePresentationAiPurpose(value: unknown): PresentationAiPurpose {
  if (!['outline', 'questions', 'feedback', 'transcription'].includes(String(value))) fail('Tipo de ayuda inválido.');
  return value as PresentationAiPurpose;
}
export function presentationAiFingerprint(context: PresentationAiContext, purpose: PresentationAiPurpose): string { return aiHash({ purpose, context }); }
export function estimatePresentationAiTokens(context: PresentationAiContext): number {
  // Gemini audio input is estimated at 32 tokens/s; reserve conservatively alongside text and output.
  return Math.ceil(JSON.stringify(context).length / 3) + Math.ceil((context.audio?.durationSeconds ?? 0) * 32) + 8000;
}
export function validatePresentationAiResult(value: unknown, purpose: PresentationAiPurpose, context: PresentationAiContext): PresentationAiResult {
  if (!aiRecord(value)) fail('La respuesta de Gemini no es válida.');
  normalizePresentationConfiguration(context);
  if (purpose === 'outline') return { outline: normalizePresentationBody(clean(value.outline, 'El esquema', 30_000), true), orientative: !context.material };
  if (purpose === 'questions') {
    if (!Array.isArray(value.questions) || !value.questions.length || value.questions.length > 12) fail('Se requieren entre 1 y 12 preguntas.');
    const questions = value.questions.map((question) => normalizePresentationQuestion(clean(question, 'La pregunta', 1000)));
    if (new Set(questions).size !== questions.length) fail('Las preguntas deben ser distintas.');
    return { questions };
  }
  if (purpose === 'transcription') {
    if (!context.audio || !Array.isArray(value.segments) || !value.segments.length || value.segments.length > 2000) fail('La transcripción debe conservar marcas de tiempo.');
    let last = 0; let characters = 0;
    const segments = value.segments.map((segment) => {
      if (!aiRecord(segment) || typeof segment.startSeconds !== 'number' || typeof segment.endSeconds !== 'number'
        || !Number.isFinite(segment.startSeconds) || !Number.isFinite(segment.endSeconds) || segment.startSeconds < last
        || segment.endSeconds < segment.startSeconds || segment.endSeconds > context.audio!.durationSeconds + 1) fail('Marcas de tiempo inválidas.');
      last = segment.endSeconds; const text = clean(segment.text, 'El segmento', 6000); characters += text.length;
      return { startSeconds: segment.startSeconds, endSeconds: segment.endSeconds, text };
    });
    if (characters > 30_000) fail('La transcripción supera 30 000 caracteres; no se recortará.');
    return { segments };
  }
  const fields = Object.fromEntries(['clarity', 'examples', 'decisions', 'limitations', 'duration'].map((key) => [key, clean(value[key], 'El comentario', 3000)]));
  if (!Array.isArray(value.oral) || value.oral.length > 30) fail('Las observaciones orales no son válidas.');
  const oral = value.oral.map((item) => {
    if (!context.audio || !aiRecord(item) || typeof item.atSeconds !== 'number' || !Number.isFinite(item.atSeconds) || item.atSeconds < 0
      || item.atSeconds > context.audio.durationSeconds) fail('La observación oral debe citar un momento del audio.');
    return { atSeconds: item.atSeconds, comment: clean(item.comment, 'El comentario oral', 1000) };
  });
  return { ...fields, oral } as unknown as PresentationAiFeedback;
}
export const PRESENTATION_AI_SCHEMA = {
  outline: { type: 'object', properties: { outline: { type: 'string' } }, required: ['outline'], additionalProperties: false },
  questions: { type: 'object', properties: { questions: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string' } } }, required: ['questions'], additionalProperties: false },
  feedback: { type: 'object', properties: Object.fromEntries([...['clarity', 'examples', 'decisions', 'limitations', 'duration'].map((key) => [key, { type: 'string' }]),
    ['oral', { type: 'array', maxItems: 30, items: { type: 'object', properties: { atSeconds: { type: 'number' }, comment: { type: 'string' } }, required: ['atSeconds', 'comment'] } }]]), required: ['clarity', 'examples', 'decisions', 'limitations', 'duration', 'oral'], additionalProperties: false },
  transcription: { type: 'object', properties: { segments: { type: 'array', items: { type: 'object', properties: { startSeconds: { type: 'number' }, endSeconds: { type: 'number' }, text: { type: 'string' } }, required: ['startSeconds', 'endSeconds', 'text'] } } }, required: ['segments'], additionalProperties: false },
} as const;
