import { t, table } from 'spacetimedb/server';

/** La ficha no contiene ni fuentes, ni conversaciones, ni el contacto de Ayuda. */
export const studyRoom = table({ name: 'study_room' }, {
  id: t.u64().primaryKey().autoInc(), requestId: t.string(), organizer: t.identity().index('btree'),
  subjectId: t.u64(), title: t.string(), topic: t.string(), objective: t.string(),
  startsAt: t.timestamp(), endsAt: t.timestamp(), capacity: t.u32().optional(),
  visibility: t.string(), status: t.string(), version: t.u32(), participantCount: t.u32(),
  createdAt: t.timestamp(), updatedAt: t.timestamp(),
});
export const roomMember = table({ name: 'room_member' }, {
  key: t.string().primaryKey(), roomId: t.u64().index('btree'), memberId: t.identity().index('btree'),
  status: t.string(), invitedBy: t.identity().optional(), joinedAt: t.timestamp().optional(), updatedAt: t.timestamp(),
});
export const roomMaterial = table({ name: 'room_material' }, {
  id: t.u64().primaryKey().autoInc(), roomId: t.u64().index('btree'), kind: t.string(),
  sourceId: t.u64(), sourceVersion: t.u32(), addedBy: t.identity(), addedAt: t.timestamp(),
});
export const roomEntry = table({ name: 'room_entry' }, {
  id: t.u64().primaryKey().autoInc(), roomId: t.u64().index('btree'), author: t.identity(),
  kind: t.string(), text: t.string(), requestId: t.string(), createdAt: t.timestamp(),
});
export const roomTimer = table({ name: 'room_timer' }, {
  roomId: t.u64().primaryKey(), phase: t.string(), state: t.string(),
  studyMinutes: t.u32(), breakMinutes: t.u32(), remainingMs: t.u64(), startedAt: t.timestamp().optional(),
  version: t.u32(), updatedBy: t.identity(), updatedAt: t.timestamp(),
});
export const roomSummary = table({ name: 'room_summary' }, {
  roomId: t.u64().primaryKey(), text: t.string(), version: t.u32(),
  updatedBy: t.identity(), updatedAt: t.timestamp(), publishedNoteId: t.u64().optional(),
});
/** El origen en Ayuda solo lo reciben las dos personas del contacto. */
export const helpRoomLink = table({ name: 'help_room_link' }, {
  id: t.u64().primaryKey().autoInc(), contactId: t.u64().index('btree'), roomId: t.u64(),
  memberA: t.identity(), memberB: t.identity(),
});
export const roomsTables = { studyRoom, roomMember, roomMaterial, roomEntry, roomTimer, roomSummary, helpRoomLink };
