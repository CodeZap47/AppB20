import { leaderboardPeriods, leaderChangesForPeriod, rankingFeedId, type RankingContributionData } from '../../core/src/feedRankings';
import { memberIdentityFor } from './authIdentity';
import { canReadTarget, withdrawn } from './delivery2Handlers';
import { readContributionOrigins } from './contributionOrigins';
import { isActive, type Ctx } from './moduleContext';

/** Reconstruye únicamente aportes del grupo con las reglas compartidas, nunca progreso privado. */
export function rankingContributionData(ctx: Ctx, viewer = memberIdentityFor(ctx)): RankingContributionData | undefined {
  const db = ctx.db;
  if (!isActive(db, viewer)) return undefined;
  const visible = (kind: string, id: bigint) => canReadTarget(db, viewer, kind, id) && !withdrawn(db, kind, id);
  const authors = new Map<bigint, string[]>();
  for (const row of db.workAuthor.iter()) authors.set(row.workId, [...(authors.get(row.workId) ?? []), row.author.toHexString()]);
  const works = [...db.work.iter()].filter((row) => visible('work', row.id) && db.workDetail.workId.find(row.id)?.status !== 'draft');
  const notes = [...db.note.iter()].filter((row) => row.visibility === 'group' && visible('note', row.id));
  const questions = [...db.question.iter()].filter((row) => visible('question', row.id));
  const guides = [...db.studyGuide.iter()].filter((row) => visible('guide', row.id));
  const evidence = [...db.evidence.iter()].filter((row) => visible('evidence', row.id));
  const noteIds = new Set(notes.map((row) => row.id));
  const questionIds = new Set(questions.map((row) => row.id));
  const guideIds = new Set(guides.map((row) => row.id));
  return {
    members: [...db.member.iter()].map((row) => ({ id: row.identity.toHexString(), status: row.status })),
    calendar: [...db.termDates.iter()].map(({ period, term, startDate, endDate }) => ({ period, term, startDate, endDate })),
    assignments: [...db.assignment.iter()].filter((row) => visible('assignment', row.id)).map((row) => ({ id: String(row.id), title: row.title, createdBy: row.createdBy.toHexString(), createdAt: row.createdAt.toDate() })),
    activities: [...db.activity.iter()].filter((row) => visible('activity', row.id)).map((row) => ({ id: String(row.id), title: row.title, createdBy: row.createdBy.toHexString(), createdAt: row.createdAt.toDate() })),
    works: works.map((row) => ({ id: String(row.id), assignmentId: String(row.assignmentId), title: row.title, description: row.description, topic: db.workDetail.workId.find(row.id)?.topic, authorIds: authors.get(row.id) ?? [], createdAt: row.createdAt.toDate() })),
    notes: notes.map((row) => ({ id: String(row.id), subjectId: String(row.subjectId), termId: db.noteDetail.noteId.find(row.id)?.termId?.toString(), title: row.title, topic: row.topic, body: row.body, authorId: row.author.toHexString(), visibility: row.visibility, createdAt: row.createdAt.toDate() })),
    noteComments: [...db.noteComment.iter()].filter((row) => noteIds.has(row.noteId)).map((row) => ({ id: String(row.id), noteId: String(row.noteId), authorId: row.author.toHexString(), createdAt: row.createdAt.toDate() })),
    questions: questions.map((row) => ({ id: String(row.id), title: row.title, authorId: row.author.toHexString(), acceptedAnswerId: row.acceptedAnswerId?.toString(), resolvedAt: row.resolvedAt?.toDate() })),
    answers: [...db.answer.iter()].filter((row) => questionIds.has(row.questionId) && visible('answer', row.id)).map((row) => ({ id: String(row.id), questionId: String(row.questionId), authorId: row.author.toHexString(), createdAt: row.createdAt.toDate() })),
    revisions: [...db.pageRevision.iter()].filter((row) => visible(row.page, row.pageId)).map((row) => ({ id: String(row.id), page: row.page, pageId: String(row.pageId), version: row.version, editedBy: row.editedBy.toHexString(), editedAt: row.editedAt.toDate(), title: row.title })),
    evidences: evidence.map((row) => ({ id: String(row.id), activityId: String(row.activityId), authorId: row.author.toHexString(), participantIds: row.participants.map((person) => person.toHexString()), content: row.content, createdAt: row.createdAt.toDate() })),
    guides: guides.map((row) => ({ id: String(row.id), subjectId: String(row.subjectId), termId: row.termId?.toString(), title: row.title, topics: row.topics, sections: row.sections, createdBy: row.createdBy.toHexString(), createdAt: row.createdAt.toDate() })),
    guideSources: [...db.guideSource.iter()].filter((row) => guideIds.has(row.guideId)).map((row) => ({ id: String(row.id), guideId: String(row.guideId), kind: row.kind, refId: String(row.refId), status: row.status, addedBy: row.addedBy.toHexString(), addedAt: row.addedAt.toDate() })),
    guideReviews: [...db.guideReview.iter()].filter((row) => guideIds.has(row.guideId)).map((row) => ({ id: String(row.id), guideId: String(row.guideId), guideVersion: row.guideVersion, reviewerId: row.reviewer.toHexString(), createdAt: row.createdAt.toDate() })),
    resourceFiles: [...db.resourceFile.iter()].filter((row) => visible(row.targetKind, row.targetId)).map((row) => ({ id: row.id, targetKind: row.targetKind, targetId: String(row.targetId), name: row.name, size: Number(row.size), contentType: row.contentType, removedAt: row.removedAt?.toDate() })),
    workFiles: [...db.workFile.iter()].filter((row) => works.some((work) => work.id === row.workId)).map((row) => ({ id: String(row.id), workId: String(row.workId), name: row.name, size: Number(row.size), contentType: row.contentType })),
    contributionOrigins: readContributionOrigins(db, viewer).map((row) => ({ kind: row.kind, refId: String(row.refId), memberId: row.memberId.toHexString(), creditedAt: row.creditedAt.toDate(), duplicateOf: row.duplicateOf?.toString() })),
  };
}

