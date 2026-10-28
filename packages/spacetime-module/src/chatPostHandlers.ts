import { SenderError } from 'spacetimedb/server';
import { CHAT_POST_KINDS, chatPostKey, cleanChatPostRef, isFeedChatPost, type ChatPostKind, type ChatPostPreview, type ChatPostRef } from '../../core/src/chatPosts';
import { feedPreviewText } from '../../core/src/feedInteractions';
import { leaderChanges, rankingFeedId } from '../../core/src/feedRankings';
import { resolveFeedResource } from './feedInteractionHandlers';
import { rankingContributionData } from './feedRankingAdapter';
import { activeMember, type Ctx } from './moduleContext';
import { readSignalState } from './signalsHandlers';

// The visual module may not be installed on a server yet. Keep this integration additive.
interface SharedVisualRow { id: bigint; visibility: string; archived: boolean; metadata: string }
function visualTable(ctx: Ctx) {
  return (ctx.db as unknown as { visualProject?: { id: { find(id: bigint): SharedVisualRow | undefined }; iter(): Iterable<SharedVisualRow> } }).visualProject;
}

/** This resolver never creates public links or expands a module's visibility. */
export function resolveChatPost(ctx: Ctx, target: ChatPostRef): ChatPostPreview {
  const unavailable: ChatPostPreview = { target, available: false };
  if (isFeedChatPost(target)) {
    const resource = resolveFeedResource(ctx, target);
    if (!resource) return unavailable;
    const subject = resource.subjectId === undefined ? undefined : ctx.db.subject.id.find(resource.subjectId)?.name;
    return { target, available: true, title: feedPreviewText(resource.title, 200) || resource.kindLabel,
      description: feedPreviewText(resource.description, 160), kindLabel: resource.kindLabel, path: resource.path,
      ...(subject ? { subject: feedPreviewText(subject, 100) } : {}) };
  }
  if (target.kind === 'signal-dictionary') {
    const state = readSignalState(ctx.db);
    const dictionary = state.dictionaries.find(row => row.id === target.id);
    if (!dictionary || dictionary.archived || !dictionary.publishedVersion) return unavailable;
    // Published metadata is separate from the author's potentially private draft.
    const version = state.versions.find(row => row.dictionaryId === dictionary.id && row.number === dictionary.publishedVersion);
    if (!version) return unavailable;
    const subject = ctx.db.subject.id.find(BigInt(version.subjectId))?.name;
    return { target, available: true, title: feedPreviewText(version.title, 200), description: feedPreviewText(version.topic, 160),
      kindLabel: 'Diccionario de señales', path: `/m/senales?diccionario=${encodeURIComponent(target.id)}`,
      ...(subject ? { subject: feedPreviewText(subject, 100) } : {}) };
  }
  const id = BigInt(target.id); const row = visualTable(ctx)?.id.find(id);
  if (!row || row.visibility !== 'group' || row.archived) return unavailable;
  const metadata = JSON.parse(row.metadata) as { title: string; description: string; objective: string };
  return { target, available: true, title: feedPreviewText(metadata.title, 200),
    description: feedPreviewText(metadata.description || metadata.objective, 160), kindLabel: 'Proyecto visual', path: `/m/laboratorio-visual/${target.id}` };
}

function candidates(ctx: Ctx, kind?: ChatPostKind): ChatPostRef[] {
  const rows: ChatPostRef[] = [];
  const add = (next: ChatPostKind, table: Iterable<{ id: string | bigint }>) => {
    if (!kind || kind === next) for (const row of table) rows.push({ kind: next, id: String(row.id) });
  };
  add('assignment', ctx.db.assignment.iter()); add('activity', ctx.db.activity.iter());
  add('work', ctx.db.work.iter()); add('evidence', ctx.db.evidence.iter()); add('note', ctx.db.note.iter());
  add('question', ctx.db.question.iter()); add('answer', ctx.db.answer.iter()); add('guide', ctx.db.studyGuide.iter());
  add('poll', ctx.db.poll.iter()); add('help', ctx.db.helpPost.iter()); add('spaced', ctx.db.spacedCollection.iter());
  add('post', ctx.db.feedPost.iter()); add('challenge', ctx.db.codingChallenge.iter()); add('solution', ctx.db.challengeSolution.iter());
  add('review', ctx.db.codeReview.iter()); add('review-comment', ctx.db.codeReviewComment.iter());
  add('opportunity', ctx.db.opportunity.iter()); add('room', ctx.db.studyRoom.iter()); add('exam', ctx.db.studyExam.iter());
  add('visual-project', visualTable(ctx)?.iter() ?? []);
  if (!kind || kind === 'signal-dictionary') add('signal-dictionary', readSignalState(ctx.db).dictionaries);
  if (!kind || kind === 'ranking') {
    const data = rankingContributionData(ctx);
    if (data) for (const ranking of leaderChanges(data, ctx.timestamp.toDate())) rows.push({ kind: 'ranking', id: rankingFeedId(ranking) });
  }
  return rows;
}

/** Member-only, read-only catalogue; IDs and routes are independently checked on every call. */
export function chatPostAction(ctx: Ctx, payload: string): string {
  activeMember(ctx);
  if (typeof payload !== 'string' || payload.length > 80_000) throw new SenderError('La solicitud de publicaciones no es válida.');
  try {
    const input = JSON.parse(payload) as Record<string, unknown>;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Solicitud no válida.');
    if (input.action === 'resolve') {
      if (!Array.isArray(input.targets) || input.targets.length > 50) throw new Error('Selecciona hasta 50 publicaciones.');
      const targets = input.targets.map(value => cleanChatPostRef(value, true));
      return JSON.stringify(targets.map(target => resolveChatPost(ctx, target)));
    }
    if (input.action !== 'search' || typeof input.query !== 'string' || input.query.length > 160
      || input.kind !== undefined && !(CHAT_POST_KINDS as readonly unknown[]).includes(input.kind)) throw new Error('La búsqueda no es válida.');
    const query = input.query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
    const seen = new Set<string>(); const result: ChatPostPreview[] = [];
    for (const target of candidates(ctx, input.kind as ChatPostKind | undefined).reverse()) {
      if (seen.has(chatPostKey(target))) continue; seen.add(chatPostKey(target));
      const row = resolveChatPost(ctx, target);
      if (!row.available) continue;
      const haystack = `${row.title} ${row.description} ${row.kindLabel} ${row.subject ?? ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
      if (!query || haystack.includes(query)) result.push(row);
      if (result.length === 50) break;
    }
    return JSON.stringify(result);
  } catch (error) {
    throw new SenderError(error instanceof Error && !(error instanceof SyntaxError) ? error.message : 'La solicitud de publicaciones no es válida.');
  }
}
