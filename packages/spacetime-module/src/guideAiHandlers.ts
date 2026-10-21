import { Identity } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { AI_CONSENT_VERSION, AI_LIMITS, aiHash, aiRecord, aiUuid, sanitizeAiText } from '../../core/src/ai';
import { buildGuideAiPreparation, estimateGuideAiCallTokens, validateGuideAiPrepareInput, validateGuideAiResult, validateGuideAiSummary,
  type GuideAiClaim, type GuideAiDraft, type GuideAiDraftSummary, type GuideAiFragment,
  type GuideAiSnapshot, type GuideAiStep, type GuideAiSummary, type GuideAiTranscription } from '../../core/src/guideAi';
import { activeMember, expectVersion, isActive, log, requireGuide, targetVersion, type Ctx, type ViewDb } from './moduleContext';
import { isAiService, resolveAiSource } from './aiHandlers';
import { canReadTarget, captureGuide, extraVersion, withdrawn } from './delivery2Handlers';

function fail(code: string, message: string): never { throw new SenderError(`${code}:${message}`); }
function record(value: unknown) { if (!aiRecord(value)) fail('invalid', 'Se esperaba un objeto.'); return value; }
function string(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('invalid', `${field} inválido.`); return value.trim();
}
function id(value: unknown, field = 'El identificador'): string {
  if (!aiUuid(value)) fail('invalid', `${field} debe ser UUID.`); return value.toLowerCase();
}
function decimal(value: unknown): bigint {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value) || BigInt(value) > 0xffffffffffffffffn) fail('invalid', 'Referencia inválida.'); return BigInt(value);
}
function version(value: unknown): number { if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 0xffffffff) fail('invalid', 'Versión inválida.'); return Number(value); }
function milliseconds(ctx: Ctx) { return Number(ctx.timestamp.microsSinceUnixEpoch / 1000n); }
function ownedDraft(ctx: Ctx, value: unknown) {
  activeMember(ctx); const row = ctx.db.guideAiDraft.id.find(id(value));
  if (!row || !row.actor.isEqual(ctx.sender)) fail('unavailable', 'El borrador no está disponible.');
  return row;
}
function actor(value: unknown) {
  const clean = string(value, 'La identidad', 66).replace(/^0x/, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(clean)) fail('invalid', 'Identidad inválida.'); return Identity.fromString(clean);
}
function service(ctx: Ctx) { if (!isAiService(ctx)) fail('unauthorized', 'Solo el servicio de IA puede registrar este resultado.'); }

/** Guías deliberately adds questions without enabling them as EX-1 question sources. */
export function resolveGuideAiSource(ctx: Ctx, kind: string, refId: string, person = ctx.sender) {
  const ref = decimal(refId);
  if (!isActive(ctx.db, person) || !canReadTarget(ctx.db, person, kind, ref) || withdrawn(ctx.db, kind, ref)) fail('unavailable', 'Una fuente ya no está disponible.');
  if (kind === 'question') {
    const question = ctx.db.question.id.find(ref)!;
    const answers = [...ctx.db.answer.questionId.filter(ref)].filter((answer) => canReadTarget(ctx.db, person, 'answer', answer.id) && !withdrawn(ctx.db, 'answer', answer.id))
      .sort((a, b) => a.id < b.id ? -1 : 1);
    return { kind: 'question' as const, refId, subjectId: String(question.subjectId), version: extraVersion(ctx, 'question', ref),
      title: question.title, topic: question.topic, visibility: 'group' as const,
      fields: [{ name: 'pregunta', text: question.body }, ...answers.map((answer) => ({ name: `respuesta:${answer.id}:v${extraVersion(ctx, 'answer', answer.id)}`, text: answer.body }))],
      context: aiHash({ acceptedAnswerId: question.acceptedAnswerId?.toString(), status: question.status,
        answers: answers.map((answer) => ({ id: String(answer.id), version: extraVersion(ctx, 'answer', answer.id), body: answer.body })) }),
      omissions: answers.length ? [] : ['La pregunta no tiene respuestas públicas disponibles.'] };
  }
  if (!['note', 'assignment', 'activity', 'work', 'evidence'].includes(kind)) fail('invalid', 'Este tipo de fuente no pertenece a Guías.');
  const source = resolveAiSource(ctx, kind, refId, person);
  if (source.visibility !== 'group') fail('unauthorized', 'Guías solo utiliza material compartido por el grupo.');
  if (kind === 'work') {
    const work = ctx.db.work.id.find(ref)!;
    if (!canReadTarget(ctx.db, person, 'assignment', work.assignmentId) || withdrawn(ctx.db, 'assignment', work.assignmentId)) fail('unavailable', 'La consigna de esta fuente ya no está disponible.');
  }
  if (kind === 'evidence') {
    const evidence = ctx.db.evidence.id.find(ref)!;
    if (!canReadTarget(ctx.db, person, 'activity', evidence.activityId) || withdrawn(ctx.db, 'activity', evidence.activityId)) fail('unavailable', 'La actividad de esta evidencia ya no está disponible.');
  }
  return source;
}

