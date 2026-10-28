import { canDeleteMessage, canEditMessage, fileSizeError, isReaction, normalizeReaction } from '@b20/core';
import type { DirectConversation, DirectMessage, GroupMessage, Id, Member, MessageFields, MessageReaction, MessageScope, ResourceFile, ResourceTargetKind, ResourceTransferOptions, Snapshot, Subject } from './types';
import type { ChatChannel, ChannelMessage, ConversationState, CreateChatChannelInput, MessageReport, ReportMessageInput } from './chatTypes';
import { chatTarget, mentionedMembers } from '../lib/chat';

interface ChatState {
  members: Member[];
  subjects: Subject[];
  groupMessages: GroupMessage[];
  directConversations: DirectConversation[];
  directMessages: DirectMessage[];
  reactions: MessageReaction[];
}
interface Context {
  state(): ChatState;
  active(): Member;
  id(): Id;
  now(): Date;
  emit(): void;
  validateText(text: string, member: Member): string;
  available?(kind: string, id: Id): boolean;
}

const clean = (value: string, label: string, limit: number) => {
  const result = value.trim();
  if (!result || result.length > limit) throw new Error(`${label}: escribe entre 1 y ${limit} caracteres.`);
  return result;
};
type Presence = Snapshot['typingPresence'][number];
const sharedPresence = new WeakMap<object, Map<string, Presence>>();
interface SharedChat {
  channels: ChatChannel[]; messages: ChannelMessage[]; states: (ConversationState & { memberId: Id })[];
  blocks: { ownerId: Id; memberId: Id }[]; reports: MessageReport[]; files: ResourceFile[];
  blobs: Map<Id, Blob>; versions: Map<string, number>;
}
const sharedChats = new WeakMap<object, SharedChat>();

/** Canales, convivencia y archivos de la simulación, con el mismo aislamiento por usuario. */
export class DemoChatStore {
  private shared: SharedChat;
  private get channels() { return this.shared.channels; } private set channels(value: ChatChannel[]) { this.shared.channels = value; }
  private get messages() { return this.shared.messages; } private set messages(value: ChannelMessage[]) { this.shared.messages = value; }
  private get states() { return this.shared.states; } private set states(value: (ConversationState & { memberId: Id })[]) { this.shared.states = value; }
  private get blocks() { return this.shared.blocks; } private set blocks(value: { ownerId: Id; memberId: Id }[]) { this.shared.blocks = value; }
  private get reports() { return this.shared.reports; } private set reports(value: MessageReport[]) { this.shared.reports = value; }
  private get files() { return this.shared.files; } private set files(value: ResourceFile[]) { this.shared.files = value; }
  private get blobs() { return this.shared.blobs; }
  private get versions() { return this.shared.versions; }
  private presence: Map<string, Presence>;
  constructor(private ctx: Context) {
    const state = ctx.state();
    this.shared = sharedChats.get(state) ?? { channels: [], messages: [], states: [], blocks: [], reports: [], files: [], blobs: new Map(), versions: new Map() };
    sharedChats.set(state, this.shared);
    this.presence = sharedPresence.get(state) ?? new Map();
    sharedPresence.set(state, this.presence);
  }

  setTyping(scope: MessageScope, conversationId: Id, typing: boolean) {
    this.thread(scope, conversationId);
    const me = this.ctx.active();
    if (scope === 'channel' && this.channel(conversationId).archivedAt) throw new Error('El canal está archivado.');
    if (scope === 'direct') {
      const chat = this.ctx.state().directConversations.find((row) => row.id === conversationId)!;
      const other = chat.participantIds.find((id) => id !== me.id)!;
      if (!this.ctx.state().members.some((member) => member.id === other && member.status === 'active')) throw new Error('El compañero no está activo.');
      this.assertDirectAllowed(other);
    }
    const now = this.ctx.now();
    for (const [key, row] of this.presence) if (row.expiresAt <= now) this.presence.delete(key);
    const key = `${me.id}:${scope}:${conversationId}`;
    if (typing) this.presence.set(key, { memberId: me.id, scope, conversationId, expiresAt: new Date(now.getTime() + 7000) });
    else this.presence.delete(key);
    this.ctx.emit();
  }

