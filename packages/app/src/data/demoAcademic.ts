import { fileSizeError } from '@b20/core';
import type {
  AcademicComment, AcademicProgress, Activity, ActivityLink, Assignment, AssignmentInput,
  CreateActivityInput, Evidence, Id, Member, Note, PageSnapshot, ProgressStatus,
  ProgressTargetKind, ResourceFile, ResourceTargetKind, ResourceTransferOptions, Work, WorkFile, WorkRevision,
  WorkReview, WorkVersionInput,
} from './types';

interface AcademicState {
  works: Work[];
  workFiles: WorkFile[];
  assignments: Assignment[];
  activities: Activity[];
  evidences: Evidence[];
  notes: Note[];
}

interface Context {
  extraTarget?(kind: ResourceTargetKind, id: Id, editable: boolean): { version?: number };
  captureExtra?(kind: ResourceTargetKind, id: Id): void;
  changedExtra?(kind: ResourceTargetKind, id: Id): void;
  state(): AcademicState;
  active(): Member;
  id(): Id;
  now(): Date;
  emit(): void;
  updateAssignment(id: Id, input: AssignmentInput, expectedVersion?: number): void;
  updateActivity(id: Id, input: CreateActivityInput, expectedVersion?: number): void;
}

const checkVersion = (version: number, expected: number | undefined) => {
  if (expected !== undefined && version !== expected) {
    throw new Error('Esta publicación cambió. Revisa la versión actual antes de guardar.');
  }
};

function text(value: string, field: string, limit: number, required = false) {
  const clean = value.trim();
  if (required && !clean) throw new Error(`${field} no puede estar vacío.`);
  if (clean.length > limit) throw new Error(`${field} excede ${limit} caracteres.`);
  return clean;
}

/** Complemento de la simulación: mismos permisos, versiones y privacidad que el servidor. */
export class DemoAcademicStore {
  private progress: (AcademicProgress & { ownerId: Id })[] = [];
  private workHistory: WorkRevision[] = [];
  private reviews: WorkReview[] = [];
  private comments: AcademicComment[] = [];
  private files: ResourceFile[] = [];
  private links: ActivityLink[] = [];
  private pages: PageSnapshot[] = [];
  private blobs = new Map<Id, Blob>();
  private urls = new Set<string>();
  private purgedTargets = new Set<string>();

  constructor(private ctx: Context) {}

  resources(): ResourceFile[] {
    const ownIds = new Set(this.files.map((file) => file.id));
    return [
      ...this.ctx.state().workFiles.filter((file) => !ownIds.has(`legacy:${file.id}`)).map((file): ResourceFile => ({
        ...file, id: `legacy:${file.id}`, targetKind: 'work', targetId: file.workId,
      })),
      ...this.files,
    ];
  }

  private fileIds(kind: ResourceTargetKind, id: Id) {
    return this.resources().filter((file) => file.targetKind === kind && file.targetId === id && !file.removedAt)
      .map((file) => file.id);
  }

  private work(id: Id, author = false) {
    const me = this.ctx.active();
    const row = this.ctx.state().works.find((work) => work.id === id);
    if (!row) throw new Error('El trabajo no existe.');
    if (author && !row.authorIds.includes(me.id)) throw new Error('Solo el autor o los coautores editan este trabajo.');
    return row;
  }

  private target(kind: ResourceTargetKind, id: Id, editable = false) {
    const me = this.ctx.active();
    const state = this.ctx.state();
    if (!['assignment', 'activity', 'work', 'evidence'].includes(kind)) {
      if (this.ctx.extraTarget) return this.ctx.extraTarget(kind, id, editable);
      throw new Error('Tipo de publicación inválido.');
    }
    if (kind === 'work') return this.work(id, editable);
    if (kind === 'evidence') {
      const row = state.evidences.find((evidence) => evidence.id === id);
      if (!row) throw new Error('La evidencia no existe.');
      if (editable && row.authorId !== me.id) {
        throw new Error('Solo el autor adjunta archivos a esta evidencia.');
      }
      return row;
    }
    const row = kind === 'assignment' ? state.assignments.find((page) => page.id === id)
      : state.activities.find((page) => page.id === id);
    if (!row) throw new Error('La publicación no existe.');
    return row;
  }

