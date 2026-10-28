import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { aiUuid, type GuideMaterialSelection, type GuideMaterialSelectionInput, type GuideMaterialSelectionSummary } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';

export type GuideSelectionValue = Omit<GuideMaterialSelectionInput, 'id' | 'expectedRevision'>;
const valueOf = (value: GuideMaterialSelection): GuideSelectionValue => ({ subjectId: value.subjectId, termId: value.termId,
  guideType: value.guideType, title: value.title, topicsText: value.topicsText, sources: value.sources,
  chosenFileIds: value.chosenFileIds, ...(value.manualSections ? { manualSections: value.manualSections } : {}) });

/** Only the opaque draft id lives in the URL. Material and personal text stay in the actor-bound store. */
export function useGuideMaterialSelection(value: GuideSelectionValue, restore: (saved: GuideMaterialSelection) => void, enabled = true) {
  const source = useDataSource(); const { me } = useSnapshot(); const [params, setParams] = useSearchParams();
  const freshId = useRef(crypto.randomUUID()); const asked = params.get('materialDraft');
  const id = aiUuid(asked) ? asked.toLowerCase() : freshId.current;
  const actor = me?.id; const usable = enabled && me?.status === 'active';
  const [ready, setReady] = useState(false); const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<GuideMaterialSelection>(); const [error, setError] = useState('');
  const [summaries, setSummaries] = useState<GuideMaterialSelectionSummary[]>([]);
  const latest = useRef({ value, restore }); latest.current = { value, restore };
  const revision = useRef(0); const signature = useRef(''); const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const running = useRef<Promise<void> | undefined>(undefined);
  const identity = useRef({ id, actor }); identity.current = { id, actor };
  const text = JSON.stringify(value);

  useEffect(() => {
    const token = ++generation.current; let active = true; setReady(false); setSaved(undefined); setError('');
    revision.current = 0; signature.current = ''; running.current = undefined;
    if (timer.current) clearTimeout(timer.current);
    if (usable) void Promise.all([source.getGuideMaterialSelection(id), source.listGuideMaterialSelections()]).then(([record, list]) => {
      if (!active || token !== generation.current) return;
      if (record) { revision.current = record.revision; signature.current = JSON.stringify(valueOf(record)); setSaved(record); latest.current.restore(record); }
      setSummaries(list); setReady(true);
    }).catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'No pudimos recuperar tus materiales guardados.'); });
    return () => { active = false; generation.current++; if (timer.current) clearTimeout(timer.current); };
  }, [source, id, actor, usable]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    if (!ready || !usable) throw new Error('Espera a que se recuperen tus materiales guardados.');
    while (running.current) await running.current;
    if (JSON.stringify(latest.current.value) === signature.current) return;
    const token = generation.current;
    const current = () => generation.current === token && identity.current.id === id && source.getSnapshot().me?.id === actor;
    const work = async () => {
      if (current()) { setSaving(true); setError(''); }
      try {
        while (current()) {
          const next = latest.current.value; if (!next.subjectId) return;
          const stamp = JSON.stringify(next); if (stamp === signature.current) return;
          let result: GuideMaterialSelection;
          try { result = await source.saveGuideMaterialSelection({ ...next, id, expectedRevision: revision.current }); }
          catch (failure) {
            const recovered = await source.getGuideMaterialSelection(id).catch(() => null);
            if (!recovered || JSON.stringify(valueOf(recovered)) !== stamp) throw failure;
            result = recovered;
          }
          if (!current()) return;
          revision.current = result.revision; signature.current = stamp; setSaved(result);
        }
      } catch (failure) {
        if (current()) setError(failure instanceof Error ? failure.message : 'No pudimos guardar los materiales. Tu selección sigue en pantalla.');
        throw failure;
      } finally { if (current()) setSaving(false); }
    };
    const operation = work(); running.current = operation;
    try { await operation; } finally { if (running.current === operation) running.current = undefined; }
  }, [ready, usable, id, source, actor]);

  useEffect(() => {
    if (!ready || !usable || !value.subjectId || text === signature.current) return;
    timer.current = setTimeout(() => { void flush().catch(() => {}); }, 450);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [text, ready, usable, value.subjectId, flush]);
  useEffect(() => {
    if (!saved || params.get('materialDraft') === id) return;
    setParams((previous) => { const next = new URLSearchParams(previous); next.set('materialDraft', id); return next; }, { replace: true });
  }, [saved, id, params, setParams]);
  const open = (nextId: string) => setParams((previous) => { const next = new URLSearchParams(previous); next.set('materialDraft', nextId); return next; }, { replace: true });
  const refreshList = async () => { const list = await source.listGuideMaterialSelections(); setSummaries(list); };
  return { id, ready, saving, saved, error, summaries, flush, open, refreshList };
}
