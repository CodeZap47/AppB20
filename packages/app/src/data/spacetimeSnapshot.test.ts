import { describe, expect, it } from 'vitest';
import type { DbConnection } from '../module_bindings';
import { emptySnapshot, PUBLIC_VIEWS, readSnapshot } from './spacetimeSnapshot';

const ID = '00000000000000000000000000000000000000000000000000000000000000aa';
const OTHER = '00000000000000000000000000000000000000000000000000000000000000bb';
const identity = (value = ID) => ({ toHexString: () => value });
const at = new Date('2026-10-20T12:34:00Z');
const timestamp = { toDate: () => new Date(at) };
const member = {
  identity: identity(), displayName: 'Luis', photoUrl: undefined, status: 'active',
  isCreator: true, joinedAt: timestamp,
};
const table = (rows: unknown[] = []) => ({ iter: () => rows.values() });

/** Tables are stubbed at the cache boundary; production rows remain inferred from generated bindings. */
function connection(overrides: Record<string, unknown[]> = {}): Pick<DbConnection, 'db'> {
  const names = [
    'myMember', 'members', 'invitations', 'subjects', 'terms', 'calendar', 'assignments',
    'pageRevisions', 'works', 'workAuthors', 'workFiles', 'groupMessages',
    'myDirectConversations', 'myDirectMessages', 'messageReactions', 'stickerPacks',
    'stickers', 'myChatCommands', 'birthdays', 'activities', 'evidences', 'notes',
    'noteComments', 'questions', 'answers', 'myLastSeen', 'studyGuides', 'guideSources',
    'guideReviews', 'polls', 'pollVotes',
  ];
  return { db: Object.fromEntries(names.map((name) => [name, table(
    overrides[name] ?? (name === 'myMember' || name === 'members' ? [member] : []),
  )])) } as unknown as Pick<DbConnection, 'db'>;
}