function readableCurrentFile(ctx: Ctx, fileId: string, person = ctx.sender) {
  const file = ctx.db.resourceFile.id.find(fileId);
  if (!file || file.removedAt !== undefined) fail('unavailable', 'El adjunto ya no está disponible en esta versión.');
  resolveGuideAiSource(ctx, file.targetKind, String(file.targetId), person);
  if (file.size > 10n * 1024n * 1024n) fail('quota', 'La extracción admite hasta 10 MiB por documento.');
  return file;
}
export function saveGuideTranscription(ctx: Ctx, raw: Record<string, unknown>) {
  activeMember(ctx); const transcriptionId = id(raw.id); const fileId = string(raw.fileId, 'El archivo', 300);
  const prior = ctx.db.guideAiTranscription.id.find(transcriptionId);
  const file = readableCurrentFile(ctx, fileId); const expectedVersion = version(raw.targetVersion);
  if (raw.targetKind !== file.targetKind || raw.targetId !== String(file.targetId)) fail('conflict', 'La transcripción no corresponde al destino del adjunto.');
  expectVersion(targetVersion(ctx, file.targetKind, file.targetId), expectedVersion);
  const fileHash = string(raw.fileHash, 'La huella', 128).toLowerCase();
  const storedHash = file.storageKey.startsWith('stdb:') ? ctx.db.resourceUpload.id.find(file.storageKey.slice(5))?.sha256 : undefined;
  if (!storedHash || fileHash !== storedHash.toLowerCase()) fail('conflict', 'La huella no corresponde al archivo almacenado; este adjunto requiere una huella verificada.');
  if (!/^[a-f0-9]{64}$/.test(fileHash)) fail('invalid', 'Huella SHA-256 inválida.');
  if (raw.reviewed !== true) fail('consent', 'Revisa y confirma la transcripción antes de guardarla.');
  if (!Array.isArray(raw.segments) || !raw.segments.length || raw.segments.length > 20_000) fail('invalid', 'La transcripción no contiene segmentos válidos.');
  let characters = 0;
  const segments = raw.segments.map((value) => {
    const segment = record(value); const locator = record(segment.locator);
    if (!['page', 'paragraph', 'lines'].includes(String(locator.kind)) || !Number.isInteger(locator.start) || !Number.isInteger(locator.end)
      || Number(locator.start) < 1 || Number(locator.end) < Number(locator.start) || Number(locator.end) > 1_000_000
      || (locator.kind === 'page' && Number(locator.end) > 200)) fail('invalid', 'Conserva páginas, párrafos o líneas como localizadores válidos.');
    if (typeof segment.text !== 'string' || segment.text.length > 120_000) fail('invalid', 'Texto de segmento inválido.');
    const text = sanitizeAiText(segment.text); characters += text.length; return { id: string(segment.id, 'El segmento', 120), locator, text };
  });
  if (!segments.some((segment) => segment.text.trim()) || characters > 120_000) fail('quota', 'El texto preparado debe contener texto y admite hasta 120 000 caracteres, sin recortes.');
  if (!Array.isArray(raw.omissions) || raw.omissions.length > 100 || raw.omissions.some((value) => typeof value !== 'string' || value.length > 500)) fail('invalid', 'Las omisiones no son válidas.');
  if (typeof raw.text !== 'string' || raw.text !== (raw.segments as { text: string }[]).map((segment) => segment.text).join('\n')) fail('invalid', 'El texto revisado debe corresponder a sus segmentos y localizadores.');
  const json = JSON.stringify({ id: transcriptionId, fileId, fileHash, fileEtag: file.etag,
    targetKind: file.targetKind, targetId: String(file.targetId), targetVersion: expectedVersion,
    text: segments.map((segment) => segment.text).join('\n'), segments, omissions: raw.omissions,
    reviewed: true, createdAt: prior ? Number(prior.createdAt.microsSinceUnixEpoch / 1000n) : milliseconds(ctx), label: 'Texto preparado y revisado por el alumno' });
  if (prior) {
    if (!prior.actor.isEqual(ctx.sender) || prior.json !== json) fail('conflict', 'La transcripción ya pertenece a otra preparación.');
    return JSON.parse(prior.json) as unknown;
  }
  ctx.db.guideAiTranscription.insert({ id: transcriptionId, actor: ctx.sender, fileId, fileHash,
    targetKind: file.targetKind, targetId: file.targetId, targetVersion: expectedVersion, json, createdAt: ctx.timestamp });
  return JSON.parse(json) as unknown;
}

export function getGuideTranscription(ctx: Ctx, transcriptionId: string, person = ctx.sender, requireSame = true): GuideAiTranscription {
  const row = ctx.db.guideAiTranscription.id.find(id(transcriptionId));
  if (!isActive(ctx.db, person) || !row || !row.actor.isEqual(person)) fail('unavailable', 'La transcripción no está disponible.');
  const file = requireSame ? readableCurrentFile(ctx, row.fileId, person) : ctx.db.resourceFile.id.find(row.fileId);
  if (!file) fail('unavailable', 'El adjunto ya no está disponible.');
  if (!requireSame) resolveGuideAiSource(ctx, row.targetKind, String(row.targetId), person);
  else expectVersion(targetVersion(ctx, row.targetKind, row.targetId), row.targetVersion);
  const parsed = record(JSON.parse(row.json));
  if (requireSame && parsed.fileEtag !== file.etag) fail('conflict', 'El adjunto cambió; vuelve a preparar su transcripción.');
  return parsed as unknown as GuideAiTranscription;
}

