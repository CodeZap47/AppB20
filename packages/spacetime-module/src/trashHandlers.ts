import { purgePresentationAiSource } from './presentationAiHandlers';
import { purgeExamSpacedSource } from './examSpaced';
import { purgeDocumentSource } from './documentHandlers';
import { memberIdentityFor } from './authIdentity';
import { SenderError } from 'spacetimedb/server';
import { ScheduleAt, Timestamp } from 'spacetimedb';
import { retentionDeadline, retentionExpired } from '../../core/src/retention';
import { activeMember, isActive, type Ctx, type ViewDb } from './moduleContext';
import { purgeAiSource } from './aiHandlers';
import { purgeMuseum } from './community4Handlers';
import { purgeAgentSource } from './agentHandlers';
import { purgeGuideAiSource } from './guideAiHandlers';
import { purgeExamSource } from './examHandlers';
import { rememberContributionOrigins } from './contributionOrigins';

const KINDS = ['note', 'question', 'answer', 'guide', 'work', 'evidence', 'feed_post', 'feed_comment', 'group_message', 'channel_message'];
const keyOf = (kind: string, id: bigint) => `${kind}:${id}`;
type RetentionRow = NonNullable<ReturnType<Ctx['db']['contentRetention']['key']['find']>>;

function owners(db: ViewDb, kind: string, id: bigint) {
  if (kind === 'work') return [...db.workAuthor.workId.filter(id)].map((row) => row.author);
  const owner = kind === 'note' ? db.note.id.find(id)?.author : kind === 'guide' ? db.studyGuide.id.find(id)?.createdBy
    : kind === 'question' ? db.question.id.find(id)?.author : kind === 'answer' ? db.answer.id.find(id)?.author
    : kind === 'feed_post' ? db.feedPost.id.find(id)?.author : kind === 'feed_comment' ? db.feedComment.id.find(id)?.author
    : kind === 'group_message' ? db.groupMessage.id.find(id)?.sender : kind === 'channel_message' ? db.channelMessage.id.find(id)?.sender : db.evidence.id.find(id)?.author;
  return owner ? [owner] : [];
}
function versionOf(db: ViewDb, kind: string, id: bigint) {
  if (kind === 'note') return db.note.id.find(id)?.version ?? 0;
  if (kind === 'guide') return db.studyGuide.id.find(id)?.version ?? 0;
  if (kind === 'work') return db.work.id.find(id)?.version ?? 0;
  if (kind === 'evidence') return db.evidenceDetail.evidenceId.find(id)?.version ?? 1;
  return db.resourceVersion.key.find(keyOf(kind, id))?.version ?? 1;
}
function audit(ctx: Ctx, row: RetentionRow, action: string, actorRole: string) {
  ctx.db.retentionAudit.insert({ id: 0n, key: row.key, generation: row.generation, action, actorRole, at: ctx.timestamp });
}
export function retentionBlocksRead(db: ViewDb, kind: string, id: bigint) {
  const state = db.contentRetention?.key.find(keyOf(kind, id))?.state;
  return state === 'purging' || state === 'purged';
}
export function assertRetentionReadable(ctx: Ctx, kind: string, id: bigint) {
  const entry = ctx.db.contentRetention.key.find(keyOf(kind, id));
  const withdrawnAt = ctx.db.contentStatus.key.find(keyOf(kind, id))?.withdrawnAt;
  const deadline = entry?.state === 'pending' ? entry.expiresAt.microsSinceUnixEpoch
    : withdrawnAt ? retentionDeadline(withdrawnAt.microsSinceUnixEpoch) : undefined;
  if (retentionBlocksRead(ctx.db, kind, id) || deadline !== undefined && retentionExpired(ctx.timestamp.microsSinceUnixEpoch, deadline)) {
    throw new SenderError('El plazo de recuperación de 30 días terminó.');
  }
}
export function scheduleRetention(ctx: Ctx, kind: string, id: bigint, actorRole: string) {
  const key = keyOf(kind, id); const old = ctx.db.contentRetention.key.find(key);
  const withdrawnAt = ctx.db.contentStatus.key.find(key)?.withdrawnAt ?? ctx.timestamp;
  const expiresAt = new Timestamp(retentionDeadline(withdrawnAt.microsSinceUnixEpoch));
  const row = { key, kind, targetId: id, generation: (old?.generation ?? 0) + 1, withdrawnAt, expiresAt, state: 'pending', purgedAt: undefined };
  if (old) ctx.db.contentRetention.key.update(row); else ctx.db.contentRetention.insert(row);
  ctx.db.retentionExpiry.insert({ id: 0n, key, generation: row.generation, scheduledAt: ScheduleAt.time(expiresAt.microsSinceUnixEpoch) });
  audit(ctx, row, 'withdraw', actorRole);
}
export function restoreRetention(ctx: Ctx, kind: string, id: bigint, actorRole: string) {
  assertRetentionReadable(ctx, kind, id);
  const row = ctx.db.contentRetention.key.find(keyOf(kind, id));
  if (row) { ctx.db.contentRetention.key.update({ ...row, state: 'restored' }); audit(ctx, row, 'restore', actorRole); }
}
export function readTrashEntries(db: ViewDb, sender: Ctx['sender']) {
  if (!isActive(db, sender)) return [];
  const creator = db.member.identity.find(sender)?.isCreator === true;
  return [...db.contentRetention.iter()].filter((row) => row.state === 'pending').flatMap((row) => {
    const people = owners(db, row.kind, row.targetId); const own = people.some((owner) => owner.isEqual(sender));
    if (!people.length || !own && (!creator || row.kind === 'note' && db.note.id.find(row.targetId)?.visibility === 'personal')) return [];
    const by = db.contentStatus.key.find(row.key)?.withdrawnBy;
    const moderation = by !== undefined && !people.some((owner) => owner.isEqual(by));
    return [{ kind: row.kind, targetId: row.targetId, withdrawnAt: row.withdrawnAt, expiresAt: row.expiresAt,
      state: row.state, canRestore: moderation ? creator : own, version: versionOf(db, row.kind, row.targetId) }];
  });
}
function otherServiceIdentity(ctx: Ctx, identity: Ctx['sender']) {
  const hex = (value: string) => value.trim().replace(/^0x/i, '').toLowerCase();
  return ctx.db.fileServiceConfig.id.find(0)?.identity.isEqual(identity)
    || ctx.db.aiServiceConfig.id.find(0)?.identity.isEqual(identity)
    || ctx.db.notificationServiceConfig.id.find(0)?.identity.isEqual(identity)
    || !!ctx.env.B20_FILE_SERVICE_IDENTITY && hex(ctx.env.B20_FILE_SERVICE_IDENTITY) === hex(identity.toHexString());
}
export function setMaintenanceService(ctx: Ctx, input: { identity: Ctx['sender'] }) {
  activeMember(ctx);
  if (!ctx.db.appConfig.id.find(0)?.owner.isEqual(memberIdentityFor(ctx))) throw new SenderError('Solo el propietario configura el mantenimiento.');
  if (ctx.db.member.identity.find(input.identity)) throw new SenderError('Usa una identidad dedicada de mantenimiento, separada de los integrantes.');
  if (otherServiceIdentity(ctx, input.identity)) {
    throw new SenderError('La identidad de mantenimiento debe ser diferente de los otros servicios.');
  }
  const row = { id: 0, identity: input.identity };
  if (ctx.db.maintenanceService.id.find(0)) ctx.db.maintenanceService.id.update(row); else ctx.db.maintenanceService.insert(row);
}
export function isMaintenanceService(ctx: Ctx) {
  if (memberIdentityFor(ctx).isEqual(ctx.identity)) return true;
  if (ctx.db.member.identity.find(memberIdentityFor(ctx)) || otherServiceIdentity(ctx, memberIdentityFor(ctx))) return false;
  const configured = ctx.db.maintenanceService.id.find(0)?.identity;
  const env = ctx.env.B20_MAINTENANCE_IDENTITY?.trim().replace(/^0x/i, '').toLowerCase();
  return configured?.isEqual(memberIdentityFor(ctx)) === true
    || !!env && env === memberIdentityFor(ctx).toHexString().replace(/^0x/i, '').toLowerCase();
}
export function assertMaintenance(ctx: Ctx) {
  if (!isMaintenanceService(ctx)) {
    throw new SenderError('Solo el servicio de mantenimiento puede ejecutar la purga.');
  }
}
function drop<T extends { id: bigint }>(rows: Iterable<T>, predicate: (row: T) => boolean, remove: (id: bigint) => unknown) {
  for (const row of [...rows]) if (predicate(row)) remove(row.id);
}
function fileReferenced(db: ViewDb, fileId: string) {
  if ([...db.workRevision.iter()].some((row) => row.attachmentIds.includes(fileId))
    || [...db.noteVersion.iter()].some((row) => row.attachmentIds.includes(fileId))
    || [...db.guideVersion.iter()].some((row) => row.attachmentIds.includes(fileId))
    || [...db.pageSnapshot.iter()].some((row) => row.attachmentIds.includes(fileId))
    || [...db.messageReport.iter()].some((row) => row.attachmentIds.includes(fileId))) return true;
  const token = `(resource:${fileId})`;
  return [...db.note.iter()].some((row) => row.body.includes(token)) || [...db.noteVersion.iter()].some((row) => row.body.includes(token))
    || [...db.studyGuide.iter()].some((row) => row.sections.some((section) => section.includes(token)))
    || [...db.guideVersion.iter()].some((row) => row.sections.some((section) => section.includes(token)));
}
function releaseUnreferencedBytes(ctx: Ctx, storageKey: string) {
  if (!storageKey.startsWith('stdb:') || [...ctx.db.resourceFile.iter()].some((row) => row.storageKey === storageKey)) return;
  const uploadId = storageKey.slice(5); const upload = ctx.db.resourceUpload.id.find(uploadId);
  if (!upload) return;
  for (const chunk of [...ctx.db.resourceChunk.uploadId.filter(uploadId)]) ctx.db.resourceChunk.id.delete(chunk.id);
  const capacity = ctx.db.resourceCapacity.id.find(0);
  if (capacity && upload.state !== 'cancelled' && upload.state !== 'expired') ctx.db.resourceCapacity.id.update({ ...capacity,
    reservedBytes: capacity.reservedBytes >= upload.bytes ? capacity.reservedBytes - upload.bytes : 0n });
  ctx.db.resourceUpload.id.delete(uploadId);
  drop(ctx.db.resourceExpiry.iter(), (event) => event.uploadId === uploadId, (id) => ctx.db.resourceExpiry.id.delete(id));
}
function unlinkSources(ctx: Ctx, kind: string, id: bigint) {
  const sourceKind = ({ note: 'nota', question: 'pregunta', work: 'trabajo', evidence: 'evidencia', guide: 'guia' } as Record<string, string>)[kind];
  const removedSources = [...ctx.db.guideSource.iter()].filter((row) => row.kind === sourceKind && row.refId === id || kind === 'guide' && row.guideId === id);
  const sourceIds = new Set(removedSources.map((row) => row.id.toString()));
  for (const row of removedSources) ctx.db.guideSource.id.delete(row.id);
  drop(ctx.db.changeLog.iter(), (row) => row.entity === 'guide_source' && sourceIds.has(row.entityId), (key) => ctx.db.changeLog.id.delete(key));
  for (const version of ctx.db.guideVersion.iter()) {
    const sources = version.sources.filter((source) => !(source.kind === sourceKind && source.refId === id));
    if (sources.length !== version.sources.length) ctx.db.guideVersion.id.update({ ...version, sources });
  }
  drop(ctx.db.roomMaterial.iter(), (row) => row.kind === kind && row.sourceId === id, (key) => ctx.db.roomMaterial.id.delete(key));
  if (kind === 'note' || kind === 'guide') {
    for (const card of ctx.db.spacedCard.iter()) if (card.sourceKind === kind && card.sourceId === id) {
      // La referencia conserva su identidad y el avance privado, sin retener el texto derivado.
      ctx.db.spacedCard.id.update({ ...card, question: '', explanation: '', hint: '', archived: true, version: card.version + 1 });
    }
    for (const personal of ctx.db.teachingPersonal.iter()) if (personal.sourceKind === kind && personal.sourceId === id) {
      ctx.db.teachingPersonal.practiceId.update({ ...personal, sourceKind: undefined, sourceId: undefined, sourceVersion: undefined });
    }
  }
  if (kind === 'note') {
    drop(ctx.db.activityLink.iter(), (row) => row.targetKind === 'note' && row.targetId === id, (key) => ctx.db.activityLink.id.delete(key));
    for (const row of ctx.db.pageSnapshot.iter()) if (row.noteIds.includes(id)) ctx.db.pageSnapshot.id.update({ ...row, noteIds: row.noteIds.filter((key) => key !== id) });
    for (const row of ctx.db.noteDetail.iter()) if (row.publishedFromId === id) ctx.db.noteDetail.noteId.update({ ...row, publishedFromId: undefined, publishedFromVersion: undefined });
    for (const row of ctx.db.roomSummary.iter()) if (row.publishedNoteId === id) ctx.db.roomSummary.roomId.update({ ...row, publishedNoteId: undefined });
    for (const row of ctx.db.teachingPersonal.iter()) if (row.publishedNoteId === id) ctx.db.teachingPersonal.practiceId.update({ ...row, publishedNoteId: undefined });
  }
  if (kind === 'question') {
    for (const row of ctx.db.noteDetail.iter()) if (row.questionIds.includes(id)) ctx.db.noteDetail.noteId.update({ ...row, questionIds: row.questionIds.filter((key) => key !== id) });
    for (const row of ctx.db.noteVersion.iter()) if (row.questionIds.includes(id)) ctx.db.noteVersion.id.update({ ...row, questionIds: row.questionIds.filter((key) => key !== id) });
  }
  if (kind === 'note' || kind === 'guide') drop(ctx.db.questionLink.iter(), (row) => row.targetKind === kind && row.targetId === id, (key) => ctx.db.questionLink.id.delete(key));
}
function purgeOne(ctx: Ctx, row: RetentionRow) {
  const current = ctx.db.contentRetention.key.find(row.key);
  if (!current || current.generation !== row.generation) return false;
  row = current;
  if (row.state !== 'pending' || !retentionExpired(ctx.timestamp.microsSinceUnixEpoch, row.expiresAt.microsSinceUnixEpoch)) return false;
  const targets = new Set([row.key]);
  if (row.kind === 'question') for (const answer of ctx.db.answer.questionId.filter(row.targetId)) targets.add(keyOf('answer', answer.id));
  if (row.kind === 'feed_post') for (const comment of ctx.db.feedComment.postId.filter(row.targetId)) targets.add(keyOf('feed_comment', comment.id));
  // Guardar únicamente firmas internas y crédito canónico antes de eliminar las fuentes.
  rememberContributionOrigins(ctx, targets);
  ctx.db.contentRetention.key.update({ ...row, state: 'purging' });
  for (const target of targets) {
    const split = target.indexOf(':'); const kind = target.slice(0, split); const id = BigInt(target.slice(split + 1));
    purgeAiSource(ctx, kind, id);
    purgeMuseum(ctx.db, kind, id);
    purgeAgentSource(ctx.db, kind, id);
    purgeGuideAiSource(ctx, kind, id); purgeDocumentSource(ctx, kind, id);
    purgeExamSource(ctx, kind, id); purgeExamSpacedSource(ctx, kind, id); purgePresentationAiSource(ctx, kind, id);
    unlinkSources(ctx, kind, id);
    if (kind === 'note') {
      drop(ctx.db.noteComment.iter(), (item) => item.noteId === id, (key) => ctx.db.noteComment.id.delete(key));
      drop(ctx.db.noteVersion.iter(), (item) => item.noteId === id, (key) => ctx.db.noteVersion.id.delete(key));
      ctx.db.noteDetail.noteId.delete(id); ctx.db.note.id.delete(id);
    } else if (kind === 'guide') {
      drop(ctx.db.guideVersion.iter(), (item) => item.guideId === id, (key) => ctx.db.guideVersion.id.delete(key));
      drop(ctx.db.guideSource.iter(), (item) => item.guideId === id, (key) => ctx.db.guideSource.id.delete(key));
      drop(ctx.db.guideReview.iter(), (item) => item.guideId === id, (key) => ctx.db.guideReview.id.delete(key));
      ctx.db.studyGuide.id.delete(id);
    } else if (kind === 'question') {
      drop(ctx.db.questionComment.iter(), (item) => item.questionId === id, (key) => ctx.db.questionComment.id.delete(key));
      drop(ctx.db.questionLink.iter(), (item) => item.questionId === id, (key) => ctx.db.questionLink.id.delete(key));
      ctx.db.question.id.delete(id);
    } else if (kind === 'answer') {
      drop(ctx.db.questionComment.iter(), (item) => item.answerId === id, (key) => ctx.db.questionComment.id.delete(key));
      for (const vote of ctx.db.answerUsefulness.answerId.filter(id)) ctx.db.answerUsefulness.key.delete(vote.key);
      for (const question of ctx.db.question.iter()) if (question.acceptedAnswerId === id) ctx.db.question.id.update({ ...question,
        acceptedAnswerId: undefined, status: 'open', resolvedAt: undefined });
      ctx.db.answer.id.delete(id);
    } else if (kind === 'work') {
      drop(ctx.db.workRevision.iter(), (item) => item.workId === id, (key) => ctx.db.workRevision.id.delete(key));
      drop(ctx.db.workReview.iter(), (item) => item.workId === id, (key) => ctx.db.workReview.id.delete(key));
      drop(ctx.db.workAuthor.iter(), (item) => item.workId === id, (key) => ctx.db.workAuthor.id.delete(key));
      drop(ctx.db.workFile.iter(), (item) => item.workId === id, (key) => ctx.db.workFile.id.delete(key));
      ctx.db.workDetail.workId.delete(id); ctx.db.work.id.delete(id);
    } else if (kind === 'evidence') { ctx.db.evidenceDetail.evidenceId.delete(id); ctx.db.evidence.id.delete(id); }
    else if (kind === 'feed_post') {
      for (const reaction of [...ctx.db.feedReaction.target.filter(`post:${id}`)]) ctx.db.feedReaction.key.delete(reaction.key);
      ctx.db.feedPost.id.delete(id);
    } else if (kind === 'feed_comment') ctx.db.feedComment.id.delete(id);
    else if (kind === 'group_message' || kind === 'channel_message') {
      const message = kind === 'group_message' ? ctx.db.groupMessage.id.find(id) : ctx.db.channelMessage.id.find(id);
      if (message) {
        const minimal = { ...message, sender: ctx.identity, text: '', editedAt: undefined, deletedAt: ctx.timestamp, deletedBy: undefined };
        if (kind === 'group_message') ctx.db.groupMessage.id.update(minimal);
        else ctx.db.channelMessage.id.update({ ...ctx.db.channelMessage.id.find(id)!, ...minimal });
      }
      const scope = kind === 'group_message' ? 'group' : 'channel';
      drop(ctx.db.messageReaction.iter(), (item) => item.scope === scope && item.messageId === id, (key) => ctx.db.messageReaction.id.delete(key));
    }
    drop(ctx.db.academicComment.iter(), (item) => item.targetKind === kind && item.targetId === id, (key) => ctx.db.academicComment.id.delete(key));
    ctx.db.resourceVersion.key.delete(target); ctx.db.contentStatus.key.delete(target);
    if (target !== row.key) {
      const childRetention = ctx.db.contentRetention.key.find(target);
      // Las respuestas activas también necesitan un marcador mínimo: permite revisar
      // archivos retenidos por referencias cuando esas referencias desaparezcan después.
      const marker = { ...(childRetention ?? { ...row, key: target, kind, targetId: id, generation: 1 }), state: 'purged', purgedAt: ctx.timestamp };
      if (childRetention) ctx.db.contentRetention.key.update(marker); else ctx.db.contentRetention.insert(marker);
      if (childRetention?.state !== 'purged') audit(ctx, marker, 'purge', 'maintenance');
    }
    // El registro de auditoría conserva roles, nunca el motivo ni la identidad del autor.
    drop(ctx.db.changeLog.iter(), (item) => (item.entity === kind || kind === 'guide' && item.entity === 'study_guide') && item.entityId === id.toString(), (key) => ctx.db.changeLog.id.delete(key));
  }
  const keys = new Set<string>();
  for (const file of [...ctx.db.resourceFile.iter()]) if (targets.has(keyOf(file.targetKind, file.targetId)) || retentionBlocksRead(ctx.db, file.targetKind, file.targetId)) {
    if (fileReferenced(ctx.db, file.id)) {
      ctx.db.resourceFile.id.update({ ...file, name: 'Archivo conservado por referencia', uploadedBy: ctx.identity });
    } else { keys.add(file.storageKey); ctx.db.resourceFile.id.delete(file.id); }
    drop(ctx.db.changeLog.iter(), (item) => item.entity === 'resource_file' && item.entityId === file.id, (key) => ctx.db.changeLog.id.delete(key));
  }
  for (const intent of [...ctx.db.fileUploadIntent.iter()]) if (targets.has(keyOf(intent.targetKind, intent.targetId))) ctx.db.fileUploadIntent.id.delete(intent.id);
  for (const upload of [...ctx.db.resourceUpload.iter()]) if (targets.has(keyOf(upload.targetKind, upload.targetId))) {
    keys.add(`stdb:${upload.id}`);
    if ([...ctx.db.resourceFile.iter()].some((file) => file.storageKey === `stdb:${upload.id}`)) {
      ctx.db.resourceUpload.id.update({ ...upload, actor: ctx.identity, name: 'Archivo conservado por referencia', targetKind: 'retained', targetId: 0n });
    }
  }
  for (const storageKey of keys) releaseUnreferencedBytes(ctx, storageKey);
  ctx.db.contentRetention.key.update({ ...row, state: 'purged', purgedAt: ctx.timestamp }); audit(ctx, row, 'purge', 'maintenance');
  return true;
}
export function purgeDue(ctx: Ctx, input: { batchSize: number }) {
  assertMaintenance(ctx);
  if (!Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 20) throw new SenderError('El lote debe contener entre 1 y 20 publicaciones.');
  // Migración aditiva: los retirados anteriores respetan su fecha original, sin reiniciar los 30 días.
  let migrated = 0;
  for (const status of ctx.db.contentStatus.iter()) if (status.withdrawnAt && KINDS.includes(status.kind) && !ctx.db.contentRetention.key.find(status.key)) {
    scheduleRetention(ctx, status.kind, status.targetId, 'migration'); if (++migrated >= input.batchSize) break;
  }
  const due = [...ctx.db.contentRetention.iter()].filter((row) => row.state === 'pending' && retentionExpired(ctx.timestamp.microsSinceUnixEpoch, row.expiresAt.microsSinceUnixEpoch))
    .sort((a, b) => a.expiresAt.microsSinceUnixEpoch < b.expiresAt.microsSinceUnixEpoch ? -1 : a.key.localeCompare(b.key));
  let processed = 0;
  for (const row of due.slice(0, input.batchSize)) if (purgeOne(ctx, row)) processed++;
  const legacyRemaining = [...ctx.db.contentStatus.iter()].filter((status) => status.withdrawnAt && KINDS.includes(status.kind) && !ctx.db.contentRetention.key.find(status.key)).length;
  const pendingDue = [...ctx.db.contentRetention.iter()].filter((row) => row.state === 'pending' && retentionExpired(ctx.timestamp.microsSinceUnixEpoch, row.expiresAt.microsSinceUnixEpoch)).length;
  return { processed, remaining: pendingDue + legacyRemaining };
}
export function expireContent(ctx: Ctx, input: { key: string; generation: number }) {
  if (!memberIdentityFor(ctx).isEqual(ctx.identity)) throw new SenderError('Solo el programador interno puede vencer el contenido.');
  const row = ctx.db.contentRetention.key.find(input.key);
  if (row?.generation === input.generation) purgeOne(ctx, row);
}