  private workSnapshot(work: Work): WorkRevision {
    return {
      id: `baseline:work:${work.id}:${work.version}`, workId: work.id, version: work.version,
      title: work.title, description: work.description, topic: work.topic ?? '',
      status: work.status === 'final' || work.status === 'reviewed' ? 'final' : 'draft',
      authorIds: [...work.authorIds], attachmentIds: this.fileIds('work', work.id),
      editedBy: work.updatedBy, editedAt: work.updatedAt,
    };
  }

  captureWork(id: Id) {
    const work = this.work(id);
    if (this.workHistory.some((item) => item.workId === id && item.version === work.version)) return;
    this.workHistory = [...this.workHistory, { ...this.workSnapshot(work), id: this.ctx.id() }];
  }

  private pageSnapshot(kind: ProgressTargetKind, id: Id): PageSnapshot {
    const row = this.target(kind, id) as Assignment | Activity;
    const assignment = kind === 'assignment' ? row as Assignment : undefined;
    const activity = kind === 'activity' ? row as Activity : undefined;
    const linked = this.links.filter((link) => link.activityId === id && !link.removedAt);
    return {
      id: `baseline:${kind}:${id}:${row.version}`, page: kind, pageId: id, version: row.version,
      subjectId: row.subjectId, termId: row.termId, kind: assignment?.kind,
      topic: row.topic ?? '', date: activity?.date ?? '', title: row.title,
      summary: activity?.objective ?? '', body: row.instructions, dueDate: assignment?.dueDate,
      attachmentIds: this.fileIds(kind, id),
      assignmentIds: kind === 'activity' ? linked.filter((link) => link.targetKind === 'assignment').map((link) => link.targetId) : [],
      noteIds: kind === 'activity' ? linked.filter((link) => link.targetKind === 'note').map((link) => link.targetId) : [],
      editedBy: row.updatedBy, editedAt: row.updatedAt,
    };
  }

  capturePage(kind: ProgressTargetKind, id: Id) {
    const snapshot = this.pageSnapshot(kind, id);
    if (this.pages.some((item) => item.page === kind && item.pageId === id && item.version === snapshot.version)) return;
    this.pages = [...this.pages, { ...snapshot, id: this.ctx.id() }];
  }

  snapshot(ownerId: Id) {
    const state = this.ctx.state();
    const resources = this.resources();
    const workRevisions = [...this.workHistory];
    const pageSnapshots = [...this.pages];
    for (const work of state.works) {
      if (!workRevisions.some((item) => item.workId === work.id && item.version === work.version)) {
        workRevisions.push(this.workSnapshot(work));
      }
    }
    for (const [kind, rows] of [['assignment', state.assignments], ['activity', state.activities]] as const) {
      for (const row of rows) {
        if (!pageSnapshots.some((item) => item.page === kind && item.pageId === row.id && item.version === row.version)) {
          pageSnapshots.push(this.pageSnapshot(kind, row.id));
        }
      }
    }
    return {
      myProgress: this.progress.filter((item) => item.ownerId === ownerId).map(({ ownerId: _owner, ...item }) => item),
      workRevisions, workReviews: this.reviews, academicComments: this.comments,
      resourceFiles: resources.filter((file) => { try { this.target(file.targetKind, file.targetId); return true; } catch { return false; } }), activityLinks: this.links, pageSnapshots,
      works: state.works.map((work): Work => ({ ...work, topic: work.topic ?? '',
        status: work.status === 'final' && this.reviews.some((review) => review.workId === work.id &&
          review.version === work.version && !work.authorIds.includes(review.reviewerId)) ? 'reviewed' : work.status ?? 'draft' })),
      workFiles: resources.filter((file) => file.targetKind === 'work' && !file.removedAt).map((file): WorkFile => ({
        ...file, id: file.id.startsWith('legacy:') ? file.id.slice(7) : file.id, workId: file.targetId,
      })),
    };
  }