function preparedSnapshots(ctx: Ctx, input: ReturnType<typeof validateGuideAiPrepareInput>, person = ctx.sender, requireSame = true): GuideAiSnapshot[] {
  return input.sources.map((ref) => {
    const resolved = resolveGuideAiSource(ctx, ref.kind, ref.refId, person);
    const snapshot = { ...resolved, kind: ref.kind, fields: [...resolved.fields] } as GuideAiSnapshot;
    const context: unknown[] = [snapshot.context];
    const files: { id: string; name: string; storageKey: string }[] = [];
    const includeFiles = (kind: string, targetId: string) => {
      files.push(...[...ctx.db.resourceFile.targetId.filter(decimal(targetId))].filter((file) => file.targetKind === kind && file.removedAt === undefined));
      if (kind === 'work') for (const file of ctx.db.workFile.workId.filter(decimal(targetId))) {
        if (!files.some((candidate) => candidate.storageKey === file.storageKey)) files.push({ id: `legacy:${file.id}`, name: file.name, storageKey: file.storageKey });
      }
    };
    includeFiles(ref.kind, ref.refId);
    snapshot.omissions = (snapshot.omissions ?? []).filter((omission) => !omission.includes('archivo(s) adjunto(s) excluido(s)'));
    const evidences = (ref.evidenceIds ?? []).map((evidenceId) => {
      const evidence = ctx.db.evidence.id.find(decimal(evidenceId));
      if (!evidence || evidence.activityId !== decimal(ref.refId)) fail('invalid', 'Una evidencia no pertenece a la actividad seleccionada.');
      const selected = resolveGuideAiSource(ctx, 'evidence', evidenceId, person);
      snapshot.fields.push(...selected.fields.map((field) => ({ ...field, origin: { kind: 'evidence' as const, refId: evidenceId, version: selected.version } })));
      snapshot.omissions!.push(...(selected.omissions ?? []).filter((omission) => !omission.includes('archivo(s) adjunto(s) excluido(s)')));
      includeFiles('evidence', evidenceId);
      context.push(selected); return evidenceId;
    });
    const transcribedFiles = new Set<string>();
    for (const transcriptionId of ref.transcriptionIds ?? []) {
      const transcription = getGuideTranscription(ctx, transcriptionId, person, requireSame);
      const sameSource = transcription.targetKind === ref.kind && transcription.targetId === ref.refId;
      const selectedEvidence = ref.kind === 'activity' && transcription.targetKind === 'evidence' && evidences.includes(transcription.targetId);
      if (!sameSource && !selectedEvidence) fail('invalid', 'Un adjunto preparado no pertenece a la fuente o evidencia seleccionada.');
      transcribedFiles.add(transcription.fileId);
      snapshot.fields.push(...transcription.segments.map((segment) => ({ name: `archivo:${transcription.fileId}:${segment.id}`, text: segment.text,
        origin: { kind: transcription.targetKind, refId: transcription.targetId, version: transcription.targetVersion,
          fileId: transcription.fileId, fileHash: transcription.fileHash, transcriptionId, locator: segment.locator } })));
      snapshot.omissions = [...(snapshot.omissions ?? []), ...transcription.omissions]; context.push(transcription);
    }
    for (const file of files) if (!transcribedFiles.has(file.id)) snapshot.omissions.push(`Adjunto «${sanitizeAiText(file.name)}» no preparado: su archivo no se enviará ni contará como texto utilizado.`);
    snapshot.context = aiHash(context); return snapshot;
  });
}
function draftValue(row: NonNullable<ReturnType<Ctx['db']['guideAiDraft']['id']['find']>>): GuideAiDraft {
  return { ...JSON.parse(row.json) as GuideAiDraft, revision: row.revision, state: row.state as GuideAiDraft['state'], updatedAt: Number(row.updatedAt.microsSinceUnixEpoch / 1000n) };
}
function saveDraft(ctx: Ctx, draft: GuideAiDraft) {
  const row = ctx.db.guideAiDraft.id.find(draft.id)!;
  const next = { ...draft, revision: row.revision + 1, updatedAt: milliseconds(ctx), completedSteps: draft.steps.filter((step) => step.state === 'succeeded').length };
  ctx.db.guideAiDraft.id.update({ ...row, revision: next.revision, state: next.state, json: JSON.stringify(next), updatedAt: ctx.timestamp }); return next;
}
function summary(draft: GuideAiDraft): GuideAiDraftSummary {
  const { id, revision, state, title, subjectId, termId, createdAt, updatedAt, completedSteps, totalSteps, publishedGuideId } = draft;
  return { id, revision, state, title, subjectId, ...(termId ? { termId } : {}), createdAt, updatedAt, completedSteps, totalSteps, ...(publishedGuideId ? { publishedGuideId } : {}) };
}
function validDraftSources(ctx: Ctx, draft: GuideAiDraft, person: Identity, requireSame = true) {
  const snapshots = preparedSnapshots(ctx, draft.preparation.input, person, requireSame);
  if (requireSame) {
    const current = buildGuideAiPreparation(draft.preparation.input, snapshots, { id: draft.id, model: draft.preparation.model, now: draft.preparation.createdAt });
    if (current.fingerprint !== draft.preparation.fingerprint) fail('conflict', 'Una fuente cambió. Conservamos el borrador; vuelve a preparar las fuentes antes de publicar o continuar.');
  }
}
export function prepareGuideAi(ctx: Ctx, raw: Record<string, unknown>): GuideAiDraft {
  activeMember(ctx); const draftId = id(raw.id); const input = validateGuideAiPrepareInput(raw.input); const model = string(raw.model, 'El modelo');
  if (!ctx.db.subject.id.find(decimal(input.subjectId))) fail('unavailable', 'La materia no está disponible.');
  if (input.termId && ctx.db.term.id.find(decimal(input.termId))?.subjectId !== decimal(input.subjectId)) fail('invalid', 'El parcial no pertenece a la materia.');
  const preparation = buildGuideAiPreparation(input, preparedSnapshots(ctx, input), { id: draftId, model, now: milliseconds(ctx) });
  const prior = ctx.db.guideAiDraft.id.find(draftId);
  if (prior) {
    if (!prior.actor.isEqual(ctx.sender) || draftValue(prior).preparation.fingerprint !== preparation.fingerprint) fail('conflict', 'La preparación pertenece a otra selección. Crea una nueva para actualizar las fuentes.');
    return draftValue(prior);
  }
  const steps: GuideAiStep[] = preparation.batches.length <= 1 ? [{ id: 'direct', kind: 'direct', state: 'pending' }]
    : [...preparation.batches.map((batch) => ({ id: batch.id, batchId: batch.id, kind: 'summary' as const, state: 'pending' as const })), { id: 'synthesis', kind: 'synthesis', state: 'pending' }];
  const draft: GuideAiDraft = { id: draftId, revision: 1, state: 'prepared', title: input.title, subjectId: input.subjectId, ...(input.termId ? { termId: input.termId } : {}),
    preparation, steps, createdAt: milliseconds(ctx), updatedAt: milliseconds(ctx), completedSteps: 0, totalSteps: steps.length };
  ctx.db.guideAiDraft.insert({ id: draftId, actor: ctx.sender, revision: 1, state: draft.state, json: JSON.stringify(draft), createdAt: ctx.timestamp, updatedAt: ctx.timestamp }); return draft;
}
function reprepareGuideAiDraft(ctx: Ctx, raw: Record<string, unknown>): GuideAiDraft {
  const row = ownedDraft(ctx, raw.id); const draft = draftValue(row); const requestId = id(raw.requestId, 'La actualización');
  validDraftSources(ctx, draft, ctx.sender, false);
  const input = validateGuideAiPrepareInput(raw.input); const model = string(raw.model, 'El modelo');
  const refreshHash = aiHash({ input, model });
  if (draft.refreshRequestId === requestId) {
    if ((draft as GuideAiDraft & { refreshHash?: string }).refreshHash !== refreshHash) fail('conflict', 'La actualización ya pertenece a otra selección.');
    validDraftSources(ctx, draft, ctx.sender, false);
    return draft;
  }
  expectVersion(draft.revision, version(raw.expectedRevision));
  if (['running', 'published', 'cancelled'].includes(draft.state) || draft.steps.some((step) => step.state === 'running')) fail('conflict', 'Termina el envío en curso o elige otro borrador privado para actualizar sus fuentes.');
  if (!ctx.db.subject.id.find(decimal(input.subjectId))) fail('unavailable', 'La materia no está disponible.');
  if (input.termId && ctx.db.term.id.find(decimal(input.termId))?.subjectId !== decimal(input.subjectId)) fail('invalid', 'El parcial no pertenece a la materia.');
  const preparation = buildGuideAiPreparation(input, preparedSnapshots(ctx, input), { id: draft.id, model, now: milliseconds(ctx) });
  const same = preparation.fingerprint === draft.preparation.fingerprint;
  if (same) return saveDraft(ctx, { ...draft, preparation, refreshRequestId: requestId, refreshHash } as GuideAiDraft);
  const next = { ...draft, preparation, subjectId: input.subjectId, termId: input.termId,
    refreshRequestId: requestId, refreshHash, authorization: undefined };
  if (draft.result) {
    const allowed = new Set(preparation.fragments.map((fragment) => fragment.id));
    next.result = { ...draft.result, sections: draft.result.sections.map((section) => ({ ...section, citations: section.citations.filter((citation) => allowed.has(citation)) })) };
    next.state = 'ready'; next.needsCitationReview = true; next.editedAfterGeneration = true;
    next.generationModel = draft.generationModel ?? draft.preparation.model;
  } else {
    next.title = input.title; next.state = 'prepared'; next.completedSteps = 0;
    next.steps = preparation.batches.length <= 1 ? [{ id: 'direct', kind: 'direct', state: 'pending' }]
      : [...preparation.batches.map((batch) => ({ id: batch.id, batchId: batch.id, kind: 'summary' as const, state: 'pending' as const })), { id: 'synthesis', kind: 'synthesis', state: 'pending' }];
    next.totalSteps = next.steps.length;
  }
  return saveDraft(ctx, next);
}
function fileInfo(ctx: Ctx, raw: Record<string, unknown>) {
  activeMember(ctx); const file = readableCurrentFile(ctx, string(raw.fileId, 'El archivo', 300));
  const hash = file.storageKey.startsWith('stdb:') ? ctx.db.resourceUpload.id.find(file.storageKey.slice(5))?.sha256 : undefined;
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) fail('unavailable', 'Este archivo anterior no tiene una huella verificada. Vuelve a adjuntarlo para preparar su texto.');
  return { fileId: file.id, fileHash: hash, targetKind: file.targetKind, targetId: String(file.targetId),
    targetVersion: targetVersion(ctx, file.targetKind, file.targetId), name: file.name, size: Number(file.size), contentType: file.contentType };
}
function expireGuideSteps(ctx: Ctx, person: Identity) {
  const now = milliseconds(ctx);
  for (const row of ctx.db.guideAiDraft.actor.filter(person)) {
    const draft = draftValue(row); let changed = false;
    for (const step of draft.steps) if (step.state === 'running' && step.startedAt !== undefined && step.startedAt + 90_000 <= now) {
      step.state = 'unknown'; step.finishedAt = now; step.error = 'No se conoce el resultado del envío. No se reenviará automáticamente.'; changed = true;
      if (step.generationId) { const generation = ctx.db.aiGeneration.id.find(step.generationId); if (generation?.status === 'running') ctx.db.aiGeneration.id.update({ ...generation, status: 'unknown', errorCode: 'unknown', errorMessage: step.error }); }
    }
    if (changed) { if (draft.state !== 'cancelled') draft.state = 'unknown'; saveDraft(ctx, draft); }
  }
}
function authorizeGuideStep(ctx: Ctx, raw: Record<string, unknown>) {
  activeMember(ctx); expireGuideSteps(ctx, ctx.sender); const row = ownedDraft(ctx, raw.id); const draft = draftValue(row);
  if (raw.model !== draft.preparation.model || raw.fingerprint !== draft.preparation.fingerprint) fail('conflict', 'La vista previa o el modelo cambió. Prepara nuevamente.');
  const generationId = id(raw.generationId, 'El envío'); const prior = ctx.db.aiGeneration.id.find(generationId);
  if (prior) {
    if (!prior.actor.isEqual(ctx.sender) || prior.preparationId !== draft.id) fail('conflict', 'El envío pertenece a otra operación.');
    validDraftSources(ctx, draft, ctx.sender, false);
    return { actor: ctx.sender.toHexString(), draft };
  }
  if (draft.steps.some((step) => step.generationId === generationId && step.state === 'pending')) { validDraftSources(ctx, draft, ctx.sender, false); return { actor: ctx.sender.toHexString(), draft }; }
  expectVersion(draft.revision, version(raw.expectedRevision));
  if (raw.confirmed !== true) fail('consent', 'Confirma expresamente el envío del texto preparado.');
  if (raw.allowNew !== true) fail('disabled', 'La IA real todavía no está habilitada.');
  if (raw.model !== draft.preparation.model || raw.fingerprint !== draft.preparation.fingerprint) fail('conflict', 'La vista previa o el modelo cambió. Prepara nuevamente.');
  if (['published', 'cancelled', 'ready'].includes(draft.state)) fail('conflict', 'Este borrador no tiene pasos pendientes.');
  if (!draft.preparation.canGenerate) fail('invalid', 'Resuelve las fuentes y cobertura pendientes.');
  if (draft.completedSteps === 0 && draft.preparation.expiresAt <= milliseconds(ctx)) fail('expired', 'La vista previa venció. Prepara otra selección antes del primer envío.');
  validDraftSources(ctx, draft, ctx.sender);
  const step = draft.steps.find((entry) => entry.state !== 'succeeded');
  if (!step || step.state === 'running') fail('conflict', 'Ya hay un paso en curso.');
  const hasUnknown = [...ctx.db.aiGeneration.actor.filter(ctx.sender)].some((generation) => generation.status === 'unknown' && generation.createdAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch - 86_400_000_000n);
  if ((step.state === 'unknown' || hasUnknown) && raw.acknowledgeUnknown !== true) fail('unknown_confirmation_required', 'Confirma el posible consumo adicional del envío de resultado incierto.');
  // Authorization never sends or reserves. The restricted claim below does both atomically.
  const key = ctx.db.aiKey.actor.find(ctx.sender); if (!key) fail('unavailable', 'Configura tu clave personal antes de generar.');
  step.generationId = generationId; step.state = 'pending'; step.error = undefined;
  const authorized = { ...draft, state: 'prepared' as const,
    authorization: { generationId, keyId: key.keyId, acknowledgeUnknown: raw.acknowledgeUnknown === true } };
  const next = saveDraft(ctx, authorized);
  return { actor: ctx.sender.toHexString(), draft: next, acknowledgeUnknown: raw.acknowledgeUnknown === true };
}
function fragmentsForStep(draft: GuideAiDraft, step: GuideAiStep): GuideAiFragment[] {
  if (step.kind === 'synthesis') {
    const cited = new Set(draft.steps.filter((entry) => entry.kind === 'summary' && entry.state === 'succeeded')
      .flatMap((entry) => (entry.result as GuideAiSummary).paragraphs.flatMap((paragraph) => paragraph.citations)));
    return draft.preparation.fragments.filter((fragment) => cited.has(fragment.id));
  }
  if (step.kind !== 'summary') return draft.preparation.fragments;
  const batch = draft.preparation.batches.find((entry) => entry.id === step.batchId);
  if (!batch) fail('invalid', 'El lote del paso no existe.'); return draft.preparation.fragments.filter((fragment) => batch.fragmentIds.includes(fragment.id));
}
function claimGuideStep(ctx: Ctx, raw: Record<string, unknown>): GuideAiClaim {
  service(ctx); const person = actor(raw.actor); const draftId = id(raw.id); const generationId = id(raw.generationId);
  if (!isActive(ctx.db, person)) fail('unauthorized', 'La persona ya no es miembro activo.');
  expireGuideSteps(ctx, person); const row = ctx.db.guideAiDraft.id.find(draftId);
  if (!row || !row.actor.isEqual(person)) fail('unavailable', 'El borrador no está disponible.');
  const draft = draftValue(row); validDraftSources(ctx, draft, person);
  const existing = ctx.db.aiGeneration.id.find(generationId);
  if (existing) {
    if (!existing.actor.isEqual(person) || existing.preparationId !== draftId) fail('conflict', 'El envío pertenece a otra operación.');
    return { claimed: false, actor: person.toHexString(), draft };
  }
  const step = draft.steps.find((entry) => entry.generationId === generationId);
  if (!step || step.state !== 'pending' || draft.state === 'cancelled' || draft.state === 'published') fail('conflict', 'El paso no está autorizado o fue cancelado.');
  if (!ctx.db.aiServiceConfig.id.find(0)?.enabled) fail('disabled', 'La IA real todavía no está habilitada.');
  const consent = ctx.db.aiConsent.actor.find(person);
  if (!consent?.accepted || consent.version !== AI_CONSENT_VERSION) fail('consent', 'Confirma el consentimiento vigente.');
  const key = ctx.db.aiKey.actor.find(person); if (!key) fail('unavailable', 'Configura tu clave personal antes de generar.');
  const authorization = (draft as GuideAiDraft & { authorization?: { generationId: string; keyId: string; acknowledgeUnknown: boolean } }).authorization;
  if (authorization?.generationId !== generationId || authorization.keyId !== key.keyId) fail('conflict', 'La clave cambió después de confirmar. Vuelve a revisar el envío.');
  for (const generation of ctx.db.aiGeneration.actor.filter(person)) {
    if (generation.status === 'running' && generation.claimedAt && generation.claimedAt.microsSinceUnixEpoch + 90_000_000n <= ctx.timestamp.microsSinceUnixEpoch) ctx.db.aiGeneration.id.update({ ...generation, status: 'unknown', errorCode: 'unknown', errorMessage: 'Resultado incierto; no se reenvía automáticamente.' });
    else if (generation.status === 'queued' || generation.status === 'running') fail('quota', 'Ya tienes una generación en curso.');
  }
  const sinceHour = ctx.timestamp.microsSinceUnixEpoch - 3_600_000_000n; const sinceDay = ctx.timestamp.microsSinceUnixEpoch - 86_400_000_000n;
  const hasUnknown = [...ctx.db.aiGeneration.actor.filter(person)].some((generation) => generation.status === 'unknown' && generation.createdAt.microsSinceUnixEpoch > sinceDay);
  if (hasUnknown && !authorization.acknowledgeUnknown) fail('unknown_confirmation_required', 'Confirma el riesgo de consumo adicional antes del nuevo envío.');
  const reservations = [...ctx.db.aiReservation.actor.filter(person)];
  if (reservations.filter((entry) => entry.createdAt.microsSinceUnixEpoch > sinceHour).length >= AI_LIMITS.requestsPerHour || reservations.filter((entry) => entry.createdAt.microsSinceUnixEpoch > sinceDay).length >= AI_LIMITS.requestsPerDay) fail('quota', 'Alcanzaste el límite compartido de solicitudes de IA. Se conserva tu avance.');
  const fragments = fragmentsForStep(draft, step);
  const summaries = draft.steps.filter((entry) => entry.kind === 'summary' && entry.state === 'succeeded').map((entry) => entry.result as GuideAiSummary);
  const estimatedTokens = estimateGuideAiCallTokens(draft.preparation.input, step.kind, fragments, summaries);
  const spent = reservations.filter((entry) => entry.createdAt.microsSinceUnixEpoch > sinceDay && entry.status !== 'released').reduce((total, entry) => total + entry.estimatedTokens, 0);
  if (spent + estimatedTokens > (ctx.db.aiServiceConfig.id.find(0)?.dailyTokenBudget ?? AI_LIMITS.dailyEstimatedTokens)) fail('quota', 'No queda presupuesto diario para este paso. Se conserva tu avance.');
  ctx.db.aiReservation.insert({ id: generationId, actor: person, estimatedTokens, status: 'reserved', createdAt: ctx.timestamp });
  ctx.db.aiGeneration.insert({ id: generationId, actor: person, preparationId: draftId, requestHash: aiHash({ draftId, step: step.id, fingerprint: draft.preparation.fingerprint }),
    configJson: JSON.stringify({ purpose: 'study_guide', stepId: step.id }), keyId: key.keyId, model: draft.preparation.model, status: 'running', createdAt: ctx.timestamp, claimedAt: ctx.timestamp,
    inputTokens: undefined, outputTokens: undefined, resultJson: '', errorCode: '', errorMessage: '' });
  step.state = 'running'; step.startedAt = milliseconds(ctx); step.finishedAt = undefined;
  const next = saveDraft(ctx, { ...draft, state: 'running' });
  return { claimed: true, actor: person.toHexString(), draft: next, step, fragments,
    ...(step.kind === 'synthesis' ? { summaries } : {}), estimatedTokens,
    key: { keyId: key.keyId, provider: 'gemini', ciphertext: key.ciphertext, iv: key.iv, masterVersion: key.masterVersion } };
}

