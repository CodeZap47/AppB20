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
    'myMember', 'myAuthIdentity', 'members', 'invitations', 'invitationEmailStatuses', 'inviteLinks', 'subjects', 'terms', 'calendar', 'assignments',
    'pageRevisions', 'works', 'workAuthors', 'workFiles', 'groupMessages',
    'myDirectConversations', 'myDirectMessages', 'messageReactions', 'stickerPacks',
    'stickers', 'myChatCommands', 'birthdays', 'activities', 'evidences', 'notes',
    'noteComments', 'questions', 'answers', 'myLastSeen', 'studyGuides', 'guideSources',
    'guideReviews', 'polls', 'pollVotes',
    'assignmentDetails', 'workDetails', 'evidenceDetails', 'myProgress', 'workRevisions',
    'workReviews', 'academicComments', 'resourceFiles', 'activityLinks', 'pageSnapshots',
    'helpPosts', 'myHelpContactRequests',
    'teachingPractices', 'myTeachingPersonal', 'teachingQuestions',
    'spacedCollections', 'spacedCards', 'spacedUnavailableCards', 'mySpacedEnrollments', 'mySpacedProgress', 'mySpacedReviews',
    ...('memberUploadStats' in overrides ? ['memberUploadStats'] : []),
  ];
  return { db: Object.fromEntries(names.map((name) => [name, table(
    overrides[name] ?? (name === 'myMember' || name === 'members' ? [member] : []),
  )])) } as unknown as Pick<DbConnection, 'db'>;
}

