import { GUIDE_SECTIONS, isGuideSourceKind } from '@b20/core';
import type { Activity, Answer, Assignment, GuideSource, Id, Member, Note, Question, ResourceFile, ResourceTargetKind, SaveNoteInput, StudyGuide, Subject, Term, Work } from './types';
import type { AnswerUsefulness, GuideVersion, NoteVersion, QuestionComment, QuestionLink } from './knowledgeTypes';

interface KnowledgeState {
  notes: Note[]; guides: StudyGuide[]; guideSources: GuideSource[]; questions: Question[];
  answers: Answer[]; subjects: Subject[]; terms: Term[]; assignments: Assignment[]; activities: Activity[]; works: Work[];
}
interface Context {
  state(): KnowledgeState;
  active(): Member;
  id(): Id;
  now(): Date;
  emit(): void;
  files(): ResourceFile[];
  restoreFiles(kind: ResourceTargetKind, id: Id, ids: Id[]): void;
  copyFiles(fromNoteId: Id, toNoteId: Id): Map<Id, Id>;
}

function text(value: string, field: string, limit: number, required = false) {
  const clean = value.trim();
  if (required && !clean) throw new Error(`${field} no puede estar vacío.`);
  if (clean.length > limit) throw new Error(`${field} excede ${limit} caracteres.`);
  return clean;
}
function version(actual: number, expected?: number) {
  if (expected !== undefined && actual !== expected) throw new Error('Este material cambió. Revisa la versión actual antes de guardar.');
}

/** Reglas locales para la demo; la persistencia real y los permisos viven en SpacetimeDB. */
export class DemoKnowledgeStore {
  private noteHistory: NoteVersion[] = [];
  private guideHistory: GuideVersion[] = [];
  private comments: QuestionComment[] = [];
  private usefulness: AnswerUsefulness[] = [];
  private links: QuestionLink[] = [];
  constructor(private ctx: Context) {}

  private note(id: Id, edit = false) {
    const me = this.ctx.active();
    const note = this.ctx.state().notes.find((item) => item.id === id && (item.visibility === 'group' || item.authorId === me.id));
    if (!note) throw new Error('La nota no existe o no tienes acceso.');
    if (edit && note.authorId !== me.id) throw new Error('Solo su autor edita esta nota; los demás pueden proponer cambios en comentarios.');
    return note;
  }
  private attachments(kind: ResourceTargetKind, id: Id) {
    return this.ctx.files().filter((file) => file.targetKind === kind && file.targetId === id && !file.removedAt).map((file) => file.id);
  }
  private noteSnapshot(note: Note, editedBy?: Id): NoteVersion {
    return { id: `note:${note.id}:${note.version}`, noteId: note.id, version: note.version,
      subjectId: note.subjectId, termId: note.termId, session: note.session,
      topic: note.topic, title: note.title, body: note.body, tags: [...note.tags], visibility: note.visibility,
      source: note.source, authorId: note.authorId, assignmentIds: [...(note.assignmentIds ?? [])],
      activityIds: [...(note.activityIds ?? [])], questionIds: [...(note.questionIds ?? [])],
      attachmentIds: this.attachments('note', note.id), editedBy, editedAt: note.updatedAt };
  }
  captureNote(id: Id, editedBy?: Id) {
    const note = this.note(id);
    if (!this.noteHistory.some((item) => item.noteId === id && item.version === note.version)) this.noteHistory.push(this.noteSnapshot(note, editedBy ?? (note.version === 1 ? note.authorId : undefined)));
  }
  captureGuide(id: Id, editedBy?: Id) {
    this.ctx.active();
    const state = this.ctx.state(); const guide = state.guides.find((item) => item.id === id);
    if (!guide) throw new Error('La guía no existe.');
    if (this.guideHistory.some((item) => item.guideId === id && item.version === guide.version)) return;
    this.guideHistory.push({ id: `guide:${id}:${guide.version}`, guideId: id, version: guide.version,
      subjectId: guide.subjectId, termId: guide.termId, title: guide.title, topics: [...guide.topics], sections: [...guide.sections],
      sources: state.guideSources.filter((source) => source.guideId === id).map(({ kind, refId, sourceVersion, status, reason, topics, addedBy, addedAt }) => ({ kind, refId, sourceVersion, status, reason, topics: [...topics], addedBy, addedAt })),
      attachmentIds: this.attachments('guide', id), editedBy: editedBy ?? guide.updatedBy, editedAt: guide.updatedAt });
  }
  snapshot(viewerId: Id) {
    const state = this.ctx.state();
    const ids = new Set(state.notes.filter((note) => note.visibility === 'group' || note.authorId === viewerId).map((note) => note.id));
    const noteVersions = [...this.noteHistory.filter((item) => ids.has(item.noteId))];
    for (const note of state.notes.filter((item) => ids.has(item.id))) if (!noteVersions.some((item) => item.noteId === note.id && item.version === note.version)) noteVersions.push(this.noteSnapshot(note, note.version === 1 ? note.authorId : undefined));
    const guideVersions = [...this.guideHistory];
    for (const guide of state.guides) if (!guideVersions.some((item) => item.guideId === guide.id && item.version === guide.version)) {
      guideVersions.push({ id: `guide:${guide.id}:${guide.version}`, guideId: guide.id, version: guide.version,
        subjectId: guide.subjectId, termId: guide.termId, title: guide.title, topics: [...guide.topics], sections: [...guide.sections],
        sources: state.guideSources.filter((source) => source.guideId === guide.id).map(({ kind, refId, sourceVersion, status, reason, topics, addedBy, addedAt }) => ({ kind, refId, sourceVersion, status, reason, topics: [...topics], addedBy, addedAt })),
        attachmentIds: this.attachments('guide', guide.id), editedBy: guide.updatedBy, editedAt: guide.updatedAt });
    }
    return { noteVersions, guideVersions, questionComments: this.comments, answerUsefulness: this.usefulness, questionLinks: this.links };
  }