function finishGuideStep(ctx: Ctx, raw: Record<string, unknown>): GuideAiDraft {
  service(ctx); const person = actor(raw.actor); const draftId = id(raw.id); const generationId = id(raw.generationId);
  const row = ctx.db.guideAiDraft.id.find(draftId); const generation = ctx.db.aiGeneration.id.find(generationId);
  if (!row || !row.actor.isEqual(person) || !generation || !generation.actor.isEqual(person) || generation.preparationId !== draftId) fail('unavailable', 'El envío no está disponible.');
  const draft = draftValue(row); const step = draft.steps.find((entry) => entry.generationId === generationId);
  if (!step) fail('conflict', 'El envío ya no pertenece al paso actual.');
  if (!['succeeded', 'failed', 'unknown'].includes(String(raw.state))) fail('invalid', 'Estado final inválido.');
  let result: GuideAiStep['result']; let state = raw.state as 'succeeded' | 'failed' | 'unknown';
  let error = state === 'succeeded' ? undefined : `${string(raw.errorCode ?? state, 'El código', 80)}:${string(raw.errorMessage ?? 'La solicitud no terminó correctamente.', 'El error', 500)}`;
  if (state === 'succeeded') {
    try {
      const fragments = fragmentsForStep(draft, step);
      result = step.kind === 'summary' ? validateGuideAiSummary(raw.result, fragments, Math.min(8000, Math.floor(32_000 / draft.preparation.batches.length)))
        : validateGuideAiResult(raw.result, { ...draft.preparation, fragments });
    }
    catch { state = 'failed'; error = 'invalid:El proveedor devolvió secciones o citas inválidas. Se conserva el avance anterior.'; }
  }
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  if (raw.usage !== undefined) {
    const value = record(raw.usage);
    if (![value.inputTokens, value.outputTokens].every((count) => Number.isInteger(count) && Number(count) >= 0 && Number(count) <= 10_000_000)) fail('invalid', 'El consumo reportado no es válido.');
    usage = { inputTokens: Number(value.inputTokens), outputTokens: Number(value.outputTokens) };
  }
  const resultJson = result ? JSON.stringify(result) : '';
  if (resultJson.length > 200_000) fail('invalid', 'La respuesta excede el límite.');
  if (generation.status !== 'running' || step.state !== 'running') {
    if (generation.status === state && generation.resultJson === resultJson) return draft;
    fail('conflict', 'El envío ya terminó; su resultado no puede cambiar ni volver a enviarse.');
  }
  step.state = state; step.result = result; step.error = error; step.usage = usage; step.finishedAt = milliseconds(ctx);
  ctx.db.aiGeneration.id.update({ ...generation, status: state, resultJson, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
    errorCode: state === 'succeeded' ? '' : String(error?.split(':')[0] ?? state), errorMessage: state === 'succeeded' ? '' : String(error?.slice((error.indexOf(':') ?? -1) + 1) ?? state) });
  const reservation = ctx.db.aiReservation.id.find(generationId);
  if (reservation) ctx.db.aiReservation.id.update({ ...reservation, status: state === 'unknown' ? 'reserved' : 'consumed',
    estimatedTokens: Math.max(reservation.estimatedTokens, (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)) });
  if (draft.state !== 'cancelled') {
    draft.state = state === 'succeeded' ? (step.kind === 'summary' ? 'prepared' : 'ready') : state;
    if (state === 'succeeded' && step.kind !== 'summary') { draft.result = result as GuideAiDraft['result']; draft.title = draft.result!.title; draft.generationModel = draft.preparation.model; }
  }
  return saveDraft(ctx, draft);
}
function publishGuideAi(ctx: Ctx, raw: Record<string, unknown>): GuideAiDraft {
  const row = ownedDraft(ctx, raw.id); const draft = draftValue(row); const requestId = id(raw.requestId, 'La publicación');
  if (draft.state === 'published') {
    if (draft.publicationRequestId !== requestId || (raw.guideId !== undefined && raw.guideId !== draft.publishedGuideId)) fail('conflict', 'Este borrador ya se publicó mediante otra solicitud.');
    validDraftSources(ctx, draft, ctx.sender, false);
    return draft;
  }
  expectVersion(draft.revision, version(raw.expectedRevision));
  if (draft.state !== 'ready' || !draft.result) fail('invalid', 'Completa y revisa el borrador antes de publicarlo.');
  if (draft.needsCitationReview) fail('invalid', 'Revisa las citas y guarda el borrador después de actualizar sus fuentes antes de publicar.');
  validDraftSources(ctx, draft, ctx.sender); const result = validateGuideAiResult(draft.result, draft.preparation);
  const input = draft.preparation.input; const subjectId = decimal(input.subjectId); const termId = input.termId ? decimal(input.termId) : undefined;
  if (!ctx.db.subject.id.find(subjectId) || (termId !== undefined && ctx.db.term.id.find(termId)?.subjectId !== subjectId)) fail('conflict', 'La clasificación ya no está disponible.');
  const existing = raw.guideId !== undefined ? requireGuide(ctx, decimal(raw.guideId)) : undefined;
  if (existing) {
    if (!canReadTarget(ctx.db, ctx.sender, 'guide', existing.id) || withdrawn(ctx.db, 'guide', existing.id)) fail('unavailable', 'La guía ya no está disponible.');
    if (existing.subjectId !== subjectId || existing.termId !== termId) fail('conflict', 'La materia y el parcial deben coincidir con el borrador.');
    expectVersion(existing.version, version(raw.expectedVersion)); captureGuide(ctx, existing.id);
  }
  const sections = result.sections.map((section) => section.content);
  const guide = existing ? { ...existing, title: result.title, topics: input.topics, sections, version: existing.version + 1, updatedBy: ctx.sender, updatedAt: ctx.timestamp }
    : ctx.db.studyGuide.insert({ id: 0n, subjectId, termId, title: result.title, topics: input.topics, sections, version: 1,
      createdBy: ctx.sender, createdAt: ctx.timestamp, updatedBy: ctx.sender, updatedAt: ctx.timestamp });
  if (existing) { ctx.db.studyGuide.id.update(guide); for (const source of ctx.db.guideSource.guideId.filter(guide.id)) ctx.db.guideSource.id.delete(source.id); }
  const cited = new Set(result.sections.flatMap((section) => section.citations));
  const grouped = new Map<string, { kind: string; refId: bigint; version: number; used: boolean; topics: Set<string> }>();
  const sourceKindMap: Record<string, string> = { assignment: 'tarea', work: 'trabajo', activity: 'actividad', note: 'nota', question: 'pregunta', evidence: 'actividad' };
  for (const source of draft.preparation.sources) {
    const refId = source.kind === 'evidence' ? ctx.db.evidence.id.find(decimal(source.refId))!.activityId : decimal(source.refId);
    const kind = sourceKindMap[source.kind]; const key = `${kind}:${refId}`;
    const used = source.fragmentIds.some((fragment) => cited.has(fragment));
    const prior = grouped.get(key);
    if (prior) { prior.used ||= used; for (const topic of source.topics) prior.topics.add(topic); }
    else grouped.set(key, { kind, refId, version: source.kind === 'evidence' ? ctx.db.activity.id.find(refId)!.version : source.version, used, topics: new Set(source.topics) });
  }
  for (const source of grouped.values()) {
    ctx.db.guideSource.insert({ id: 0n, guideId: guide.id, kind: source.kind, refId: source.refId,
      sourceVersion: source.version,
      status: source.used ? 'processed' : 'pending', reason: source.used ? '' : 'Preparada, pero no citada en esta versión.', topics: [...source.topics],
      addedBy: ctx.sender, addedAt: ctx.timestamp });
  }
  ctx.db.guideAiProvenance.insert({ key: `${guide.id}:${guide.version}`, guideId: guide.id, guideVersion: guide.version,
    json: JSON.stringify({ purpose: 'study_guide', model: draft.generationModel ?? draft.preparation.model, editedAfterGeneration: draft.editedAfterGeneration === true, preparationFingerprint: draft.preparation.fingerprint,
      sources: draft.preparation.sources, fragments: draft.preparation.fragments.filter((fragment) => cited.has(fragment.id)),
      citations: result.sections, generatedAt: Math.max(draft.createdAt, ...draft.steps.filter((step) => step.kind !== 'summary' && step.state === 'succeeded').map((step) => step.finishedAt ?? draft.createdAt)) }) });
  captureGuide(ctx, guide.id, ctx.sender); log(ctx, existing ? 'update' : 'create', 'study_guide', guide.id);
  return saveDraft(ctx, { ...draft, state: 'published', publishedGuideId: String(guide.id), publishedGuideVersion: guide.version, publicationRequestId: requestId });
}