  liveDraftVisible(viewerId: Id, row: { memberId: Id; scope: MessageScope; conversationId: Id }): boolean {
    const state = this.ctx.state();
    if (![viewerId, row.memberId].every((id) => state.members.some((member) => member.id === id && member.status === 'active'))) return false;
    if (this.blocks.some((block) => (block.ownerId === viewerId && block.memberId === row.memberId) || (block.ownerId === row.memberId && block.memberId === viewerId))) return false;
    if (row.scope === 'group') return row.conversationId === 'general';
    if (row.scope === 'channel') return this.channels.some((channel) => channel.id === row.conversationId && !channel.archivedAt);
    return state.directConversations.some((chat) => chat.id === row.conversationId && chat.participantIds.includes(viewerId) && chat.participantIds.includes(row.memberId)
      && chat.participantIds.every((id) => state.members.some((member) => member.id === id && member.status === 'active')));
  }

  receiptMessage(scope: MessageScope, id: Id, viewer: Id) {
    if (!this.ctx.state().members.some(member => member.id === viewer && member.status === 'active')) return;
    const message = scope === 'group' ? this.ctx.state().groupMessages.find(row => row.id === id)
      : scope === 'direct' ? this.ctx.state().directMessages.find(row => row.id === id) : this.messages.find(row => row.id === id);
    if (!message || message.deletedAt || this.ctx.available?.(`${scope}_message`, id) === false) return;
    const conversationId = scope === 'direct' ? (message as DirectMessage).conversationId : scope === 'channel' ? (message as ChannelMessage).channelId : 'general';
    if (scope === 'channel' && !this.channels.some(channel => channel.id === conversationId)) return;
    const direct = scope === 'direct' ? this.ctx.state().directConversations.find(chat => chat.id === conversationId) : undefined;
    if (scope === 'direct' && (!direct?.participantIds.includes(viewer) || this.blocks.some(block => direct.participantIds.includes(block.ownerId) && direct.participantIds.includes(block.memberId)))) return;
    return { message, conversationId, recipients: direct?.participantIds ?? this.ctx.state().members.filter(member => member.status === 'active').map(member => member.id) };
  }

  handles(kind: string): boolean { return ['group_message', 'direct_message', 'channel_message'].includes(kind); }
  private scope(kind: string): MessageScope {
    if (!this.handles(kind)) throw new Error('Tipo de mensaje inválido.');
    return kind === 'group_message' ? 'group' : kind === 'direct_message' ? 'direct' : 'channel';
  }
  versionOf(scope: MessageScope, id: Id): number { return this.versions.get(`${scope}:${id}`) ?? 1; }
  private bump(scope: MessageScope, id: Id) { this.versions.set(`${scope}:${id}`, this.versionOf(scope, id) + 1); }
  bumpVersion(scope: MessageScope, id: Id) { this.bump(scope, id); }
  resources(): ResourceFile[] { return this.files; }
  moderationReports(): MessageReport[] { return this.reports; }
  purgeManaged(targets: ReadonlySet<string>) {
    const purge = <T extends MessageFields>(row: T, kind: string): T => targets.has(`${kind}:${row.id}`) ? { ...row, text: '', senderId: '', editedAt: undefined, deletedBy: undefined, deletedAt: this.ctx.now() } : row;
    this.ctx.state().groupMessages = this.ctx.state().groupMessages.map((row) => purge(row, 'group_message'));
    this.messages = this.messages.map((row) => purge(row, 'channel_message'));
    this.ctx.state().reactions = this.ctx.state().reactions.filter((row) => !targets.has(`${row.scope}_message:${row.messageId}`));
    const referenced = new Set(this.reports.flatMap((row) => row.attachmentIds));
    this.files = this.files.filter((row) => {
      if (!targets.has(`${row.targetKind}:${row.targetId}`)) return true;
      if (referenced.has(row.id)) { row.name = 'Archivo conservado por referencia'; row.uploadedBy = ''; return true; }
      this.blobs.delete(row.id); return false;
    });
  }
  private expect(scope: MessageScope, id: Id, expected?: number) {
    if (expected !== undefined && expected !== this.versionOf(scope, id)) throw new Error('Los archivos del mensaje cambiaron. Actualiza antes de continuar.');
  }