  setProgress(kind: ProgressTargetKind, id: Id, status: ProgressStatus) {
    const me = this.ctx.active();
    if (!['assignment', 'activity'].includes(kind)) throw new Error('Tipo de publicación inválido.');
    this.target(kind, id);
    if (!['pending', 'in_progress', 'done'].includes(status)) throw new Error('Estado de avance inválido.');
    this.progress = [...this.progress.filter((item) => !(item.ownerId === me.id && item.targetKind === kind && item.targetId === id)),
      { ownerId: me.id, targetKind: kind, targetId: id, status, updatedAt: this.ctx.now() }];
    this.ctx.emit();
  }

  saveWorkVersion(id: Id, input: WorkVersionInput, expectedVersion: number) {
    const work = this.work(id, true);
    checkVersion(work.version, expectedVersion);
    if (input.status !== 'draft' && input.status !== 'final') throw new Error('El estado del trabajo no existe.');
    const fields = { title: text(input.title, 'El título', 200), description: text(input.description, 'La descripción', 50_000),
      topic: text(input.topic, 'El tema', 120), status: input.status };
    this.captureWork(id);
    this.ctx.state().works = this.ctx.state().works.map((row) => row.id === id ? { ...row, ...fields,
      version: row.version + 1, updatedAt: this.ctx.now(), updatedBy: this.ctx.active().id } : row);
    this.captureWork(id);
    this.ctx.emit();
  }

  restoreWorkVersion(id: Id, version: number, expectedVersion: number) {
    const work = this.work(id, true);
    checkVersion(work.version, expectedVersion);
    const snapshot = this.snapshot(this.ctx.active().id).workRevisions.find((item) => item.workId === id && item.version === version);
    if (!snapshot) throw new Error('La versión no existe.');
    this.captureWork(id);
    this.restoreFiles('work', id, snapshot.attachmentIds);
    this.saveWorkVersion(id, snapshot, expectedVersion);
    this.workHistory = this.workHistory.map((item) => item.workId === id && item.version === expectedVersion + 1
      ? { ...item, restoredFrom: version } : item);
  }

  reviewWork(id: Id, version: number, comment: string) {
    const work = this.work(id);
    const me = this.ctx.active();
    checkVersion(work.version, version);
    if (work.authorIds.includes(me.id)) throw new Error('El autor y los coautores no pueden revisar su propio trabajo.');
    if (work.status !== 'final') throw new Error('Solo se revisa una versión final.');
    const clean = text(comment, 'El comentario de revisión', 2_000, true);
    if (this.reviews.some((review) => review.workId === id && review.version === version && review.reviewerId === me.id)) {
      throw new Error('Ya revisaste esta versión.');
    }
    this.reviews = [...this.reviews, { id: this.ctx.id(), workId: id, version, workVersion: version,
      reviewerId: me.id, comment: clean, createdAt: this.ctx.now() }];
    this.ctx.emit();
  }

  commentAcademic(kind: 'work' | 'evidence', id: Id, value: string) {
    if (kind !== 'work' && kind !== 'evidence') throw new Error('El tipo de comentario no existe.');
    this.target(kind, id);
    this.comments = [...this.comments, { id: this.ctx.id(), targetKind: kind, targetId: id,
      authorId: this.ctx.active().id, text: text(value, 'El comentario', 2_000, true), createdAt: this.ctx.now() }];
    this.ctx.emit();
  }

