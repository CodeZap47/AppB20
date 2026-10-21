import type { DbConnection } from '../module_bindings';
import type { Snapshot } from './types';
import { emptyStudyRooms } from './roomTypes';

type RoomView = 'studyRooms' | 'roomMembers' | 'roomMaterials' | 'roomEntries' | 'roomTimers' | 'roomSummaries' | 'myHelpRoomLinks';
export type RoomSnapshotConnection = { db: { [Key in RoomView]: Pick<DbConnection['db'][Key], 'iter'> } };

function value<const T extends readonly string[]>(input: string, allowed: T): T[number] {
  const result = allowed.find((item) => item === input);
  if (result === undefined) throw new Error('Actualiza la aplicación para consultar las salas.');
  return result;
}
function milliseconds(input: bigint): number {
  const result = Number(input);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('La duración del temporizador no es válida.');
  return result;
}
/** Además de las vistas privadas, aplica revocaciones durante la propagación de la caché. */
export function enrichStudyRoomsSnapshot(connection: RoomSnapshotConnection, snapshot: Snapshot, identity: string): Snapshot {
  if (snapshot.me?.status !== 'active' || snapshot.me.id !== identity) return { ...snapshot, ...emptyStudyRooms() };
  const db = connection.db;
  const active = new Set(snapshot.members.filter((r) => r.status === 'active').map((r) => r.id));
  const members = [...(db.roomMembers?.iter() ?? [])].map((row) => ({ roomId: row.roomId.toString(), memberId: row.memberId.toHexString(),
    status: value(row.status, ['invited', 'joined', 'declined', 'left', 'removed']), invitedBy: row.invitedBy?.toHexString(),
    joinedAt: row.joinedAt?.toDate(), updatedAt: row.updatedAt.toDate() }));
  const own = new Map(members.filter((r) => r.memberId === identity && active.has(identity)).map((r) => [r.roomId, r]));
  const studyRooms = [...(db.studyRooms?.iter() ?? [])].filter((r) => own.get(r.id.toString())?.status !== 'removed' && (r.visibility === 'group' || ['invited', 'joined'].includes(own.get(r.id.toString())?.status ?? ''))).map((r) => ({
    id: r.id.toString(), requestId: r.requestId, organizerId: r.organizer.toHexString(), subjectId: r.subjectId.toString(), title: r.title,
    topic: r.topic, objective: r.objective, startsAt: r.startsAt.toDate(), endsAt: r.endsAt.toDate(), capacity: r.capacity,
    visibility: value(r.visibility, ['group', 'private']), status: value(r.status, ['scheduled', 'active', 'completed', 'cancelled']),
    version: r.version, participantCount: r.participantCount, createdAt: r.createdAt.toDate(), updatedAt: r.updatedAt.toDate(),
  }));
  const visible = new Set(studyRooms.map((r) => r.id));
  const joined = new Set(studyRooms.filter((r) => own.get(r.id)?.status === 'joined').map((r) => r.id));
  return { ...snapshot, studyRooms,
    roomMembers: members.filter((r) => visible.has(r.roomId) && (joined.has(r.roomId) || r.memberId === identity)),
    roomMaterials: [...(db.roomMaterials?.iter() ?? [])].filter((r) => {
      if (!joined.has(r.roomId.toString())) return false;
      const room = studyRooms.find((row) => row.id === r.roomId.toString())!;
      return r.kind === 'note' ? snapshot.notes.some((n) => n.id === r.sourceId.toString() && n.subjectId === room.subjectId && n.visibility === 'group' && !n.withdrawnAt)
        : r.kind === 'guide' && snapshot.guides.some((g) => g.id === r.sourceId.toString() && g.subjectId === room.subjectId && !g.withdrawnAt);
    }).map((r) => ({ id: r.id.toString(), roomId: r.roomId.toString(), kind: value(r.kind, ['note', 'guide']), sourceId: r.sourceId.toString(),
      sourceVersion: r.sourceVersion, addedBy: r.addedBy.toHexString(), addedAt: r.addedAt.toDate() })),
    roomEntries: [...(db.roomEntries?.iter() ?? [])].filter((r) => joined.has(r.roomId.toString())).map((r) => ({ id: r.id.toString(), roomId: r.roomId.toString(), authorId: r.author.toHexString(),
      kind: value(r.kind, ['message', 'question', 'conclusion']), text: r.text, requestId: r.requestId, createdAt: r.createdAt.toDate() })),
    roomTimers: [...(db.roomTimers?.iter() ?? [])].filter((r) => joined.has(r.roomId.toString())).map((r) => ({ roomId: r.roomId.toString(), phase: value(r.phase, ['study', 'break']),
      state: value(r.state, ['idle', 'running', 'paused']), studyMinutes: r.studyMinutes, breakMinutes: r.breakMinutes, remainingMs: milliseconds(r.remainingMs),
      startedAt: r.startedAt?.toDate(), version: r.version, updatedAt: r.updatedAt.toDate() })),
    roomSummaries: [...(db.roomSummaries?.iter() ?? [])].filter((r) => joined.has(r.roomId.toString())).map((r) => ({ roomId: r.roomId.toString(), text: r.text,
      version: r.version, updatedBy: r.updatedBy.toHexString(), updatedAt: r.updatedAt.toDate(), publishedNoteId: r.publishedNoteId?.toString() })),
    helpRoomLinks: [...(db.myHelpRoomLinks?.iter() ?? [])].filter((r) => (r.memberA.toHexString() === identity || r.memberB.toHexString() === identity) && active.has(identity) && visible.has(r.roomId.toString())).map((r) => ({ contactId: r.contactId.toString(), roomId: r.roomId.toString() })),
  };
}