describe('snapshot de SpacetimeDB', () => {
  it('mantiene estados de conexión separados de la falta de membresía', () => {
    expect(emptySnapshot('connecting').connection).toBe('connecting');
    expect(emptySnapshot('offline', 'Sin conexión')).toMatchObject({
      connection: 'offline', connectionError: 'Sin conexión', me: undefined, members: [],
    });
    expect(readSnapshot(connection({ myMember: [] }), ID)).toEqual(emptySnapshot('ready'));
  });

  it('conserva IDs u64, autores y fechas sin perder precisión', () => {
    const workId = 18_446_744_073_709_551_614n;
    const data = readSnapshot(connection({
      works: [{ id: workId, assignmentId: 17n, title: 'Equipo', description: 'Trabajo', version: 3,
        createdBy: identity(), createdAt: timestamp, updatedAt: timestamp }],
      workAuthors: [{ workId, author: identity() }, { workId, author: identity(OTHER) }],
      assignments: [{ id: 17n, subjectId: 6n, termId: 0n, kind: 'examen', title: 'Parcial',
        instructions: 'Resolver', dueDate: '', version: 1, createdBy: identity(), createdAt: timestamp,
        updatedBy: identity(OTHER), updatedAt: timestamp }],
      calendar: [{ id: 1n, period: 2, term: 1, startDate: '2026-09-01', endDate: '2026-10-31',
        updatedBy: identity(), updatedAt: timestamp }],
    }), ID);
    expect(data.works[0]).toMatchObject({
      id: '18446744073709551614', assignmentId: '17', authorIds: [ID, OTHER], createdAt: at,
    });
    expect(data.assignments[0]).toMatchObject({ termId: '0', kind: 'examen', updatedBy: OTHER });
    expect(data.assignments[0]?.dueDate).toBeUndefined();
    expect(data.calendar).toEqual([{ period: 2, term: 1, startDate: '2026-09-01', endDate: '2026-10-31' }]);
  });

  it('mapea participantes, mensajes y campos opcionales', () => {
    const data = readSnapshot(connection({
      myDirectConversations: [{ id: 10n, userA: identity(), userB: identity(OTHER), createdAt: timestamp }],
      myDirectMessages: [{ id: 13n, conversationId: 10n, sender: identity(OTHER), text: '',
        sentAt: timestamp, replyToId: 0n, deletedAt: timestamp, deletedBy: identity(), editedAt: undefined }],
      myLastSeen: [{ identity: identity(OTHER), at: { toDate: () => new Date(0) } },
        { identity: identity(), at: timestamp }],
    }), ID);
    expect(data.directConversations[0]?.participantIds).toEqual([ID, OTHER]);
    expect(data.directMessages[0]).toMatchObject({
      conversationId: '10', senderId: OTHER, replyToId: '0', deletedBy: ID, deletedAt: at,
    });
    expect(data.directMessages[0]?.editedAt).toBeUndefined();
    expect(data.lastSeenAt).toEqual(at);
  });

  it('no convierte referencias de almacenamiento en enlaces públicos', () => {
    const data = readSnapshot(connection({
      workFiles: [{ id: 1n, workId: 2n, name: 'apunte.pdf', size: 1024n, contentType: 'application/pdf',
        storageKey: 'private/work/secret', uploadedBy: identity(), createdAt: timestamp }],
      stickers: [{ id: 3n, packId: 4n, storageKey: 'private/sticker/secret', size: 256n,
        contentType: 'image/webp', animated: false, used: true, createdAt: timestamp }],
    }), ID);
    expect(data.workFiles[0]).not.toHaveProperty('storageKey');
    expect(data.workFiles[0]?.url).toBeUndefined();
    expect(data.stickers[0]).not.toHaveProperty('storageKey');
    expect(data.stickers[0]?.url).toBe('');
    expect(data.workFiles[0]?.size).toBe(1024);
  });

  it('retira datos en caché si el miembro fue dado de baja o no es la identidad actual', () => {
    const source = connection({ myMember: [{ ...member, status: 'removed' }],
      groupMessages: [{ invalid: 'una fila en caché no debe evaluarse' }] });
    const removed = readSnapshot(source, ID);
    expect(removed.me?.status).toBe('removed');
    expect(removed.members).toEqual([]);
    expect(removed.groupMessages).toEqual([]);
    expect(readSnapshot(connection(), OTHER)).toEqual(emptySnapshot('ready'));
  });

  it('oculta invitaciones a quien no es creador', () => {
    const data = readSnapshot(connection({ myMember: [{ ...member, isCreator: false }],
      invitations: [{ email: 'privado@example.com', isCreator: false,
        invitedBy: identity(), createdAt: timestamp }] }), ID);
    expect(data.invitations).toEqual([]);
  });

  it('rechaza una versión de enum desconocida y tamaños imposibles', () => {
    expect(() => readSnapshot(connection({ notes: [{ id: 1n, subjectId: 2n, topic: '', title: 'Nota',
      body: '', tags: [], visibility: 'public', source: 'student', author: identity(), version: 1,
      createdAt: timestamp, updatedAt: timestamp }] }), ID)).toThrow('versión de B20');
    expect(() => readSnapshot(connection({ workFiles: [{ id: 1n, workId: 2n, name: '',
      size: 18_446_744_073_709_551_615n, contentType: '', uploadedBy: identity(), createdAt: timestamp }] }), ID))
      .toThrow('tamaño de un archivo');
  });

  it('se suscribe únicamente a vistas públicas con permisos por usuario', () => {
    expect(PUBLIC_VIEWS).toContain('my_member');
    expect(PUBLIC_VIEWS).toContain('my_direct_messages');
    expect(PUBLIC_VIEWS).not.toContain('member');
    expect(PUBLIC_VIEWS).not.toContain('direct_message');
    expect(PUBLIC_VIEWS).not.toContain('auth_config');
    expect(new Set(PUBLIC_VIEWS).size).toBe(PUBLIC_VIEWS.length);
  });
});
