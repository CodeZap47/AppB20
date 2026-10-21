import type { Id, MaybePromise, MessageScope } from './types';
import type { CreateChatChannelInput, ReportMessageInput } from './chatTypes';
import type { MemberProfileInput, ProfileCoverInput } from './communityTypes';
export type { ChatChannel, ChannelMessage, ConversationState, BlockedMember, MessageReport, CreateChatChannelInput, ReportMessageInput } from './chatTypes';
export type { MemberProfile, MemberProfileInput, ProfileCover, ProfileCoverInput } from './communityTypes';
export type { NoteVersion, GuideVersion, GuideVersionSource, QuestionComment, AnswerUsefulness, QuestionLink } from './knowledgeTypes';
export type WithdrawableKind = 'note' | 'guide' | 'question' | 'answer' | 'work' | 'evidence';
export interface Delivery2Actions {
  downloadSticker(stickerId: Id): Promise<Blob>;
  createChatChannel(input: CreateChatChannelInput): MaybePromise<Id>;
  setChatChannelArchived(channelId: Id, archived: boolean): MaybePromise<void>;
  sendChannelMessage(channelId: Id, text: string, replyToId?: Id): MaybePromise<Id>;
  markConversationRead(scope: MessageScope, conversationId: Id, messageId: Id): MaybePromise<void>;
  setConversationMuted(scope: MessageScope, conversationId: Id, muted: boolean): MaybePromise<void>;
  setMemberBlocked(memberId: Id, blocked: boolean): MaybePromise<void>;
  reportMessage(input: ReportMessageInput): MaybePromise<Id>;
  resolveMessageReport(reportId: Id): MaybePromise<void>;
  saveMemberProfile(input: MemberProfileInput): MaybePromise<Id>;
  saveProfileCover(input: ProfileCoverInput): MaybePromise<void>;
  publishNoteVersion(noteId: Id, expectedVersion: number): MaybePromise<Id>;
  restoreNoteVersion(noteId: Id, version: number, expectedVersion: number): MaybePromise<void>;
  restoreGuideVersion(guideId: Id, version: number, expectedVersion: number): MaybePromise<void>;
  commentQuestion(questionId: Id, text: string, answerId?: Id): MaybePromise<void>;
  toggleAnswerUsefulness(answerId: Id): MaybePromise<void>;
  saveQuestionLinks(questionId: Id, noteIds: Id[], guideIds: Id[]): MaybePromise<void>;
  withdrawContent(kind: WithdrawableKind, targetId: Id, withdrawn: boolean, expectedVersion: number, reason?: string): MaybePromise<void>;
}