  saveActivityLinks(id: Id, assignmentIds: Id[], noteIds: Id[], expectedVersion?: number) {
    const activity = this.target('activity', id) as Activity;
    checkVersion(activity.version, expectedVersion);
    const state = this.ctx.state();
    if (new Set(assignmentIds).size + new Set(noteIds).size > 100) throw new Error('Puedes enlazar hasta 100 materiales por actividad.');
    if (assignmentIds.some((target) => !state.assignments.some((row) => row.id === target && row.subjectId === activity.subjectId))) {
      throw new Error('La tarea relacionada debe ser de la misma materia.');
    }
    if (noteIds.some((target) => !state.notes.some((row) => row.id === target && row.subjectId === activity.subjectId && row.visibility === 'group'))) {
      throw new Error('La nota relacionada debe ser compartida y de la misma materia.');
    }
    this.capturePage('activity', id);
    this.replaceLinks(id, assignmentIds, noteIds);
    this.ctx.updateActivity(id, activity, activity.version);
  }

  private replaceLinks(id: Id, assignmentIds: Id[], noteIds: Id[]) {
    const now = this.ctx.now();
    this.links = this.links.map((link) => link.activityId === id && !link.removedAt ? { ...link, removedAt: now } : link);
    for (const [targetKind, ids] of [['assignment', assignmentIds], ['note', noteIds]] as const) {
      this.links = [...this.links, ...[...new Set(ids)].map((targetId): ActivityLink => ({ id: this.ctx.id(),
        activityId: id, targetKind, targetId, createdBy: this.ctx.active().id, createdAt: now }))];
    }
  }

  restoreFiles(kind: ResourceTargetKind, id: Id, ids: Id[]) {
    const desired = new Set(ids);
    this.files = this.resources().map((file) => file.targetKind === kind && file.targetId === id
      ? { ...file, removedAt: desired.has(file.id) ? undefined : this.ctx.now() } : file);
  }

  restorePageSnapshot(kind: ProgressTargetKind, id: Id, version: number, expectedVersion: number) {
    const current = this.target(kind, id) as Assignment | Activity;
    checkVersion(current.version, expectedVersion);
    const snapshot = this.snapshot(this.ctx.active().id).pageSnapshots.find((page) => page.page === kind && page.pageId === id && page.version === version);
    if (!snapshot) throw new Error('La versión no existe.');
    if (kind === 'activity') {
      const state = this.ctx.state();
      if (snapshot.assignmentIds.some((target) => !state.assignments.some((row) => row.id === target && row.subjectId === snapshot.subjectId))) {
        throw new Error('La tarea relacionada debe ser de la misma materia.');
      }
      if (snapshot.noteIds.some((target) => !state.notes.some((row) => row.id === target && row.subjectId === snapshot.subjectId && row.visibility === 'group'))) {
        throw new Error('La nota relacionada debe ser compartida y de la misma materia.');
      }
    }
    this.capturePage(kind, id);
    this.restoreFiles(kind, id, snapshot.attachmentIds);
    if (kind === 'assignment') {
      this.ctx.updateAssignment(id, { subjectId: snapshot.subjectId, termId: snapshot.termId,
        kind: snapshot.kind ?? 'tarea', title: snapshot.title, topic: snapshot.topic,
        instructions: snapshot.body, dueDate: snapshot.dueDate }, expectedVersion);
    } else {
      this.replaceLinks(id, snapshot.assignmentIds, snapshot.noteIds);
      this.ctx.updateActivity(id, { subjectId: snapshot.subjectId, termId: snapshot.termId,
        topic: snapshot.topic, date: snapshot.date, title: snapshot.title,
        objective: snapshot.summary, instructions: snapshot.body }, expectedVersion);
    }
    this.pages = this.pages.map((page) => page.page === kind && page.pageId === id && page.version === expectedVersion + 1
      ? { ...page, restoredFrom: version } : page);
  }

