import { guideMaterialSelectionSummary, validateGuideMaterialSelectionInput, type GuideMaterialSelection, type GuideMaterialTranscriptionRef, type GuideAiTranscription } from '@b20/core';
import { guideAiCandidateKey, guideAiCandidates } from '../lib/guideAiSources';
import type { Snapshot } from './types';
import type { GuideMaterialsActions } from './guideMaterialsTypes';
interface Context {
  snapshot(): Snapshot; now(): Date;
  listExams: GuideMaterialsActions['listGuideExamMaterials']; exam: GuideMaterialsActions['getGuideExamMaterial'];
  getTranscription(id: string): GuideAiTranscription | undefined;
}
interface Saved { actor: string; value: GuideMaterialSelection }
const sharedSelections = new WeakMap<object, Map<string, Saved>>();
export class DemoGuideMaterialsStore implements GuideMaterialsActions {
  private selections: Map<string, Saved>;
  constructor(private ctx: Context, sharedKey: object) { let rows = sharedSelections.get(sharedKey); if (!rows) { rows = new Map(); sharedSelections.set(sharedKey, rows); } this.selections = rows; }
  private actor() { const me = this.ctx.snapshot().me; if (me?.status !== 'active') throw new Error('Necesitas acceso vigente al grupo.'); return me.id; }
  listGuideExamMaterials(subjectId: string) { this.actor(); return this.ctx.listExams(subjectId); }
  getGuideExamMaterial(examId: string, version: number, includeSolutions = false) { this.actor(); return this.ctx.exam(examId, version, includeSolutions); }
  private owned(id: string) { const actor = this.actor(); const row = this.selections.get(id); if (row && row.actor !== actor) throw new Error('El borrador no está disponible.'); return row; }
  private async available(ref: GuideMaterialSelection['sources'][number], subjectId: string) {
    const data = this.ctx.snapshot();
    if (ref.kind === 'exam') { const exam = await this.ctx.exam(ref.refId, ref.examVersion!, ref.includeSolutions); if (exam.subjectId !== subjectId) throw new Error('El examen pertenece a otra materia.'); return; }
    if (!guideAiCandidates(data, subjectId).some((candidate) => guideAiCandidateKey(candidate) === guideAiCandidateKey(ref))) throw new Error('Un material dejó de estar disponible.');
  }
  private async projection(value: GuideMaterialSelection) {
    const unavailableSourceKeys: string[] = [], transcriptions: GuideMaterialTranscriptionRef[] = [];
    for (const ref of value.sources) {
      try { await this.available(ref, value.subjectId); } catch { unavailableSourceKeys.push(guideAiCandidateKey(ref)); continue; }
      for (const id of ref.transcriptionIds ?? []) { const row = this.ctx.getTranscription(id); if (!row) continue;
        const file = this.ctx.snapshot().resourceFiles.find((file) => file.id === row.fileId && !file.removedAt);
        const candidate = guideAiCandidates(this.ctx.snapshot(), value.subjectId).find((entry) => entry.kind === row.targetKind && entry.refId === row.targetId);
        if (file && candidate?.version === row.targetVersion) transcriptions.push({ id: row.id, fileId: row.fileId, targetKind: row.targetKind, targetId: row.targetId, targetVersion: row.targetVersion }); }
    }
    return structuredClone({ ...value, transcriptions, unavailableSourceKeys });
  }
  async getGuideMaterialSelection(id: string) { const actor = this.actor(), row = this.owned(id); const value = row ? await this.projection(row.value) : null; if (this.actor() !== actor) throw new Error('La cuenta cambió.'); return value; }
  async listGuideMaterialSelections() { const actor = this.actor(); return [...this.selections.values()].filter((row) => row.actor === actor).map((row) => guideMaterialSelectionSummary(row.value)).sort((a, b) => b.updatedAt - a.updatedAt); }
  async saveGuideMaterialSelection(raw: Parameters<GuideMaterialsActions['saveGuideMaterialSelection']>[0]) {
    const actor = this.actor();
    if (new Set(raw.sources.map(guideAiCandidateKey)).size !== raw.sources.length) throw new Error('Un material solo puede agregarse una vez.');
    // Demo records use synthetic identifiers; validate their shape with numeric aliases, then restore the original references.
    const checked = validateGuideMaterialSelectionInput({ ...raw, subjectId: '1', ...(raw.termId ? { termId: '1' } : {}), sources: raw.sources.map((ref, index) => ({ ...ref, refId: ref.kind === 'exam' ? ref.refId : String(index + 1), ...(ref.evidenceIds ? { evidenceIds: ref.evidenceIds.map((_, evidenceIndex) => String(evidenceIndex + 1)) } : {}) })) });
    const input = { ...checked, subjectId: raw.subjectId, termId: raw.termId, sources: checked.sources.map((ref, index) => ({ ...ref, refId: raw.sources[index]!.refId, ...(raw.sources[index]!.evidenceIds ? { evidenceIds: raw.sources[index]!.evidenceIds } : {}) })) };
    const previous = this.owned(input.id);
    if ((previous?.value.revision ?? 0) !== input.expectedRevision) throw new Error('El borrador cambió. Recarga su selección antes de guardar.');
    const data = this.ctx.snapshot(); if (!data.subjects.some((subject) => subject.id === input.subjectId) || input.termId && !data.terms.some((term) => term.id === input.termId && term.subjectId === input.subjectId)) throw new Error('La materia y el parcial no coinciden.');
    const priorKeys = new Set(previous?.value.sources.map(guideAiCandidateKey) ?? []);
    for (const ref of input.sources) {
      let available = true; try { await this.available(ref, input.subjectId); } catch (error) { if (!priorKeys.has(guideAiCandidateKey(ref))) throw error; available = false; }
      if (!available) continue;
      for (const id of ref.transcriptionIds ?? []) {
        const prepared = this.ctx.getTranscription(id);
        if (!prepared || !(prepared.targetKind === ref.kind && prepared.targetId === ref.refId || ref.kind === 'activity' && prepared.targetKind === 'evidence' && ref.evidenceIds?.includes(prepared.targetId))) throw new Error('La transcripción no pertenece al material.');
      }
    }
    const keys = new Set(input.sources.flatMap((ref) => [guideAiCandidateKey(ref), ...(ref.kind === 'activity' ? (ref.evidenceIds ?? []).filter((id) => data.evidences.some((evidence) => evidence.id === id && evidence.activityId === ref.refId)).map((id) => `evidence:${id}`) : [])])); const oldFiles = new Set(previous?.value.chosenFileIds ?? []);
    for (const id of input.chosenFileIds) { const file = data.resourceFiles.find((entry) => entry.id === id && !entry.removedAt); if ((!file || !keys.has(`${file.targetKind}:${file.targetId}`)) && !oldFiles.has(id)) throw new Error('El archivo no pertenece a los materiales agregados.'); }
    const { expectedRevision: _expected, ...content } = input;
    const value: GuideMaterialSelection = { ...content, revision: input.expectedRevision + 1, updatedAt: this.ctx.now().getTime(), transcriptions: [], unavailableSourceKeys: [] };
    if (this.actor() !== actor) throw new Error('La cuenta cambió.');
    this.selections.set(input.id, { actor, value: structuredClone(value) }); const result = await this.projection(value); if (this.actor() !== actor) throw new Error('La cuenta cambió.'); return result;
  }
}