  validateMentions(text: string, allowedIds?: Id[]) {
    for (const id of mentionedMembers(text)) {
      if (!this.ctx.state().members.some((member) => member.id === id && member.status === 'active') || (allowedIds && !allowedIds.includes(id))) {
        throw new Error('Solo puedes mencionar integrantes activos de esta conversación.');
      }
    }
    return text;
  }
  assertDirectAllowed(otherId: Id) {
    const me = this.ctx.active();
    if (this.blocks.some((row) => (row.ownerId === me.id && row.memberId === otherId) || (row.ownerId === otherId && row.memberId === me.id))) throw new Error('No se pueden enviar mensajes a esta conversación.');
  }
  private channel(id: Id) {
    this.ctx.active();
    const row = this.channels.find((channel) => channel.id === id);
    if (!row) throw new Error('El canal no está disponible.');
    return row;
  }
  private thread(scope: MessageScope, conversationId: Id): MessageFields[] {
    const me = this.ctx.active();
    if (scope === 'group') {
      if (conversationId !== 'general') throw new Error('Canal general inválido.');
      return this.ctx.state().groupMessages;
    }
    if (scope === 'channel') { this.channel(conversationId); return this.messages.filter((row) => row.channelId === conversationId); }
    if (scope !== 'direct') throw new Error('Conversación inválida.');
    const conversation = this.ctx.state().directConversations.find((row) => row.id === conversationId && row.participantIds.includes(me.id));
    if (!conversation) throw new Error('No participas en esta conversación.');
    return this.ctx.state().directMessages.filter((row) => row.conversationId === conversationId);
  }
  private message(scope: MessageScope, id: Id): MessageFields {
    const me = this.ctx.active();
    if (scope === 'group') {
      const row = this.ctx.state().groupMessages.find((message) => message.id === id);
      if (row) return row;
    } else if (scope === 'channel') {
      const row = this.messages.find((message) => message.id === id);
      if (row) { this.channel(row.channelId); return row; }
    } else if (scope === 'direct') {
      const row = this.ctx.state().directMessages.find((message) => message.id === id);
      if (row && this.ctx.state().directConversations.some((conversation) => conversation.id === row.conversationId && conversation.participantIds.includes(me.id))) return row;
    }
    throw new Error('El mensaje no está disponible.');
  }
  channelMessages(): ChannelMessage[] { this.ctx.active(); return this.messages; }
  channelMessage(id: Id): ChannelMessage { return this.message('channel', id) as ChannelMessage; }