  private fields(input: SaveNoteInput) {
    const state = this.ctx.state();
    if (!state.subjects.some((subject) => subject.id === input.subjectId)) throw new Error('La materia no existe.');
    if (input.termId && !state.terms.some((term) => term.id === input.termId && term.subjectId === input.subjectId)) throw new Error('El parcial no pertenece a esta materia.');
    if (input.session && (!/^\d{4}-\d{2}-\d{2}$/.test(input.session) || !Number.isFinite(Date.parse(`${input.session}T12:00:00Z`)) || new Date(`${input.session}T12:00:00Z`).toISOString().slice(0, 10) !== input.session)) throw new Error('Escribe una fecha de sesión válida.');
    if (!['personal', 'group'].includes(input.visibility) || !['student', 'teacher', 'ai'].includes(input.source)) throw new Error('La visibilidad o el origen no son válidos.');
    const assignments = [...new Set(input.assignmentIds ?? [])]; const activities = [...new Set(input.activityIds ?? [])]; const questions = [...new Set(input.questionIds ?? [])];
    if ([assignments, activities, questions].some((ids) => ids.length > 50)) throw new Error('Selecciona hasta 50 vínculos de cada tipo.');
    if (assignments.some((id) => !state.assignments.some((item) => item.id === id && item.subjectId === input.subjectId)) || activities.some((id) => !state.activities.some((item) => item.id === id && item.subjectId === input.subjectId)) || questions.some((id) => !state.questions.some((item) => item.id === id && item.subjectId === input.subjectId))) throw new Error('Los vínculos deben pertenecer a esta materia.');
    const tags = [...new Set(input.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
    if (tags.length > 30 || tags.some((tag) => tag.length > 60)) throw new Error('Usa hasta 30 etiquetas de 60 caracteres.');
    return { subjectId: input.subjectId, termId: input.termId || undefined, session: input.session || undefined,
      topic: text(input.topic, 'El tema', 120), title: text(input.title, 'El título', 200, true), body: text(input.body, 'El contenido', 50_000, true),
      visibility: input.visibility, source: input.source, tags, assignmentIds: assignments, activityIds: activities, questionIds: questions };
  }
  saveNote(input: SaveNoteInput): Id {
    const me = this.ctx.active(); const fields = this.fields(input); const state = this.ctx.state(); const now = this.ctx.now();
    if (input.id) {
      const current = this.note(input.id, true); version(current.version, input.expectedVersion);
      if (current.visibility !== fields.visibility) throw new Error('Publica una copia desde la nota personal para compartir una versión. La visibilidad del historial se conserva.');
      this.captureNote(current.id);
      state.notes = state.notes.map((note) => note.id === current.id ? { ...note, ...fields, version: note.version + 1, updatedAt: now } : note);
      this.captureNote(current.id, me.id); this.ctx.emit(); return current.id;
    }
    const note: Note = { id: this.ctx.id(), ...fields, authorId: me.id, version: 1, createdAt: now, updatedAt: now };
    state.notes = [...state.notes, note]; this.captureNote(note.id, me.id); this.ctx.emit(); return note.id;
  }
  publishNoteVersion(id: Id, expectedVersion: number): Id {
    const current = this.note(id, true); version(current.version, expectedVersion);
    if (current.visibility !== 'personal') throw new Error('Esta nota ya está compartida.');
    const state = this.ctx.state();
    const prior = state.notes.find((item) => item.publishedFromId === id && item.publishedFromVersion === expectedVersion);
    if (prior) return prior.id;
    const now = this.ctx.now(); const nextId = this.ctx.id();
    const copied = this.ctx.copyFiles(id, nextId);
    const body = current.body.replace(/\(resource:([a-zA-Z0-9_-]+)\)/g, (original, fileId: string) => copied.has(fileId) ? `(resource:${copied.get(fileId)})` : original);
    const next: Note = { ...current, id: nextId, body, version: 1, visibility: 'group', publishedFromId: id,
      publishedFromVersion: expectedVersion, createdAt: now, updatedAt: now };
    state.notes = [...state.notes, next]; this.captureNote(nextId, current.authorId); this.ctx.emit(); return nextId;
  }
  restoreNoteVersion(id: Id, oldVersion: number, expectedVersion: number) {
    const current = this.note(id, true); version(current.version, expectedVersion);
    const previous = this.snapshot(this.ctx.active().id).noteVersions.find((item) => item.noteId === id && item.version === oldVersion);
    if (!previous) throw new Error('La versión no existe.');
    const fields = this.fields({ ...previous, id, visibility: current.visibility });
    this.captureNote(id); this.ctx.restoreFiles('note', id, previous.attachmentIds);
    this.ctx.state().notes = this.ctx.state().notes.map((note) => note.id === id ? { ...note, ...fields, version: current.version + 1, updatedAt: this.ctx.now() } : note);
    this.captureNote(id, this.ctx.active().id);
    const revision = this.noteHistory.find((item) => item.noteId === id && item.version === current.version + 1)!;
    revision.restoredFromVersion = oldVersion; this.ctx.emit();
  }
  restoreGuideVersion(id: Id, oldVersion: number, expectedVersion: number) {
    const me = this.ctx.active(); const state = this.ctx.state(); const current = state.guides.find((guide) => guide.id === id);
    if (!current) throw new Error('La guía no existe.'); version(current.version, expectedVersion);
    const previous = this.snapshot(me.id).guideVersions.find((item) => item.guideId === id && item.version === oldVersion);
    if (!previous) throw new Error('La versión no existe.');
    if (previous.subjectId !== current.subjectId || previous.sections.length !== GUIDE_SECTIONS.length) throw new Error('Esta versión no es compatible con la guía.');
    // Revalida las fuentes actuales antes de cambiar el material compartido.
    for (const source of previous.sources) {
      if (!isGuideSourceKind(source.kind)) throw new Error('Tipo de fuente inválido.');
      const found = source.kind === 'nota' ? state.notes.find((note) => note.id === source.refId && note.visibility === 'group' && note.subjectId === current.subjectId)
        : source.kind === 'tarea' ? state.assignments.find((item) => item.id === source.refId && item.subjectId === current.subjectId)
          : source.kind === 'actividad' ? state.activities.find((item) => item.id === source.refId && item.subjectId === current.subjectId)
            : source.kind === 'pregunta' ? state.questions.find((item) => item.id === source.refId && item.subjectId === current.subjectId)
              : state.works.find((work) => work.id === source.refId && state.assignments.some((assignment) => assignment.id === work.assignmentId && assignment.subjectId === current.subjectId));
      if (!found) throw new Error('Una fuente de esta versión ya no está disponible.');
    }
    this.captureGuide(id); this.ctx.restoreFiles('guide', id, previous.attachmentIds); const now = this.ctx.now();
    state.guides = state.guides.map((guide) => guide.id === id ? { ...guide, termId: previous.termId, title: previous.title, topics: [...previous.topics], sections: [...previous.sections], version: guide.version + 1, updatedBy: me.id, updatedAt: now } : guide);
    state.guideSources = [...state.guideSources.filter((source) => source.guideId !== id), ...previous.sources.map((source): GuideSource => ({ ...source, topics: [...source.topics], id: this.ctx.id(), guideId: id, addedBy: source.addedBy ?? me.id, addedAt: source.addedAt ?? now }))];
    this.captureGuide(id, me.id); this.guideHistory.find((item) => item.guideId === id && item.version === current.version + 1)!.restoredFromVersion = oldVersion; this.ctx.emit();
  }
  commentQuestion(questionId: Id, body: string, answerId?: Id) {
    const me = this.ctx.active(); const state = this.ctx.state();
    if (!state.questions.some((question) => question.id === questionId)) throw new Error('La pregunta no existe.');
    if (answerId && !state.answers.some((answer) => answer.id === answerId && answer.questionId === questionId)) throw new Error('La respuesta no pertenece a esta pregunta.');
    this.comments = [...this.comments, { id: this.ctx.id(), questionId, answerId, authorId: me.id, text: text(body, 'La aclaración', 2000, true), createdAt: this.ctx.now() }]; this.ctx.emit();
  }
  toggleAnswerUsefulness(answerId: Id) {
    const me = this.ctx.active(); const answer = this.ctx.state().answers.find((item) => item.id === answerId);
    if (!answer) throw new Error('La respuesta no existe.');
    if (answer.authorId === me.id) throw new Error('No puedes marcar tu propia respuesta como útil.');
    const prior = this.usefulness.some((item) => item.answerId === answerId && item.memberId === me.id);
    this.usefulness = this.usefulness.filter((item) => item.answerId !== answerId || item.memberId !== me.id);
    if (!prior) this.usefulness.push({ answerId, memberId: me.id, createdAt: this.ctx.now() }); this.ctx.emit();
  }
  saveQuestionLinks(questionId: Id, notes: Id[], guides: Id[]) {
    const me = this.ctx.active(); const state = this.ctx.state(); const question = state.questions.find((item) => item.id === questionId);
    if (!question) throw new Error('La pregunta no existe.');
    const noteIds = [...new Set(notes)]; const guideIds = [...new Set(guides)];
    if (noteIds.length + guideIds.length > 50) throw new Error('Selecciona hasta 50 materiales relacionados.');
    if (noteIds.some((id) => !state.notes.some((note) => note.id === id && note.visibility === 'group' && note.subjectId === question.subjectId)) || guideIds.some((id) => !state.guides.some((guide) => guide.id === id && guide.subjectId === question.subjectId))) throw new Error('Enlaza solo material compartido de esta materia.');
    this.links = [...this.links.filter((item) => item.questionId !== questionId), ...noteIds.map((id): QuestionLink => ({ id: this.ctx.id(), questionId, targetKind: 'note', targetId: id, addedBy: me.id, createdAt: this.ctx.now() })), ...guideIds.map((id): QuestionLink => ({ id: this.ctx.id(), questionId, targetKind: 'guide', targetId: id, addedBy: me.id, createdAt: this.ctx.now() }))]; this.ctx.emit();
  }
}