  private changedFiles(kind: ResourceTargetKind, id: Id) {
    const state = this.ctx.state();
    if (!['assignment', 'activity', 'work', 'evidence'].includes(kind)) {
      this.ctx.changedExtra?.(kind, id); this.ctx.emit(); return;
    }
    if (kind === 'work') {
      const work = this.work(id);
      state.works = state.works.map((row) => row.id === id ? { ...row, version: row.version + 1,
        updatedBy: this.ctx.active().id, updatedAt: this.ctx.now() } : row);
      this.captureWork(work.id);
    } else if (kind === 'evidence') {
      const evidence = state.evidences.find((row) => row.id === id)!;
      state.evidences = state.evidences.map((row) => row.id === id ? { ...row, version: (row.version ?? 1) + 1 } : row);
      this.evidenceChanged(evidence.activityId);
    } else if (kind === 'assignment') {
      this.ctx.updateAssignment(id, this.target(kind, id) as Assignment);
    } else this.ctx.updateActivity(id, this.target(kind, id) as Activity);
    this.ctx.emit();
  }

  /** La fuente «actividad» de una guía incluye el material de todos sus equipos. */
  evidenceChanged(activityId: Id) {
    const activity = this.target('activity', activityId) as Activity;
    this.ctx.updateActivity(activityId, activity, activity.version);
  }

  async attachResourceFile(kind: ResourceTargetKind, id: Id, file: File, expectedVersion?: number, transfer: ResourceTransferOptions = {}): Promise<Id> {
    if (transfer.signal?.aborted) throw new DOMException('Cancelaste la transferencia.', 'AbortError');
    const row = this.target(kind, id, true);
    checkVersion(row.version ?? 1, expectedVersion);
    const problem = fileSizeError(file.name, file.size);
    if (problem) throw new Error(problem);
    const name = text(file.name, 'El nombre del archivo', 200, true);
    transfer.onProgress?.(0, file.size);
    if (transfer.signal?.aborted) throw new DOMException('Cancelaste la transferencia.', 'AbortError');
    if (kind === 'work') this.captureWork(id);
    else if (kind === 'evidence') this.capturePage('activity', (row as Evidence).activityId);
    else if (kind === 'assignment' || kind === 'activity') this.capturePage(kind, id);
    else this.ctx.captureExtra?.(kind, id);
    const fileId = crypto.randomUUID();
    const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined;
    if (url) this.urls.add(url);
    this.blobs.set(fileId, file);
    this.files = [...this.files, { id: fileId, targetKind: kind, targetId: id, name, size: file.size,
      contentType: file.type || 'application/octet-stream', uploadedBy: this.ctx.active().id,
      createdAt: this.ctx.now(), url }];
    this.changedFiles(kind, id);
    transfer.onProgress?.(file.size, file.size);
    return fileId;
  }

  removeResourceFile(fileId: Id, expectedVersion?: number) {
    const file = this.resources().find((entry) => entry.id === fileId);
    if (!file || file.removedAt) throw new Error('El archivo no existe.');
    const row = this.target(file.targetKind, file.targetId, true);
    checkVersion(row.version ?? 1, expectedVersion);
    if (file.targetKind === 'work') this.captureWork(file.targetId);
    else if (file.targetKind === 'evidence') this.capturePage('activity', (row as Evidence).activityId);
    else if (file.targetKind === 'assignment' || file.targetKind === 'activity') this.capturePage(file.targetKind, file.targetId);
    else this.ctx.captureExtra?.(file.targetKind, file.targetId);
    this.files = [...this.files.filter((entry) => entry.id !== fileId), { ...file, removedAt: this.ctx.now() }];
    this.changedFiles(file.targetKind, file.targetId);
  }

  restoreResourceFile(fileId: Id, expectedVersion: number) {
    const file = this.resources().find((entry) => entry.id === fileId);
    if (!file) throw new Error('El archivo no existe.');
    this.target(file.targetKind, file.targetId);
    if (file.targetKind !== 'evidence') throw new Error('Restaura este archivo desde el historial de la publicación.');
    const row = this.target('evidence', file.targetId, true);
    if (!file.removedAt) return;
    checkVersion(row.version ?? 1, expectedVersion);
    this.capturePage('activity', (row as Evidence).activityId);
    this.files = this.files.map((entry) => entry.id === fileId ? { ...entry, removedAt: undefined } : entry);
    this.changedFiles('evidence', file.targetId);
  }

