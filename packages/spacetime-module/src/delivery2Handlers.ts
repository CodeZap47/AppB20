import { SenderError } from 'spacetimedb/server';
import { Identity } from 'spacetimedb';
import { retentionBlocksRead } from './trashHandlers';
import { activeMember, attachmentIds, isActive, messageText, readableMessage,
  requireGuide, requireSubject, requireText, type Ctx, type ViewDb } from './moduleContext';

export const extraKinds = ['note', 'guide', 'question', 'answer', 'group_message', 'direct_message', 'channel_message', 'profile'] as const;
export function withdrawn(db: ViewDb, kind: string, id: bigint) {
  return db.contentStatus.key.find(`${kind}:${id}`)?.withdrawnAt !== undefined;
}
export function contentOwner(db: ViewDb, kind: string, id: bigint) {
  if (kind === 'note') return db.note.id.find(id)?.author;
  if (kind === 'guide') return db.studyGuide.id.find(id)?.createdBy;
  if (kind === 'question') return db.question.id.find(id)?.author;
  if (kind === 'answer') return db.answer.id.find(id)?.author;
  if (kind === 'work') return db.work.id.find(id)?.createdBy;
  if (kind === 'evidence') return db.evidence.id.find(id)?.author;
  return undefined;
}
function statusReadable(db: ViewDb, sender: Ctx['sender'], kind: string, id: bigint) {
  return !withdrawn(db, kind, id) || contentOwner(db, kind, id)?.isEqual(sender) === true || db.member.identity.find(sender)?.isCreator === true
    || (kind === 'work' && [...db.workAuthor.workId.filter(id)].some((r) => r.author.isEqual(sender)));
}
export function canReadTarget(db: ViewDb, sender: Ctx['sender'], kind: string, id: bigint): boolean {
  if (!isActive(db, sender)) return false;
  if (retentionBlocksRead(db, kind, id)) return false;
  if (kind === 'note') {
    const row = db.note.id.find(id);
    return !!row && (row.author.isEqual(sender) || row.visibility === 'group') && statusReadable(db, sender, kind, id);
  }
  if (kind === 'guide') return !!db.studyGuide.id.find(id) && statusReadable(db, sender, kind, id);
  if (kind === 'question') return !!db.question.id.find(id) && statusReadable(db, sender, kind, id);
  if (kind === 'answer') {
    const row = db.answer.id.find(id);
    return !!row && canReadTarget(db, sender, 'question', row.questionId) && statusReadable(db, sender, kind, id);
  }
  if (kind === 'profile') {
    const row = db.memberProfile.id.find(id);
    return !!row && isActive(db, row.memberId);
  }
  if (kind === 'group_message') return !!db.groupMessage.id.find(id) && !db.groupMessage.id.find(id)?.deletedAt;
  if (kind === 'channel_message') {
    const row = db.channelMessage.id.find(id);
    return !!row && !row.deletedAt && !!db.chatChannel.id.find(row.channelId);
  }
  if (kind === 'direct_message') {
    const row = db.directMessage.id.find(id);
    const chat = row && db.directConversation.id.find(row.conversationId);
    return !!row && !row.deletedAt && !!chat && (chat.userA.isEqual(sender) || chat.userB.isEqual(sender));
  }
  if (kind === 'assignment') return !!db.assignment.id.find(id);
  if (kind === 'activity') return !!db.activity.id.find(id);
  if (kind === 'work') return !!db.work.id.find(id) && statusReadable(db, sender, kind, id);
  if (kind === 'evidence') return !!db.evidence.id.find(id) && statusReadable(db, sender, kind, id);
  return false;
}
export function reportFileReadable(db: ViewDb, sender: Ctx['sender'], fileId: string) {
  if (!isActive(db, sender)) return false;
  const admin = db.member.identity.find(sender)?.isCreator === true;
  return [...db.messageReport.iter()].some((row) => row.attachmentIds.includes(fileId) && (admin || row.reporter.isEqual(sender)));
}
export function extraVersion(ctx: Ctx, kind: string, id: bigint): number {
  if (kind === 'note') {
    const row = ctx.db.note.id.find(id); if (!row) throw new SenderError('La nota no existe.'); return row.version;
  }
  if (kind === 'guide') return requireGuide(ctx, id).version;
  if (kind === 'profile') {
    const row = ctx.db.memberProfile.id.find(id); if (!row) throw new SenderError('El perfil no existe.'); return row.version;
  }
  const exists = kind === 'question' ? !!ctx.db.question.id.find(id) : kind === 'answer' ? !!ctx.db.answer.id.find(id)
    : kind === 'group_message' ? !!ctx.db.groupMessage.id.find(id) : kind === 'direct_message' ? !!ctx.db.directMessage.id.find(id)
      : kind === 'channel_message' ? !!ctx.db.channelMessage.id.find(id) : false;
  if (!exists) throw new SenderError('El recurso no existe.');
  return ctx.db.resourceVersion.key.find(`${kind}:${id}`)?.version ?? 1;
}
export function extraWriter(ctx: Ctx, kind: string, id: bigint, actor: Ctx['sender']) {
  if (!canReadTarget(ctx.db, actor, kind, id) || withdrawn(ctx.db, kind, id)) throw new SenderError('El recurso no está disponible.');
  let owner;
  if (kind === 'note') owner = ctx.db.note.id.find(id)?.author;
  else if (kind === 'question') owner = ctx.db.question.id.find(id)?.author;
  else if (kind === 'answer') owner = ctx.db.answer.id.find(id)?.author;
  else if (kind === 'profile') owner = ctx.db.memberProfile.id.find(id)?.memberId;
  else if (kind === 'group_message') owner = ctx.db.groupMessage.id.find(id)?.sender;
  else if (kind === 'direct_message') {
    const row = ctx.db.directMessage.id.find(id)!;
    const chat = ctx.db.directConversation.id.find(row.conversationId)!;
    assertDirectAllowed(ctx, actor, chat.userA.isEqual(actor) ? chat.userB : chat.userA);
    owner = row.sender;
  } else if (kind === 'channel_message') {
    const row = ctx.db.channelMessage.id.find(id)!;
    if (ctx.db.chatChannel.id.find(row.channelId)?.archivedAt) throw new SenderError('El canal está archivado.');
    owner = row.sender;
  }
  if (kind !== 'guide' && !owner?.isEqual(actor)) throw new SenderError('Solo el autor modifica los archivos de este recurso.');
}
export function captureNote(ctx: Ctx, id: bigint, actor?: Ctx['sender'], restoredFromVersion?: number) {
  const row = ctx.db.note.id.find(id);
  if (!row || [...ctx.db.noteVersion.noteId.filter(id)].some((v) => v.version === row.version)) return;
  const detail = ctx.db.noteDetail.noteId.find(id);
  ctx.db.noteVersion.insert({ id: 0n, noteId: id, version: row.version, subjectId: row.subjectId,
    termId: detail?.termId, session: detail?.session ?? '', topic: row.topic, title: row.title, body: row.body,
    tags: row.tags, visibility: row.visibility, source: row.source, author: row.author,
    assignmentIds: detail?.assignmentIds ?? [], activityIds: detail?.activityIds ?? [], questionIds: detail?.questionIds ?? [],
    attachmentIds: attachmentIds(ctx, 'note', id), editedBy: actor, editedAt: row.updatedAt, restoredFromVersion });
}
export function captureGuide(ctx: Ctx, id: bigint, actor?: Ctx['sender'], restoredFromVersion?: number) {
  const row = ctx.db.studyGuide.id.find(id);
  if (!row || [...ctx.db.guideVersion.guideId.filter(id)].some((v) => v.version === row.version)) return;
  const provenanceKey = `${id}:${row.version}`;
  if (!ctx.db.guideAiProvenance.key.find(provenanceKey)) {
    const prior = ctx.db.guideAiProvenance.key.find(`${id}:${restoredFromVersion ?? row.version - 1}`);
    if (prior) {
      const provenance = JSON.parse(prior.json) as { citations?: { id: string; content: string; citations: string[] }[]; editedAfterGeneration?: boolean };
      if (restoredFromVersion === undefined && provenance.citations?.some((section, index) => section.content !== row.sections[index])) {
        provenance.editedAfterGeneration = true;
        provenance.citations = provenance.citations.map((section, index) => ({ ...section, content: row.sections[index] ?? '' }));
      }
      ctx.db.guideAiProvenance.insert({ ...prior, key: provenanceKey, guideVersion: row.version, json: JSON.stringify(provenance) });
    }
  }
  ctx.db.guideVersion.insert({ id: 0n, guideId: id, version: row.version, subjectId: row.subjectId,
    termId: row.termId, title: row.title, topics: row.topics, sections: row.sections,
    sources: [...ctx.db.guideSource.guideId.filter(id)].map(({ kind, refId, sourceVersion, status, reason, topics, addedBy, addedAt }) => ({ kind, refId, sourceVersion, status, reason, topics, addedBy, addedAt })),
    attachmentIds: attachmentIds(ctx, 'guide', id), editedBy: actor ?? row.updatedBy, editedAt: row.updatedAt, restoredFromVersion });
}
export function bumpExtra(ctx: Ctx, kind: string, id: bigint, actor = ctx.sender) {
  const version = extraVersion(ctx, kind, id) + 1;
  if (kind === 'note') {
    ctx.db.note.id.update({ ...ctx.db.note.id.find(id)!, version, updatedAt: ctx.timestamp }); captureNote(ctx, id, actor);
  } else if (kind === 'guide') {
    ctx.db.studyGuide.id.update({ ...requireGuide(ctx, id), version, updatedBy: actor, updatedAt: ctx.timestamp }); captureGuide(ctx, id, actor);
  } else if (kind === 'profile') {
    const latest = [...ctx.db.resourceFile.targetId.filter(id)].filter((f) => f.targetKind === kind && f.removedAt === undefined)
      .sort((a, b) => a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1)[0];
    ctx.db.memberProfile.id.update({ ...ctx.db.memberProfile.id.find(id)!, version, photoFileId: latest?.id, updatedAt: ctx.timestamp });
  } else {
    const row = { key: `${kind}:${id}`, targetKind: kind, targetId: id, version };
    if (ctx.db.resourceVersion.key.find(row.key)) ctx.db.resourceVersion.key.update(row); else ctx.db.resourceVersion.insert(row);
  }
}
export function assertDirectAllowed(ctx: Ctx, actor: Ctx['sender'], other: Ctx['sender']) {
  if (!isActive(ctx.db, other)) throw new SenderError('Ese compañero no está activo.');
  const key = (a: Ctx['sender'], b: Ctx['sender']) => `${a.toHexString()}:${b.toHexString()}`;
  if (ctx.db.memberBlock.key.find(key(actor, other)) || ctx.db.memberBlock.key.find(key(other, actor))) {
    throw new SenderError('No se pueden enviar mensajes entre estas cuentas.');
  }
}
export function validateMentions(ctx: Ctx, text: string, allowed?: Ctx['sender'][]) {
  for (const match of text.matchAll(/\[\[mencion:([^\]]+)\]\]/g)) {
    if (!/^[a-f0-9]{64}$/i.test(match[1])) throw new SenderError('La mención no es válida.');
    const identity = Identity.fromString(match[1]);
    if (!isActive(ctx.db, identity) || (allowed && !allowed.some((person) => person.isEqual(identity)))) {
      throw new SenderError('La persona mencionada no participa en esta conversación.');
    }
  }
}
export function channel(ctx: Ctx, id: bigint, writing = false) {
  activeMember(ctx);
  const row = ctx.db.chatChannel.id.find(id);
  if (!row) throw new SenderError('El canal no existe.');
  if (writing && row.archivedAt) throw new SenderError('El canal está archivado.');
  return row;
}
export function conversationAccess(ctx: Ctx, scope: string, conversationId: string) {
  activeMember(ctx);
  if (scope === 'group' && conversationId === 'general') return;
  if (!/^[1-9][0-9]{0,19}$/.test(conversationId)) throw new SenderError('La conversación no es válida.');
  const id = BigInt(conversationId);
  if (scope === 'channel') { channel(ctx, id); return; }
  if (scope === 'direct') {
    const row = ctx.db.directConversation.id.find(id);
    if (row && (row.userA.isEqual(ctx.sender) || row.userB.isEqual(ctx.sender))) return;
  }
  throw new SenderError('No participas en esa conversación.');
}

