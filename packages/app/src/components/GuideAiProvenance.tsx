import { useEffect, useState } from 'react';
import { GUIDE_SECTIONS, type GuideAiProvenance as Provenance } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { GUIDE_AI_SOURCE_LABELS } from '../lib/guideAiSources';

/** Authorized on-demand read: manual guides simply have no AI provenance. */
export function GuideAiProvenance({ guideId, version }: { guideId: string; version: number }) {
  const source = useDataSource(); const data = useSnapshot();
  const signature = JSON.stringify([data.me?.id, data.me?.status,
    data.notes.map((row) => [row.id, row.version, row.visibility, row.withdrawnAt]),
    data.works.map((row) => [row.id, row.version, row.withdrawnAt]), data.evidences.map((row) => [row.id, row.version, row.withdrawnAt]),
    data.questions.map((row) => [row.id, row.version, row.withdrawnAt]), data.answers.map((row) => [row.id, row.version, row.withdrawnAt]),
    data.assignments.map((row) => [row.id, row.version]), data.activities.map((row) => [row.id, row.version])]);
  const [saved, setSaved] = useState<{ signature: string; result: Provenance | null }>();
  // Hide cached source text during the same render that observes a withdrawal or access change.
  const result = saved?.signature === signature ? saved.result : null;
  useEffect(() => {
    let active = true; setSaved(undefined);
    if (source.getGuideAiProvenance) void source.getGuideAiProvenance(guideId, version).then((value) => { if (active) setSaved({ signature, result: value }); }).catch(() => {});
    return () => { active = false; };
  }, [source, guideId, version, signature]);
  if (!result) return null;
  return <details className="ai-preview guide-ai-provenance"><summary>Procedencia de IA y citas de esta versión</summary>
    <p>Contenido originado en un borrador con <strong>{result.model}</strong>. Cada cita corresponde al texto y la versión conservados.</p>
    {result.editedAfterGeneration && <p className="ai-notice">Esta versión fue editada después de generarse. Las citas conservan la procedencia original; revisa su correspondencia con los cambios.</p>}
    {result.citations.map((section) => <div key={section.id}><h4>{GUIDE_SECTIONS.find((entry) => entry.id === section.id)?.title}</h4>
      {section.citations.map((id) => { const fragment = result.fragments.find((entry) => entry.id === id); if (!fragment) return null;
        return <details className="ai-fragment" key={id}><summary>{fragment.origins.map((origin) => `${result.sources.find((source) => source.kind === origin.kind && source.refId === origin.refId)?.title ?? GUIDE_AI_SOURCE_LABELS[origin.kind]} · versión ${origin.version}${origin.locator ? ` · ${origin.locator.kind === 'page' ? 'página' : origin.locator.kind === 'paragraph' ? 'párrafo' : 'líneas'} ${origin.locator.start}–${origin.locator.end}` : ` · líneas ${origin.startLine}–${origin.endLine}`}`).join('; ')}</summary><pre>{fragment.text}</pre><small className="muted">Referencia: {id}</small></details>;
      })}
    </div>)}
  </details>;
}
