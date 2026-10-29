import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import { FEED_RESOURCE_KINDS, type FeedResourceRef, type FeedSharePreview, type FeedThread } from '../../core/src/feedInteractions';
import { leaderChanges, rankingFeedId } from '../../core/src/feedRankings';

vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }),
    table: (options: unknown) => ({ options, rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import { feedShareAction, feedSharePreview as readSharePreview, feedThread } from './feedInteractionHandlers';
import { feedInteractionTables } from './feedInteractionTables';
import { purgeFeedThread } from './feedInteractionLifecycle';
import { rankingContributionData } from './feedRankingAdapter';
import { withdrawContent } from './communityHandlers';
import { commentFeedPost, deleteFeedPost } from './feedHandlers';
import { mutateHelp } from './helpVersioning';
import { archive_spaced_collection, configure_feed_share_service, exam_action, save_work_version, restore_work_version, remove_member, invite_member, join_group } from './index';
import type { Ctx } from './index';
import './index';

const identity = (digit: string) => Identity.fromString(digit.repeat(64));
const admin = identity('a'); const author = identity('b'); const other = identity('c'); const removed = identity('d');
const service = identity('e'); const moduleIdentity = identity('f');
const at = new Timestamp(1_700_000_000_000_000n); const after = new Timestamp(at.microsSinceUnixEpoch + 86_400_000_000n);
type Row = Record<string, unknown>;
const keyOf = (value: unknown): string => value && typeof value === 'object' && 'toHexString' in value ? (value as Identity).toHexString() : String(value);
function store(primary: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [keyOf(row[primary]), row])); let next = 1000n;
  return new Proxy({ rows, iter: () => rows.values(), insert: (value: Row) => { const row: Row = { ...value, ...(value.id === 0n ? { id: next++ } : {}) }; rows.set(keyOf(row[primary]), row); return row; } }, {
    get(target, name: string) { if (name in target) return target[name as keyof typeof target];
      return { find: (value: unknown) => [...rows.values()].find((row) => keyOf(row[name]) === keyOf(value)), filter: (value: unknown) => [...rows.values()].filter((row) => keyOf(row[name]) === keyOf(value)),
        update: (row: Row) => { rows.set(keyOf(row[primary]), { ...row }); return row; }, delete: (value: unknown) => rows.delete(keyOf(value)) };
    },
  });
}
function setup() {
  const note = { id: 5n, subjectId: 1n, title: 'Apunte', topic: 'Funciones', body: 'Cuerpo público <img src="private.png"> (resource:private) https://example.test/private', tags: [], visibility: 'group', source: 'student', author, version: 1, createdAt: at, updatedAt: at };
  const initial: Record<string, Row[]> = {
    feedShareServiceConfig: [{ id: 0, identity: service, enabled: true }],
    member: [admin, author, other, removed].map((person) => ({ identity: person, displayName: 'Alumno', isCreator: person === admin, status: person === removed ? 'removed' : 'active' })),
    appConfig: [{ id: 0, owner: admin }], authConfig: [{ id: 0, issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['test'] }], subject: [{ id: 1n, name: 'Lógica' }],
    assignment: [{ id: 1n, subjectId: 1n, title: 'Tarea', instructions: 'Practica funciones', createdBy: author, createdAt: at }],
    activity: [{ id: 2n, subjectId: 1n, title: 'Actividad', objective: 'Objetivo de clase', createdBy: author, createdAt: at }],
    work: [{ id: 3n, assignmentId: 1n, createdBy: author, title: 'Trabajo', description: 'Descripción', createdAt: at, version: 1 }], workAuthor: [{ id: 1n, workId: 3n, author }],
    evidence: [{ id: 4n, activityId: 2n, author, participants: [], content: 'Evidencia', createdAt: at }],
    note: [note], question: [{ id: 6n, author, subjectId: 1n, title: 'Pregunta', body: 'Duda', createdAt: at, status: 'open' }],
    answer: [{ id: 7n, questionId: 6n, author, body: 'Respuesta pública', createdAt: at }],
    studyGuide: [{ id: 8n, subjectId: 1n, title: 'Guía', topics: ['Funciones'], sections: ['Resumen'], createdBy: author, createdAt: at, version: 1 }],
    poll: [{ id: 9n, title: 'Votación', description: 'Consulta', closesAt: after, createdBy: author, createdAt: at }],
    helpPost: [{ id: 10n, title: 'Ayuda', topic: 'Funciones', description: 'Ayuda pública', author, subjectId: 1n, status: 'open', createdAt: at, updatedAt: at }],
    spacedCollection: [{ id: 11n, title: 'Repaso', subjectId: 1n, visibility: 'group', archived: false, ownerId: author, version: 1, createdAt: at }],
    feedPost: [{ id: 12n, author, text: 'Publicación', requestId: 'post', createdAt: at }],
    codingChallenge: [{ id: 13n, author, subjectId: 1n, title: 'Reto', objective: 'Objetivo', closed: false, createdAt: at }],
    challengeSolution: [{ id: 14n, challengeId: 13n, author, explanation: 'Explicación', body: 'code', createdAt: at }],
    codeReview: [{ id: 15n, author, subjectId: 1n, title: 'Revisión', language: 'JavaScript', currentVersion: 1, closed: false, createdAt: at }],
    codeReviewVersion: [{ key: '15:1', reviewId: 15n, summary: 'Contexto público de revisión', code: 'SECRET CODE' }],
    codeReviewComment: [{ id: 16n, reviewId: 15n, author, body: 'Observación', versionNumber: 1, lineStart: 3, status: 'pending' }],
    opportunity: [{ id: 17n, author, fields: JSON.stringify({ title: 'Oportunidad', topic: 'Código', requirements: 'Requisitos públicos', sourceUrl: 'https://example.test' }), withdrawn: false }],
    studyRoom: [{ id: 18n, organizer: author, title: 'Sala', topic: 'Funciones', objective: 'Objetivo público', subjectId: 1n, visibility: 'group', status: 'scheduled', createdAt: at }],
    roomEntry: [{ id: 1n, roomId: 18n, author, kind: 'message', text: 'PRIVATE CHAT', createdAt: at }],
    studyExam: [{ id: '11111111-1111-4111-8111-111111111111', owner: author, subjectId: 1n, title: 'Examen', visibility: 'group', archived: false, readyVersion: 1, revision: 1, createdAt: at, updatedAt: at }],
    examVersion: [{ key: '11111111-1111-4111-8111-111111111111:1', examId: '11111111-1111-4111-8111-111111111111', version: 1, state: 'ready', createdAt: at, json: JSON.stringify({ title: 'Examen listo', hasPersonalSources: false,
      preparation: { topics: ['Funciones'], sources: [], fragments: [] }, questions: [{ correctAnswer: 'PRIVATE ANSWER' }] }) }],
  };
  const keys: Record<string, string> = { member: 'identity', memberEmail: 'email', contentStatus: 'key', contentRetention: 'key', feedThreadReceipt: 'key', codeReviewVersion: 'key',
    feedReaction: 'key', noteDetail: 'noteId', resourceVersion: 'key', workDetail: 'workId', examVersion: 'key', studyExam: 'id', noteEdition: 'key',
    invitation: 'email', individualInvitationGrant: 'email', emailRestriction: 'email', memberAccess: 'memberIdentity', invitationEmail: 'email' };
  const tables = new Map<string, ReturnType<typeof store>>(); const accessed = new Set<string>();
  const db = new Proxy({}, { get(_target, property: string) { accessed.add(property); if (!tables.has(property)) tables.set(property, store(keys[property] ?? 'id', initial[property])); return tables.get(property); } });
  const state = { db, sender: author, identity: moduleIdentity, timestamp: at, env: {}, senderAuth: { jwt: { issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'alumno@example.com', email_verified: true } } } };
  const table = (name: string) => (db as Record<string, ReturnType<typeof store>>)[name];
  return { ctx: state as unknown as Ctx, accessed, as: (person: Identity) => { state.sender = person; state.senderAuth.jwt.fullPayload.email = `${person.toHexString()}@example.test`; },
    anonymous: () => { state.sender = removed; (state as { senderAuth: unknown }).senderAuth = undefined; }, rows: (name: string) => [...table(name).rows.values()],
    seed: (name: string, row: Row) => table(name).insert(row), patch: (name: string, id: unknown, changes: Row) => { const rows = table(name).rows; rows.set(keyOf(id), { ...rows.get(keyOf(id)), ...changes }); },
    drop: (name: string, id: unknown) => table(name).rows.delete(keyOf(id)) };
}
const feedSharePreview = (ctx: Ctx, tokenHash: string) => {
  const state = ctx as unknown as { sender: Identity }; const previous = state.sender; state.sender = service;
  try { return readSharePreview(ctx, tokenHash); } finally { state.sender = previous; }
};
const target = (kind: FeedResourceRef['kind'], id: string): FeedResourceRef => ({ kind, id });
const thread = (ctx: Ctx, ref: FeedResourceRef, extra: Row = {}) => JSON.parse(feedThread(ctx, JSON.stringify({ action: 'read', target: ref, ...extra }))) as FeedThread;
const share = (ctx: Ctx, ref: FeedResourceRef, tokenHash = '1'.repeat(64)) => JSON.parse(feedShareAction(ctx, JSON.stringify({ action: 'create', target: ref, tokenHash }))) as { id: string; preview: FeedSharePreview };
const refs = FEED_RESOURCE_KINDS.filter((kind) => kind !== 'ranking').map((kind, index) => target(kind, kind === 'exam' ? '11111111-1111-4111-8111-111111111111' : String(index + 1)));