export function createChatChannel(ctx: Ctx, input: { name: string; kind: string; subjectId?: bigint }) {
  activeMember(ctx);
  if (!['subject', 'topic', 'project'].includes(input.kind)) throw new SenderError('Tipo de canal inválido.');
  if (input.kind === 'subject' && input.subjectId === undefined) throw new SenderError('Selecciona la materia del canal.');
  if (input.subjectId !== undefined) requireSubject(ctx, input.subjectId);
  const name = requireText(input.name, 'El nombre', 80);
  if ([...ctx.db.chatChannel.iter()].some((c) => c.kind === input.kind && c.subjectId === input.subjectId && c.name.toLowerCase() === name.toLowerCase() && !c.archivedAt)) {
    throw new SenderError('Ya existe un canal con ese nombre y clasificación.');
  }
  ctx.db.chatChannel.insert({ id: 0n, ...input, subjectId: input.subjectId, name, createdBy: ctx.sender, createdAt: ctx.timestamp, archivedAt: undefined });
}
export function sendChannelMessage(ctx: Ctx, input: { channelId: bigint; text: string; replyToId?: bigint }) {
  channel(ctx, input.channelId, true); validateMentions(ctx, input.text);
  if (input.replyToId !== undefined) {
    const reply = ctx.db.channelMessage.id.find(input.replyToId);
    if (!reply || reply.channelId !== input.channelId || reply.deletedAt) throw new SenderError('La respuesta no pertenece a este canal.');
  }
  const message = ctx.db.channelMessage.insert({ id: 0n, ...input, replyToId: input.replyToId, text: messageText(ctx, input.text), sender: ctx.sender, sentAt: ctx.timestamp,
    editedAt: undefined, deletedAt: undefined, deletedBy: undefined });
  return message.id;
}
export function markConversationRead(ctx: Ctx, input: { scope: string; conversationId: string; messageId: bigint }) {
  conversationAccess(ctx, input.scope, input.conversationId);
  const found = readableMessage(ctx, input.scope, input.messageId);
  const actual = found.scope === 'direct' ? found.row.conversationId.toString() : found.scope === 'channel' ? found.row.channelId.toString() : 'general';
  if (actual !== input.conversationId) throw new SenderError('El mensaje pertenece a otra conversación.');
  const key = `${ctx.sender.toHexString()}:${input.scope}:${input.conversationId}`;
  const old = ctx.db.conversationState.key.find(key);
  if (old?.readThroughId !== undefined && old.readThroughId >= input.messageId) return;
  const row = { key, memberId: ctx.sender, scope: input.scope, conversationId: input.conversationId,
    readThroughId: input.messageId, muted: old?.muted ?? false, updatedAt: ctx.timestamp };
  if (old) ctx.db.conversationState.key.update(row); else ctx.db.conversationState.insert(row);
}
export function reportMessage(ctx: Ctx, input: { scope: string; messageId: bigint; reason: string; shareText: boolean; attachmentIds: string[] }) {
  activeMember(ctx);
  const found = readableMessage(ctx, input.scope, input.messageId);
  if (found.row.deletedAt) throw new SenderError('El mensaje ya se eliminó.');
  if (found.row.sender.isEqual(ctx.sender)) throw new SenderError('No puedes reportar tu propio mensaje.');
  const kind = `${input.scope}_message`;
  const ids = [...new Set(input.attachmentIds)];
  if (ids.length > 20 || ids.some((id) => {
    const file = ctx.db.resourceFile.id.find(id);
    return !file || file.targetKind !== kind || file.targetId !== input.messageId || file.removedAt !== undefined;
  })) throw new SenderError('Solo puedes compartir adjuntos activos de este mensaje.');
  ctx.db.messageReport.insert({ id: 0n, reporter: ctx.sender, scope: input.scope, messageId: input.messageId,
    reason: requireText(input.reason, 'El motivo', 2000), evidenceText: input.shareText ? found.row.text : '', attachmentIds: ids,
    createdAt: ctx.timestamp, status: 'open', resolvedBy: undefined, resolvedAt: undefined });
}
