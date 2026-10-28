import { SenderError } from 'spacetimedb/server';
import { aiDecimalId, aiRecord, aiUuid } from '../../core/src/ai';
import { guideMaterialSelectionSummary, validateGuideMaterialSelectionInput, type GuideExamMaterial, type GuideExamMaterialDetail,
  type GuideMaterialSelection, type GuideMaterialTranscriptionRef } from '../../core/src/guideMaterials';
import { activeMember, type Ctx } from './moduleContext';
import { memberIdentityFor } from './authIdentity';
import { getGuideTranscription, resolveGuideAiSource } from './guideAiHandlers';
const key = (ref: { kind: string; refId: string }) => `${ref.kind}:${ref.refId}`;
function fail(code: string, message: string): never { throw new SenderError(`${code}:${message}`); }
function uuid(value: unknown) { if (!aiUuid(value)) fail('invalid', 'Identificador de borrador o examen inválido.'); return value.toLowerCase(); }
function examDetail(ctx: Ctx, examId: string, version: number, includeSolutions = false): GuideExamMaterialDetail {
  const row = ctx.db.studyExam.id.find(uuid(examId));
  if (!row || row.archived || !(row.owner.isEqual(memberIdentityFor(ctx)) || row.visibility === 'group' && row.readyVersion === version)) fail('unavailable', 'El examen no está disponible para esta guía.');
  const source = resolveGuideAiSource(ctx, 'exam', examId, memberIdentityFor(ctx), { examVersion: version, includeSolutions });
  const stored = ctx.db.examVersion.key.find(`${examId}:${version}`); if (!stored) fail('unavailable', 'La versión no está disponible.');
  const data = JSON.parse(stored.json) as { preparation?: { topics?: string[] }; questions?: { topic: string }[] };
  return { id: examId, title: source.title, subjectId: source.subjectId, ...(source.termId ? { termId: source.termId } : {}), version,
    topics: [...new Set(data.preparation?.topics ?? data.questions?.map((question) => question.topic) ?? [])], ownerId: row.owner.toHexString(),
    visibility: source.visibility, canIncludeSolutions: 'canIncludeSolutions' in source && source.canIncludeSolutions === true,
    sourceIssues: 'sourceIssues' in source ? source.sourceIssues.map(({ state, message }) => ({ state, message })) : [], text: source.fields.map((field) => field.text).join('\n\n'), fields: source.fields.map(({ name, text }) => ({ name, text })), omissions: source.omissions ?? [] };
}
function listExams(ctx: Ctx, subjectId: unknown): GuideExamMaterial[] {
  if (!aiDecimalId(subjectId)) fail('invalid', 'Elige una materia.');
  const actor = memberIdentityFor(ctx); const out: GuideExamMaterial[] = [];
  for (const exam of ctx.db.studyExam.iter()) {
    if (exam.archived || String(exam.subjectId) !== subjectId || !(exam.owner.isEqual(actor) || exam.visibility === 'group' && exam.readyVersion !== undefined)) continue;
    const version = exam.owner.isEqual(actor) ? exam.draftVersion ?? exam.readyVersion : exam.readyVersion;
    if (!version) continue;
    try { const { text: _text, fields: _fields, omissions: _omissions, ...summary } = examDetail(ctx, exam.id, version); out.push(summary); }
    catch { const row = ctx.db.examVersion.key.find(`${exam.id}:${version}`); if (!row) continue;
      const value = JSON.parse(row.json) as { title?: string; preparation?: { topics?: string[] } };
      out.push({ id: exam.id, version, title: value.title ?? exam.title, subjectId, termId: exam.termId?.toString(), ownerId: exam.owner.toHexString(),
        visibility: exam.visibility === 'personal' || row.state !== 'ready' ? 'personal' : 'group', topics: value.preparation?.topics ?? [], canIncludeSolutions: false,
        sourceIssues: [{ state: 'unavailable', message: 'Una fuente de esta versión ya no está disponible.' }] }); }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, 'es'));
}
function selectionRow(ctx: Ctx, id: string) {
  const row = ctx.db.guideMaterialSelection.id.find(uuid(id));
  if (row && !row.actor.isEqual(memberIdentityFor(ctx))) fail('unavailable', 'El borrador no está disponible.');
  return row;
}
function projection(ctx: Ctx, value: GuideMaterialSelection): GuideMaterialSelection {
  const unavailableSourceKeys: string[] = [], transcriptions: GuideMaterialTranscriptionRef[] = [];
  for (const ref of value.sources) {
    try { resolveGuideAiSource(ctx, ref.kind, ref.refId, memberIdentityFor(ctx), ref); }
    catch { unavailableSourceKeys.push(key(ref)); continue; }
    for (const id of ref.transcriptionIds ?? []) try {
      const prepared = getGuideTranscription(ctx, id);
      transcriptions.push({ id: prepared.id, fileId: prepared.fileId, targetKind: prepared.targetKind, targetId: prepared.targetId, targetVersion: prepared.targetVersion });
    } catch { /* A stale file stays chosen and requires review rather than exposing its previous text. */ }
  }
  return { ...value, transcriptions: [...new Map(transcriptions.map((item) => [item.id, item])).values()], unavailableSourceKeys };
}
function saveSelection(ctx: Ctx, raw: unknown): GuideMaterialSelection {
  const input = validateGuideMaterialSelectionInput(raw); const prior = selectionRow(ctx, input.id);
  if ((prior?.revision ?? 0) !== input.expectedRevision) fail('conflict', 'El borrador cambió. Recarga su selección antes de guardar.');
  if (!ctx.db.subject.id.find(BigInt(input.subjectId)) || input.termId && ctx.db.term.id.find(BigInt(input.termId))?.subjectId !== BigInt(input.subjectId)) fail('invalid', 'La materia y el parcial no coinciden.');
  const previous = prior ? JSON.parse(prior.json) as GuideMaterialSelection : undefined;
  const oldKeys = new Set(previous?.sources.map(key) ?? []), oldFiles = new Set(previous?.chosenFileIds ?? []);
  const allowedKeys = new Set<string>();
  for (const ref of input.sources) {
    allowedKeys.add(key(ref));
    let resolved: ReturnType<typeof resolveGuideAiSource> | undefined;
    try { resolved = resolveGuideAiSource(ctx, ref.kind, ref.refId, memberIdentityFor(ctx), ref); }
    catch (error) { if (!oldKeys.has(key(ref))) throw error; }
    if (resolved) {
      if (resolved.subjectId !== input.subjectId) fail('invalid', 'Todos los materiales deben pertenecer a la materia de la guía.');
      for (const evidenceId of ref.evidenceIds ?? []) {
        const evidence = ctx.db.evidence.id.find(BigInt(evidenceId));
        if (!evidence || String(evidence.activityId) !== ref.refId) fail('invalid', 'La evidencia no pertenece a la actividad.');
        resolveGuideAiSource(ctx, 'evidence', evidenceId); allowedKeys.add(`evidence:${evidenceId}`);
      }
      for (const transcriptionId of ref.transcriptionIds ?? []) {
        const prepared = getGuideTranscription(ctx, transcriptionId);
        if (!(prepared.targetKind === ref.kind && prepared.targetId === ref.refId || ref.kind === 'activity' && prepared.targetKind === 'evidence' && ref.evidenceIds?.includes(prepared.targetId))) fail('invalid', 'La transcripción no pertenece al material.');
      }
    }
  }
  for (const fileId of input.chosenFileIds) {
    const file = ctx.db.resourceFile.id.find(fileId);
    if ((!file || file.removedAt !== undefined || !allowedKeys.has(`${file.targetKind}:${file.targetId}`)) && !oldFiles.has(fileId)) fail('invalid', 'Un archivo elegido no pertenece a los materiales agregados.');
  }
  const { expectedRevision: _expected, ...content } = input;
  const value: GuideMaterialSelection = { ...content, revision: (prior?.revision ?? 0) + 1, updatedAt: Number(ctx.timestamp.microsSinceUnixEpoch / 1000n), transcriptions: [], unavailableSourceKeys: [] };
  const row = { id: input.id, actor: memberIdentityFor(ctx), revision: value.revision, json: JSON.stringify(value), updatedAt: ctx.timestamp };
  if (prior) ctx.db.guideMaterialSelection.id.update(row); else ctx.db.guideMaterialSelection.insert(row);
  return projection(ctx, value);
}
export function guideMaterialsResponse(ctx: Ctx, payload: string): string {
  try {
    activeMember(ctx);
    if (payload.length > 2 * 1024 * 1024) fail('invalid', 'La selección supera el tamaño admitido.');
    const raw: unknown = JSON.parse(payload); if (!aiRecord(raw)) fail('invalid', 'Solicitud inválida.');
    if (raw.action === 'listExams') return JSON.stringify(listExams(ctx, raw.subjectId));
    if (raw.action === 'getExam') { if (!Number.isSafeInteger(raw.version) || Number(raw.version) < 1) fail('invalid', 'Versión inválida.'); return JSON.stringify(examDetail(ctx, uuid(raw.examId), Number(raw.version), raw.includeSolutions === true)); }
    if (raw.action === 'saveSelection') return JSON.stringify(saveSelection(ctx, raw.input));
    if (raw.action === 'getSelection') { const row = selectionRow(ctx, uuid(raw.id)); return row ? JSON.stringify(projection(ctx, JSON.parse(row.json) as GuideMaterialSelection)) : 'null'; }
    if (raw.action === 'listSelections') return JSON.stringify([...ctx.db.guideMaterialSelection.actor.filter(memberIdentityFor(ctx))].map((row) => guideMaterialSelectionSummary(JSON.parse(row.json) as GuideMaterialSelection)).sort((a, b) => b.updatedAt - a.updatedAt));
    return fail('invalid', 'Operación de materiales no admitida.');
  } catch (error) {
    if (error instanceof SenderError) throw error;
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') return fail(error.code, error.message);
    if (error instanceof SyntaxError) return fail('invalid', 'Solicitud inválida.');
    throw error;
  }
}