  createChatChannel(input: CreateChatChannelInput): Id {
    const me = this.ctx.active();
    const name = clean(input.name, 'Nombre del canal', 80);
    if (!['subject', 'topic', 'project'].includes(input.kind)) throw new Error('Tipo de canal inválido.');
    if (input.kind === 'subject' && !this.ctx.state().subjects.some((subject) => subject.id === input.subjectId)) throw new Error('Elige una materia existente.');
    if (this.channels.some((channel) => !channel.archivedAt && channel.kind === input.kind && channel.subjectId === input.subjectId && channel.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('Ya hay un canal activo con ese nombre y clasificación.');
    const row: ChatChannel = { id: this.ctx.id(), name, kind: input.kind, subjectId: input.kind === 'subject' ? input.subjectId : undefined, createdBy: me.id, createdAt: this.ctx.now() };
    this.channels.push(row); this.ctx.emit(); return row.id;
  }
  setChatChannelArchived(id: Id, archived: boolean) {
    const me = this.ctx.active(); const row = this.channel(id);
    if (row.createdBy !== me.id && !me.isCreator) throw new Error('Solo el creador del canal o un administrador puede archivarlo.');
    if (Boolean(row.archivedAt) === archived) return;
    row.archivedAt = archived ? this.ctx.now() : undefined; this.ctx.emit();
  }
  sendChannelMessage(channelId: Id, text: string, replyToId?: Id): Id {
    const me = this.ctx.active(); const channel = this.channel(channelId);
    if (channel.archivedAt) throw new Error('El canal está archivado.');
    const content = this.validateMentions(this.ctx.validateText(text, me));
    if (replyToId && !this.messages.some((message) => message.id === replyToId && message.channelId === channelId && !message.deletedAt && this.ctx.available?.('channel_message', message.id) !== false)) throw new Error('La respuesta debe pertenecer al mismo canal.');
    const row: ChannelMessage = { id: this.ctx.id(), channelId, text: content, senderId: me.id, sentAt: this.ctx.now(), replyToId };
    this.messages.push(row); this.ctx.emit(); return row.id;
  }
  editMessage(scope: MessageScope, id: Id, text: string) {
    const me = this.ctx.active(); const row = this.message(scope, id);
    if (this.ctx.available?.(`${scope}_message`, id) === false) throw new Error('El mensaje está retirado.');
    if (scope !== 'channel' || !canEditMessage(me.id, row, this.ctx.now())) throw new Error('No puedes editar este mensaje.');
    row.text = this.validateMentions(this.ctx.validateText(text, me)); row.editedAt = this.ctx.now(); this.bump(scope, id); this.ctx.emit();
  }
  deleteMessage(scope: MessageScope, id: Id) {
    const me = this.ctx.active(); const row = this.message(scope, id);
    if (this.ctx.available?.(`${scope}_message`, id) === false) throw new Error('El mensaje está retirado.');
    if (scope !== 'channel' || !canDeleteMessage(me.id, row, 'group', me.isCreator)) throw new Error('No puedes eliminar este mensaje.');
    row.text = ''; row.deletedAt = this.ctx.now(); row.deletedBy = me.id;
    this.bump(scope, id);
    this.ctx.state().reactions = this.ctx.state().reactions.filter((reaction) => reaction.scope !== scope || reaction.messageId !== id); this.ctx.emit();
  }
  toggleReaction(scope: MessageScope, id: Id, emoji: string) {
    emoji = normalizeReaction(emoji) ?? emoji;
    const me = this.ctx.active(); const row = this.message(scope, id);
    if (this.ctx.available?.(`${scope}_message`, id) === false) throw new Error('El mensaje está retirado.');
    if (scope !== 'channel' || row.deletedAt || !isReaction(emoji)) throw new Error('No puedes reaccionar a este mensaje.');
    const mine = (reaction: MessageReaction) => reaction.scope === scope && reaction.messageId === id && reaction.memberId === me.id;
    const previous = this.ctx.state().reactions.find(mine);
    this.ctx.state().reactions = this.ctx.state().reactions.filter((reaction) => !mine(reaction));
    if (previous?.emoji !== emoji) this.ctx.state().reactions.push({ scope, messageId: id, memberId: me.id, emoji }); this.ctx.emit();
  }
  markConversationRead(scope: MessageScope, conversationId: Id, messageId: Id) {
    const me = this.ctx.active(); const messages = this.thread(scope, conversationId);
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) throw new Error('Ese mensaje no pertenece a esta conversación.');
    const previous = this.states.find((row) => row.memberId === me.id && row.scope === scope && row.conversationId === conversationId);
    if (previous) {
      if (messages.findIndex((message) => message.id === previous.readThroughId) >= index) return;
      previous.readThroughId = messageId;
    } else this.states.push({ memberId: me.id, scope, conversationId, readThroughId: messageId, muted: false });
    this.ctx.emit();
  }
  setConversationMuted(scope: MessageScope, conversationId: Id, muted: boolean) {
    const me = this.ctx.active(); this.thread(scope, conversationId);
    const row = this.states.find((state) => state.memberId === me.id && state.scope === scope && state.conversationId === conversationId);
    if (row) row.muted = muted; else this.states.push({ memberId: me.id, scope, conversationId, muted }); this.ctx.emit();
  }
  setMemberBlocked(memberId: Id, blocked: boolean) {
    const me = this.ctx.active();
    if (memberId === me.id || !this.ctx.state().members.some((member) => member.id === memberId)) throw new Error('Compañero inválido.');
    this.blocks = this.blocks.filter((row) => row.ownerId !== me.id || row.memberId !== memberId);
    if (blocked) this.blocks.push({ ownerId: me.id, memberId }); this.ctx.emit();
  }
  reportMessage(input: ReportMessageInput): Id {
    const me = this.ctx.active(); const message = this.message(input.scope, input.messageId);
    if (this.ctx.available?.(`${input.scope}_message`, input.messageId) === false) throw new Error('El mensaje está retirado.');
    if (message.deletedAt || message.senderId === me.id) throw new Error('Elige un mensaje recibido que siga disponible.');
    const ids = [...new Set(input.attachmentIds)];
    for (const id of ids) if (!this.files.some((file) => file.id === id && file.targetKind === chatTarget(input.scope) && file.targetId === message.id && !file.removedAt)) throw new Error('Uno de los adjuntos elegidos no pertenece al mensaje.');
    const report: MessageReport = { id: this.ctx.id(), scope: input.scope, messageId: message.id, reporterId: me.id, reason: clean(input.reason, 'Motivo', 2000), evidenceText: input.shareText ? message.text : '', attachmentIds: ids, createdAt: this.ctx.now(), status: 'open' };
    this.reports.push(report); this.ctx.emit(); return report.id;
  }
  resolveMessageReport(id: Id) {
    const me = this.ctx.active(); if (!me.isCreator) throw new Error('Solo los creadores atienden reportes.');
    const report = this.reports.find((row) => row.id === id); if (!report) throw new Error('Reporte no disponible.');
    report.status = 'resolved'; this.ctx.emit();
  }
  private readableFile(file: ResourceFile): boolean {
    const me = this.ctx.active();
    if (this.reports.some((report) => report.attachmentIds.includes(file.id) && (report.reporterId === me.id || me.isCreator))) return true;
    if (this.ctx.available?.(file.targetKind, file.targetId) === false) return false;
    try { return !this.message(this.scope(file.targetKind), file.targetId).deletedAt && !file.removedAt; } catch { return false; }
  }
  private writable(scope: MessageScope, id: Id) {
    const me = this.ctx.active(); const row = this.message(scope, id);
    if (this.ctx.available?.(`${scope}_message`, id) === false) throw new Error('El mensaje está retirado.');
    if (row.senderId !== me.id || row.deletedAt) throw new Error('Solo el autor adjunta o retira archivos de su mensaje.');
    if (scope === 'channel' && this.channel((row as ChannelMessage).channelId).archivedAt) throw new Error('El canal está archivado.');
    if (scope === 'direct') {
      const conversation = this.ctx.state().directConversations.find((conversation) => conversation.id === (row as DirectMessage).conversationId)!;
      this.assertDirectAllowed(conversation.participantIds.find((id) => id !== me.id)!);
    }
    return me;
  }
  async attachResourceFile(kind: ResourceTargetKind, targetId: Id, file: File, expected?: number, transfer?: ResourceTransferOptions): Promise<Id> {
    const scope = this.scope(kind); const me = this.writable(scope, targetId); this.expect(scope, targetId, expected);
    const problem = fileSizeError(file.name, file.size); if (problem) throw new Error(problem);
    transfer?.signal?.throwIfAborted();
    const id = this.ctx.id();
    this.files.push({ id, targetKind: kind, targetId, name: file.name, size: file.size, contentType: file.type || 'application/octet-stream', uploadedBy: me.id, createdAt: this.ctx.now() });
    this.blobs.set(id, file); this.bump(scope, targetId); transfer?.onProgress?.(file.size, file.size); this.ctx.emit(); return id;
  }
  removeResourceFile(id: Id, expected?: number) {
    const file = this.files.find((row) => row.id === id); if (!file) throw new Error('Archivo no disponible.');
    const scope = this.scope(file.targetKind); this.writable(scope, file.targetId); this.expect(scope, file.targetId, expected);
    if (!file.removedAt) { file.removedAt = this.ctx.now(); this.bump(scope, file.targetId); this.ctx.emit(); }
  }
  restoreResourceFile(id: Id, expected?: number) {
    const file = this.files.find((row) => row.id === id); if (!file) throw new Error('Archivo no disponible.');
    const scope = this.scope(file.targetKind); this.writable(scope, file.targetId); this.expect(scope, file.targetId, expected);
    if (file.removedAt) { file.removedAt = undefined; this.bump(scope, file.targetId); this.ctx.emit(); }
  }
  async downloadResourceFile(id: Id, transfer?: ResourceTransferOptions): Promise<Blob> {
    const file = this.files.find((row) => row.id === id);
    if (!file || !this.readableFile(file)) throw new Error('Archivo no disponible.');
    transfer?.signal?.throwIfAborted(); const blob = this.blobs.get(id); if (!blob) throw new Error('Archivo no disponible.');
    transfer?.onProgress?.(file.size, file.size); return blob;
  }
  snapshot(base: Snapshot): Snapshot {
    const me = base.me;
    if (!me || me.status !== 'active') return { ...base, typingPresence: [], chatChannels: [], channelMessages: [], conversationStates: [], blockedMembers: [], messageReports: [] };
    const withVersion = <T extends MessageFields>(row: T, scope: MessageScope): T => ({ ...row, version: this.versionOf(scope, row.id) });
    return { ...base, typingPresence: [...this.presence.values()].filter((row) => {
      if (!base.members.some((member) => member.id === row.memberId && member.status === 'active')) return false;
      if (this.blocks.some((block) => (block.ownerId === me.id && block.memberId === row.memberId) || (block.ownerId === row.memberId && block.memberId === me.id))) return false;
      if (row.scope === 'direct') return base.directConversations.some((chat) => chat.id === row.conversationId && chat.participantIds.includes(me.id));
      return row.scope === 'group' || this.channels.some((chat) => chat.id === row.conversationId && !chat.archivedAt);
    }), groupMessages: base.groupMessages.map((row) => withVersion(row, 'group')), directMessages: base.directMessages.map((row) => withVersion(row, 'direct')),
      chatChannels: this.channels.map((row) => ({ ...row })), channelMessages: this.messages.map((row) => withVersion(row, 'channel')),
      conversationStates: this.states.filter((row) => row.memberId === me.id).map(({ memberId: _owner, ...row }) => ({ ...row })),
      blockedMembers: this.blocks.filter((row) => row.ownerId === me.id).map(({ memberId }) => ({ memberId })),
      messageReports: this.reports.filter((row) => row.reporterId === me.id || me.isCreator).map((row) => ({ ...row, attachmentIds: [...row.attachmentIds] })),
      resourceFiles: [...new Map([...base.resourceFiles, ...this.files.filter((file) => this.readableFile(file)).map((file) => ({ ...file }))].map((file) => [file.id, file])).values()],
      reactions: [...new Map([...base.reactions, ...this.ctx.state().reactions.filter((row) => row.scope === 'channel')].map((row) => [`${row.scope}:${row.messageId}:${row.memberId}`, row])).values()],
    };
  }
  dispose() { /* El estado compartido pertenece al grupo, no a la sesión que se cierra. */ }
}
