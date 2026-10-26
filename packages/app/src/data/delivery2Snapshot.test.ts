import { describe, expect, it } from 'vitest';
import type { DbConnection } from '../module_bindings';
import { emptySnapshot, PUBLIC_VIEWS, readSnapshot } from './spacetimeSnapshot';

const me = 'a'.repeat(64); const other = 'b'.repeat(64);
const identity = (value: string) => ({ toHexString: () => value });
const at = new Date('2026-10-21T12:00:00Z'); const timestamp = { toDate: () => new Date(at) };
const member = (value: string) => ({ identity: identity(value), displayName: 'Alumno', status: 'active', isCreator: false, joinedAt: timestamp });
function connection(rows: Record<string, unknown[]>): Pick<DbConnection, 'db'> {
  const db = new Proxy({}, { get(_target, key: string) { return { iter: () => (rows[key] ?? []).values() }; } });
  return { db } as unknown as Pick<DbConnection, 'db'>;
}
const base = { myMember: [member(me)], members: [member(me), member(other)] };

describe('adaptador de datos de la segunda entrega', () => {
  it('recupera el estado final por revisión, hereda cambios de adjuntos y respeta la vuelta a V1', () => {
    const noteId = 18_446_744_073_709_551_614n;
    const note = { id: noteId, subjectId: 1n, author: identity(me), title: 'Nota', body: 'Texto', topic: '',
      tags: [], visibility: 'group', source: 'student', version: 5, createdAt: timestamp, updatedAt: timestamp };
    const snapshot = readSnapshot(connection({ ...base,
      notes: [note, { ...note, id: 2n, version: 3 }, { ...note, id: 3n, version: 1 }],
      noteEditions: [
        { key: `${noteId}:4`, noteId, version: 4, isFinal: false },
        { key: `${noteId}:2`, noteId, version: 2, isFinal: true },
        { key: `${noteId}:8`, noteId, version: 8, isFinal: true },
        { key: '2:2', noteId: 2n, version: 2, isFinal: true },
      ],
      noteVersions: [1, 2, 3, 4, 5].map((version) => ({ ...note, id: BigInt(version), noteId, version,
        session: '', assignmentIds: [], activityIds: [], questionIds: [], attachmentIds: [], editedAt: timestamp })),
    }), me);
    expect(snapshot.notes.map((item) => item.isFinal)).toEqual([false, true, false]);
    expect(snapshot.noteVersions.map((item) => item.isFinal)).toEqual([false, true, true, false, false]);
    expect(snapshot.notes[0]?.id).toBe(noteId.toString());
    expect(PUBLIC_VIEWS).toContain('note_editions');
  });

  it('suscribe vistas de presentación, lectura e historial y mantiene vacíos todos los arrays al desconectar', () => {
    for (const name of ['member_profiles', 'my_conversation_states', 'chat_channels', 'channel_messages', 'note_versions', 'guide_versions', 'question_comments', 'answer_usefulness', 'content_statuses', 'contribution_origins']) expect(PUBLIC_VIEWS).toContain(name);
    const snapshot = emptySnapshot('offline');
    expect(snapshot.memberProfiles).toEqual([]); expect(snapshot.conversationStates).toEqual([]); expect(snapshot.messageReports).toEqual([]); expect(snapshot.noteVersions).toEqual([]);
    expect(snapshot.contributionOrigins).toEqual([]);
  });

  it('conserva ids u64 y solo incorpora preferencias y bloqueos de la cuenta actual', () => {
    const hugeId = 18_446_744_073_709_551_614n;
    const snapshot = readSnapshot(connection({ ...base,
      chatChannels: [{ id: hugeId, name: 'Tema', kind: 'topic', createdBy: identity(other), createdAt: timestamp }],
      channelMessages: [{ id: hugeId - 1n, channelId: hugeId, sender: identity(other), text: 'Compartido', sentAt: timestamp }],
      myConversationStates: [me, other].map((person) => ({ memberId: identity(person), scope: 'channel', conversationId: hugeId.toString(), readThroughId: hugeId - 1n, muted: true })),
      myBlockedMembers: [me, other].map((person) => ({ owner: identity(person), memberId: identity(other) })),
      memberProfiles: [{ id: hugeId, memberId: identity(other), preferredName: 'Compañero', bio: '', interests: [], learningGoals: '', skills: [], helpTopics: [], portfolioLinks: [], subjectIds: [hugeId], photoFileId: 'private-photo', version: 2, updatedAt: timestamp }],
    }), me);
    expect(snapshot.chatChannels[0]?.id).toBe(hugeId.toString());
    expect(snapshot.channelMessages[0]?.channelId).toBe(hugeId.toString());
    expect(snapshot.conversationStates).toEqual([{ scope: 'channel', conversationId: hugeId.toString(), readThroughId: (hugeId - 1n).toString(), muted: true }]);
    expect(snapshot.blockedMembers).toHaveLength(1);
    expect(snapshot.memberProfiles[0]).toMatchObject({ id: hugeId.toString(), memberId: other, subjectIds: [hugeId.toString()], updatedAt: at });
  });

  it('los historiales personales ajenos y sus adjuntos no se incorporan al snapshot', () => {
    const privateNote = { id: 1n, subjectId: 1n, author: identity(other), title: 'Privado', body: 'Secreto', topic: '', tags: [], visibility: 'personal', source: 'student', version: 1, createdAt: timestamp, updatedAt: timestamp };
    const snapshot = readSnapshot(connection({ ...base, notes: [privateNote],
      noteVersions: [{ ...privateNote, id: 2n, noteId: 1n, session: '', assignmentIds: [], activityIds: [], questionIds: [], attachmentIds: ['private-file'], editedAt: timestamp }],
      resourceFiles: [{ id: 'private-file', targetKind: 'note', targetId: 1n, name: 'secret.txt', size: 5n, contentType: 'text/plain', uploadedBy: identity(other), createdAt: timestamp, etag: '' }],
    }), me);
    expect(snapshot.notes).toEqual([]); expect(snapshot.noteVersions).toEqual([]); expect(snapshot.resourceFiles).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain('Secreto');
  });

  it('conserva los orígenes de puntos sin convertir ids u64 a números ni cambiar la fecha original', () => {
    const hugeId = 18_446_744_073_709_551_614n;
    const snapshot = readSnapshot(connection({ ...base, contributionOrigins: [{
      kind: 'apunte', refId: hugeId, memberId: identity(me), creditedAt: timestamp, duplicateOf: hugeId - 1n,
    }] }), me);
    expect(snapshot.contributionOrigins).toEqual([{ kind: 'apunte', refId: hugeId.toString(), memberId: me,
      creditedAt: at, duplicateOf: (hugeId - 1n).toString() }]);
  });

  it('combina estado de retirada y versión sin inventar otro registro ni puntos', () => {
    const snapshot = readSnapshot(connection({ ...base,
      questions: [{ id: 8n, subjectId: 1n, author: identity(me), title: 'Pregunta', topic: '', body: 'Texto', status: 'open', createdAt: timestamp }],
      resourceVersions: [{ targetKind: 'question', targetId: 8n, version: 3 }],
      contentStatuses: [{ kind: 'question', targetId: 8n, withdrawnAt: timestamp, withdrawnBy: identity(me), reason: '' }],
    }), me);
    expect(snapshot.questions).toMatchObject([{ id: '8', version: 3, withdrawnAt: at, withdrawnBy: me }]);
  });
});
