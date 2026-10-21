import { SenderError } from 'spacetimedb/server';
import { activeMember, attachmentIds, expectVersion, log, requireGuide, requireSubject, requireText, restoreAttachments, sourceVersion, type Ctx } from './moduleContext';
import { canReadTarget, captureGuide, captureNote, withdrawn } from './delivery2Handlers';

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
    || questionIds.some((id) => ctx.db.question.id.find(id)?.subjectId !== input.subjectId || !canReadTarget(ctx.db, ctx.sender, 'question', id) || withdrawn(ctx.db, 'question', id))) throw new SenderError('Los vínculos deben estar disponibles y pertenecer a esta materia.');
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
  if (!note || !canReadTarget(ctx.db, ctx.sender, 'note', id) || withdrawn(ctx.db, 'note', id)) throw new SenderError('La nota no existe o no está disponible.');
  if (!note.author.isEqual(ctx.sender)) throw new SenderError('Solo su autor edita esta nota; los demás pueden proponer cambios en comentarios.');
  return note;
}
export function saveNoteV2(ctx: Ctx, input: SaveNoteV2Input) {
  activeMember(ctx); const checked = checkNoteFields(ctx, input);
  if (input.noteId === undefined) {
    const note = ctx.db.note.insert({ id: 0n, ...checked.fields, author: ctx.sender, version: 1, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
    ctx.db.noteDetail.insert({ noteId: note.id, ...checked.detail, publishedFromId: undefined, publishedFromVersion: undefined });
    captureNote(ctx, note.id, ctx.sender); log(ctx, 'create', 'note', note.id); return;
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
  captureNote(ctx, note.id, ctx.sender); log(ctx, 'update', 'note', note.id);
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
    ctx.db.resourceFile.insert({ ...file, id, targetId: published.id, removedAt: undefined, uploadedBy: ctx.sender, createdAt: ctx.timestamp });
    copied.set(file.id, id);
  }
  const body = published.body.replace(/\(resource:([a-zA-Z0-9_-]+)\)/g, (original, id: string) => copied.has(id) ? `(resource:${copied.get(id)})` : original);
  if (body !== published.body) ctx.db.note.id.update({ ...published, body });
  ctx.db.noteDetail.insert({ noteId: published.id, termId: detail?.termId, session: detail?.session ?? '', assignmentIds: detail?.assignmentIds ?? [],
    activityIds: detail?.activityIds ?? [], questionIds: detail?.questionIds ?? [], publishedFromId: note.id, publishedFromVersion: note.version });
  captureNote(ctx, published.id, ctx.sender); log(ctx, 'publicar versión', 'note', published.id);
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
  captureNote(ctx, note.id, ctx.sender, input.version); log(ctx, 'restaurar versión', 'note', note.id);
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
    sourceVersion(ctx, source.kind, source.refId, guide.subjectId);
    const kind = ({ trabajo: 'work', tarea: 'assignment', actividad: 'activity', nota: 'note', pregunta: 'question' } as Record<string, string>)[source.kind];
    if (!kind || !canReadTarget(ctx.db, ctx.sender, kind, source.refId) || withdrawn(ctx.db, kind, source.refId)) throw new SenderError('Una fuente de esta versión ya no está disponible.');
  }
  captureGuide(ctx, guide.id); restoreAttachments(ctx, 'guide', guide.id, previous.attachmentIds);
  for (const row of ctx.db.guideSource.guideId.filter(guide.id)) ctx.db.guideSource.id.delete(row.id);
  for (const source of previous.sources) ctx.db.guideSource.insert({ id: 0n, guideId: guide.id, ...source, addedBy: source.addedBy ?? ctx.sender, addedAt: source.addedAt ?? ctx.timestamp });
  ctx.db.studyGuide.id.update({ ...guide, termId: previous.termId, title: previous.title, topics: previous.topics, sections: previous.sections,
    version: guide.version + 1, updatedBy: ctx.sender, updatedAt: ctx.timestamp });
  captureGuide(ctx, guide.id, ctx.sender, input.version); log(ctx, 'restaurar versión', 'guide', guide.id);
}

export function commentQuestion(ctx: Ctx, input: { questionId: bigint; answerId?: bigint; text: string }) {
  activeMember(ctx);
  if (!canReadTarget(ctx.db, ctx.sender, 'question', input.questionId) || withdrawn(ctx.db, 'question', input.questionId)) throw new SenderError('La pregunta no está disponible.');
  if (input.answerId !== undefined && (ctx.db.answer.id.find(input.answerId)?.questionId !== input.questionId || !canReadTarget(ctx.db, ctx.sender, 'answer', input.answerId) || withdrawn(ctx.db, 'answer', input.answerId))) throw new SenderError('La respuesta no pertenece a esta pregunta o no está disponible.');
  ctx.db.questionComment.insert({ id: 0n, questionId: input.questionId, answerId: input.answerId, author: ctx.sender,
    text: requireText(input.text, 'La aclaración', 2000), createdAt: ctx.timestamp });
}
export function toggleAnswerUsefulness(ctx: Ctx, input: { answerId: bigint }) {
  activeMember(ctx); const answer = ctx.db.answer.id.find(input.answerId);
  if (!answer || !canReadTarget(ctx.db, ctx.sender, 'answer', answer.id) || withdrawn(ctx.db, 'answer', answer.id)) throw new SenderError('La respuesta no está disponible.');
  if (answer.author.isEqual(ctx.sender)) throw new SenderError('No puedes marcar tu propia respuesta como útil.');
  const key = `${answer.id}:${ctx.sender.toHexString()}`;
  if (ctx.db.answerUsefulness.key.find(key)) ctx.db.answerUsefulness.key.delete(key);
  else ctx.db.answerUsefulness.insert({ key, answerId: answer.id, memberId: ctx.sender, createdAt: ctx.timestamp });
}
export function saveQuestionLinks(ctx: Ctx, input: { questionId: bigint; noteIds: bigint[]; guideIds: bigint[] }) {
  activeMember(ctx); const question = ctx.db.question.id.find(input.questionId);
  if (!question || !canReadTarget(ctx.db, ctx.sender, 'question', question.id) || withdrawn(ctx.db, 'question', question.id)) throw new SenderError('La pregunta no está disponible.');
  const noteIds = [...new Set(input.noteIds)]; const guideIds = [...new Set(input.guideIds)];
  if (noteIds.length + guideIds.length > 50) throw new SenderError('Selecciona hasta 50 materiales relacionados.');
  if (noteIds.some((id) => { const note = ctx.db.note.id.find(id); return !note || note.visibility !== 'group' || note.subjectId !== question.subjectId || withdrawn(ctx.db, 'note', id); })
    || guideIds.some((id) => ctx.db.studyGuide.id.find(id)?.subjectId !== question.subjectId || withdrawn(ctx.db, 'guide', id))) throw new SenderError('Enlaza solo material compartido disponible de esta materia.');
  for (const link of ctx.db.questionLink.questionId.filter(question.id)) ctx.db.questionLink.id.delete(link.id);
  for (const targetId of noteIds) ctx.db.questionLink.insert({ id: 0n, questionId: question.id, targetKind: 'note', targetId, addedBy: ctx.sender, createdAt: ctx.timestamp });
  for (const targetId of guideIds) ctx.db.questionLink.insert({ id: 0n, questionId: question.id, targetKind: 'guide', targetId, addedBy: ctx.sender, createdAt: ctx.timestamp });
}
