import { Identity, Timestamp } from 'spacetimedb';
import type { DbConnection } from '../module_bindings';
import type { StudyRoomActions } from './roomTypes';

const id = (value: string) => BigInt(value);
const optionalId = (value?: string) => value ? id(value) : undefined;
export type RoomActionsConnection = {
  db: { [Key in 'studyRooms' | 'myHelpRoomLinks' | 'roomEntries' | 'roomSummaries']: Pick<DbConnection['db'][Key], 'iter'> };
  reducers: Pick<DbConnection['reducers'], Exclude<keyof StudyRoomActions, 'getStudyRoomClock'>>;
  procedures: Pick<DbConnection['procedures'], 'studyRoomClock'>;
};
export function createStudyRoomActions(getConnection: () => RoomActionsConnection, identity: () => string): StudyRoomActions {
  let queue = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task); queue = next.then(() => {}, () => {}); return next;
  }
  return {
    createStudyRoom: (input) => serial(async () => {
      const c = getConnection();
      await c.reducers.createStudyRoom({ ...input, subjectId: id(input.subjectId), startsAt: Timestamp.fromDate(input.startsAt), endsAt: Timestamp.fromDate(input.endsAt),
        helpContactId: optionalId(input.helpContactId), sourceId: optionalId(input.sourceId) });
      const rows = [...c.db.studyRooms.iter()];
      const result = rows.find((r) => r.organizer.toHexString() === identity() && r.requestId === input.requestId.trim());
      if (result) return result.id.toString();
      const link = input.helpContactId ? [...c.db.myHelpRoomLinks.iter()].find((r) => r.contactId === id(input.helpContactId!) && rows.some((room) => room.id === r.roomId && ['scheduled', 'active'].includes(room.status))) : undefined;
      if (link) return link.roomId.toString();
      throw new Error('La sala se guardó. Actualiza la lista antes de volver a intentarlo.');
    }),
    updateStudyRoom: (roomId, input) => getConnection().reducers.updateStudyRoom({ ...input, roomId: id(roomId), startsAt: Timestamp.fromDate(input.startsAt), endsAt: Timestamp.fromDate(input.endsAt) }),
    joinStudyRoom: (roomId) => getConnection().reducers.joinStudyRoom({ roomId: id(roomId) }),
    leaveStudyRoom: (roomId) => getConnection().reducers.leaveStudyRoom({ roomId: id(roomId) }),
    inviteStudyRoomMember: (roomId, memberId) => getConnection().reducers.inviteStudyRoomMember({ roomId: id(roomId), memberId: Identity.fromString(memberId) }),
    respondStudyRoomInvitation: (roomId, accepted) => getConnection().reducers.respondStudyRoomInvitation({ roomId: id(roomId), accepted }),
    removeStudyRoomMember: (roomId, memberId) => getConnection().reducers.removeStudyRoomMember({ roomId: id(roomId), memberId: Identity.fromString(memberId) }),
    setStudyRoomStatus: (roomId, status, expectedVersion) => getConnection().reducers.setStudyRoomStatus({ roomId: id(roomId), status, expectedVersion }),
    setStudyRoomMaterial: (roomId, kind, sourceId, enabled) => getConnection().reducers.setStudyRoomMaterial({ roomId: id(roomId), kind, sourceId: id(sourceId), enabled }),
    sendStudyRoomEntry: (roomId, kind, text, requestId) => serial(async () => {
      const c = getConnection(); await c.reducers.sendStudyRoomEntry({ roomId: id(roomId), kind, text, requestId });
      const result = [...c.db.roomEntries.iter()].find((r) => r.roomId === id(roomId) && r.author.toHexString() === identity() && r.requestId === requestId.trim());
      if (!result) throw new Error('El mensaje se guardó. Actualiza antes de reenviarlo.');
      return result.id.toString();
    }),
    controlStudyRoomTimer: (roomId, input) => getConnection().reducers.controlStudyRoomTimer({ ...input, roomId: id(roomId) }),
    saveStudyRoomSummary: (roomId, text, expectedVersion) => getConnection().reducers.saveStudyRoomSummary({ roomId: id(roomId), text, expectedVersion }),
    publishStudyRoomSummary: (roomId, expectedVersion) => serial(async () => {
      const c = getConnection(); await c.reducers.publishStudyRoomSummary({ roomId: id(roomId), expectedVersion });
      const result = [...c.db.roomSummaries.iter()].find((r) => r.roomId === id(roomId))?.publishedNoteId;
      if (result === undefined) throw new Error('El resumen se publicó. Actualiza antes de volver a publicarlo.');
      return result.toString();
    }),
    getStudyRoomClock: async (roomId) => (await getConnection().procedures.studyRoomClock({ roomId: id(roomId) })).toDate(),
  };
}