describe('Hilos canónicos del feed', () => {
  it('lee comentarios anteriores del módulo y no mezcla pregunta con respuesta', () => {
    const { ctx, seed, rows, patch } = setup();
    seed('noteComment', { id: 900n, noteId: 5n, author: other, text: 'Comentario anterior', createdAt: at });
    seed('questionComment', { id: 901n, questionId: 6n, author: other, text: 'En pregunta', createdAt: at });
    seed('questionComment', { id: 902n, questionId: 6n, answerId: 7n, author: other, text: 'En respuesta', createdAt: at });
    expect(thread(ctx, target('note', '5')).comments[0]?.text).toBe('Comentario anterior');
    expect(thread(ctx, target('question', '6')).comments.map((row) => row.text)).toEqual(['En pregunta']);
    expect(thread(ctx, target('answer', '7')).comments.map((row) => row.text)).toEqual(['En respuesta']);
    commentFeedPost(ctx, { postId: 12n, text: 'Enviado desde el módulo', requestId: 'native' });
    expect(thread(ctx, target('post', '12'), { action: 'comment', text: 'Enviado desde el módulo', requestId: 'native' }).comments).toHaveLength(1);
    expect(rows('feedComment')).toHaveLength(1);
    seed('challengeComment', { id: 903n, challengeId: 13n, author, body: 'Antes del cierre', requestId: 'native', createdAt: at });
    patch('codingChallenge', 13n, { closed: true });
    expect(thread(ctx, target('challenge', '13'), { action: 'comment', text: 'Antes del cierre', requestId: 'native' }).comments).toHaveLength(1);
  });
  it('reutiliza los ocho almacenes nativos y conserva recibos después de borrar', () => {
    const { ctx, rows } = setup();
    const pairs = [['post', '12', 'feedComment', 500], ['note', '5', 'noteComment', 4000], ['work', '3', 'academicComment', 2000], ['evidence', '4', 'academicComment', 2000],
      ['question', '6', 'questionComment', 2000], ['answer', '7', 'questionComment', 2000], ['challenge', '13', 'challengeComment', 4000], ['solution', '14', 'challengeComment', 4000]] as const;
    for (const [kind, id, table, maxLength] of pairs) {
      const ref = target(kind, id); const before = rows(table).length;
      const first = thread(ctx, ref, { action: 'comment', text: ' Hola\r\ngrupo ', requestId: `request-${kind}` });
      expect(first.maxLength).toBe(maxLength); expect(first.comments[0]?.text).toBe('Hola\ngrupo');
      expect(rows(table)).toHaveLength(before + 1);
      expect(thread(ctx, ref, { action: 'comment', text: 'Hola\ngrupo', requestId: `request-${kind}` }).comments).toHaveLength(1);
      expect(() => thread(ctx, ref, { action: 'comment', text: 'Otro texto', requestId: `request-${kind}` })).toThrow('otro comentario');
      thread(ctx, ref, { action: 'delete', commentId: first.comments[0]!.id });
      expect(thread(ctx, ref, { action: 'comment', text: 'Hola\ngrupo', requestId: `request-${kind}` }).comments).toHaveLength(0);
    }
    expect(rows('feedThreadComment')).toHaveLength(0); expect(rows('feedThreadReceipt')).toHaveLength(8);
  });

  it('los comentarios generales no alteran observaciones de código ni conversaciones de sala', () => {
    const { ctx, rows } = setup();
    for (const ref of [target('review', '15'), target('review-comment', '16'), target('room', '18')]) expect(thread(ctx, ref, { action: 'comment', text: 'Comentario público', requestId: 'same-request' }).comments).toHaveLength(1);
    expect(rows('feedThreadComment')).toHaveLength(3); expect(rows('codeReviewComment')).toHaveLength(1);
    expect(rows('roomEntry')[0]?.text).toBe('PRIVATE CHAT'); expect(JSON.stringify(thread(ctx, target('room', '18')))).not.toContain('PRIVATE CHAT');
  });

  it('un lector no borra comentarios ajenos; su autor, el autor del recurso y admin sí', () => {
    const { ctx, as } = setup(); const ref = target('assignment', '1');
    const own = thread(ctx, ref, { action: 'comment', text: 'Uno', requestId: 'r1' }).comments[0]!;
    as(other); expect(thread(ctx, ref).comments[0]?.canDelete).toBe(false);
    expect(() => thread(ctx, ref, { action: 'delete', commentId: own.id })).toThrow('No puedes');
    const theirs = thread(ctx, ref, { action: 'comment', text: 'Dos', requestId: 'r2' }).comments.find((row) => row.authorId === other.toHexString())!;
    as(author); thread(ctx, ref, { action: 'delete', commentId: theirs.id });
    as(admin); thread(ctx, ref, { action: 'delete', commentId: own.id }); expect(thread(ctx, ref).comments).toEqual([]);
    expect(() => thread(ctx, target('activity', '2'), { action: 'delete', commentId: own.id })).toThrow('disponible');
  });

  it('lee conversaciones cerradas pero impide nuevos mensajes y conserva replay idempotente', () => {
    const { ctx, patch } = setup();
    const challenge = target('challenge', '13'); thread(ctx, challenge, { action: 'comment', text: 'Antes', requestId: 'r' });
    patch('codingChallenge', 13n, { closed: true }); patch('codeReview', 15n, { closed: true }); patch('poll', 9n, { closesAt: at }); patch('helpPost', 10n, { status: 'closed' }); patch('studyRoom', 18n, { status: 'completed' });
    expect(thread(ctx, challenge, { action: 'comment', text: 'Antes', requestId: 'r' }).comments).toHaveLength(1);
    for (const ref of [challenge, target('solution', '14'), target('review', '15'), target('review-comment', '16'), target('poll', '9'), target('help', '10'), target('room', '18')]) {
      expect(thread(ctx, ref)).toMatchObject({ canComment: false, reason: expect.any(String) });
      expect(() => thread(ctx, ref, { action: 'comment', text: 'Después', requestId: 'new' })).toThrow();
    }
  });

  it('rechaza miembros inactivos, referencias no canónicas y comentarios demasiado largos', () => {
    const { ctx, as } = setup();
    for (const value of [{ kind: 'dm', id: '1' }, { kind: 'note', id: '05' }, { kind: 'post', id: '-1' }, { kind: 'note', id: '18446744073709551616' }]) expect(() => feedThread(ctx, JSON.stringify({ action: 'read', target: value }))).toThrow();
    expect(() => thread(ctx, target('post', '12'), { action: 'comment', text: 'x'.repeat(501), requestId: 'r' })).toThrow('500');
    as(removed); expect(() => thread(ctx, target('post', '12'))).toThrow('activo');
  });

  it('bloquea objetos privados, borradores, cancelados y dependencias retiradas para todos', () => {
    const { ctx, patch, seed, as } = setup();
    patch('note', 5n, { visibility: 'personal' }); patch('studyRoom', 18n, { visibility: 'private' }); patch('studyExam', '11111111-1111-4111-8111-111111111111', { visibility: 'personal' });
    patch('spacedCollection', 11n, { archived: true }); patch('poll', 9n, { cancelledAt: at }); patch('helpPost', 10n, { status: 'withdrawn' });
    seed('workDetail', { workId: 3n, status: 'draft' }); seed('contentStatus', { key: 'question:6', withdrawnAt: at }); seed('contentStatus', { key: 'activity:2', withdrawnAt: at });
    const blocked = [target('note', '5'), target('room', '18'), target('exam', '11111111-1111-4111-8111-111111111111'), target('spaced', '11'), target('poll', '9'), target('help', '10'), target('work', '3'), target('question', '6'), target('answer', '7'), target('evidence', '4')];
    for (const person of [author, other, admin]) { as(person); for (const ref of blocked) { expect(() => thread(ctx, ref)).toThrow('disponible'); expect(() => share(ctx, ref)).toThrow('disponible'); } }
  });
});

