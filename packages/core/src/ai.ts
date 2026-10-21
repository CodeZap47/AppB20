import { sha256 } from '@noble/hashes/sha2.js';

export const AI_CONSENT_VERSION = '2026-10-21.2';
export const AI_SOURCE_KINDS = ['note', 'assignment', 'activity', 'work', 'evidence', 'guide', 'teaching'] as const;
export type AiSourceKind = typeof AI_SOURCE_KINDS[number];
export const AI_LIMITS = Object.freeze({ maxSources: 10, maxCharacters: 40_000, maxQuestions: 20,
  maxOutputTokens: 8_000, maxConcurrent: 1, requestsPerHour: 5, requestsPerDay: 10,
  dailyEstimatedTokens: 100_000, preparationTtlMs: 30 * 60_000, timeoutMs: 60_000,
  maxBodyBytes: 128 * 1024 });
export type AiLimits = typeof AI_LIMITS;
export type AiErrorCode = 'invalid' | 'unauthorized' | 'unavailable' | 'conflict' | 'expired' |
  'quota' | 'consent' | 'disabled' | 'provider' | 'unknown';
export class AiError extends Error {
  constructor(public readonly code: AiErrorCode, message: string) { super(message); this.name = 'AiError'; }
}
export interface AiSourceRef { kind: AiSourceKind; refId: string; topics: string[]; includeUnplaced: boolean }
export interface AiPrepareInput { subjectId: string; termId?: string; topics: string[]; sources: AiSourceRef[]; config?: AiGenerationConfig }
export interface AiSourceOrigin { kind: AiSourceKind; refId: string; version: number }
export interface AiSourceSnapshot extends AiSourceOrigin {
  subjectId: string; termId?: string; title: string; topic?: string; visibility: 'group' | 'personal';
  fields: { name: string; text: string }[]; context?: string; origins?: AiSourceOrigin[]; omissions?: string[];
}
export interface AiFragmentOrigin extends AiSourceOrigin { field: string; startLine: number; endLine: number }
export interface AiFragment { id: string; text: string; origins: AiFragmentOrigin[] }
export type AiSourceStatus = 'prepared' | 'pending' | 'failed' | 'outdated' | 'unauthorized';
export interface AiPreparedSource extends AiSourceOrigin {
  title: string; subjectId: string; termId?: string; visibility: 'group' | 'personal';
  fingerprint: string; topics: string[]; status: AiSourceStatus; reason?: string; fragmentIds: string[];
  origins: AiSourceOrigin[];
}
export interface AiPreparation {
  id: string; subjectId: string; termId?: string; topics: string[]; sources: AiPreparedSource[];
  fragments: AiFragment[]; coverage: { topic: string; sourceIds: string[] }[]; omissions: string[];
  fingerprint: string; model: string; config: AiGenerationConfig; estimatedInputTokens: number; estimatedOutputTokens: number;
  createdAt: number; expiresAt: number; canGenerate: boolean;
}
export interface AiKeyStatus { configured: boolean; provider?: string; keyId?: string; updatedAt?: number; keyVersion?: number }
export interface AiStatus {
  actor: string; enabled: boolean; configured: boolean; reason?: string; model: string;
  limits: AiLimits; consentVersion: string; consented: boolean; serviceConfigured?: boolean;
}
export type AiGenerationState = 'prepared' | 'running' | 'succeeded' | 'failed' | 'unknown';
export interface AiGenerationConfig { purpose?: 'guide' | 'explanation' | 'questions' | 'teaching_questions' | 'spaced_cards'; questionCount: number; types: ('single' | 'boolean')[]; difficulty: 'basic' | 'intermediate' | 'advanced' }
export const AI_DEFAULT_GENERATION_CONFIG: AiGenerationConfig = { questionCount: 10, types: ['single', 'boolean'], difficulty: 'intermediate' };
export interface AiGenerationRequest { id: string; preparationId: string; fingerprint: string; config: AiGenerationConfig; confirmed: boolean; acknowledgeUnknown?: boolean }
export interface AiGeneration {
  id: string; state: AiGenerationState; preparationId: string; createdAt: number; updatedAt?: number;
  result?: unknown; preparation?: AiPreparation; acceptance?: { targetKind: string; targetId: string; acceptedIds: string[] }; error?: string; estimatedTokens?: number; usage?: { inputTokens: number; outputTokens: number };
}
export const aiSourceKey = (source: Pick<AiSourceOrigin, 'kind' | 'refId'>) => `${source.kind}:${source.refId}`;
export function aiCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(aiCanonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${JSON.stringify(k)}:${aiCanonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function aiHash(value: unknown): string {
  return Array.from(sha256(new TextEncoder().encode(aiCanonical(value))), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export const aiSourceFingerprint = (source: AiSourceSnapshot) => aiHash(source);
export function aiDecimalId(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9]\d{0,19})$/.test(value) && BigInt(value) <= 0xffffffffffffffffn;
}
export function aiUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function aiRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export function validateAiPrepareInput(value: unknown): AiPrepareInput {
  if (!aiRecord(value) || !aiDecimalId(value.subjectId) ||
    (value.termId !== undefined && !aiDecimalId(value.termId)) || !Array.isArray(value.topics) ||
    !value.topics.length || value.topics.length > 40 || !Array.isArray(value.sources) ||
    !value.sources.length || value.sources.length > AI_LIMITS.maxSources) throw new AiError('invalid', 'Elige materia, temas y entre 1 y 10 fuentes.');
  const topics = value.topics.map((topic) => {
    if (typeof topic !== 'string' || !topic.trim() || topic.trim().length > 120) throw new AiError('invalid', 'Cada tema debe tener entre 1 y 120 caracteres.');
    return topic.trim();
  });
  if (new Set(topics.map((t) => t.toLocaleLowerCase('es'))).size !== topics.length) throw new AiError('invalid', 'No repitas temas.');
  const sources: AiSourceRef[] = value.sources.map((source) => {
    if (!aiRecord(source) || !AI_SOURCE_KINDS.includes(source.kind as AiSourceKind) || !aiDecimalId(source.refId) ||
      !Array.isArray(source.topics) || source.topics.some((t) => typeof t !== 'string' || !topics.includes(t)) ||
      typeof source.includeUnplaced !== 'boolean') throw new AiError('invalid', 'La selección de fuentes no es válida.');
    return { kind: source.kind as AiSourceKind, refId: source.refId, topics: [...new Set(source.topics as string[])], includeUnplaced: source.includeUnplaced };
  });
  if (new Set(sources.map(aiSourceKey)).size !== sources.length) throw new AiError('invalid', 'No repitas fuentes.');
  const config = validateAiGenerationConfig(value.config ?? AI_DEFAULT_GENERATION_CONFIG);
  if (config.purpose === 'teaching_questions' && (sources.filter((source) => source.kind === 'teaching').length !== 1 || sources.some((source) => !['teaching', 'note', 'guide'].includes(source.kind)))) throw new AiError('invalid', 'Elige una explicación guardada y, opcionalmente, notas o guías de contexto.');
  if (config.purpose === 'spaced_cards' && sources.some((source) => !['note', 'guide'].includes(source.kind))) throw new AiError('invalid', 'Las tarjetas solo se generan desde notas y guías.');
  if (config.purpose !== 'teaching_questions' && sources.some((source) => source.kind === 'teaching')) throw new AiError('invalid', 'La explicación privada solo se usa para preguntas de tu práctica.');
  return { subjectId: value.subjectId, ...(value.termId ? { termId: value.termId } : {}), topics, sources,
    config };
}
/** Redacción conservadora; la vista previa permite revisar lo que los patrones no detectan. */
export function sanitizeAiText(text: string): string {
  return text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[correo retirado]')
    .replace(/-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/g, '[clave retirada]')
    .replace(/\bAIza[\w-]{20,}\b/g, '[clave retirada]')
    .replace(/\b(?:sk-[\w-]{16,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[credencial retirada]')
    .replace(/\b(api[_ -]?key|password|contraseña|secret|access[_ -]?token)\s*[:=]\s*["']?[^\s"',;]+/gi, '$1=[credencial retirada]');
}
export function buildAiPreparation(rawInput: unknown, snapshots: AiSourceSnapshot[], options: { id: string; model: string; now: number }): AiPreparation {
  const input = validateAiPrepareInput(rawInput);
  if (!aiUuid(options.id) || !options.model.trim() || options.model.length > 200 || !Number.isFinite(options.now)) throw new AiError('invalid', 'La preparación no está configurada.');
  const fragments: AiFragment[] = [];
  const byText = new Map<string, AiFragment>();
  const omissions: string[] = [];
  let characters = 0;
  const sources: AiPreparedSource[] = input.sources.map((ref) => {
    const source = snapshots.find((candidate) => aiSourceKey(candidate) === aiSourceKey(ref));
    if (!source) throw new AiError('unauthorized', 'Una fuente no está disponible.');
    if (source.subjectId !== input.subjectId || (input.termId && source.termId && source.termId !== input.termId)) throw new AiError('conflict', 'La materia o el parcial de una fuente cambió.');
    const prepared: AiPreparedSource = { kind: source.kind, refId: source.refId, version: source.version,
      subjectId: source.subjectId, ...(source.termId ? { termId: source.termId } : {}), title: sanitizeAiText(source.title),
      visibility: source.visibility, fingerprint: aiSourceFingerprint(source), topics: ref.topics,
      status: 'prepared', fragmentIds: [], origins: source.origins ?? [] };
    if (!source.termId && !ref.includeUnplaced) {
      prepared.status = 'pending'; prepared.reason = 'Incluye expresamente el material sin parcial.'; return prepared;
    }
    for (const omission of source.omissions ?? []) omissions.push(`${aiSourceKey(source)}: ${omission}`);
    for (const field of source.fields) {
      const sanitized = sanitizeAiText(field.text.replace(/\r\n?/g, '\n'));
      if (!sanitized.trim()) continue;
      const lines = sanitized.split('\n');
      let start = 0;
      while (start < lines.length) {
        let end = start + 1;
        let text = lines[start]!;
        while (end < lines.length && text.length + lines[end]!.length + 1 <= 4000) text += `\n${lines[end++]!}`;
        const origin: AiFragmentOrigin = { kind: ref.kind, refId: ref.refId, version: source.version,
          field: field.name, startLine: start + 1, endLine: end };
        const key = aiHash(text);
        let fragment = byText.get(key);
        if (!fragment) {
          characters += text.length;
          if (characters > AI_LIMITS.maxCharacters) throw new AiError('quota', 'Las fuentes superan 40 000 caracteres. Reduce el alcance; no se ha truncado contenido.');
          fragment = { id: `fragment-${key.slice(0, 24)}`, text, origins: [] };
          fragments.push(fragment); byText.set(key, fragment);
        }
        fragment.origins.push(origin); prepared.fragmentIds.push(fragment.id); start = end;
      }
    }
    prepared.fragmentIds = [...new Set(prepared.fragmentIds)];
    if (!prepared.fragmentIds.length) { prepared.status = 'failed'; prepared.reason = 'La fuente no contiene texto procesable.'; }
    return prepared;
  });
  const coverage = input.topics.map((topic) => ({ topic, sourceIds: sources.filter((source) =>
    source.status === 'prepared' && source.topics.includes(topic)).map(aiSourceKey) }));
  const model = options.model.trim();
  const fingerprint = aiHash({ input, sources, fragments, model });
  return { id: options.id, subjectId: input.subjectId, ...(input.termId ? { termId: input.termId } : {}),
    topics: input.topics, sources, fragments, coverage, omissions, fingerprint, model, config: input.config!,
    estimatedInputTokens: Math.ceil(new TextEncoder().encode(fragments.map((f) => f.text).join('\n')).length / 3) + 1024,
    estimatedOutputTokens: AI_LIMITS.maxOutputTokens, createdAt: options.now, expiresAt: options.now + AI_LIMITS.preparationTtlMs,
    canGenerate: sources.every((s) => s.status === 'prepared') && coverage.every((c) => c.sourceIds.length > 0) };
}
export function validateAiGenerationConfig(value: unknown): AiGenerationConfig {
  if (!aiRecord(value) || !Number.isInteger(value.questionCount) || Number(value.questionCount) < 1 || Number(value.questionCount) > AI_LIMITS.maxQuestions ||
    !Array.isArray(value.types) || !value.types.length || value.types.length > 2 || value.types.some((t) => t !== 'single' && t !== 'boolean') ||
    !['basic', 'intermediate', 'advanced'].includes(String(value.difficulty))) throw new AiError('invalid', 'La configuración de preguntas no es válida.');
  if (value.purpose !== undefined && !['guide', 'explanation', 'questions', 'teaching_questions', 'spaced_cards'].includes(String(value.purpose))) throw new AiError('invalid', 'El tipo de borrador no es válido.');
  return { ...(value.purpose ? { purpose: value.purpose as AiGenerationConfig['purpose'] } : {}), questionCount: Number(value.questionCount), types: [...new Set(value.types as ('single' | 'boolean')[])], difficulty: value.difficulty as AiGenerationConfig['difficulty'] };
}
