import type { Id, MessageFields, MessageScope } from './types';

export interface ChatChannel {
  id: Id;
  name: string;
  kind: 'subject' | 'topic' | 'project';
  subjectId?: Id;
  createdBy: Id;
  createdAt: Date;
  archivedAt?: Date;
}

export interface ChannelMessage extends MessageFields { channelId: Id }

/** Preferencia y puntero privados del miembro conectado. */
export interface ConversationState {
  scope: MessageScope;
  conversationId: Id;
  readThroughId?: Id;
  muted: boolean;
}

export interface BlockedMember { memberId: Id }

/** Contiene exclusivamente la evidencia que el reportante decidió compartir. */
export interface MessageReport {
  id: Id;
  scope: MessageScope;
  messageId: Id;
  reporterId: Id;
  reason: string;
  evidenceText: string;
  attachmentIds: Id[];
  createdAt: Date;
  status: 'open' | 'resolved';
}

export interface CreateChatChannelInput {
  name: string;
  kind: ChatChannel['kind'];
  subjectId?: Id;
}

export interface ReportMessageInput {
  scope: MessageScope;
  messageId: Id;
  reason: string;
  shareText: boolean;
  attachmentIds: Id[];
}
