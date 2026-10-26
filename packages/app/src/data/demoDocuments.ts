import { aiHash, DOCUMENT_LIMITS, documentUuid, validateDocumentOcrInput, validateDocumentSegments,
  type DocumentFileMetadata, type DocumentOcrDraft, type DocumentTranscription } from '@b20/core';
import { sha256 } from '@noble/hashes/sha2.js';
import { aiSourceCandidates } from '../lib/aiSources';
import type { DocumentActions } from './documentTypes';
import type { Snapshot } from './types';

interface Context { snapshot(): Snapshot; download(fileId: string): Promise<Blob>; now(): Date }
interface SharedDocuments { transcripts: Map<string, Map<string, DocumentTranscription>>; drafts: Map<string, Map<string, DocumentOcrDraft>> }
const sharedDocuments = new WeakMap<object, SharedDocuments>();
/** Account-scoped simulation. It never contacts a model or stores a real key. */
export class DemoDocumentStore implements DocumentActions {
  private transcripts = new Map<string, Map<string, DocumentTranscription>>();
  private drafts = new Map<string, Map<string, DocumentOcrDraft>>();
  constructor(private ctx: Context, sharedKey?: object) {
    if (sharedKey) { let state = sharedDocuments.get(sharedKey); if (!state) { state = { transcripts: this.transcripts, drafts: this.drafts }; sharedDocuments.set(sharedKey, state); } this.transcripts = state.transcripts; this.drafts = state.drafts; }
  }
  private actor() { const member = this.ctx.snapshot().me; if (member?.status !== 'active') throw new Error('Necesitas acceso vigente al grupo.'); return member.id; }
  private owned<T>(map: Map<string, Map<string, T>>) { const actor = this.actor(); if (!map.has(actor)) map.set(actor, new Map()); return map.get(actor)!; }
  async getDocumentFile(fileId: string): Promise<DocumentFileMetadata> {
    this.actor(); const data = this.ctx.snapshot(); const file = data.resourceFiles.find((f) => f.id === fileId && !f.removedAt);
    if (!file || file.size > DOCUMENT_LIMITS.maxBytes) throw new Error('El documento no está disponible o supera 10 MiB.');
    const source = data.subjects.flatMap((s) => aiSourceCandidates(data, s.id)).find((s) => s.kind === file.targetKind && s.refId === file.targetId);
    if (!source) throw new Error('El original no está disponible para esta cuenta.');
    const bytes = new Uint8Array(await (await this.ctx.download(fileId)).arrayBuffer());
    return { fileId, fileHash: Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, '0')).join(''), targetKind: source.kind,
      targetId: source.refId, targetVersion: source.version, name: file.name, size: bytes.length, contentType: file.contentType };
  }
  async saveDocumentTranscription(input: Parameters<DocumentActions['saveDocumentTranscription']>[0]) {
    documentUuid(input.id); const info = await this.getDocumentFile(input.fileId);
    if (!input.reviewed || input.fileHash !== info.fileHash || input.targetVersion !== info.targetVersion || input.targetKind !== info.targetKind || input.targetId !== info.targetId) throw new Error('El original cambió o falta revisar el texto.');
    const map = this.owned(this.transcripts); const previous = map.get(input.id);
    const value: DocumentTranscription = { ...structuredClone(input), segments: validateDocumentSegments(input.segments), fileEtag: info.fileHash,
      createdAt: previous?.createdAt ?? this.ctx.now().getTime(), label: 'Texto preparado y revisado · simulación' };
    if (previous && aiHash(previous) !== aiHash(value)) throw new Error('El identificador ya contiene otra preparación.');
    map.set(value.id, value); return structuredClone(value);
  }
  async getDocumentTranscription(id: string) { const value = this.owned(this.transcripts).get(id); if (!value) throw new Error('El texto preparado es privado.');
    const file = await this.getDocumentFile(value.fileId); if (file.fileHash !== value.fileHash || file.targetVersion !== value.targetVersion) throw new Error('El original cambió.'); return structuredClone(value); }
  /** Only for a persisted shared exam/bank record already authorized by DemoExamStore. */
  async resolveReviewedTranscription(id: string) {
    this.actor(); const value = [...this.transcripts.values()].map((map) => map.get(id)).find((row) => row !== undefined);
    if (!value) throw new Error('El documento preparado ya no está disponible.');
    const file = await this.getDocumentFile(value.fileId);
    // Persisted exam citations keep their reviewed version; another attachment can change the parent version.
    if (file.fileHash !== value.fileHash || file.targetKind !== value.targetKind || file.targetId !== value.targetId) throw new Error('El original cambió.');
    return structuredClone(value);
  }
  async listDocumentTranscriptions(fileId?: string) { return [...this.owned(this.transcripts).values()].filter((t) => !fileId || t.fileId === fileId).map((t) => ({ id: t.id, fileId: t.fileId, createdAt: t.createdAt, targetKind: t.targetKind, targetId: t.targetId, characters: t.segments.reduce((n, s) => n + s.text.length, 0) })); }
  async prepareDocumentOcr(input: Parameters<DocumentActions['prepareDocumentOcr']>[0]) {
    const id = documentUuid(input.id), checked = validateDocumentOcrInput(input.input), file = await this.getDocumentFile(checked.fileId);
    if (file.fileHash !== checked.fileHash || file.targetVersion !== checked.targetVersion) throw new Error('El original cambió.');
    const fingerprint = aiHash(checked), map = this.owned(this.drafts), prior = map.get(id);
    if (prior) { if (prior.fingerprint !== fingerprint) throw new Error('La preparación pertenece a otras páginas.'); return structuredClone(prior); }
    const draft: DocumentOcrDraft = { id, file, fingerprint, model: 'simulado', revision: 1, state: 'prepared', pages: checked.pages, estimatedInputTokens: checked.pages.length * 1600 + 1024,
      estimatedOutputTokens: 8000, createdAt: this.ctx.now().getTime(), expiresAt: this.ctx.now().getTime() + 30 * 60_000 };
    map.set(id, draft); return structuredClone(draft);
  }
  async getDocumentOcr(id: string) { const value = this.owned(this.drafts).get(id); if (!value) throw new Error('La preparación OCR es privada.'); const info = await this.getDocumentFile(value.file.fileId); if (info.fileHash !== value.file.fileHash || info.targetVersion !== value.file.targetVersion) throw new Error('El original cambió.'); return structuredClone(value); }
  async runDocumentOcr(id: string, input: Parameters<DocumentActions['runDocumentOcr']>[1]) {
    const draft = await this.getDocumentOcr(id); documentUuid(input.generationId);
    if (draft.generationId === input.generationId) return draft;
    if (draft.generationId || draft.state !== 'prepared' || draft.revision !== input.expectedRevision || draft.fingerprint !== input.fingerprint || !input.confirmed || draft.expiresAt <= this.ctx.now().getTime()) throw new Error('Revisa y confirma una preparación vigente.');
    draft.state = 'ready'; draft.revision++; draft.generationId = input.generationId;
    draft.result = { segments: draft.pages.map((page) => ({ id: `page-${page}`, text: `Texto ficticio del OCR de demostración para la página ${page}. Revísalo antes de utilizarlo.`, locator: { kind: 'page', start: page, end: page } })), omissions: ['OCR simulado: esta transcripción es ficticia y permite probar el recorrido sin enviar el original a Gemini.'] };
    this.owned(this.drafts).set(id, draft); return structuredClone(draft);
  }
  async cancelDocumentOcr(id: string, expectedRevision: number) { const draft = await this.getDocumentOcr(id); if (draft.revision !== expectedRevision) throw new Error('La preparación cambió.'); draft.state = 'cancelled'; draft.result = undefined; draft.revision++; this.owned(this.drafts).set(id, draft); return structuredClone(draft); }
}
