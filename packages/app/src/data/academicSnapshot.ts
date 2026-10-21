import type { DbConnection } from '../module_bindings';
import type { PageSnapshot, ResourceFile, Snapshot, WorkRevision, WorkStatus } from './types';

const rows = <T,>(table: { iter(): Iterable<T> } | undefined): T[] => table ? [...table.iter()] : [];
const checked = <const T extends readonly string[]>(value: string, allowed: T): T[number] => {
  if (!allowed.includes(value)) throw new Error('Los datos académicos requieren una actualización de B20.');
  return value;
};
const size = (value: bigint) => {
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('El tamaño del archivo no es válido.');
  return bytes;
};

/** Une metadatos aditivos conservando los IDs, enlaces y contenido de las tablas originales. */
export function enrichAcademicSnapshot(connection: Pick<DbConnection, 'db'>, snapshot: Snapshot, identity: string): Snapshot {
  const db = connection.db;
  const assignmentDetails = new Map(rows(db.assignmentDetails).map((row) => [row.assignmentId.toString(), row]));
  const workDetails = new Map(rows(db.workDetails).map((row) => [row.workId.toString(), row]));
  const evidenceDetails = new Map(rows(db.evidenceDetails).map((row) => [row.evidenceId.toString(), row]));
  const workReviews = rows(db.workReviews).map((row) => ({ id: row.id.toString(), workId: row.workId.toString(),
    version: row.version, workVersion: row.version, reviewerId: row.reviewer.toHexString(), comment: row.comment, createdAt: row.createdAt.toDate() }));
  const newFiles: ResourceFile[] = rows(db.resourceFiles).map((row) => ({ id: row.id,
    targetKind: checked(row.targetKind, ['assignment', 'activity', 'work', 'evidence', 'note', 'guide', 'question', 'answer', 'profile', 'profile_cover', 'group_message', 'direct_message', 'channel_message']), targetId: row.targetId.toString(),
    name: row.name, size: size(row.size), contentType: row.contentType, uploadedBy: row.uploadedBy.toHexString(),
    createdAt: row.createdAt.toDate(), removedAt: row.removedAt?.toDate() }));
  const mirrored = new Set(newFiles.map((file) => file.id));
  const resourceFiles: ResourceFile[] = [...snapshot.workFiles.filter((file) => !mirrored.has(`legacy:${file.id}`))
    .map((file): ResourceFile => ({ ...file, id: `legacy:${file.id}`, targetKind: 'work', targetId: file.workId })), ...newFiles];
  const filesOf = (kind: ResourceFile['targetKind'], id: string) => resourceFiles.filter((file) =>
    file.targetKind === kind && file.targetId === id && !file.removedAt).map((file) => file.id);
  const assignments = snapshot.assignments.map((row) => ({ ...row, topic: assignmentDetails.get(row.id)?.topic ?? '' }));
  const works = snapshot.works.map((row) => {
    const details = workDetails.get(row.id);
    const status = details ? checked(details.status, ['draft', 'final']) : 'draft';
    const reviewed = status === 'final' && workReviews.some((review) => review.workId === row.id &&
      review.version === row.version && !row.authorIds.includes(review.reviewerId));
    return { ...row, topic: details?.topic ?? '', updatedBy: details?.updatedBy.toHexString(),
      status: (reviewed ? 'reviewed' : status) as WorkStatus };
  });
  const workRevisions: WorkRevision[] = rows(db.workRevisions).map((row) => ({
    id: row.id.toString(), workId: row.workId.toString(), version: row.version, title: row.title,
    description: row.description, topic: row.topic, status: checked(row.status, ['draft', 'final']),
    authorIds: row.authors.map((author) => author.toHexString()), attachmentIds: [...row.attachmentIds],
    editedBy: row.editedBy.toHexString(), editedAt: row.editedAt.toDate(), restoredFrom: row.restoredFrom,
  }));
  for (const work of works) {
    if (!workRevisions.some((revision) => revision.workId === work.id && revision.version === work.version)) {
      workRevisions.push({ id: `baseline:work:${work.id}:${work.version}`, workId: work.id, version: work.version,
        title: work.title, description: work.description, topic: work.topic, status: work.status === 'draft' ? 'draft' : 'final',
        authorIds: [...work.authorIds], attachmentIds: filesOf('work', work.id), editedBy: work.updatedBy, editedAt: work.updatedAt });
    }
  }
  const activityLinks = rows(db.activityLinks).map((row) => ({ id: row.id.toString(), activityId: row.activityId.toString(),
    targetKind: checked(row.targetKind, ['assignment', 'note']), targetId: row.targetId.toString(),
    createdBy: row.createdBy.toHexString(), createdAt: row.createdAt.toDate(), removedAt: row.removedAt?.toDate() }));
  const pageSnapshots: PageSnapshot[] = rows(db.pageSnapshots).map((row) => ({ id: row.id.toString(),
    page: checked(row.page, ['assignment', 'activity']), pageId: row.pageId.toString(), version: row.version,
    subjectId: row.subjectId.toString(), termId: row.termId?.toString(),
    kind: row.page === 'assignment' ? checked(row.kind, ['tarea', 'actividad', 'exposicion', 'examen']) : undefined,
    topic: row.topic, date: row.date, title: row.title, summary: row.summary, body: row.body,
    dueDate: row.dueDate || undefined, attachmentIds: [...row.attachmentIds],
    assignmentIds: row.assignmentIds.map(String), noteIds: row.noteIds.map(String),
    editedBy: row.editedBy.toHexString(), editedAt: row.editedAt.toDate(), restoredFrom: row.restoredFrom,
  }));
  for (const [kind, items] of [['assignment', assignments], ['activity', snapshot.activities]] as const) {
    for (const item of items) {
      if (pageSnapshots.some((revision) => revision.page === kind && revision.pageId === item.id && revision.version === item.version)) continue;
      const assignment = kind === 'assignment' ? assignments.find((row) => row.id === item.id) : undefined;
      const activity = kind === 'activity' ? snapshot.activities.find((row) => row.id === item.id) : undefined;
      const links = activity ? activityLinks.filter((link) => link.activityId === activity.id && !link.removedAt) : [];
      pageSnapshots.push({ id: `baseline:${kind}:${item.id}:${item.version}`, page: kind, pageId: item.id,
        version: item.version, subjectId: item.subjectId, termId: item.termId, kind: assignment?.kind,
        topic: item.topic ?? '', date: activity?.date ?? '', title: item.title, summary: activity?.objective ?? '',
        body: item.instructions, dueDate: assignment?.dueDate, attachmentIds: filesOf(kind, item.id),
        assignmentIds: links.filter((link) => link.targetKind === 'assignment').map((link) => link.targetId),
        noteIds: links.filter((link) => link.targetKind === 'note').map((link) => link.targetId), editedBy: item.updatedBy, editedAt: item.updatedAt });
    }
  }
  return { ...snapshot, assignments, works, workReviews, resourceFiles, workRevisions, activityLinks, pageSnapshots,
    workFiles: resourceFiles.filter((file) => file.targetKind === 'work' && !file.removedAt).map((file) => ({
      ...file, id: file.id.startsWith('legacy:') ? file.id.slice(7) : file.id, workId: file.targetId,
    })),
    evidences: snapshot.evidences.map((row) => ({ ...row, version: evidenceDetails.get(row.id)?.version ?? 1 })),
    myProgress: rows(db.myProgress).filter((row) => row.owner.toHexString() === identity).map((row) => ({
      targetKind: checked(row.targetKind, ['assignment', 'activity']), targetId: row.targetId.toString(),
      status: checked(row.status, ['pending', 'in_progress', 'done']), updatedAt: row.updatedAt.toDate(),
    })),
    academicComments: rows(db.academicComments).map((row) => ({ id: row.id.toString(),
      targetKind: checked(row.targetKind, ['work', 'evidence']), targetId: row.targetId.toString(),
      authorId: row.author.toHexString(), text: row.text, createdAt: row.createdAt.toDate() })),
  };
}