/** El periodo va en la referencia: el aviso sigue siendo verificable al pasar al siguiente. */
export function verifiedRanking(ctx: Ctx, id: string, viewer = memberIdentityFor(ctx)) {
  const [periodKey, memberId, timestamp, extra] = id.split('|');
  if (extra !== undefined || !memberId || !/^\d+$/.test(timestamp ?? '')) return undefined;
  const partial = /^parcial:([1-9]):([1-3]):(\d{4}-\d{2}-\d{2})$/.exec(periodKey ?? '');
  const month = /^mes:(\d{4}-\d{2}-\d{2})$/.exec(periodKey ?? '');
  if (!partial && !month) return undefined;
  const anchor = new Date(`${partial?.[3] ?? month?.[1]}T12:00:00.000Z`);
  if (!Number.isFinite(anchor.getTime())) return undefined;
  if (month) anchor.setUTCDate(anchor.getUTCDate() + 29);
  if (anchor.getTime() > ctx.timestamp.toDate().getTime() + 86_400_000) return undefined;
  const data = rankingContributionData(ctx, viewer);
  if (!data) return undefined;
  const period = leaderboardPeriods(data.calendar, anchor)[0]!;
  if (period.key !== periodKey) return undefined;
  const nextStart = partial && data.calendar.map((entry) => entry.startDate).filter((day) => day > partial[3]!).sort()[0];
  const end = nextStart ? Date.parse(`${nextStart}T00:00:00.000Z`)
    : month ? Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() + 1)
    : Number.POSITIVE_INFINITY;
  const to = new Date(Math.min(end, ctx.timestamp.toDate().getTime() + 1));
  return leaderChangesForPeriod(data, { ...period, window: { ...period.window, to } }).find((change) => rankingFeedId(change) === id);
}