function publicSourceState(db: ViewDb, sender: Identity, kind: string, refId: string): { version: number; subjectId: string; termId?: string } | undefined {
  const target = BigInt(refId);
  if (!isActive(db, sender) || !canReadTarget(db, sender, kind, target) || withdrawn(db, kind, target)) return undefined;
  if (kind === 'note') {
    const row = db.note.id.find(target); if (row?.visibility !== 'group') return undefined;
    return { version: row.version, subjectId: String(row.subjectId), termId: db.noteDetail.noteId.find(target)?.termId?.toString() };
  }
  if (kind === 'assignment') {
    const row = db.assignment.id.find(target)!; return { version: row.version, subjectId: String(row.subjectId), termId: row.termId?.toString() };
  }
  if (kind === 'activity') {
    const row = db.activity.id.find(target)!; return { version: row.version, subjectId: String(row.subjectId), termId: row.termId?.toString() };
  }
  if (kind === 'work') {
    const row = db.work.id.find(target)!; const parent = publicSourceState(db, sender, 'assignment', String(row.assignmentId));
    return parent ? { ...parent, version: row.version } : undefined;
  }
  if (kind === 'evidence') {
    const row = db.evidence.id.find(target)!; const parent = publicSourceState(db, sender, 'activity', String(row.activityId));
    return parent ? { ...parent, version: db.evidenceDetail.evidenceId.find(target)?.version ?? 1 } : undefined;
  }
  if (kind === 'question') {
    const row = db.question.id.find(target)!; return { version: db.resourceVersion.key.find(`question:${target}`)?.version ?? 1, subjectId: String(row.subjectId) };
  }
  return undefined;
}
function availableOrigin(db: ViewDb, sender: Identity, origin: GuideAiFragment['origins'][number]) {
  const current = publicSourceState(db, sender, origin.kind, origin.refId); if (!current) return undefined;
  const answer = origin.kind === 'question' ? /^respuesta:([1-9][0-9]*):v([1-9][0-9]*)$/.exec(origin.field) : null;
  if (answer && (!canReadTarget(db, sender, 'answer', BigInt(answer[1])) || withdrawn(db, 'answer', BigInt(answer[1])))) return undefined;
  if (origin.fileId) {
    const file = db.resourceFile.id.find(origin.fileId);
    if (!file || file.targetKind !== origin.kind || String(file.targetId) !== origin.refId) return undefined;
    if (file.removedAt !== undefined) {
      const historical = file.targetKind === 'evidence' || (file.targetKind === 'note'
        ? [...db.noteVersion.noteId.filter(file.targetId)].some((version) => version.attachmentIds.includes(file.id))
        : file.targetKind === 'work' ? [...db.workRevision.workId.filter(file.targetId)].some((version) => version.attachmentIds.includes(file.id))
          : (file.targetKind === 'assignment' || file.targetKind === 'activity') && [...db.pageSnapshot.pageId.filter(file.targetId)].some((version) => version.page === file.targetKind && version.attachmentIds.includes(file.id)));
      if (!historical) return undefined;
    }
  }
  return { ...current, outdated: current.version !== origin.version || !!(answer && (db.resourceVersion.key.find(`answer:${answer[1]}`)?.version ?? 1) !== Number(answer[2])) };
}
function originBelongsToSource(db: ViewDb, origin: GuideAiFragment['origins'][number], source: GuideAiDraft['preparation']['sources'][number]) {
  return origin.kind === source.kind && origin.refId === source.refId || source.kind === 'activity' && origin.kind === 'evidence' && db.evidence.id.find(BigInt(origin.refId))?.activityId === BigInt(source.refId);
}
function inGuideScope(current: { subjectId: string; termId?: string }, scope: { subjectId: string; termId?: string }) {
  return current.subjectId === scope.subjectId && !(scope.termId && current.termId && current.termId !== scope.termId);
}
function readableProvenance(ctx: Ctx, json: string, scope: { subjectId: string; termId?: string }): unknown {
  const provenance = record(JSON.parse(json));
  const sources = provenance.sources as GuideAiDraft['preparation']['sources'];
  const fragments = provenance.fragments as GuideAiFragment[];
  if (!Array.isArray(sources) || !Array.isArray(fragments)) fail('invalid', 'La procedencia histórica no es válida.');
  const availableOrigins = new Map<string, GuideAiFragment['origins']>();
  for (const fragment of fragments) {
    availableOrigins.set(fragment.id, fragment.origins.filter((origin) => {
      const current = availableOrigin(ctx.db, ctx.sender, origin); return !!current && inGuideScope(current, scope);
    }));
  }
  const currentSources = sources.map((source) => {
    const current = publicSourceState(ctx.db, ctx.sender, source.kind, source.refId);
    const available = !!current && inGuideScope(current, scope);
    const availableFragmentIds = available ? source.fragmentIds.filter((fragmentId) => availableOrigins.get(fragmentId)?.some((origin) => originBelongsToSource(ctx.db, origin, source))) : [];
    return { ...source, ...(!available ? { title: 'Fuente no disponible' } : {}), available, availableFragmentIds };
  });
  const unavailableFragmentIds = fragments.filter((fragment) => !availableOrigins.get(fragment.id)?.length).map((fragment) => fragment.id);
  return { ...provenance, sources: currentSources, unavailableFragmentIds,
    fragments: fragments.map((fragment) => {
      const origins = availableOrigins.get(fragment.id) ?? [];
      return { ...fragment, text: origins.length ? fragment.text : '[Fuente no disponible]', origins, available: origins.length > 0 };
    }) };
}

