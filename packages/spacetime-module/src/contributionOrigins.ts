import { Timestamp } from 'spacetimedb';
import { computeContributionOrigins, type ContributionContent, type ContributionOriginInput, type OriginContributionKind } from '../../core/src/contributionOrigins';
import { isActive, type Ctx, type ViewDb } from './moduleContext';
import { canReadTarget } from './delivery2Handlers';

const targetKind: Record<OriginContributionKind, string> = { trabajo: 'work', apunte: 'note', evidencia: 'evidence', guia: 'guide', respuesta: 'answer' };

/** Solo metadatos de procedencia; no devuelve cuerpos, hashes ni firmas de material privado. */
export function readContributionOrigins(db: ViewDb, sender: Ctx['sender']) {
  if (!isActive(db, sender)) return [];
  const inputs: ContributionOriginInput[] = [];
  const people = new Map<string, Ctx['sender']>();
  const fileKeys = new Map<string, string[]>();
  const fileIds = new Set<string>();
  const groupNotes = [...db.note.iter()].filter((row) => row.visibility === 'group');
  const groupNoteIds = new Set(groupNotes.map((row) => row.id));
  const addFile = (kind: string, id: bigint, key: string) => {
    const target = `${kind}:${id}`; const list = fileKeys.get(target) ?? []; list.push(key); fileKeys.set(target, list);
  };
  for (const file of db.resourceFile.iter()) {
    if (!['work', 'note', 'evidence', 'guide', 'answer'].includes(file.targetKind)
      || (file.targetKind === 'note' && !groupNoteIds.has(file.targetId))) continue;
    fileIds.add(file.id);
    if (file.removedAt !== undefined) continue;
    const sourceId = file.storageKey.startsWith('stdb:') ? file.storageKey.slice(5) : undefined;
    const native = sourceId ? db.resourceUpload.id.find(sourceId) : undefined;
    const verified = native?.state === 'ready' && /^[a-f0-9]{64}$/i.test(native.sha256);
    // UUID, nombre y tipo declarado no prueban que los bytes sean distintos.
    const key = verified ? JSON.stringify(['sha256', native.sha256.toLowerCase()])
      : JSON.stringify(['legacy', file.storageKey || file.id]);
    addFile(file.targetKind, file.targetId, key);
  }
  for (const file of db.workFile.iter()) {
    if (!fileIds.has(`legacy:${file.id}`)) addFile('work', file.workId, JSON.stringify(['legacy', file.storageKey || `legacy:${file.id}`]));
  }
  const add = (kind: OriginContributionKind, refId: bigint, person: Ctx['sender'], createdAt: Ctx['timestamp'], context: string[], content: ContributionContent[]) => {
    const memberId = person.toHexString(); people.set(memberId, person);
    inputs.push({ kind, refId: refId.toString(), memberId, createdAt: createdAt.microsSinceUnixEpoch, context, content, files: fileKeys.get(`${targetKind[kind]}:${refId}`) ?? [] });
  };
  const workPeople = new Map<bigint, Map<string, Ctx['sender']>>();
  for (const row of db.workAuthor.iter()) {
    const authors = workPeople.get(row.workId) ?? new Map<string, Ctx['sender']>(); authors.set(row.author.toHexString(), row.author); workPeople.set(row.workId, authors);
  }
  const workDetails = new Map([...db.workDetail.iter()].map((row) => [row.workId, row]));
  for (const row of db.work.iter()) {
    if (workDetails.get(row.id)?.status === 'draft') continue;
    for (const author of workPeople.get(row.id)?.values() ?? []) {
      add('trabajo', row.id, author, row.createdAt, [row.assignmentId.toString()], [row.title, row.description, workDetails.get(row.id)?.topic ?? '']);
    }
  }
  const noteDetails = new Map([...db.noteDetail.iter()].map((row) => [row.noteId, row]));
  // La exclusión ocurre antes del cálculo, también para el autor y los administradores.
  for (const row of groupNotes) {
    add('apunte', row.id, row.author, row.createdAt, [row.subjectId.toString(), noteDetails.get(row.id)?.termId?.toString() ?? ''], [row.title, row.body, row.topic]);
  }
  for (const row of db.evidence.iter()) {
    const authors = new Map([row.author, ...row.participants].map((person) => [person.toHexString(), person]));
    for (const person of authors.values()) add('evidencia', row.id, person, row.createdAt, [row.activityId.toString()], [row.content]);
  }
  for (const row of db.studyGuide.iter()) add('guia', row.id, row.createdBy, row.createdAt, [row.subjectId.toString(), row.termId?.toString() ?? ''], [row.title, row.topics, row.sections]);
  // La regla de respuestas es más restrictiva: una contribución por persona y pregunta.
  for (const row of db.answer.iter()) {
    const memberId = row.author.toHexString(); people.set(memberId, row.author);
    inputs.push({ kind: 'respuesta', refId: row.id.toString(), memberId, createdAt: row.createdAt.microsSinceUnixEpoch,
      context: [row.questionId.toString()], content: ['respuesta'], files: [] });
  }
  return computeContributionOrigins(inputs)
    .filter((row) => canReadTarget(db, sender, targetKind[row.kind], BigInt(row.refId)))
    .map((row) => ({ kind: row.kind, refId: BigInt(row.refId), memberId: people.get(row.memberId)!,
      creditedAt: new Timestamp(row.creditedAt), duplicateOf: row.duplicateOf === undefined ? undefined : BigInt(row.duplicateOf) }));
}
