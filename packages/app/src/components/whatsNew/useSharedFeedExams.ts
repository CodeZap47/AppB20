import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExamSummary } from '@b20/core';
import { useDataSource, useSnapshot } from '../../data/DataContext';
import type { DataSource, Snapshot } from '../../data/types';

interface FeedExamsState {
  source: DataSource;
  session: string;
  permissions: string;
  exams: ExamSummary[];
  loading: boolean;
  error: string;
}
interface ActiveRead { source: DataSource; session: string; owner: object; promise: Promise<void> }
const ACADEMIC_FILE_TARGETS = new Set(['note', 'assignment', 'activity', 'work', 'evidence', 'guide', 'question', 'answer']);

function permissionSession(snapshot: Snapshot, enabled: boolean) {
  return enabled && snapshot.connection === 'ready' && snapshot.me?.status === 'active' ? snapshot.me.id : '';
}

/** Changes to text, counters and feed reactions do not change source access. */
function sourcePermissions(snapshot: Snapshot) {
  const rows = [
    ...(snapshot.notes ?? []).map((row) => ['note', row.id, row.subjectId, row.termId, row.authorId, row.visibility, !!row.withdrawnAt]),
    ...(snapshot.assignments ?? []).map((row) => ['assignment', row.id, row.subjectId, row.termId]),
    ...(snapshot.works ?? []).map((row) => ['work', row.id, row.assignmentId, !!row.withdrawnAt]),
    ...(snapshot.activities ?? []).map((row) => ['activity', row.id, row.subjectId, row.termId]),
    ...(snapshot.evidences ?? []).map((row) => ['evidence', row.id, row.activityId, !!row.withdrawnAt]),
    ...(snapshot.guides ?? []).map((row) => ['guide', row.id, row.subjectId, row.termId, !!row.withdrawnAt]),
    ...(snapshot.questions ?? []).map((row) => ['question', row.id, row.subjectId, !!row.withdrawnAt]),
    ...(snapshot.answers ?? []).map((row) => ['answer', row.id, row.questionId, !!row.withdrawnAt]),
    ...(snapshot.spacedCollections ?? []).map((row) => ['collection', row.id, row.subjectId, row.termId, row.visibility, row.archived]),
    ...(snapshot.spacedCards ?? []).map((row) => ['card', row.id, row.collectionId, row.sourceKind, row.sourceId, row.archived]),
    ...(snapshot.resourceFiles ?? []).filter((row) => ACADEMIC_FILE_TARGETS.has(row.targetKind)).map((row) => ['file', row.id, row.targetKind, row.targetId, !!row.removedAt]),
    ...(snapshot.workFiles ?? []).map((row) => ['work-file', row.id, row.workId]),
  ];
  return JSON.stringify(rows.map((row) => JSON.stringify(row)).sort());
}

/** Public summaries live outside the subscription snapshot and never outlive membership. */
export function useSharedFeedExams(enabled: boolean): { exams: ExamSummary[]; loading: boolean; error: string; refresh: () => void } {
  const source = useDataSource();
  const snapshot = useSnapshot();
  const session = permissionSession(snapshot, enabled);
  const permissions = session ? sourcePermissions(snapshot) : '';
  const [state, setState] = useState<FeedExamsState>({ source, session: '', permissions: '', exams: [], loading: false, error: '' });
  const activeReads = useRef<ActiveRead[]>([]);
  const refreshRequest = useRef<() => void>(() => {});
  const current = useRef({ source, session, permissions });
  current.current = { source, session, permissions };
  const refresh = useCallback(() => refreshRequest.current(), []);

  useEffect(() => {
    let disposed = false;
    let queued = false;
    const owner = {};
    const valid = () => {
      if (disposed || current.current.source !== source || current.current.session !== session || current.current.permissions !== permissions) return false;
      const latest = source.getSnapshot();
      return permissionSession(latest, true) === session && sourcePermissions(latest) === permissions;
    };
    setState({ source, session, permissions, exams: [], loading: false, error: '' });
    if (!session) { refreshRequest.current = () => {}; return; }

    const load = () => {
      if (!valid() || document.visibilityState !== 'visible') return;
      const active = activeReads.current.find((read) => read.source === source && read.session === session);
      if (active) {
        if (active.owner !== owner && !queued) {
          queued = true;
          setState((previous) => ({ ...previous, loading: true }));
          void active.promise.then(() => { queued = false; load(); });
        }
        return;
      }
      setState((previous) => ({ ...previous, loading: true, error: '' }));
      // Promise.resolve also isolates a transport that throws before returning a promise.
      const promise = Promise.resolve().then(() => {
        if (!valid()) return undefined;
        return source.examAction({ action: 'listExams', sharedOnly: true });
      }).then((exams) => {
        if (!valid() || !exams) return;
        // An older server may ignore sharedOnly. Never accept its private or draft projection.
        const approved = exams.filter((exam) => exam.visibility === 'group' && !exam.archived &&
          Number.isInteger(exam.readyVersion) && exam.readyVersion! > 0 && exam.draftVersion === undefined);
        setState({ source, session, permissions, exams: approved, loading: false, error: '' });
      }).catch(() => {
        if (valid()) setState({ source, session, permissions, exams: [], loading: false, error: 'No se pudieron actualizar los exámenes compartidos.' });
      }).finally(() => { activeReads.current = activeReads.current.filter((read) => read.owner !== owner); });
      activeReads.current.push({ source, session, owner, promise });
    };
    refreshRequest.current = load;
    load();
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    const timer = window.setInterval(load, 15_000);
    return () => {
      disposed = true;
      refreshRequest.current = () => {};
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', load);
    };
  }, [source, session, permissions]);

  if (!session || state.source !== source || state.session !== session || state.permissions !== permissions) return { exams: [], loading: false, error: '', refresh };
  return { exams: state.exams, loading: state.loading, error: state.error, refresh };
}
