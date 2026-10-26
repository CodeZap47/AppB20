import { memberIdentityFor } from './authIdentity';
import { SenderError } from 'spacetimedb/server';
import { activeMember, attachmentIds, expectVersion, log, requireGuide, requireSubject, requireText, restoreAttachments, sourceVersion, type Ctx } from './moduleContext';
import { bumpExtra, canReadTarget, captureGuide, captureNote, withdrawn, withdrawnIncludingParent } from './delivery2Handlers';

/** Manual selection is explicit; an unplaced source is allowed, a different parcial is not. */
export function validateGuideSourceClassification(ctx: Ctx, kind: string, refId: bigint, subjectId: bigint, termId?: bigint, includeUnplaced = true) {
  sourceVersion(ctx, kind, refId, subjectId);
  let sourceTerm: bigint | undefined;
  if (kind === 'trabajo') {
    const work = ctx.db.work.id.find(refId)!; const parent = ctx.db.assignment.id.find(work.assignmentId);
    if (!parent || withdrawn(ctx.db, 'assignment', parent.id)) throw new SenderError('La consigna de esta fuente ya no está disponible.');
    sourceTerm = parent.termId;
  } else if (kind === 'tarea') sourceTerm = ctx.db.assignment.id.find(refId)?.termId;
  else if (kind === 'actividad') sourceTerm = ctx.db.activity.id.find(refId)?.termId;
  else if (kind === 'nota') sourceTerm = ctx.db.noteDetail.noteId.find(refId)?.termId;
  // Questions currently have no parcial field and therefore require explicit selection in IA.
  if (termId !== undefined && sourceTerm !== undefined && sourceTerm !== termId) throw new SenderError('Las fuentes deben pertenecer al parcial de la guía.');
  if (sourceTerm === undefined && !includeUnplaced) throw new SenderError('Confirma la selección de material sin parcial.');
}

