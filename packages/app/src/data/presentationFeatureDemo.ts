import { estimatePresentationAiTokens, presentationAiFingerprint, validatePresentationAiResult, validatePresentationAudioDuration, validatePresentationAudioSize,
  PRESENTATION_AUDIO_LIMITS, type PresentationAiDraft, type PresentationAiPurpose, type PresentationAudio, type PresentationAiContext } from '@b20/core';
import { presentationByteHash, type PresentationFeatureActions } from './presentationFeatureClient';
import type { PresentationAttempt, PresentationPractice } from './presentationTypes';
interface DemoContext {
  actor(): string; now(): number;
  attempt(id: string, owner: boolean): { attempt: PresentationAttempt; practice: PresentationPractice };
  applyOutline(id: string, body: string, version: number): void;
  addQuestion(id: string, text: string, requestId: string): void;
}
/** Demo results are explicitly simulated. No key or audio is ever sent to a provider. */
export class DemoPresentationFeatures implements PresentationFeatureActions {
  private drafts = new Map<string, PresentationAiDraft>();
  private audio = new Map<string, { value: PresentationAudio; bytes?: Uint8Array; actor: string; reviewer?: string }>();
  constructor(private ctx: DemoContext) {}
  purgeSource(kind: string, id: string) {
    for (const draft of this.drafts.values()) {
      const context = draft.context as PresentationAiContext & Pick<PresentationAttempt, 'sourceKind' | 'sourceId'>;
      if ((context.material?.kind ?? context.sourceKind) !== kind || (context.material?.id ?? context.sourceId) !== id) continue;
      if (draft.state === 'accepted') {
        if (context.material?.text) { draft.context = { ...context, material: { ...context.material, text: '' } }; draft.revision++; }
      } else if (draft.state !== 'cancelled' || context.material || draft.result) {
        Object.assign(draft, { context: { ...context, material: undefined }, state: 'cancelled', result: undefined,
          error: 'La referencia fue eliminada definitivamente. Prepara otro envío con material accesible.', revision: draft.revision + 1 });
      }
    }
  }
  revoke(practiceId: string) { for (const item of this.audio.values()) { try { if (this.ctx.attempt(item.value.attemptId, true).practice.id === practiceId) item.reviewer = undefined; } catch { /* Other owners stay private. */ } } }
  ready(attemptId: string) { return [...this.audio.values()].some((row) => row.value.attemptId === attemptId && row.value.state === 'ready'); }
  private draft(id: string): PresentationAiDraft { const draft = this.drafts.get(id); if (!draft || draft.actor !== this.ctx.actor()) throw new Error('El borrador no está disponible.'); this.ctx.attempt(draft.context.attemptId, true); return draft; }
  async listDrafts(id: string) { this.ctx.attempt(id, true); return structuredClone([...this.drafts.values()].filter((row) => row.context.attemptId === id && row.actor === this.ctx.actor() && row.state !== 'cancelled').map(({ id, purpose, state, revision, createdAt }) => ({ id, purpose, state, revision, createdAt }))); }
  async prepare(input: { id: string; attemptId: string; expectedVersion: number; purpose: PresentationAiPurpose }) {
    const { attempt } = this.ctx.attempt(input.attemptId, true);
    if (this.drafts.has(input.id)) return structuredClone(this.draft(input.id));
    if (attempt.version !== input.expectedVersion || (input.purpose === 'outline' ? attempt.status !== 'draft' : attempt.status !== 'completed')) throw new Error('La versión o el estado cambió.');
    const audio = [...this.audio.values()].find((row) => row.value.attemptId === attempt.id && row.value.state === 'ready')?.value;
    if (input.purpose === 'transcription' && !audio) throw new Error('Este intento no tiene audio.');
    const transcript = [...this.drafts.values()].filter((row) => row.context.attemptId === attempt.id && row.state === 'accepted' && row.purpose === 'transcription').at(-1)?.result;
    if (input.purpose !== 'outline' && input.purpose !== 'transcription' && !attempt.body.trim() && !transcript) throw new Error('Acepta primero una transcripción.');
    const context: PresentationAiContext = { ...attempt, practiceId: attempt.practiceId, attemptId: attempt.id, attemptVersion: attempt.version,
      ...(transcript && 'segments' in transcript ? { transcript } : {}), ...(audio && (input.purpose === 'transcription' || input.purpose === 'feedback') ? { audio: { id: audio.id, sha256: audio.sha256, durationSeconds: audio.durationSeconds!, bytes: audio.bytes, mime: audio.mime } } : {}) };
    const draft: PresentationAiDraft = { id: input.id, actor: this.ctx.actor(), purpose: input.purpose, state: 'prepared', revision: 1,
      context, fingerprint: presentationAiFingerprint(context, input.purpose), model: 'demo-sin-envio', estimatedTokens: estimatePresentationAiTokens(context), createdAt: this.ctx.now(), expiresAt: this.ctx.now() + 30 * 60_000 };
    this.drafts.set(draft.id, draft); return structuredClone(draft);
  }
  async get(id: string) { return structuredClone(this.draft(id)); }
  async generate(value: PresentationAiDraft, generationId: string) {
    const draft = this.draft(value.id); if (draft.generationId) return structuredClone(draft);
    if (draft.state !== 'prepared' || draft.revision !== value.revision) throw new Error('El borrador cambió.');
    const result = draft.purpose === 'outline' ? { outline: `[Demostración sin Gemini]\nIntroducción: ${draft.context.topic}\n${draft.context.keyPoints.map((point) => `Desarrollar: ${point}`).join('\n')}\nCierre y preguntas.`, orientative: true }
      : draft.purpose === 'questions' ? { questions: ['[Demostración] ¿Qué ejemplo ayuda a explicar el punto principal?', '[Demostración] ¿Qué limitación conviene aclarar?'] }
      : draft.purpose === 'transcription' ? { segments: [{ startSeconds: 0, endSeconds: draft.context.audio!.durationSeconds, text: '[Demostración: transcripción simulada, no se analizó el audio.]' }] }
      : { clarity: '[Demostración] Revisa el orden.', examples: '[Demostración] Añade un ejemplo.', decisions: '[Demostración] Justifica el enfoque.', limitations: '[Demostración] Explica un límite.', duration: '[Demostración] Comprueba el tiempo objetivo.', oral: [] };
    Object.assign(draft, { state: 'succeeded', generationId, result, revision: draft.revision + 1 }); return structuredClone(draft);
  }
  async accept(value: PresentationAiDraft, raw: Parameters<PresentationFeatureActions['accept']>[1]) {
    const draft = this.draft(value.id); const result = validatePresentationAiResult(raw, draft.purpose, draft.context);
    if (draft.state === 'accepted') return structuredClone(draft);
    const { attempt } = this.ctx.attempt(draft.context.attemptId, true);
    if (draft.state !== 'succeeded' || draft.revision !== value.revision || attempt.version !== draft.context.attemptVersion) throw new Error('La versión cambió.');
    if (draft.context.audio && this.audio.get(draft.context.audio.id)?.value.state !== 'ready') throw new Error('El audio fue eliminado.');
    if ('outline' in result) this.ctx.applyOutline(attempt.id, result.outline, attempt.version);
    if ('questions' in result) for (let at = 0; at < result.questions.length; at++) this.ctx.addQuestion(attempt.id, result.questions[at]!, `gemini:${draft.id}:${at}`);
    Object.assign(draft, { state: 'accepted', result, acceptedAt: this.ctx.now(), revision: draft.revision + 1 }); return structuredClone(draft);
  }
  async cancel(value: PresentationAiDraft) { const draft = this.draft(value.id); if (draft.state === 'accepted') throw new Error('Ya fue aceptado.'); Object.assign(draft, { state: 'cancelled', result: undefined, revision: draft.revision + 1 }); return structuredClone(draft); }
  async listAudio(attemptId: string) {
    const { attempt, practice } = this.ctx.attempt(attemptId, false); const actor = this.ctx.actor();
    return structuredClone([...this.audio.values()].filter((row) => row.value.attemptId === attemptId && (row.actor === actor ||
      row.reviewer === actor && practice.reviewerId === actor && !practice.archived && attempt.status === 'completed' && row.value.state === 'ready')).map((row) => ({ ...row.value, shared: row.reviewer === practice.reviewerId && !!practice.reviewerId })));
  }
  async upload(attemptId: string, expectedVersion: number, file: File, requestId: string, onProgress?: (percent: number) => void) {
    const { attempt } = this.ctx.attempt(attemptId, true); if (attempt.status !== 'draft' || attempt.version !== expectedVersion) throw new Error('El intento ya quedó conservado.');
    validatePresentationAudioSize(file.size); const previous = this.audio.get(requestId); const bytes = new Uint8Array(await file.arrayBuffer()); const sha256 = await presentationByteHash(bytes);
    if (previous) { if (previous.actor !== this.ctx.actor() || previous.value.sha256 !== sha256) throw new Error('La subida ya pertenece a otro archivo.'); return structuredClone(previous.value); }
    if (this.ready(attemptId)) throw new Error('El intento ya tiene un audio.');
    const url = URL.createObjectURL(file); let duration: number;
    try { duration = await new Promise<number>((resolve, reject) => { const audio = new Audio(); const timer = setTimeout(() => { audio.src = ''; reject(new Error('No se pudo leer la duración.')); }, 10_000);
      audio.onloadedmetadata = () => { clearTimeout(timer); resolve(audio.duration); audio.src = ''; }; audio.onerror = () => { clearTimeout(timer); reject(new Error('El audio no es válido.')); }; audio.src = url; }); } finally { URL.revokeObjectURL(url); }
    validatePresentationAudioDuration(duration);
    const value: PresentationAudio = { id: requestId, attemptId, name: file.name, mime: file.type || 'audio/mpeg', bytes: bytes.length, sha256, durationSeconds: duration, state: 'ready', chunkCount: Math.ceil(bytes.length / PRESENTATION_AUDIO_LIMITS.chunkBytes), received: [], shared: false };
    this.audio.set(requestId, { value, bytes, actor: this.ctx.actor() }); onProgress?.(100); return structuredClone(value);
  }
  private media(value: PresentationAudio, owner: boolean) { const row = this.audio.get(value.id); const { practice, attempt } = this.ctx.attempt(value.attemptId, owner);
    if (!row || (row.actor !== this.ctx.actor() && (owner || row.reviewer !== this.ctx.actor() || practice.reviewerId !== this.ctx.actor() || practice.archived || attempt.status !== 'completed'))) throw new Error('El audio no está disponible.'); return row; }
  async audioBlob(value: PresentationAudio) { const row = this.media(value, false); if (!row.bytes || row.value.state !== 'ready') throw new Error('El audio fue eliminado.'); return new Blob([row.bytes as Uint8Array<ArrayBuffer>], { type: row.value.mime }); }
  async shareAudio(value: PresentationAudio, shared: boolean) { const row = this.media(value, true); const { practice, attempt } = this.ctx.attempt(value.attemptId, true); if (!practice.reviewerId || attempt.status !== 'completed') throw new Error('Invita a un revisor y concluye el intento.'); row.reviewer = shared ? practice.reviewerId : undefined; row.value.shared = shared; return structuredClone(row.value); }
  async deleteAudio(value: PresentationAudio) { const row = this.media(value, true); row.bytes = undefined; row.reviewer = undefined; row.value = { ...row.value, state: 'deleted', received: [], shared: false };
    for (const draft of this.drafts.values()) if (draft.context.audio?.id === value.id && draft.state !== 'accepted') Object.assign(draft, { state: 'cancelled', result: undefined }); return structuredClone(row.value); }
  async cancelAudio(value: PresentationAudio) { return this.deleteAudio(value); }
}