describe('Enlaces de feed y proyección pública', () => {
  it('solo el owner configura una identidad exclusiva, y miembros/servicios ajenos no leen previews', () => {
    const { ctx, as, patch, seed } = setup(); const configure = configure_feed_share_service as unknown as (ctx: Ctx, input: { identity: Identity; enabled: boolean }) => void;
    expect(() => configure(ctx, { identity: service, enabled: true })).toThrow('propietario');
    as(admin);
    for (const person of [admin, author, other, moduleIdentity]) expect(() => configure(ctx, { identity: person, enabled: true })).toThrow('exclusiva');
    seed('fileServiceConfig', { id: 0, identity: identity('9') }); expect(() => configure(ctx, { identity: identity('9'), enabled: true })).toThrow('exclusiva');
    configure(ctx, { identity: service, enabled: true });
    const ref = target('post', '12'); share(ctx, ref);
    expect(() => readSharePreview(ctx, '1'.repeat(64))).toThrow('servicio');
    as(other); expect(() => readSharePreview(ctx, '1'.repeat(64))).toThrow('servicio');
    as(service); expect(JSON.parse(readSharePreview(ctx, '1'.repeat(64))).title).toBe('Publicación');
    patch('feedShareServiceConfig', 0, { enabled: false }); expect(() => readSharePreview(ctx, '1'.repeat(64))).toThrow('servicio');
    patch('feedShareServiceConfig', 0, { enabled: true }); seed('aiServiceConfig', { id: 0, identity: service, enabled: true });
    expect(() => readSharePreview(ctx, '1'.repeat(64))).toThrow('servicio');
  });
  it('cubre 20 tipos mediante servicio exclusivo, sin publicar tablas, archivos, respuestas ni chats privados', () => {
    const { ctx, anonymous, accessed } = setup();
    const data = rankingContributionData(ctx)!; const ranking = leaderChanges(data, ctx.timestamp.toDate())[0]!; expect(ranking).toBeDefined();
    const all = [...refs, target('ranking', rankingFeedId(ranking))];
    const hashes = all.map((_ref, index) => (index + 1).toString(16).padStart(64, '0'));
    for (const [index, ref] of all.entries()) { const created = share(ctx, ref, hashes[index]); expect(created.preview.path).toMatch(/^\/m\//); }
    anonymous(); accessed.clear();
    for (const tokenHash of hashes) {
      const value = JSON.parse(feedSharePreview(ctx, tokenHash)) as FeedSharePreview;
      expect(Object.keys(value).sort()).toEqual(value.subject ? ['description', 'kindLabel', 'path', 'subject', 'title'] : ['description', 'kindLabel', 'path', 'title']);
      expect(value.title.length).toBeLessThanOrEqual(200); expect(value.description.length).toBeLessThanOrEqual(160);
      expect(JSON.stringify(value)).not.toMatch(/PRIVATE|private\.png|resource:|https:\/\/example|<img|SECRET CODE/);
    }
    expect(accessed.has('resourceChunk')).toBe(false); expect(accessed.has('resourceUpload')).toBe(false);
    expect(accessed.has('roomEntry')).toBe(false); expect(accessed.has('examAttempt')).toBe(false); expect(accessed.has('directMessage')).toBe(false);
    for (const table of Object.values(feedInteractionTables)) expect((table as unknown as { options: { public?: boolean } }).options.public).not.toBe(true);
  });

  it('los enlaces comprueban metadata actual y una retirada intermedia los invalida para siempre', () => {
    const { ctx, patch, rows } = setup(); const ref = target('note', '5'); const created = share(ctx, ref);
    patch('note', 5n, { title: 'Nuevo título' }); expect(JSON.parse(feedSharePreview(ctx, '1'.repeat(64))).title).toBe('Nuevo título');
    withdrawContent(ctx, { kind: 'note', targetId: 5n, withdrawn: true, expectedVersion: 1, reason: '' });
    withdrawContent(ctx, { kind: 'note', targetId: 5n, withdrawn: false, expectedVersion: 2, reason: '' });
    expect(feedSharePreview(ctx, '1'.repeat(64))).toBe('null'); expect(rows('feedShare')[0]?.invalidatedAt).toBeDefined();
    expect(() => share(ctx, ref)).toThrow('utilizó'); expect(share(ctx, ref, '2'.repeat(64)).id).not.toBe(created.id);
  });

  it('volver a borrador al editar o restaurar invalida enlaces del trabajo y exámenes dependientes', () => {
    const { ctx, seed, patch } = setup(); const ref = target('work', '3'); const examRef = target('exam', '11111111-1111-4111-8111-111111111111');
    seed('workDetail', { workId: 3n, topic: 'Funciones', status: 'final', updatedBy: author });
    patch('work', 3n, { updatedAt: at });
    patch('examVersion', '11111111-1111-4111-8111-111111111111:1', { json: JSON.stringify({ title: 'Examen', hasPersonalSources: false,
      preparation: { topics: ['Funciones'], sources: [{ kind: 'work', refId: '3', visibility: 'group', status: 'prepared', origins: [] }], fragments: [] }, questions: [] }) });
    const save = save_work_version as unknown as (ctx: Ctx, input: { workId: bigint; title: string; description: string; topic: string; status: string; expectedVersion: number }) => void;
    const restore = restore_work_version as unknown as (ctx: Ctx, input: { workId: bigint; version: number; expectedVersion: number }) => void;
    share(ctx, ref); share(ctx, examRef, '2'.repeat(64));
    save(ctx, { workId: 3n, title: 'Trabajo', description: 'Descripción', topic: 'Funciones', status: 'draft', expectedVersion: 1 });
    save(ctx, { workId: 3n, title: 'Trabajo', description: 'Descripción', topic: 'Funciones', status: 'final', expectedVersion: 2 });
    expect(feedSharePreview(ctx, '1'.repeat(64))).toBe('null'); expect(feedSharePreview(ctx, '2'.repeat(64))).toBe('null');
    share(ctx, ref, '3'.repeat(64)); share(ctx, examRef, '4'.repeat(64));
    restore(ctx, { workId: 3n, version: 2, expectedVersion: 3 });
    restore(ctx, { workId: 3n, version: 3, expectedVersion: 4 });
    expect(feedSharePreview(ctx, '3'.repeat(64))).toBe('null'); expect(feedSharePreview(ctx, '4'.repeat(64))).toBe('null');
    expect(share(ctx, ref, '5'.repeat(64)).preview.path).toBe('/m/tareas/1?trabajo=3');
  });

  it('la baja y reinvitación de un líder sin salas no reactivan su enlace de ranking', () => {
    const { ctx, as, seed, drop, rows } = setup(); drop('studyRoom', 18n); as(author);
    const email = `${author.toHexString()}@example.test`; seed('memberEmail', { email, memberIdentity: author, verifiedAt: at });
    const ranking = leaderChanges(rankingContributionData(ctx)!, ctx.timestamp.toDate()).find((change) => change.memberId === author.toHexString())!;
    const ref = target('ranking', rankingFeedId(ranking)); share(ctx, ref);
    const remove = remove_member as unknown as (ctx: Ctx, input: { identity: Identity }) => void;
    const invite = invite_member as unknown as (ctx: Ctx, input: { email: string; isCreator: boolean }) => void;
    const join = join_group as unknown as (ctx: Ctx, input: { displayName: string }) => void;
    as(admin); remove(ctx, { identity: author });
    expect(rows('member').find((row) => (row.identity as Identity).isEqual(author))?.status).toBe('removed');
    (ctx as unknown as { timestamp: Timestamp }).timestamp = new Timestamp(at.microsSinceUnixEpoch + 1_000n);
    invite(ctx, { email, isCreator: false }); as(author); join(ctx, { displayName: 'Alumno reinvitado' });
    expect(rows('member').find((row) => (row.identity as Identity).isEqual(author))?.status).toBe('active');
    expect(feedSharePreview(ctx, '1'.repeat(64))).toBe('null');
    expect(share(ctx, ref, '2'.repeat(64)).preview.path).toContain('/m/leaderboard?aviso=');
  });

  it('privacidad, archivo, borrado y pérdida de disponibilidad nunca reactivan el mismo enlace', () => {
    const { ctx, patch, drop } = setup();
    const cases = [[target('note', '5'), 'note', 5n, { visibility: 'personal' }, { visibility: 'group' }],
      [target('room', '18'), 'studyRoom', 18n, { visibility: 'private' }, { visibility: 'group' }],
      [target('exam', '11111111-1111-4111-8111-111111111111'), 'studyExam', '11111111-1111-4111-8111-111111111111', { archived: true }, { archived: false }]] as const;
    for (const [index, [ref, table, id, down, up]] of cases.entries()) {
      const tokenHash = (index + 3).toString().repeat(64); share(ctx, ref, tokenHash); patch(table, id, down);
      expect(feedSharePreview(ctx, tokenHash)).toBe('null'); patch(table, id, up); expect(feedSharePreview(ctx, tokenHash)).toBe('null');
    }
    share(ctx, target('post', '12'), '6'.repeat(64)); deleteFeedPost(ctx, { postId: 12n }); expect(feedSharePreview(ctx, '6'.repeat(64))).toBe('null');
    share(ctx, target('activity', '2'), '7'.repeat(64)); drop('activity', 2n); expect(feedSharePreview(ctx, '7'.repeat(64))).toBe('null');
  });

  it('hooks de archivo y privacidad invalidan aunque se restaure antes de consultar el enlace', () => {
    const { ctx } = setup();
    share(ctx, target('spaced', '11'));
    const archive = archive_spaced_collection as unknown as (ctx: Ctx, input: { collectionId: bigint; archived: boolean; expectedVersion: number }) => void;
    archive(ctx, { collectionId: 11n, archived: true, expectedVersion: 1 }); archive(ctx, { collectionId: 11n, archived: false, expectedVersion: 2 });
    expect(feedSharePreview(ctx, '1'.repeat(64))).toBe('null');
    share(ctx, target('exam', '11111111-1111-4111-8111-111111111111'), '2'.repeat(64));
    const exam = exam_action as unknown as (ctx: { withTx: (fn: (tx: Ctx) => string) => string }, input: { payload: string }) => string;
    const call = (archived: boolean, expectedRevision: number) => exam({ withTx: (fn) => fn(ctx) }, { payload: JSON.stringify({ action: 'setArchived', examId: '11111111-1111-4111-8111-111111111111', archived, expectedRevision }) });
    expect(JSON.parse(call(true, 1)).archived).toBe(true);
    expect(JSON.parse(call(false, 2)).archived).toBe(false);
    expect(feedSharePreview(ctx, '2'.repeat(64))).toBe('null');
  });

  it('las dependencias retiradas invalidan respuestas y exámenes sin exponer su preparación', () => {
    const { ctx, patch } = setup();
    const preparation = { topics: ['Funciones'], sources: [{ kind: 'note', refId: '5', visibility: 'group', status: 'prepared', origins: [] }], fragments: [] };
    patch('examVersion', '11111111-1111-4111-8111-111111111111:1', { json: JSON.stringify({ title: 'Examen', preparation, questions: [{ answer: 'SECRET' }] }) });
    share(ctx, target('exam', '11111111-1111-4111-8111-111111111111')); share(ctx, target('answer', '7'), '2'.repeat(64));
    withdrawContent(ctx, { kind: 'note', targetId: 5n, withdrawn: true, expectedVersion: 1, reason: '' });
    withdrawContent(ctx, { kind: 'note', targetId: 5n, withdrawn: false, expectedVersion: 2, reason: '' });
    expect(feedSharePreview(ctx, '1'.repeat(64))).toBe('null');
    withdrawContent(ctx, { kind: 'question', targetId: 6n, withdrawn: true, expectedVersion: 1, reason: '' });
    expect(feedSharePreview(ctx, '2'.repeat(64))).toBe('null');
  });

  it('creador, autor y admin revocan; terceros no, incluso después de retirar el recurso', () => {
    const { ctx, as, patch } = setup(); const ref = target('note', '5'); as(other); const created = share(ctx, ref);
    as(author); const list = JSON.parse(feedShareAction(ctx, JSON.stringify({ action: 'list', target: ref }))); expect(list[0].canRevoke).toBe(true);
    patch('note', 5n, { visibility: 'personal' }); expect(JSON.parse(feedShareAction(ctx, JSON.stringify({ action: 'revoke', id: created.id })))).toEqual({ ok: true });
    patch('note', 5n, { visibility: 'group' }); expect(feedSharePreview(ctx, '1'.repeat(64))).toBe('null');
    const second = share(ctx, ref, '2'.repeat(64)); as(other); expect(() => feedShareAction(ctx, JSON.stringify({ action: 'revoke', id: second.id }))).toThrow('No puedes');
    as(admin); feedShareAction(ctx, JSON.stringify({ action: 'revoke', id: second.id })); expect(feedSharePreview(ctx, '2'.repeat(64))).toBe('null');
  });

  it('rechaza tokens inválidos, referencias privadas y eventos de ranking inventados; purga el hilo general', () => {
    const { ctx, patch, rows } = setup();
    expect(feedSharePreview(ctx, 'plain-token')).toBe('null');
    expect(() => share(ctx, target('post', '12'), 'x'.repeat(64))).toThrow();
    expect(() => share(ctx, target('ranking', `mes:2023-11-01|${author.toHexString()}|1700000000000`))).toThrow('disponible');
    patch('note', 5n, { visibility: 'personal' }); expect(() => share(ctx, target('note', '5'))).toThrow('disponible');
    thread(ctx, target('assignment', '1'), { action: 'comment', text: 'Comentario', requestId: 'r' });
    share(ctx, target('assignment', '1')); purgeFeedThread(ctx, 'assignment', 1n);
    expect(rows('feedThreadComment')).toHaveLength(0); expect(rows('feedThreadReceipt')).toHaveLength(1); expect(feedSharePreview(ctx, '1'.repeat(64))).toBe('null');
    share(ctx, target('help', '10'), '2'.repeat(64)); mutateHelp(ctx, JSON.stringify({ action: 'withdraw', id: '10', expectedVersion: 1, reason: '', requestId: 'withdraw-help' })); expect(feedSharePreview(ctx, '2'.repeat(64))).toBe('null');
  });
});