function mutableGuide(ctx: Ctx, guideId: bigint, expectedVersion: number) {
  activeMember(ctx); const guide = requireGuide(ctx, guideId);
  if (withdrawn(ctx.db, 'guide', guideId)) throw new SenderError('La guía está retirada.');
  expectVersion(guide.version, expectedVersion); return guide;
}
function mutableSource(ctx: Ctx, sourceId: bigint, expectedVersion: number) {
  activeMember(ctx); const source = ctx.db.guideSource.id.find(sourceId);
  if (!source) throw new SenderError('La fuente no existe.');
  return { source, guide: mutableGuide(ctx, source.guideId, expectedVersion) };
}
export function addGuideSourcesV3(ctx: Ctx, input: { guideId: bigint; expectedVersion: number; sources: { kind: string; refId: bigint }[] }) {
  const guide = mutableGuide(ctx, input.guideId, input.expectedVersion);
  if (input.sources.length > 100) throw new SenderError('Selecciona hasta 100 fuentes por operación.');
  const refs = input.sources.map((ref) => { validateGuideSourceClassification(ctx, ref.kind, ref.refId, guide.subjectId, guide.termId); return { ...ref, version: sourceVersion(ctx, ref.kind, ref.refId, guide.subjectId) }; });
  captureGuide(ctx, guide.id); let changed = false;
  for (const ref of refs) {
    if ([...ctx.db.guideSource.guideId.filter(guide.id)].some((row) => row.kind === ref.kind && row.refId === ref.refId)) continue;
    ctx.db.guideSource.insert({ id: 0n, guideId: guide.id, kind: ref.kind, refId: ref.refId, sourceVersion: ref.version,
      status: 'pending', reason: 'Falta revisarla.', topics: [], addedBy: memberIdentityFor(ctx), addedAt: ctx.timestamp }); changed = true;
  }
  if (changed) { bumpExtra(ctx, 'guide', guide.id); log(ctx, 'update', 'study_guide', guide.id); }
}
export function updateGuideSourceV3(ctx: Ctx, input: { sourceId: bigint; expectedVersion: number; status: string; reason: string; topics: string[] }) {
  const { source, guide } = mutableSource(ctx, input.sourceId, input.expectedVersion);
  if (!['pending', 'processed'].includes(input.status)) throw new SenderError('Estado de fuente inválido.');
  const reason = input.reason.trim();
  if (reason.length > 200 || (input.status === 'pending' && !reason)) throw new SenderError('Indica una razón de hasta 200 caracteres.');
  if (input.topics.some((topic) => !guide.topics.includes(topic))) throw new SenderError('Un tema no está en el temario de la guía.');
  if (input.status === 'processed') {
    validateGuideSourceClassification(ctx, source.kind, source.refId, guide.subjectId, guide.termId);
    if (source.sourceVersion !== sourceVersion(ctx, source.kind, source.refId, guide.subjectId)) throw new SenderError('La fuente cambió; actualízala y vuelve a procesarla antes de marcarla como utilizada.');
  }
  captureGuide(ctx, guide.id);
  ctx.db.guideSource.id.update({ ...source, status: input.status, reason: input.status === 'pending' ? reason : '', topics: guide.topics.filter((topic) => input.topics.includes(topic)) });
  bumpExtra(ctx, 'guide', guide.id); log(ctx, 'update', 'guide_source', source.id);
}
export function refreshGuideSourceV3(ctx: Ctx, input: { sourceId: bigint; expectedVersion: number }) {
  const { source, guide } = mutableSource(ctx, input.sourceId, input.expectedVersion);
  validateGuideSourceClassification(ctx, source.kind, source.refId, guide.subjectId, guide.termId);
  const version = sourceVersion(ctx, source.kind, source.refId, guide.subjectId);
  captureGuide(ctx, guide.id);
  ctx.db.guideSource.id.update({ ...source, sourceVersion: version, status: 'pending', reason: 'La fuente se actualizó; vuelve a procesarla.' });
  bumpExtra(ctx, 'guide', guide.id); log(ctx, 'update', 'guide_source', source.id);
}
export function removeGuideSourceV3(ctx: Ctx, input: { sourceId: bigint; expectedVersion: number }) {
  const { source, guide } = mutableSource(ctx, input.sourceId, input.expectedVersion);
  captureGuide(ctx, guide.id); ctx.db.guideSource.id.delete(source.id); bumpExtra(ctx, 'guide', guide.id); log(ctx, 'delete', 'guide_source', source.id);
}
export function reviewGuideV3(ctx: Ctx, input: { guideId: bigint; expectedVersion: number; verdict: string; comment: string }) {
  const guide = mutableGuide(ctx, input.guideId, input.expectedVersion);
  if (guide.updatedBy.isEqual(memberIdentityFor(ctx))) throw new SenderError('Guardaste esta versión; la revisa otro compañero.');
  if (!['approved', 'changes'].includes(input.verdict)) throw new SenderError('Resultado de revisión inválido.');
  const comment = input.comment.trim();
  if (!comment || comment.length > 2000) throw new SenderError('Escribe un comentario de revisión de hasta 2000 caracteres.');
  if ([...ctx.db.guideReview.guideId.filter(guide.id)].some((row) => row.guideVersion === guide.version && row.reviewer.isEqual(memberIdentityFor(ctx)))) throw new SenderError('Ya revisaste esta versión. Una revisión no se sobrescribe.');
  ctx.db.guideReview.insert({ id: 0n, guideId: guide.id, guideVersion: guide.version, reviewer: memberIdentityFor(ctx), verdict: input.verdict, comment, createdAt: ctx.timestamp });
  log(ctx, 'review', 'study_guide', guide.id);
}

