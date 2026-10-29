import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import {
  contributionEntries,
  leaderboardPeriods,
  leaderChanges,
  rankingFeedId,
  scoreEntries,
  type RankingContributionData,
} from '../../core/src/feedRankings';

// Same in-memory table adapter used by the server handler tests; SDK registration alone is mocked.
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return {
    SenderError: class SenderError extends Error {},
    t: new Proxy({}, { get: () => () => builder }),
    table: () => ({ rowType: builder }),
    schema: () => ({
      reducer: handler,
      procedure: handler,
      init: handler,
      clientConnected: handler,
      view: handler,
    }),
  };
});
import './index';
import { rankingContributionData, verifiedRanking } from './feedRankingAdapter';
import { rememberContributionOrigins } from './contributionOrigins';
import type { Ctx } from './moduleContext';

const alice = Identity.fromString('a'.repeat(64));
const bob = Identity.fromString('b'.repeat(64));
const removed = Identity.fromString('c'.repeat(64));
const date = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`);
const stamp = (value: Date) => new Timestamp(BigInt(value.getTime()) * 1000n);
const at = (day: number) => stamp(date(day));
type Row = Record<string, unknown>;
const keyOf = (value: unknown) =>
  typeof value === 'object' && value !== null && 'toHexString' in value
    ? (value as Identity).toHexString()
    : String(value);
function tableStore(key: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [keyOf(row[key]), row]));
  return new Proxy(
    {
      rows,
      iter: () => rows.values(),
      insert: (row: Row) => {
        rows.set(keyOf(row[key]), row);
        return row;
      },
    },
    {
      get(target, name) {
        if (name in target) return target[name as keyof typeof target];
        return {
          find: (value: unknown) => rows.get(keyOf(value)),
          filter: (value: unknown) =>
            [...rows.values()].filter((row) => keyOf(row[String(name)]) === keyOf(value)),
          update: (row: Row) => {
            rows.set(keyOf(row[key]), row);
            return row;
          },
          delete: (value: unknown) => rows.delete(keyOf(value)),
        };
      },
    },
  );
}
function setup() {
  const calendar = [
    { period: 1, term: 1, startDate: '2026-10-01', endDate: '2026-10-31' },
    { period: 1, term: 2, startDate: '2026-11-01', endDate: '2026-11-30' },
  ];
  const initial: Record<string, Row[]> = {
    member: [alice, bob, removed].map((identity) => ({
      identity,
      status: identity === removed ? 'removed' : 'active',
      isCreator: false,
      displayName: identity === alice ? 'Ana' : 'Luis',
    })),
    termDates: calendar.map((row, index) => ({ id: BigInt(index + 1), ...row })),
    assignment: [{ id: 1n, title: 'Consigna', createdBy: alice, createdAt: at(1) }],
    activity: [{ id: 2n, title: 'Clase', createdBy: bob, createdAt: at(2) }],
    work: [
      {
        id: 3n,
        assignmentId: 1n,
        title: 'Trabajo',
        description: 'Recorrido',
        createdBy: bob,
        createdAt: at(3),
      },
      {
        id: 4n,
        assignmentId: 1n,
        title: 'Trabajo',
        description: 'Recorrido',
        createdBy: bob,
        createdAt: at(4),
      },
      {
        id: 5n,
        assignmentId: 1n,
        title: 'Borrador privado',
        description: 'No publicado',
        createdBy: alice,
        createdAt: at(5),
      },
    ],
    workAuthor: [
      { id: 31n, workId: 3n, author: alice },
      { id: 32n, workId: 3n, author: bob },
      { id: 33n, workId: 4n, author: bob },
      { id: 34n, workId: 5n, author: alice },
    ],
    workDetail: [
      { workId: 3n, topic: 'Listas', status: 'final' },
      { workId: 4n, topic: 'Listas', status: 'final' },
      { workId: 5n, topic: 'Privado', status: 'draft' },
    ],
    note: [
      {
        id: 6n,
        subjectId: 100n,
        title: 'Nota',
        topic: 'Listas',
        body: 'Acumular',
        visibility: 'group',
        author: bob,
        createdAt: at(5),
      },
      {
        id: 7n,
        subjectId: 100n,
        title: 'PERSONAL',
        topic: 'PERSONAL',
        body: 'PERSONAL',
        visibility: 'personal',
        author: alice,
        createdAt: at(6),
      },
      {
        id: 8n,
        subjectId: 100n,
        title: 'Retirada',
        topic: 'Retirada',
        body: 'Retirada',
        visibility: 'group',
        author: alice,
        createdAt: at(6),
      },
      {
        id: 9n,
        subjectId: 100n,
        title: 'Nota',
        topic: 'Listas',
        body: 'Acumular',
        visibility: 'group',
        author: bob,
        createdAt: at(6),
      },
    ],
    noteDetail: [
      { noteId: 6n, termId: 101n },
      { noteId: 9n, termId: 101n },
    ],
    noteComment: [
      { id: 10n, noteId: 6n, author: alice, createdAt: at(6) },
      { id: 11n, noteId: 7n, author: bob, createdAt: at(6) },
    ],
    question: [
      { id: 12n, title: '¿Cómo acumular?', author: bob, acceptedAnswerId: 13n, resolvedAt: at(8) },
    ],
    answer: [
      { id: 13n, questionId: 12n, author: alice, createdAt: at(7) },
      { id: 14n, questionId: 12n, author: removed, createdAt: at(7) },
    ],
    pageRevision: [
      {
        id: 15n,
        page: 'assignment',
        pageId: 1n,
        version: 2,
        editedBy: bob,
        editedAt: at(10),
        title: 'Consigna',
      },
    ],
    evidence: [
      {
        id: 16n,
        activityId: 2n,
        author: bob,
        participants: [alice, bob],
        content: 'Práctica de listas',
        createdAt: at(11),
      },
    ],
    studyGuide: [
      {
        id: 17n,
        subjectId: 100n,
        termId: 101n,
        title: 'Guía',
        topics: ['Listas'],
        sections: ['Recorridos'],
        createdBy: alice,
        createdAt: at(12),
      },
    ],
    guideSource: [
      {
        id: 18n,
        guideId: 17n,
        kind: 'note',
        refId: 6n,
        status: 'processed',
        addedBy: bob,
        addedAt: at(13),
      },
    ],
    guideReview: [{ id: 19n, guideId: 17n, guideVersion: 1, reviewer: bob, createdAt: at(14) }],
    contentStatus: [{ key: 'note:8', withdrawnAt: at(15) }],
  };
  const keys: Record<string, string> = {
    member: 'identity',
    termDates: 'id',
    workDetail: 'workId',
    noteDetail: 'noteId',
    contentStatus: 'key',
    contentRetention: 'key',
    contributionTombstone: 'fingerprint',
    authIdentityLink: 'sessionIdentity',
  };
  const tables = new Map<string, ReturnType<typeof tableStore>>();
  const db = new Proxy(
    {},
    {
      get(_target, name: string) {
        if (
          [
            'personalProgress',
            'directMessage',
            'studyExam',
            'examAttempt',
            'spacedProgress',
          ].includes(name)
        )
          throw new Error(`El ranking no debe consultar ${name}`);
        if (!tables.has(name)) tables.set(name, tableStore(keys[name] ?? 'id', initial[name]));
        return tables.get(name);
      },
    },
  );
  const state = { db, sender: alice, timestamp: at(26) };
  const ctx = state as unknown as Ctx;
  const rows = (name: string) => [
    ...(db as Record<string, ReturnType<typeof tableStore>>)[name].rows.values(),
  ];
  const expected: RankingContributionData = {
    members: [alice, bob, removed].map((identity) => ({
      id: identity.toHexString(),
      status: identity === removed ? 'removed' : 'active',
    })),
    calendar,
    assignments: [
      { id: '1', title: 'Consigna', createdBy: alice.toHexString(), createdAt: date(1) },
    ],
    activities: [{ id: '2', title: 'Clase', createdBy: bob.toHexString(), createdAt: date(2) }],
    works: [
      {
        id: '3',
        assignmentId: '1',
        title: 'Trabajo',
        description: 'Recorrido',
        topic: 'Listas',
        authorIds: [alice.toHexString(), bob.toHexString()],
        createdAt: date(3),
      },
      {
        id: '4',
        assignmentId: '1',
        title: 'Trabajo',
        description: 'Recorrido',
        topic: 'Listas',
        authorIds: [bob.toHexString()],
        createdAt: date(4),
      },
    ],
    notes: [
      {
        id: '6',
        subjectId: '100',
        termId: '101',
        title: 'Nota',
        topic: 'Listas',
        body: 'Acumular',
        authorId: bob.toHexString(),
        visibility: 'group',
        createdAt: date(5),
      },
      {
        id: '9',
        subjectId: '100',
        termId: '101',
        title: 'Nota',
        topic: 'Listas',
        body: 'Acumular',
        authorId: bob.toHexString(),
        visibility: 'group',
        createdAt: date(6),
      },
    ],
    noteComments: [{ id: '10', noteId: '6', authorId: alice.toHexString(), createdAt: date(6) }],
    questions: [
      {
        id: '12',
        title: '¿Cómo acumular?',
        authorId: bob.toHexString(),
        acceptedAnswerId: '13',
        resolvedAt: date(8),
      },
    ],
    answers: [
      { id: '13', questionId: '12', authorId: alice.toHexString(), createdAt: date(7) },
      { id: '14', questionId: '12', authorId: removed.toHexString(), createdAt: date(7) },
    ],
    revisions: [
      {
        id: '15',
        page: 'assignment',
        pageId: '1',
        version: 2,
        editedBy: bob.toHexString(),
        editedAt: date(10),
        title: 'Consigna',
      },
    ],
    evidences: [
      {
        id: '16',
        activityId: '2',
        authorId: bob.toHexString(),
        participantIds: [alice.toHexString(), bob.toHexString()],
        content: 'Práctica de listas',
        createdAt: date(11),
      },
    ],
    guides: [
      {
        id: '17',
        subjectId: '100',
        termId: '101',
        title: 'Guía',
        topics: ['Listas'],
        sections: ['Recorridos'],
        createdBy: alice.toHexString(),
        createdAt: date(12),
      },
    ],
    guideSources: [
      {
        id: '18',
        guideId: '17',
        kind: 'note',
        refId: '6',
        status: 'processed',
        addedBy: bob.toHexString(),
        addedAt: date(13),
      },
    ],
    guideReviews: [
      {
        id: '19',
        guideId: '17',
        guideVersion: 1,
        reviewerId: bob.toHexString(),
        createdAt: date(14),
      },
    ],
    resourceFiles: [],
    workFiles: [],
    contributionOrigins: [
      { kind: 'trabajo', refId: '3', memberId: alice.toHexString(), creditedAt: date(3) },
      { kind: 'trabajo', refId: '3', memberId: bob.toHexString(), creditedAt: date(3) },
      {
        kind: 'trabajo',
        refId: '4',
        memberId: bob.toHexString(),
        creditedAt: date(3),
        duplicateOf: '3',
      },
      { kind: 'apunte', refId: '6', memberId: bob.toHexString(), creditedAt: date(5) },
      {
        kind: 'apunte',
        refId: '9',
        memberId: bob.toHexString(),
        creditedAt: date(5),
        duplicateOf: '6',
      },
      { kind: 'respuesta', refId: '13', memberId: alice.toHexString(), creditedAt: date(7) },
      { kind: 'respuesta', refId: '14', memberId: removed.toHexString(), creditedAt: date(7) },
      { kind: 'evidencia', refId: '16', memberId: alice.toHexString(), creditedAt: date(11) },
      { kind: 'evidencia', refId: '16', memberId: bob.toHexString(), creditedAt: date(11) },
      { kind: 'guia', refId: '17', memberId: alice.toHexString(), creditedAt: date(12) },
    ],
  };
  return { ctx, state, rows, tables, expected };
}

describe('paridad del adaptador de ranking del servidor', () => {
  it('normaliza aportes y produce el mismo puntaje/avisos que los registros visibles de la app', () => {
    const { ctx, expected } = setup();
    const actual = rankingContributionData(ctx)!;
    const window = leaderboardPeriods(expected.calendar, date(26))[0]!.window;
    expect(scoreEntries(contributionEntries(actual), window)).toEqual(
      scoreEntries(contributionEntries(expected), window),
    );
    expect(leaderChanges(actual, date(26))).toEqual(leaderChanges(expected, date(26)));
    expect(JSON.stringify(actual)).not.toContain('PERSONAL');
    expect(JSON.stringify(actual)).not.toContain('Borrador privado');
    expect(actual.notes.map((row) => row.id)).toEqual(['6', '9']);
  });
  it('excluye copias idénticas y conserva el origen cuando se retira el primer registro', () => {
    const { ctx, rows } = setup();
    (ctx.db.contentStatus as unknown as ReturnType<typeof tableStore>).rows.set('note:6', {
      key: 'note:6',
      withdrawnAt: at(25),
    });
    const data = rankingContributionData(ctx)!;
    const copy = scoreEntries(contributionEntries(data), {}).find(
      (entry) => entry.kind === 'apunte' && entry.refId === '9',
    );
    expect(copy?.points).toBe(0);
    expect(copy?.at).toEqual(date(5));
    expect(copy?.skipped).toContain('copia idéntica');
    expect(rows('note')).toHaveLength(4);
  });
  it('conserva la exclusión de una copia tras purgar el original sin publicar la huella', () => {
    const { ctx } = setup();
    rememberContributionOrigins(ctx, new Set(['note:6']));
    ctx.db.note.id.delete(6n);
    const data = rankingContributionData(ctx)!;
    const copy = scoreEntries(contributionEntries(data), {}).find(
      (entry) => entry.kind === 'apunte' && entry.refId === '9',
    );
    expect(copy?.points).toBe(0);
    expect(copy?.at).toEqual(date(5));
    expect(
      data.contributionOrigins?.find((row) => row.kind === 'apunte' && row.refId === '9'),
    ).toMatchObject({ duplicateOf: '6', creditedAt: date(5) });
    expect(JSON.stringify(data.contributionOrigins)).not.toMatch(/fingerprint|sha256|Acumular/);
  });
  it('no reconstruye datos para un integrante sin acceso ni consulta progreso privado', () => {
    const { ctx } = setup();
    expect(rankingContributionData(ctx, removed)).toBeUndefined();
    expect(rankingContributionData(ctx, bob)).toBeDefined();
  });
  it('verifica un aviso auténtico después del cambio de parcial y rechaza identidades inventadas', () => {
    const { ctx, state, expected } = setup();
    const notice = leaderChanges(expected, date(26))[0]!;
    state.timestamp = stamp(new Date('2026-11-10T12:00:00.000Z'));
    expect(verifiedRanking(ctx, rankingFeedId(notice))).toEqual(notice);
    expect(
      verifiedRanking(
        ctx,
        `parcial:1:1:2026-10-01|${removed.toHexString()}|${notice.at.getTime()}`,
      ),
    ).toBeUndefined();
    expect(
      verifiedRanking(ctx, `parcial:1:1:2026-10-01|${alice.toHexString()}|9999999999999`),
    ).toBeUndefined();
  });
  it('no atribuye al parcial anterior un primer lugar que ocurrió después de empezar el siguiente', () => {
    const { ctx, state, tables } = setup();
    const future = new Date('2026-11-05T12:00:00.000Z');
    state.timestamp = stamp(new Date('2026-11-10T12:00:00.000Z'));
    [...ctx.db.studyGuide.iter()]; // Inicializa la tabla del adaptador de prueba.
    tables
      .get('studyGuide')!
      .rows.set('20', {
        id: 20n,
        subjectId: 100n,
        termId: 102n,
        title: 'Guía del parcial 2',
        topics: ['Otro tema'],
        sections: ['Nueva explicación'],
        createdBy: bob,
        createdAt: stamp(future),
      });
    const fabricated = `parcial:1:1:2026-10-01|${bob.toHexString()}|${future.getTime()}`;
    expect(verifiedRanking(ctx, fabricated)).toBeUndefined();
  });
});
