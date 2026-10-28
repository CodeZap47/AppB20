import { cleanChatPostRef, feedPreviewText, isFeedChatPost, leaderChanges, rankingFeedId,
  type ChatPostKind, type ChatPostPreview, type ChatPostRef, type FeedResourceRef, type FeedSharePreview } from '@b20/core';
import type { DataSource, Snapshot } from './types';

type FeedResolver = (target: FeedResourceRef) => Promise<FeedSharePreview | undefined>;
function active(data: Snapshot) { if (!data.me || data.me.status !== 'active') throw new Error('Inicia sesión para compartir publicaciones.'); return data.me.id; }

export async function resolveDemoChatPosts(source: DataSource, targets: readonly ChatPostRef[], feed: FeedResolver): Promise<ChatPostPreview[]> {
  if (targets.length > 50) throw new Error('Selecciona hasta 50 publicaciones.');
  const data = source.getSnapshot(); const actor = active(data);
  const rows = await Promise.all(targets.map(async value => {
    const target = cleanChatPostRef(value); const unavailable: ChatPostPreview = { target, available: false };
    if (isFeedChatPost(target)) {
      const preview = await feed(target);
      return preview ? { target, available: true, ...preview } : unavailable;
    }
    if (target.kind === 'signal-dictionary') {
      const dictionary = data.signals.dictionaries.find(row => row.id === target.id && row.publishedVersion > 0 && !row.archived);
      const version = dictionary && data.signals.versions.find(row => row.dictionaryId === dictionary.id && row.number === dictionary.publishedVersion);
      if (!version) return unavailable;
      const subject = data.subjects.find(row => row.id === version.subjectId)?.name;
      return { target, available: true, title: feedPreviewText(version.title, 200), description: feedPreviewText(version.topic, 160),
        kindLabel: 'Diccionario de señales', path: `/m/senales?diccionario=${encodeURIComponent(target.id)}`, ...(subject ? { subject } : {}) };
    }
    const project = data.visualProjects?.find(row => row.id === target.id && row.visibility === 'group' && !row.archived);
    return project ? { target, available: true, title: feedPreviewText(project.title, 200),
      description: feedPreviewText(project.description || project.objective, 160), kindLabel: 'Proyecto visual', path: `/m/laboratorio-visual/${project.id}` } : unavailable;
  }));
  if (active(source.getSnapshot()) !== actor) throw new Error('La sesión cambió. Vuelve a abrir las publicaciones.');
  return rows;
}

export async function searchDemoChatPosts(source: DataSource, query: string, kind: ChatPostKind | undefined, feed: FeedResolver): Promise<ChatPostPreview[]> {
  if (query.length > 160) throw new Error('La búsqueda es demasiado larga.');
  const data = source.getSnapshot(); const actor = active(data); const targets: ChatPostRef[] = [];
  const add = (next: ChatPostKind, rows: readonly { id: string }[]) => { if (!kind || kind === next) for (const row of rows) targets.push({ kind: next, id: row.id }); };
  add('assignment', data.assignments); add('activity', data.activities); add('work', data.works); add('evidence', data.evidences);
  add('note', data.notes); add('question', data.questions); add('answer', data.answers); add('guide', data.guides); add('poll', data.polls);
  add('help', data.helpPosts); add('spaced', data.spacedCollections); add('post', data.feedPosts); add('challenge', data.codingChallenges);
  add('solution', data.challengeSolutions); add('review', data.codeReviews); add('review-comment', data.codeReviewComments);
  add('opportunity', data.opportunities); add('room', data.studyRooms); add('signal-dictionary', data.signals.dictionaries); add('visual-project', data.visualProjects ?? []);
  if (!kind || kind === 'exam') add('exam', await source.examAction({ action: 'listExams', sharedOnly: true }));
  if (!kind || kind === 'ranking') for (const row of leaderChanges(data)) targets.push({ kind: 'ranking', id: rankingFeedId(row) });
  const normalized = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
  const needle = normalized(query).trim(); const results: ChatPostPreview[] = [];
  targets.reverse();
  for (let offset = 0; offset < targets.length && results.length < 50; offset += 50) {
    const rows = await resolveDemoChatPosts(source, targets.slice(offset, offset + 50), feed);
    results.push(...rows.filter(row => row.available && (!needle || normalized(`${row.title} ${row.description} ${row.kindLabel} ${row.subject ?? ''}`).includes(needle))));
  }
  if (active(source.getSnapshot()) !== actor) throw new Error('La sesión cambió. Vuelve a abrir las publicaciones.');
  return results.slice(0, 50);
}