export interface SaveNoteV2Input {
  noteId?: bigint; expectedVersion?: number; subjectId: bigint; termId?: bigint; session: string;
  topic: string; title: string; body: string; tags: string[]; visibility: string; source: string;
  assignmentIds: bigint[]; activityIds: bigint[]; questionIds: bigint[];
}
function optionalText(value: string, field: string, max: number) {
  const clean = value.trim();
  if (clean.length > max) throw new SenderError(`${field} excede ${max} caracteres.`);
  return clean;
}
function checkNoteFields(ctx: Ctx, input: SaveNoteV2Input) {
  requireSubject(ctx, input.subjectId);
  if (input.termId !== undefined && ctx.db.term.id.find(input.termId)?.subjectId !== input.subjectId) throw new SenderError('El parcial no pertenece a esta materia.');
  const session = input.session.trim();
  if (session && (!/^\d{4}-\d{2}-\d{2}$/.test(session) || !Number.isFinite(Date.parse(`${session}T12:00:00Z`)) || new Date(`${session}T12:00:00Z`).toISOString().slice(0, 10) !== session)) throw new SenderError('Escribe una fecha de sesión válida.');
  if (!['personal', 'group'].includes(input.visibility)) throw new SenderError('Visibilidad inválida.');
  if (!['student', 'teacher', 'ai'].includes(input.source)) throw new SenderError('Origen inválido.');
  const assignmentIds = [...new Set(input.assignmentIds)]; const activityIds = [...new Set(input.activityIds)]; const questionIds = [...new Set(input.questionIds)];
  if ([assignmentIds, activityIds, questionIds].some((ids) => ids.length > 50)) throw new SenderError('Selecciona hasta 50 vínculos de cada tipo.');
  if (assignmentIds.some((id) => ctx.db.assignment.id.find(id)?.subjectId !== input.subjectId)
    || activityIds.some((id) => ctx.db.activity.id.find(id)?.subjectId !== input.subjectId)
    || questionIds.some((id) => ctx.db.question.id.find(id)?.subjectId !== input.subjectId || !canReadTarget(ctx.db, memberIdentityFor(ctx), 'question', id) || withdrawn(ctx.db, 'question', id))) throw new SenderError('Los vínculos deben estar disponibles y pertenecer a esta materia.');
  const tags = [...new Set(input.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  if (tags.length > 30 || tags.some((tag) => tag.length > 60)) throw new SenderError('Usa hasta 30 etiquetas de 60 caracteres.');
  return {
    fields: { subjectId: input.subjectId, topic: optionalText(input.topic, 'El tema', 120), title: requireText(input.title, 'El título', 200),
      body: requireText(input.body, 'El contenido', 50_000), tags, visibility: input.visibility, source: input.source },
    detail: { termId: input.termId, session, assignmentIds, activityIds, questionIds },
  };
}
function ownNote(ctx: Ctx, id: bigint) {
  activeMember(ctx);
  const note = ctx.db.note.id.find(id);
  if (!note || !canReadTarget(ctx.db, memberIdentityFor(ctx), 'note', id) || withdrawn(ctx.db, 'note', id)) throw new SenderError('La nota no existe o no está disponible.');
  if (!note.author.isEqual(memberIdentityFor(ctx))) throw new SenderError('Solo su autor edita esta nota; los demás pueden proponer cambios en comentarios.');
  return note;
}
export function saveNoteV2(ctx: Ctx, input: SaveNoteV2Input) {
  activeMember(ctx); const checked = checkNoteFields(ctx, input);
  if (input.noteId === undefined) {
    const note = ctx.db.note.insert({ id: 0n, ...checked.fields, author: memberIdentityFor(ctx), version: 1, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
    ctx.db.noteDetail.insert({ noteId: note.id, ...checked.detail, publishedFromId: undefined, publishedFromVersion: undefined });
    captureNote(ctx, note.id, memberIdentityFor(ctx)); log(ctx, 'create', 'note', note.id); return;
  }
  const note = ownNote(ctx, input.noteId);
  if (input.expectedVersion === undefined) throw new SenderError('Indica la versión que estás editando.');
  expectVersion(note.version, input.expectedVersion);
  if (note.visibility !== checked.fields.visibility) throw new SenderError('La visibilidad del historial se conserva. Publica una copia de la versión personal para compartirla.');
  captureNote(ctx, note.id, note.version === 1 ? note.author : undefined);
  const prior = ctx.db.noteDetail.noteId.find(note.id);
  const detail = { noteId: note.id, ...checked.detail, publishedFromId: prior?.publishedFromId, publishedFromVersion: prior?.publishedFromVersion };
  if (prior) ctx.db.noteDetail.noteId.update(detail); else ctx.db.noteDetail.insert(detail);
  ctx.db.note.id.update({ ...note, ...checked.fields, version: note.version + 1, updatedAt: ctx.timestamp });
  captureNote(ctx, note.id, memberIdentityFor(ctx)); log(ctx, 'update', 'note', note.id);
}

/** Publica referencias independientes; nunca abre el borrador ni sus futuras versiones. */
export function publishNoteVersion(ctx: Ctx, input: { noteId: bigint; expectedVersion: number }) {
  const note = ownNote(ctx, input.noteId); expectVersion(note.version, input.expectedVersion);
  if (note.visibility !== 'personal') throw new SenderError('Esta nota ya está compartida.');
  const existing = [...ctx.db.noteDetail.iter()].find((row) => row.publishedFromId === note.id && row.publishedFromVersion === note.version);
  if (existing) return;
  const detail = ctx.db.noteDetail.noteId.find(note.id);
  const published = ctx.db.note.insert({ ...note, id: 0n, visibility: 'group', version: 1, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
  const copied = new Map<string, string>();
  for (const fileId of attachmentIds(ctx, 'note', note.id)) {
    const file = ctx.db.resourceFile.id.find(fileId)!;
    const id = `published-${published.id}-${file.id}`;
    ctx.db.resourceFile.insert({ ...file, id, targetId: published.id, removedAt: undefined, uploadedBy: memberIdentityFor(ctx), createdAt: ctx.timestamp });
    copied.set(file.id, id);
  }
  const body = published.body.replace(/\(resource:([a-zA-Z0-9_-]+)\)/g, (original, id: string) => copied.has(id) ? `(resource:${copied.get(id)})` : original);
  if (body !== published.body) ctx.db.note.id.update({ ...published, body });
  ctx.db.noteDetail.insert({ noteId: published.id, termId: detail?.termId, session: detail?.session ?? '', assignmentIds: detail?.assignmentIds ?? [],
    activityIds: detail?.activityIds ?? [], questionIds: detail?.questionIds ?? [], publishedFromId: note.id, publishedFromVersion: note.version });
  captureNote(ctx, published.id, memberIdentityFor(ctx)); log(ctx, 'publicar versión', 'note', published.id);
}

export function restoreNoteVersion(ctx: Ctx, input: { noteId: bigint; version: number; expectedVersion: number }) {
  const note = ownNote(ctx, input.noteId); expectVersion(note.version, input.expectedVersion);
  const previous = [...ctx.db.noteVersion.noteId.filter(note.id)].find((row) => row.version === input.version);
  if (!previous) throw new SenderError('La versión no existe.');
  if (previous.visibility !== note.visibility) throw new SenderError('Esta versión tiene una visibilidad diferente y no se puede publicar mediante una restauración.');
  const checked = checkNoteFields(ctx, { ...previous, noteId: note.id });
  captureNote(ctx, note.id, note.version === 1 ? note.author : undefined);
  restoreAttachments(ctx, 'note', note.id, previous.attachmentIds);
  const prior = ctx.db.noteDetail.noteId.find(note.id);
  const detail = { noteId: note.id, ...checked.detail, publishedFromId: prior?.publishedFromId, publishedFromVersion: prior?.publishedFromVersion };
  if (prior) ctx.db.noteDetail.noteId.update(detail); else ctx.db.noteDetail.insert(detail);
  ctx.db.note.id.update({ ...note, ...checked.fields, version: note.version + 1, updatedAt: ctx.timestamp });
  captureNote(ctx, note.id, memberIdentityFor(ctx), input.version); log(ctx, 'restaurar versión', 'note', note.id);
}

export function restoreGuideVersion(ctx: Ctx, input: { guideId: bigint; version: number; expectedVersion: number }) {
  activeMember(ctx); const guide = requireGuide(ctx, input.guideId);
  if (withdrawn(ctx.db, 'guide', guide.id)) throw new SenderError('La guía está retirada.');
  expectVersion(guide.version, input.expectedVersion);
  const previous = [...ctx.db.guideVersion.guideId.filter(guide.id)].find((row) => row.version === input.version);
  if (!previous) throw new SenderError('La versión no existe.');
  if (previous.subjectId !== guide.subjectId) throw new SenderError('La materia de la guía no cambia.');
  if (previous.termId !== undefined && ctx.db.term.id.find(previous.termId)?.subjectId !== guide.subjectId) throw new SenderError('El parcial de esta versión ya no está disponible.');
  for (const source of previous.sources) {
    validateGuideSourceClassification(ctx, source.kind, source.refId, guide.subjectId, previous.termId);
    const kind = ({ trabajo: 'work', tarea: 'assignment', actividad: 'activity', nota: 'note', pregunta: 'question' } as Record<string, string>)[source.kind];
    if (!kind || !canReadTarget(ctx.db, memberIdentityFor(ctx), kind, source.refId) || withdrawn(ctx.db, kind, source.refId)) throw new SenderError('Una fuente de esta versión ya no está disponible.');
  }
  captureGuide(ctx, guide.id); restoreAttachments(ctx, 'guide', guide.id, previous.attachmentIds);
  for (const row of ctx.db.guideSource.guideId.filter(guide.id)) ctx.db.guideSource.id.delete(row.id);
  for (const source of previous.sources) ctx.db.guideSource.insert({ id: 0n, guideId: guide.id, ...source, addedBy: source.addedBy ?? memberIdentityFor(ctx), addedAt: source.addedAt ?? ctx.timestamp });
  ctx.db.studyGuide.id.update({ ...guide, termId: previous.termId, title: previous.title, topics: previous.topics, sections: previous.sections,
    version: guide.version + 1, updatedBy: memberIdentityFor(ctx), updatedAt: ctx.timestamp });
  const provenance = ctx.db.guideAiProvenance.key.find(`${guide.id}:${input.version}`);
  if (provenance) ctx.db.guideAiProvenance.insert({ ...provenance, key: `${guide.id}:${guide.version + 1}`, guideVersion: guide.version + 1 });
  captureGuide(ctx, guide.id, memberIdentityFor(ctx), input.version); log(ctx, 'restaurar versión', 'guide', guide.id);
}

export function commentQuestion(ctx: Ctx, input: { questionId: bigint; answerId?: bigint; text: string }) {
  activeMember(ctx);
  if (!canReadTarget(ctx.db, memberIdentityFor(ctx), 'question', input.questionId) || withdrawn(ctx.db, 'question', input.questionId)) throw new SenderError('La pregunta no está disponible.');
  if (input.answerId !== undefined && (ctx.db.answer.id.find(input.answerId)?.questionId !== input.questionId || !canReadTarget(ctx.db, memberIdentityFor(ctx), 'answer', input.answerId) || withdrawn(ctx.db, 'answer', input.answerId))) throw new SenderError('La respuesta no pertenece a esta pregunta o no está disponible.');
  ctx.db.questionComment.insert({ id: 0n, questionId: input.questionId, answerId: input.answerId, author: memberIdentityFor(ctx),
    text: requireText(input.text, 'La aclaración', 2000), createdAt: ctx.timestamp });
}
export function toggleAnswerUsefulness(ctx: Ctx, input: { answerId: bigint }) {
  activeMember(ctx); const answer = ctx.db.answer.id.find(input.answerId);
  if (!answer || !canReadTarget(ctx.db, memberIdentityFor(ctx), 'answer', answer.id) || withdrawnIncludingParent(ctx.db, 'answer', answer.id)) throw new SenderError('La respuesta no está disponible.');
  if (answer.author.isEqual(memberIdentityFor(ctx))) throw new SenderError('No puedes marcar tu propia respuesta como útil.');
  const key = `${answer.id}:${memberIdentityFor(ctx).toHexString()}`;
  if (ctx.db.answerUsefulness.key.find(key)) ctx.db.answerUsefulness.key.delete(key);
  else ctx.db.answerUsefulness.insert({ key, answerId: answer.id, memberId: memberIdentityFor(ctx), createdAt: ctx.timestamp });
}
export function saveQuestionLinks(ctx: Ctx, input: { questionId: bigint; noteIds: bigint[]; guideIds: bigint[] }) {
  activeMember(ctx); const question = ctx.db.question.id.find(input.questionId);
  if (!question || !canReadTarget(ctx.db, memberIdentityFor(ctx), 'question', question.id) || withdrawn(ctx.db, 'question', question.id)) throw new SenderError('La pregunta no está disponible.');
  const noteIds = [...new Set(input.noteIds)]; const guideIds = [...new Set(input.guideIds)];
  if (noteIds.length + guideIds.length > 50) throw new SenderError('Selecciona hasta 50 materiales relacionados.');
  if (noteIds.some((id) => { const note = ctx.db.note.id.find(id); return !note || note.visibility !== 'group' || note.subjectId !== question.subjectId || withdrawn(ctx.db, 'note', id); })
    || guideIds.some((id) => ctx.db.studyGuide.id.find(id)?.subjectId !== question.subjectId || withdrawn(ctx.db, 'guide', id))) throw new SenderError('Enlaza solo material compartido disponible de esta materia.');
  for (const link of ctx.db.questionLink.questionId.filter(question.id)) ctx.db.questionLink.id.delete(link.id);
  for (const targetId of noteIds) ctx.db.questionLink.insert({ id: 0n, questionId: question.id, targetKind: 'note', targetId, addedBy: memberIdentityFor(ctx), createdAt: ctx.timestamp });
  for (const targetId of guideIds) ctx.db.questionLink.insert({ id: 0n, questionId: question.id, targetKind: 'guide', targetId, addedBy: memberIdentityFor(ctx), createdAt: ctx.timestamp });
}
