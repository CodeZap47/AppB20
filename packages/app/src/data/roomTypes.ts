import type { Id, MaybePromise } from './types';

export type StudyRoomVisibility = 'group' | 'private';
export type StudyRoomStatus = 'scheduled' | 'active' | 'completed' | 'cancelled';
export type StudyRoomMemberStatus = 'invited' | 'joined' | 'declined' | 'left' | 'removed';
export type StudyRoomMaterialKind = 'note' | 'guide';
export type StudyRoomEntryKind = 'message' | 'question' | 'conclusion';

export interface StudyRoom {
  id: Id; title: string; subjectId: Id; topic: string; objective: string;
  startsAt: Date; endsAt: Date; capacity?: number; visibility: StudyRoomVisibility;
  organizerId: Id; status: StudyRoomStatus; version: number; createdAt: Date;
  updatedAt: Date; participantCount: number; requestId: string;
}
export interface StudyRoomMember {
  roomId: Id; memberId: Id; status: StudyRoomMemberStatus; invitedBy?: Id;
  joinedAt?: Date; updatedAt: Date;
}
export interface StudyRoomMaterial {
  id: Id; roomId: Id; kind: StudyRoomMaterialKind; sourceId: Id; sourceVersion: number;
  addedBy: Id; addedAt: Date;
}
export interface StudyRoomEntry {
  id: Id; roomId: Id; authorId: Id; kind: StudyRoomEntryKind; text: string;
  requestId: string; createdAt: Date;
}
export interface StudyRoomTimer {
  roomId: Id; phase: 'study' | 'break'; state: 'idle' | 'running' | 'paused';
  studyMinutes: number; breakMinutes: number; remainingMs: number;
  startedAt?: Date; version: number; updatedAt: Date;
}
export interface StudyRoomSummary {
  roomId: Id; text: string; version: number; updatedBy: Id; updatedAt: Date;
  publishedNoteId?: Id;
}
export interface HelpRoomLink { contactId: Id; roomId: Id; }
export interface StudyRoomsSnapshot {
  studyRooms: StudyRoom[]; roomMembers: StudyRoomMember[];
  roomMaterials: StudyRoomMaterial[]; roomEntries: StudyRoomEntry[];
  roomTimers: StudyRoomTimer[]; roomSummaries: StudyRoomSummary[];
  helpRoomLinks: HelpRoomLink[];
}
export interface CreateStudyRoomInput {
  requestId: string; title: string; subjectId: Id; topic: string; objective: string;
  startsAt: Date; endsAt: Date; capacity?: number; visibility: StudyRoomVisibility;
  helpContactId?: Id; sourceKind?: StudyRoomMaterialKind; sourceId?: Id;
}
export interface UpdateStudyRoomInput {
  title: string; topic: string; objective: string; startsAt: Date; endsAt: Date;
  capacity?: number; expectedVersion: number;
}
export interface ControlStudyRoomTimerInput {
  action: 'start' | 'pause' | 'resume' | 'reset' | 'next'; expectedVersion: number;
  studyMinutes?: number; breakMinutes?: number;
}
export interface StudyRoomActions {
  createStudyRoom(input: CreateStudyRoomInput): MaybePromise<Id>;
  updateStudyRoom(roomId: Id, input: UpdateStudyRoomInput): MaybePromise<void>;
  joinStudyRoom(roomId: Id): MaybePromise<void>;
  leaveStudyRoom(roomId: Id): MaybePromise<void>;
  inviteStudyRoomMember(roomId: Id, memberId: Id): MaybePromise<void>;
  respondStudyRoomInvitation(roomId: Id, accepted: boolean): MaybePromise<void>;
  removeStudyRoomMember(roomId: Id, memberId: Id): MaybePromise<void>;
  setStudyRoomStatus(roomId: Id, status: Exclude<StudyRoomStatus, 'scheduled'>, expectedVersion: number): MaybePromise<void>;
  setStudyRoomMaterial(roomId: Id, kind: StudyRoomMaterialKind, sourceId: Id, enabled: boolean): MaybePromise<void>;
  sendStudyRoomEntry(roomId: Id, kind: StudyRoomEntryKind, text: string, requestId: string): MaybePromise<Id>;
  controlStudyRoomTimer(roomId: Id, input: ControlStudyRoomTimerInput): MaybePromise<void>;
  saveStudyRoomSummary(roomId: Id, text: string, expectedVersion: number): MaybePromise<void>;
  publishStudyRoomSummary(roomId: Id, expectedVersion: number): MaybePromise<Id>;
  getStudyRoomClock(roomId: Id): MaybePromise<Date>;
}

export function emptyStudyRooms(): StudyRoomsSnapshot {
  return { studyRooms: [], roomMembers: [], roomMaterials: [], roomEntries: [], roomTimers: [], roomSummaries: [], helpRoomLinks: [] };
}