/** Read-only metadata for current public coverage; it never returns prepared text or private draft IDs. */
export function guideAiSourceAvailability(db: ViewDb, sender: Identity): { sourceId: bigint; guideId: bigint; guideVersion: number; available: boolean; outdated: boolean; reason: string }[] {
  if (!isActive(db, sender)) return [];
  const rows: { sourceId: bigint; guideId: bigint; guideVersion: number; available: boolean; outdated: boolean; reason: string }[] = [];
  const map: Record<string, string> = { assignment: 'tarea', activity: 'actividad', work: 'trabajo', note: 'nota', question: 'pregunta', evidence: 'actividad' };
  for (const guide of db.studyGuide.iter()) {
    if (!canReadTarget(db, sender, 'guide', guide.id) || withdrawn(db, 'guide', guide.id)) continue;
    const stored = db.guideAiProvenance.key.find(`${guide.id}:${guide.version}`); if (!stored) continue;
    const scope = { subjectId: String(guide.subjectId), termId: guide.termId?.toString() };
    const provenance = JSON.parse(stored.json) as { sources: GuideAiDraft['preparation']['sources']; fragments: GuideAiFragment[] };
    for (const source of db.guideSource.guideId.filter(guide.id)) {
      const matching = provenance.sources.filter((prepared) => {
        const refId = prepared.kind === 'evidence' ? db.evidence.id.find(BigInt(prepared.refId))?.activityId?.toString() : prepared.refId;
        return map[prepared.kind] === source.kind && refId === String(source.refId);
      });
      if (!matching.length) continue;
      let available = false; let outdated = false;
      for (const prepared of matching) {
        const current = publicSourceState(db, sender, prepared.kind, prepared.refId);
        if (!current || !inGuideScope(current, scope)) continue;
        for (const fragment of provenance.fragments) {
          if (!prepared.fragmentIds.includes(fragment.id)) continue;
          for (const origin of fragment.origins) {
            if (!originBelongsToSource(db, origin, prepared)) continue;
            const state = availableOrigin(db, sender, origin);
            if (state && inGuideScope(state, scope)) {
              available = true; outdated ||= state.outdated || current.version !== prepared.version
                || current.subjectId !== prepared.subjectId || current.termId !== prepared.termId;
            }
          }
        }
      }
      rows.push({ sourceId: source.id, guideId: guide.id, guideVersion: guide.version, available, outdated,
        reason: available ? '' : 'La procedencia citada ya no está disponible para el grupo.' });
    }
  }
  return rows;
}