describe('snapshot de SpacetimeDB', () => {
  it('acepta una membresía anterior solo con el vínculo propio de la sesión actual', () => {
    const linked = connection({ myAuthIdentity: [{ sessionIdentity: identity(OTHER), memberIdentity: identity() }] });
    expect(readSnapshot(linked, OTHER).me?.id).toBe(ID);
    const unrelated = connection({ myAuthIdentity: [{ sessionIdentity: identity('unrelated'), memberIdentity: identity() }] });
    expect(readSnapshot(unrelated, OTHER).me).toBeUndefined();
  });
  it('une recursos nuevos y heredados sin duplicados y conserva historial y avance privado', () => {
    const data = readSnapshot(connection({
      works: [{ id: 9n, assignmentId: 17n, title: 'Actual', description: '', version: 3,
        createdBy: identity(), createdAt: timestamp, updatedAt: timestamp }],
      workAuthors: [{ workId: 9n, author: identity() }],
      workDetails: [{ workId: 9n, status: 'final', topic: 'Tema', updatedBy: identity() }],
      workReviews: [{ id: 1n, workId: 9n, version: 2, reviewer: identity(OTHER), comment: 'Anterior', createdAt: timestamp }],
      workFiles: [{ id: 2n, workId: 9n, name: 'legado.txt', size: 4n, contentType: 'text/plain',
        uploadedBy: identity(), createdAt: timestamp, storageKey: 'privado/legado' }],
      resourceFiles: [{ id: 'legacy:2', targetKind: 'work', targetId: 9n, name: 'legado.txt', size: 4n,
        contentType: 'text/plain', uploadedBy: identity(), createdAt: timestamp, removedAt: timestamp, etag: '' },
      { id: 'new-file', targetKind: 'work', targetId: 9n, name: 'nuevo.txt', size: 3n,
        contentType: 'text/plain', uploadedBy: identity(), createdAt: timestamp, removedAt: undefined, etag: '' }],
      workRevisions: [{ id: 1n, workId: 9n, version: 2, title: 'Anterior', description: 'Texto anterior',
        topic: '', status: 'final', authors: [identity()], attachmentIds: ['legacy:2'], editedBy: identity(), editedAt: timestamp }],
      myProgress: [{ owner: identity(), targetKind: 'assignment', targetId: 17n, status: 'done', updatedAt: timestamp },
        { owner: identity(OTHER), targetKind: 'assignment', targetId: 17n, status: 'pending', updatedAt: timestamp }],
      evidenceDetails: [{ evidenceId: 10n, version: 4, updatedBy: identity(), updatedAt: timestamp }],
      evidences: [{ id: 10n, activityId: 2n, author: identity(), participants: [identity()], content: 'Prueba', createdAt: timestamp }],
    }), ID);
    expect(data.resourceFiles).toHaveLength(2);
    expect(data.workFiles.map((file) => file.id)).toEqual(['new-file']);
    expect(data.workRevisions.map((revision) => revision.version)).toEqual([2, 3]);
    expect(data.workRevisions[0]?.attachmentIds).toEqual(['legacy:2']);
    expect(data.works[0]).toMatchObject({ id: '9', status: 'final', topic: 'Tema' });
    expect(data.myProgress).toMatchObject([{ targetId: '17', status: 'done' }]);
    expect(data.myProgress).toHaveLength(1);
    expect(data.evidences[0]?.version).toBe(4);
    expect(JSON.stringify(data.resourceFiles)).not.toContain('storageKey');
    expect(JSON.stringify(data.resourceFiles)).not.toContain('privado/legado');
  });

  it('solo la revisión noautora de la versión actual deriva el estado revisado', () => {
    const work = { id: 9n, assignmentId: 17n, title: '', description: '', version: 2,
      createdBy: identity(), createdAt: timestamp, updatedAt: timestamp };
    const reviews = [{ id: 1n, workId: 9n, version: 2, reviewer: identity(), comment: 'Propia', createdAt: timestamp }];
    const fixture = { works: [work], workAuthors: [{ workId: 9n, author: identity() }],
      workDetails: [{ workId: 9n, topic: '', status: 'final', updatedBy: identity() }], workReviews: reviews };
    expect(readSnapshot(connection(fixture), ID).works[0]?.status).toBe('final');
    expect(readSnapshot(connection({ ...fixture, workReviews: [{ ...reviews[0], reviewer: identity(OTHER) }] }), ID).works[0]?.status).toBe('reviewed');
    expect(readSnapshot(connection({ works: [work] }), ID).works[0]?.status).toBe('draft');
  });

  it('mantiene estados de conexión separados de la falta de membresía', () => {
    expect(emptySnapshot('connecting').connection).toBe('connecting');
    expect(emptySnapshot('offline', 'Sin conexión')).toMatchObject({
      connection: 'offline', connectionError: 'Sin conexión', me: undefined, members: [],
    });
    expect(readSnapshot(connection({ myMember: [] }), ID)).toEqual(emptySnapshot('ready'));
  });

  it('lee totales de perfiles sin metadatos de adjuntos y descarta miembros dados de baja en caché', () => {
    const data = readSnapshot(connection({ memberUploadStats: [
      { memberId: identity(), bytes: 1024n, fileCount: 2n },
      { memberId: identity(OTHER), bytes: 8000n, fileCount: 3n },
    ] }), ID);
    expect(data.memberUploadStats).toEqual([{ memberId: ID, bytes: 1024, fileCount: 2 }]);
    expect(PUBLIC_VIEWS).toContain('member_upload_stats');
    expect(readSnapshot(connection(), ID).memberUploadStats).toBeUndefined();
    expect(readSnapshot(connection({ memberUploadStats: [] }), ID).memberUploadStats).toEqual([]);
  });

  it('rechaza totales de bytes que no se pueden representar con precisión', () => {
    expect(() => readSnapshot(connection({ memberUploadStats: [
      { memberId: identity(), bytes: BigInt(Number.MAX_SAFE_INTEGER) + 1n, fileCount: 1n },
    ] }), ID)).toThrow(/tamaño/);
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

  it('une a cada invitación el estado de su correo; el envío tomado por el worker cuenta como en curso', () => {
    const invite = (email: string) => ({ email, isCreator: false, invitedBy: identity(), createdAt: timestamp });
    const data = readSnapshot(connection({
      invitations: [invite('enviado@example.com'), invite('tomado@example.com'), invite('sin-correo@example.com')],
      invitationEmailStatuses: [
        { email: 'enviado@example.com', status: 'sent', attempts: 1, requestedAt: timestamp, sentAt: timestamp },
        { email: 'tomado@example.com', status: 'leased', attempts: 0, requestedAt: timestamp },
      ],
    }), ID);
    const byEmail = Object.fromEntries(data.invitations.map((i) => [i.email, i]));
    expect(byEmail['enviado@example.com']).toMatchObject({ emailStatus: 'sent', emailSentAt: timestamp.toDate() });
    expect(byEmail['tomado@example.com']?.emailStatus).toBe('pending');
    expect(byEmail['sin-correo@example.com']?.emailStatus).toBeUndefined();
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
    expect(PUBLIC_VIEWS).toContain('teaching_practices');
    expect(PUBLIC_VIEWS).toContain('my_teaching_personal');
    expect(PUBLIC_VIEWS).toContain('teaching_questions');
    expect(PUBLIC_VIEWS).not.toContain('member');
    expect(PUBLIC_VIEWS).not.toContain('direct_message');
    expect(PUBLIC_VIEWS).not.toContain('auth_config');
    expect(PUBLIC_VIEWS).not.toContain('teaching_practice');
    expect(PUBLIC_VIEWS).not.toContain('teaching_personal');
    expect(new Set(PUBLIC_VIEWS).size).toBe(PUBLIC_VIEWS.length);
  });

  it('mapea explicaciones y filtra información personal incluso ante filas privadas en caché', () => {
    const third = '00000000000000000000000000000000000000000000000000000000000000cc';
    const practice = { id: 9_007_199_254_740_993n, owner: identity(), reviewer: identity(OTHER), subjectId: 7n,
      topic: 'Condicionales', concept: 'Inicial', example: 'Ejemplo inicial', limits: 'Límites iniciales',
      revisedConcept: 'Revisada', revisedExample: 'Ejemplo revisado', revisedLimits: 'Límites revisados',
      status: 'practicing', createdAt: timestamp, updatedAt: timestamp };
    const personal = { practiceId: practice.id, reflection: 'Privada', topicsToReview: 'Privados',
      sourceKind: 'note', sourceId: 9_007_199_254_740_994n, sourceVersion: 2, publishedNoteId: 45n };
    const question = { id: 51n, practiceId: practice.id, author: identity(OTHER), kind: 'peer', text: '¿Por qué?',
      answer: 'Porque…', createdAt: timestamp, answeredAt: timestamp };
    const rows = {
      members: [member, { ...member, identity: identity(OTHER), isCreator: false }, { ...member, identity: identity(third) }],
      teachingPractices: [practice, { ...practice, id: 99n, owner: identity(third), reviewer: undefined }],
      myTeachingPersonal: [personal, { ...personal, practiceId: 99n }],
      teachingQuestions: [question, { ...question, id: 52n, practiceId: 99n }],
    };
    const owner = readSnapshot(connection(rows), ID);
    expect(owner.teachingPractices).toHaveLength(1);
    expect(owner.teachingPractices[0]).toMatchObject({ id: '9007199254740993', ownerId: ID, reviewerId: OTHER,
      initial: { concept: 'Inicial', example: 'Ejemplo inicial', limits: 'Límites iniciales' },
      revised: { concept: 'Revisada', example: 'Ejemplo revisado', limits: 'Límites revisados' } });
    expect(owner.teachingPersonal).toEqual([{ practiceId: '9007199254740993', reflection: 'Privada', topicsToReview: 'Privados',
      sourceKind: 'note', sourceId: '9007199254740994', sourceVersion: 2, publishedNoteId: '45' }]);
    const peer = readSnapshot(connection({ ...rows, myMember: [{ ...member, identity: identity(OTHER), isCreator: false }] }), OTHER);
    expect(peer.teachingPractices).toHaveLength(1);
    expect(peer.teachingPersonal).toEqual([]);
    expect(peer.teachingQuestions).toEqual([{ id: '51', practiceId: '9007199254740993', authorId: OTHER,
      kind: 'peer', text: '¿Por qué?', answer: 'Porque…', createdAt: at, answeredAt: at }]);
    expect(JSON.stringify(peer.teachingPractices)).not.toContain('sourceId');
  });

  it('retira prácticas y preguntas del caché al revocar compañero o dar de baja al autor', () => {
    const practice = { id: 9n, owner: identity(OTHER), reviewer: undefined, subjectId: 7n, topic: 'Privada',
      concept: '', example: '', limits: '', revisedConcept: '', revisedExample: '', revisedLimits: '',
      status: 'draft', createdAt: timestamp, updatedAt: timestamp };
    const stale = { teachingPractices: [practice],
      myTeachingPersonal: [{ practiceId: 9n, reflection: 'Secreto' }],
      teachingQuestions: [{ id: 10n, practiceId: 9n, text: 'Secreto' }] };
    const revoked = readSnapshot(connection({ ...stale, members: [member, { ...member, identity: identity(OTHER) }] }), ID);
    expect(revoked.teachingPractices).toEqual([]);
    expect(revoked.teachingPersonal).toEqual([]);
    expect(revoked.teachingQuestions).toEqual([]);
    const removedOwner = readSnapshot(connection({ ...stale, teachingPractices: [{ ...practice, reviewer: identity() }],
      members: [member, { ...member, identity: identity(OTHER), status: 'removed' }] }), ID);
    expect(removedOwner.teachingPractices).toEqual([]);
    expect(removedOwner.teachingQuestions).toEqual([]);
  });
});