  async downloadResourceFile(fileId: Id, transfer: ResourceTransferOptions = {}): Promise<Blob> {
    if (transfer.signal?.aborted) throw new DOMException('Cancelaste la transferencia.', 'AbortError');
    this.ctx.active();
    const file = this.resources().find((entry) => entry.id === fileId);
    if (!file) throw new Error('El archivo no existe.');
    const blob = this.blobs.get(fileId);
    if (blob) { transfer.onProgress?.(blob.size, blob.size); return blob; }
    if (!file.url) throw new Error('Este archivo de ejemplo no tiene contenido descargable.');
    const response = await fetch(file.url, { signal: transfer.signal });
    if (!response.ok) throw new Error('No se pudo descargar el archivo.');
    return response.blob();
  }

  copyFiles(fromNoteId: Id, toNoteId: Id): Map<Id, Id> {
    this.target('note', fromNoteId, true);
    const aliases = new Map<Id, Id>();
    for (const file of this.resources().filter((f) => f.targetKind === 'note' && f.targetId === fromNoteId && !f.removedAt)) {
      const id = `published-${toNoteId}-${file.id}`;
      aliases.set(file.id, id);
      this.files.push({ ...file, id, targetId: toNoteId, createdAt: this.ctx.now() });
      const blob = this.blobs.get(file.id); if (blob) this.blobs.set(id, blob);
    }
    return aliases;
  }

  purgeTargets(targets: ReadonlySet<string>, externalReferences: ReadonlySet<Id>) {
    for (const key of targets) this.purgedTargets.add(key);
    const keep = (kind: string, id: Id) => !targets.has(`${kind}:${id}`);
    this.workHistory = this.workHistory.filter((row) => keep('work', row.workId));
    this.reviews = this.reviews.filter((row) => keep('work', row.workId));
    this.comments = this.comments.filter((row) => keep(row.targetKind, row.targetId));
    this.links = this.links.filter((row) => keep(row.targetKind, row.targetId));
    this.pages = this.pages.map((row) => ({ ...row, noteIds: row.noteIds.filter((id) => keep('note', id)) }));
    const references = new Set([...externalReferences, ...this.workHistory.flatMap((row) => row.attachmentIds), ...this.pages.flatMap((row) => row.attachmentIds)]);
    const resources = this.resources(); const token = (id: Id) => `(resource:${id})`;
    for (const file of resources) if (this.ctx.state().notes.some((note) => note.body.includes(token(file.id)))) references.add(file.id);
    for (const file of resources) if (this.purgedTargets.has(`${file.targetKind}:${file.targetId}`) && !references.has(file.id)) this.blobs.delete(file.id);
    this.files = this.files.filter((file) => !this.purgedTargets.has(`${file.targetKind}:${file.targetId}`) || references.has(file.id)).map((file) => this.purgedTargets.has(`${file.targetKind}:${file.targetId}`) ? { ...file, name: 'Archivo conservado por referencia', uploadedBy: '' } : file);
    this.ctx.state().workFiles = this.ctx.state().workFiles.filter((file) => !this.purgedTargets.has(`work:${file.workId}`) || references.has(`legacy:${file.id}`));
    const keptUrls = new Set(this.files.map((file) => file.url));
    for (const url of this.urls) if (!keptUrls.has(url)) { URL.revokeObjectURL?.(url); this.urls.delete(url); }
  }

  dispose() {
    for (const url of this.urls) URL.revokeObjectURL?.(url);
    this.urls.clear();
    this.blobs.clear();
    this.progress = [];
    this.workHistory = [];
    this.reviews = [];
    this.comments = [];
    this.files = [];
    this.links = [];
    this.pages = [];
  }
}