function guideAiDispatch(ctx: Ctx, payload: string): string {
  if (new TextEncoder().encode(payload).length > 2 * 1024 * 1024) fail('invalid', 'La solicitud excede el límite.');
  let raw: Record<string, unknown>;
  try { raw = record(JSON.parse(payload)); } catch (error) { if (error instanceof SenderError) throw error; return fail('invalid', 'JSON inválido.'); }
  if (raw.action === 'saveTranscription') return JSON.stringify(saveGuideTranscription(ctx, raw));
  if (raw.action === 'getTranscription') { activeMember(ctx); return JSON.stringify(getGuideTranscription(ctx, string(raw.id, 'La transcripción'))); }
  if (raw.action === 'fileInfo') return JSON.stringify(fileInfo(ctx, raw));
  if (raw.action === 'prepare') return JSON.stringify(prepareGuideAi(ctx, raw));
  if (raw.action === 'reprepareDraft') return JSON.stringify(reprepareGuideAiDraft(ctx, raw));
  if (raw.action === 'authorizeStep') return JSON.stringify(authorizeGuideStep(ctx, raw));
  if (raw.action === 'claimStep') return JSON.stringify(claimGuideStep(ctx, raw));
  if (raw.action === 'finishStep') return JSON.stringify(finishGuideStep(ctx, raw));
  if (raw.action === 'publish') return JSON.stringify(publishGuideAi(ctx, raw));
  if (raw.action === 'listDrafts') {
    activeMember(ctx); expireGuideSteps(ctx, ctx.sender); return JSON.stringify([...ctx.db.guideAiDraft.actor.filter(ctx.sender)].map((row) => summary(draftValue(row))));
  }
  if (raw.action === 'getDraft') { activeMember(ctx); expireGuideSteps(ctx, ctx.sender); const row = ownedDraft(ctx, raw.id); const draft = draftValue(row); validDraftSources(ctx, draft, ctx.sender, false); return JSON.stringify(draft); }
  if (raw.action === 'saveDraft') {
    const row = ownedDraft(ctx, raw.id); const draft = draftValue(row); expectVersion(draft.revision, version(raw.expectedRevision));
    if (!draft.result || draft.state !== 'ready') fail('conflict', 'Solo se edita un borrador terminado y privado.');
    validDraftSources(ctx, draft, ctx.sender, false); const result = validateGuideAiResult(raw.result, draft.preparation);
    return JSON.stringify(saveDraft(ctx, { ...draft, result, title: result.title, needsCitationReview: false, editedAfterGeneration: true }));
  }
  if (raw.action === 'cancelDraft') {
    const row = ownedDraft(ctx, raw.id); const draft = draftValue(row); expectVersion(draft.revision, version(raw.expectedRevision));
    if (draft.state === 'published') fail('conflict', 'Una guía publicada ya no es un borrador.');
    for (const step of draft.steps) if (step.state === 'pending' || step.state === 'failed' || step.state === 'unknown') step.state = 'cancelled';
    const cancelled = saveDraft(ctx, { ...draft, state: 'cancelled' });
    try { validDraftSources(ctx, cancelled, ctx.sender, false); return JSON.stringify(cancelled); }
    catch (error) {
      if (!(error instanceof SenderError)) throw error;
      // Cancellation remains possible after access loss. Redaction changes only the reply,
      // keeping the private persisted record intact for audit and any in-flight completion.
      return JSON.stringify({ ...cancelled, result: undefined,
        preparation: { ...cancelled.preparation, fragments: [], omissions: [], input: { ...cancelled.preparation.input, sources: [] },
          sources: cancelled.preparation.sources.map((source) => ({ ...source, title: 'Fuente no disponible', status: 'pending', reason: 'La fuente no está disponible.', fragmentIds: [] })) },
        steps: cancelled.steps.map((step) => ({ ...step, result: undefined, error: undefined })) });
    }
  }
  if (raw.action === 'getProvenance') {
    activeMember(ctx); const guideId = decimal(raw.guideId); const guideVersion = version(raw.version);
    if (!canReadTarget(ctx.db, ctx.sender, 'guide', guideId) || withdrawn(ctx.db, 'guide', guideId)) fail('unavailable', 'La guía no está disponible.');
    const stored = ctx.db.guideAiProvenance.key.find(`${guideId}:${guideVersion}`);
    const guide = [...ctx.db.guideVersion.guideId.filter(guideId)].find((row) => row.version === guideVersion) ?? requireGuide(ctx, guideId);
    return stored ? JSON.stringify(readableProvenance(ctx, stored.json, { subjectId: String(guide.subjectId), termId: guide.termId?.toString() })) : 'null';
  }
  return fail('invalid', 'Operación de Guías no admitida.');
}

export function guideAiResponse(ctx: Ctx, payload: string): string {
  try { return guideAiDispatch(ctx, payload); }
  catch (error) {
    if (error instanceof SenderError) throw error;
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') return fail(error.code, error.message);
    throw error;
  }
}
