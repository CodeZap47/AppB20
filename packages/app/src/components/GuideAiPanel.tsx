import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { GUIDE_AI_LIMITS, GUIDE_SECTIONS, parseTopics, type GuideAiDraft, type GuideAiDraftSummary,
  type GuideAiPreparation, type GuideAiResult, type GuideAiSourceRef, type GuideAiTranscription } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { DemoDataSource } from '../data/demo';
import type { GuideAiActions } from '../data/guideAiTypes';
import { AiClientError } from '../data/aiClient';
import { guideAiAttachments, guideAiCandidateKey, guideAiCandidates, GUIDE_AI_SOURCE_LABELS, type GuideAiCandidate } from '../lib/guideAiSources';
import { extractGuideDocument, supportsGuideExtraction, type GuideDocumentExtraction } from '../lib/guideExtraction';
import { StructuredText } from './StructuredText';
import './ai.css';

const labels: Record<GuideAiDraftSummary['state'], string> = { prepared: 'Preparado', running: 'En curso', ready: 'Listo para revisar', failed: 'Requiere atención', unknown: 'Resultado incierto', cancelled: 'Cancelado', published: 'Publicado' };
const stepLabels = { pending: 'Pendiente', running: 'En curso', succeeded: 'Completado', failed: 'Falló', unknown: 'Resultado incierto', cancelled: 'Cancelado' } as const;
const locatorLabel = (locator: { kind: string; start: number; end: number }) => `${locator.kind === 'page' ? 'Página' : locator.kind === 'paragraph' ? 'Párrafo' : 'Líneas'} ${locator.start}${locator.end > locator.start ? `–${locator.end}` : ''}`;
function fragmentLabel(preparation: GuideAiPreparation, fragment: GuideAiPreparation['fragments'][number]) {
  const origin = fragment.origins[0]; if (!origin) return 'Fragmento preparado';
  const source = preparation.sources.find((entry) => guideAiCandidateKey(entry) === guideAiCandidateKey(origin));
  return `${source?.title ?? GUIDE_AI_SOURCE_LABELS[origin.kind]} · versión ${origin.version} · ${origin.locator ? locatorLabel(origin.locator) : `Líneas ${origin.startLine}–${origin.endLine}`}${fragment.origins.length > 1 ? ` · ${fragment.origins.length} procedencias` : ''}`;
}

/** Account key discards all material and pending UI state when the active member changes. */
export function GuideAiPanel() {
  const data = useSnapshot();
  return <GuideAiAccountPanel key={data.me?.id ?? 'sin-miembro'} />;
}
function GuideAiAccountPanel() {
  const source = useDataSource(); const data = useSnapshot(); const simulated = source instanceof DemoDataSource;
  const [status, setStatus] = useState<Awaited<ReturnType<GuideAiActions['getGuideAiStatus']>>>();
  const [summaries, setSummaries] = useState<GuideAiDraftSummary[]>([]);
  const [draft, setDraft] = useState<GuideAiDraft>();
  const [refreshing, setRefreshing] = useState<{ id: string; expectedRevision: number }>();
  const refreshRequest = useRef<{ signature: string; id: string } | undefined>(undefined);
  const [subjectId, setSubjectId] = useState(''); const [termId, setTermId] = useState('');
  const [title, setTitle] = useState(''); const [topicsText, setTopicsText] = useState('');
  const [selected, setSelected] = useState<GuideAiSourceRef[]>([]); const [filter, setFilter] = useState('');
  const [outputLimit, setOutputLimit] = useState(1500);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const operation = useRef(0); const active = data.me?.status === 'active';
  const topicsResult = useMemo(() => parseTopics(topicsText), [topicsText]);
  const topics = 'topics' in topicsResult ? topicsResult.topics : [];
  const candidates = guideAiCandidates(data, subjectId, termId || undefined);
  const unavailable = selected.some((ref) => !candidates.some((candidate) => guideAiCandidateKey(candidate) === guideAiCandidateKey(ref)));
  const eligible = Boolean(active && subjectId && title.trim() && topics.length && selected.length && !unavailable && status?.status.model);
  const reload = async () => { const [nextStatus, nextSummaries] = await Promise.all([source.getGuideAiStatus(), source.listGuideAiDrafts()]); return { nextStatus, nextSummaries }; };
  useEffect(() => {
    let current = true; setStatus(undefined); setSummaries([]); setDraft(undefined);
    if (active) void reload().then(({ nextStatus, nextSummaries }) => { if (current) { setStatus(nextStatus); setSummaries(nextSummaries); } }).catch((failure: unknown) => { if (current) setError(message(failure)); });
    return () => { current = false; operation.current++; };
  }, [source, active]);
  const run = async <T,>(action: () => Promise<T>, done: (result: T) => void) => {
    if (busy) return; const version = ++operation.current; setBusy(true); setError(''); setNotice('');
    try { const result = await action(); if (operation.current === version) { done(result); const list = await source.listGuideAiDrafts(); if (operation.current === version) setSummaries(list); } }
    catch (failure) { if (operation.current === version) setError(message(failure)); }
    finally { if (operation.current === version) setBusy(false); }
  };
  const prepare = () => {
    if (!eligible) return;
    const input = { purpose: 'study_guide' as const, subjectId, ...(termId ? { termId } : {}), title: title.trim(), topics,
      sources: selected.map((ref) => ({ ...ref, topics: ref.topics.filter((topic) => topics.includes(topic)) })), maxOutputTokens: outputLimit };
    if (refreshing) {
      const signature = JSON.stringify([refreshing.id, refreshing.expectedRevision, input]);
      if (refreshRequest.current?.signature !== signature) refreshRequest.current = { signature, id: crypto.randomUUID() };
      void run(() => source.refreshGuideAiDraft({ ...refreshing, input, requestId: refreshRequest.current!.id }), (next) => {
        setDraft(next); setRefreshing(undefined); refreshRequest.current = undefined;
        setNotice(next.needsCitationReview ? 'Fuentes actualizadas sin llamar a Gemini. Tu texto privado se conserva; revisa y guarda las citas antes de publicar.' : 'Preparación comprobada y renovada sin llamar a Gemini. Se conserva el texto y el avance guardado.');
      });
    } else void run(() => source.prepareGuideAiDraft({ id: crypto.randomUUID(), input }), (next) => { setDraft(next); setNotice('Borrador privado preparado. Revisa el texto y confirma cada envío a Gemini.'); });
  };
  const startRefresh = (current: GuideAiDraft) => {
    const input = current.preparation.input;
    setSubjectId(input.subjectId); setTermId(input.termId ?? ''); setTitle(current.result?.title ?? input.title); setTopicsText(input.topics.join('\n'));
    setSelected(input.sources.map((ref) => ({ ...ref, transcriptionIds: [] }))); setOutputLimit(input.maxOutputTokens);
    setRefreshing({ id: current.id, expectedRevision: current.revision }); refreshRequest.current = undefined;
    setNotice('Revisa la selección de arriba y vuelve a extraer los adjuntos que quieras incluir. Actualizar conserva el texto guardado y no llama a Gemini.');
  };
  const resetScope = (subject: string, term = '') => { setSubjectId(subject); setTermId(term); setSelected([]); };
  return <section className="panel guide-ai" aria-label="Guías con IA">
    <h2>Preparar una guía con Gemini</h2>
    <p>Selecciona material compartido, revisa el texto y genera un borrador privado. Se comparte con el grupo únicamente cuando lo publiques.</p>
    {simulated && <p className="ai-notice">Simulación local: textos y resultados ficticios. No se usan claves reales ni se llama a Gemini.</p>}
    {!active && <p className="ai-notice">Necesitas acceso vigente al grupo para preparar guías.</p>}
    <p><Link to="/ajustes">Configurar mi clave y consentimiento en Ajustes</Link>. Las guías manuales siguen disponibles sin IA.</p>
    {status && <p>Modelo: <strong>{status.status.model || 'Pendiente de configurar'}</strong> · Clave de <strong>{data.me?.displayName ?? 'mi cuenta'}</strong>: {status.key.configured ? 'configurada' : 'sin configurar'} · Consentimiento: {status.status.consented ? 'vigente' : 'pendiente'}.</p>}
    {status && !status.status.enabled && <p className="ai-notice">{status.status.reason || 'La generación todavía no está habilitada. Puedes revisar y preparar material.'}</p>}
    <details open={!draft || Boolean(refreshing)}>
      <summary>{refreshing ? 'Actualizar las fuentes de este borrador' : 'Seleccionar y preparar material'}</summary>
      {refreshing && <p className="ai-notice">Conservarás el texto privado guardado. Las transcripciones anteriores se quitaron de la selección para que prepares de nuevo los documentos vigentes. Los resúmenes anteriores no se reutilizarán.</p>}
      <fieldset disabled={busy || !active} className="guide-ai__form">
        <div className="ai-scope">
          <label className="field"><span>Materia de la guía</span><select value={subjectId} onChange={(event) => resetScope(event.target.value)}><option value="">Elige una materia</option>{data.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
          <label className="field"><span>Parcial de la guía</span><select value={termId} onChange={(event) => resetScope(subjectId, event.target.value)}><option value="">Sin parcial</option>{data.terms.filter((term) => term.subjectId === subjectId).map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}</select></label>
        </div>
        <label className="field"><span>Título del borrador privado</span><input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="field"><span>Temario de la guía, un tema por línea</span><textarea value={topicsText} rows={3} maxLength={4840} onChange={(event) => setTopicsText(event.target.value)} /></label>
        {topicsText && 'problem' in topicsResult && <p className="field__hint">{topicsResult.problem}</p>}
        <label className="field"><span>Buscar fuente compartida</span><input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
        <p className="field__hint">Hasta 30 fuentes y 120 000 caracteres. Cada evidencia se selecciona por separado; el material sin parcial requiere una selección expresa. Solo se envía texto revisado, sin documentos originales ni enlaces externos.</p>
        <fieldset className="ai-selector"><legend>Fuentes de la guía ({selected.length} de 30)</legend>
          {!candidates.length && <p className="muted">No hay material compartido para esta materia y parcial.</p>}
          {candidates.filter((candidate) => `${candidate.title} ${candidate.topics.join(' ')}`.toLocaleLowerCase('es').includes(filter.toLocaleLowerCase('es'))).map((candidate) => {
            const key = guideAiCandidateKey(candidate); const ref = selected.find((entry) => guideAiCandidateKey(entry) === key);
            const change = (next: GuideAiSourceRef) => setSelected((value) => value.map((entry) => guideAiCandidateKey(entry) === key ? next : entry));
            return <div className="ai-source" key={key}>
              <label className="ai-source__choice"><input type="checkbox" checked={Boolean(ref)} disabled={!ref && selected.length >= 30} onChange={(event) => setSelected((value) => event.target.checked ? [...value, { kind: candidate.kind, refId: candidate.refId, topics: topics.filter((topic) => candidate.topics.some((entry) => entry.toLocaleLowerCase('es') === topic.toLocaleLowerCase('es'))), includeUnplaced: !candidate.termId }] : value.filter((entry) => guideAiCandidateKey(entry) !== key))} />
                <span><strong>{candidate.title}</strong> · {GUIDE_AI_SOURCE_LABELS[candidate.kind]} · v{candidate.version}{!candidate.termId && <span className="badge">Sin parcial · inclusión manual</span>}</span></label>
              {ref && <><fieldset className="ai-source__topics"><legend>Temas tratados por esta fuente</legend>{topics.map((topic) => <label key={topic}><input type="checkbox" checked={ref.topics.includes(topic)} onChange={(event) => change({ ...ref, topics: event.target.checked ? [...ref.topics, topic] : ref.topics.filter((entry) => entry !== topic) })} />{topic}</label>)}</fieldset>
                {Boolean(ref.transcriptionIds?.length) && <button type="button" className="link-button" onClick={() => change({ ...ref, transcriptionIds: [] })}>Quitar las transcripciones seleccionadas y volver a prepararlas</button>}
                <GuideAiAttachmentPreparation candidate={candidate} transcriptionIds={ref.transcriptionIds ?? []} onSaved={(transcription) => change({ ...ref, transcriptionIds: [...new Set([...(ref.transcriptionIds ?? []), transcription.id])] })} />
              </>}
            </div>;
          })}
        </fieldset>
        {unavailable && <div role="alert" className="error"><p>Una fuente ya no está disponible para esta selección. Quítala y revisa el material.</p>{selected.filter((ref) => !candidates.some((candidate) => guideAiCandidateKey(candidate) === guideAiCandidateKey(ref))).map((ref) => <button type="button" key={guideAiCandidateKey(ref)} onClick={() => setSelected((value) => value.filter((entry) => guideAiCandidateKey(entry) !== guideAiCandidateKey(ref)))}>Quitar fuente no disponible: {GUIDE_AI_SOURCE_LABELS[ref.kind]}</button>)}</div>}
        <label className="field"><span>Límite de tokens de salida por llamada</span><input type="number" min={256} max={8000} step={1} value={outputLimit} onChange={(event) => setOutputLimit(Number(event.target.value))} /></label>
        <button type="button" disabled={!eligible || outputLimit < 256 || outputLimit > 8000} onClick={prepare}>{refreshing ? 'Actualizar preparación sin enviar a Gemini' : 'Preparar borrador privado sin enviar a Gemini'}</button>
        {refreshing && <button type="button" className="button--secondary" onClick={() => { setRefreshing(undefined); refreshRequest.current = undefined; }}>Cancelar actualización de fuentes</button>}
      </fieldset>
    </details>
    <section aria-label="Mis borradores privados"><h3>Mis borradores privados</h3>
      <button type="button" className="button--secondary" disabled={busy || !active} onClick={() => void run(reload, ({ nextStatus, nextSummaries }) => { setStatus(nextStatus); setSummaries(nextSummaries); })}>Actualizar borradores y configuración</button>
      {!summaries.length ? <p className="muted">Todavía no tienes borradores privados.</p> : <ul>{summaries.map((entry) => <li key={entry.id}><button type="button" className="link-button" disabled={busy} onClick={() => void run(() => source.getGuideAiDraft(entry.id), (next) => { setDraft(next); setRefreshing(undefined); refreshRequest.current = undefined; })}>{entry.title}</button> · {labels[entry.state]} · {entry.completedSteps}/{entry.totalSteps} pasos</li>)}</ul>}
    </section>
    {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {draft && <GuideAiDraftEditor key={draft.id} draft={draft} status={status} busy={busy} run={run} onDraft={setDraft} onRefresh={startRefresh} />}
  </section>;
}
function message(failure: unknown) { return failure instanceof Error ? failure.message : 'No se pudo completar la operación. Revisa la conexión y vuelve a consultar el borrador.'; }

function GuideAiPreview({ preparation, status }: { preparation: GuideAiPreparation; status?: Awaited<ReturnType<GuideAiActions['getGuideAiStatus']>> }) {
  return <section className="ai-preview" aria-label="Vista previa del envío de la guía"><h4>Texto exacto preparado para Gemini</h4>
    <p>Título solicitado: <strong>{preparation.input.title}</strong>.</p>
    <h5>Temario que se enviará</h5><ol>{preparation.input.topics.map((topic) => <li key={topic}>{topic}</li>)}</ol>
    <p>Modelo <strong>{preparation.model}</strong> · {preparation.sources.length} fuentes · {preparation.fragments.reduce((count, fragment) => count + fragment.text.length, 0).toLocaleString('es-MX')} caracteres · {preparation.estimatedCalls} {preparation.estimatedCalls === 1 ? 'llamada prevista' : 'llamadas previstas'}.</p>
    <p>Estimación total: {preparation.estimatedInputTokens.toLocaleString('es-MX')} tokens de entrada y hasta {preparation.estimatedOutputTokens.toLocaleString('es-MX')} de salida. Cada llamada cuenta contra tus límites y puede generar cargos en tu cuenta de Gemini.</p>
    {status && <p className="field__hint">Límites compartidos por persona: {status.status.limits.maxConcurrent} generación simultánea, {status.status.limits.requestsPerHour} llamadas por hora, {status.status.limits.requestsPerDay} por día y presupuesto de {status.status.limits.dailyEstimatedTokens.toLocaleString('es-MX')} tokens estimados diarios. Si falta presupuesto se conserva lo completado.</p>}
    <ul>{preparation.sources.map((entry) => <li key={guideAiCandidateKey(entry)}>{entry.title} · v{entry.version} · {entry.status === 'prepared' ? 'Texto preparado, todavía sin contar como cobertura utilizada' : entry.reason || 'Pendiente'}</li>)}</ul>
    {preparation.omissions.length > 0 && <div className="ai-notice"><h5>Material omitido</h5><ul>{preparation.omissions.map((omission, index) => <li key={index}>{omission}</li>)}</ul></div>}
    {preparation.fragments.map((fragment) => <details className="ai-fragment" key={fragment.id}><summary>{fragmentLabel(preparation, fragment)}</summary><pre>{fragment.text}</pre><small className="muted">Referencia: {fragment.id}</small></details>)}
  </section>;
}
function GuideAiDraftEditor({ draft, status, busy, run, onDraft, onRefresh }: { draft: GuideAiDraft; status?: Awaited<ReturnType<GuideAiActions['getGuideAiStatus']>>; busy: boolean;
  run<T>(action: () => Promise<T>, done: (value: T) => void): Promise<void>; onDraft(draft: GuideAiDraft): void; onRefresh(draft: GuideAiDraft): void }) {
  const source = useDataSource(); const data = useSnapshot();
  const [confirmed, setConfirmed] = useState(false); const [acknowledge, setAcknowledge] = useState(false);
  const [result, setResult] = useState<GuideAiResult | undefined>(draft.result); const [editRevision, setEditRevision] = useState(draft.revision);
  const [target, setTarget] = useState<{ id: string; version: number }>();
  useEffect(() => { setTarget(undefined); }, [draft.subjectId, draft.termId]);
  const [uncertain, setUncertain] = useState(false); const generationId = useRef(crypto.randomUUID());
  const [cancelling, setCancelling] = useState(false); const [cancelError, setCancelError] = useState('');
  const [needsUnknownAcknowledgement, setNeedsUnknownAcknowledgement] = useState(false);
  const publication = useRef({ revision: draft.revision, target: '', id: crypto.randomUUID() });
  useEffect(() => { setConfirmed(false); setAcknowledge(false); setUncertain(false); setResult(draft.result); setEditRevision(draft.revision); generationId.current = crypto.randomUUID(); }, [draft.revision, draft.id]);
  const currentCandidates = guideAiCandidates(data, draft.subjectId, draft.termId);
  const changed = draft.preparation.sources.some((entry) => { const candidate = currentCandidates.find((ref) => guideAiCandidateKey(ref) === guideAiCandidateKey(entry)); return !candidate || candidate.version !== entry.version || candidate.termId !== entry.termId; });
  const inaccessible = draft.preparation.fragments.some((fragment) => fragment.origins.some((origin) => !currentCandidates.some((candidate) => guideAiCandidateKey(candidate) === guideAiCandidateKey(origin))
    || (origin.field.startsWith('respuesta:') && !data.answers.some((answer) => answer.id === origin.field.split(':')[1] && !answer.withdrawnAt))));
  const generationAllowed = Boolean(status?.status.enabled && status.key.configured && status.status.consented && draft.preparation.canGenerate && !changed && !uncertain && !['published', 'cancelled', 'running'].includes(draft.state));
  const targetGuide = target && data.guides.find((guide) => guide.id === target.id);
  const targetChanged = Boolean(target && (!targetGuide || targetGuide.version !== target.version));
  const dirty = JSON.stringify(result) !== JSON.stringify(draft.result);
  const nextStep = draft.steps.find((step) => step.state === 'pending' || step.state === 'failed' || step.state === 'unknown');
  const mustAcknowledge = draft.state === 'unknown' || needsUnknownAcknowledgement;
  const step = () => {
    if (!confirmed || !generationAllowed || (mustAcknowledge && !acknowledge)) return;
    setConfirmed(false); setUncertain(true);
    void run(() => source.runGuideAiStep(draft.id, { expectedRevision: draft.revision, fingerprint: draft.preparation.fingerprint,
      generationId: generationId.current, confirmed: true, ...(acknowledge ? { acknowledgeUnknown: true } : {}) }).catch((failure: unknown) => { if (failure instanceof AiClientError && failure.code === 'unknown_confirmation_required') setNeedsUnknownAcknowledgement(true); throw failure; }), (next) => { setUncertain(false); onDraft(next); });
  };
  const publish = () => {
    const key = target?.id ?? ''; if (publication.current.revision !== draft.revision || publication.current.target !== key) publication.current = { revision: draft.revision, target: key, id: crypto.randomUUID() };
    void run(() => source.publishGuideAiDraft({ id: draft.id, expectedRevision: draft.revision, requestId: publication.current.id,
      ...(target ? { guideId: target.id, expectedVersion: target.version } : {}) }), onDraft);
  };
  const cancelPending = async () => {
    if (cancelling) return; setCancelling(true); setCancelError('');
    try { const current = (await source.listGuideAiDrafts()).find((entry) => entry.id === draft.id); if (!current) throw new Error('El borrador ya no está disponible.'); onDraft(await source.cancelGuideAiDraft(current.id, current.revision)); }
    catch (failure) { setCancelError(message(failure)); }
    finally { setCancelling(false); }
  };
  return <article className="guide-ai-draft" aria-label="Borrador privado de la guía"><h3>{draft.title} <span className="badge">Privado · {labels[draft.state]}</span></h3>
    <p>Progreso guardado: {draft.completedSteps} de {draft.totalSteps} pasos. Puedes cerrar esta pantalla y volver a consultar el borrador.</p>
    <ul>{draft.steps.map((entry, index) => <li key={entry.id}>Paso {index + 1}: {entry.kind === 'summary' ? 'Resumen de materiales' : entry.kind === 'synthesis' ? 'Síntesis final' : 'Guía completa'} · {stepLabels[entry.state]}{entry.error && <span> · {entry.error}</span>}</li>)}</ul>
    {!inaccessible && <GuideAiPreview preparation={draft.preparation} status={status} />}
    {inaccessible && <p role="alert" className="ai-notice">Una fuente citada dejó de estar disponible. Su texto preparado se ocultó. Conservamos este borrador; prepara uno nuevo desde la selección de material disponible.</p>}
    {changed && <p role="alert" className="error">Una fuente cambió o dejó de estar disponible. Este borrador se conserva: selecciona y prepara el material actualizado antes de publicar.</p>}
    {draft.needsCitationReview && <p role="status" className="ai-notice">Las fuentes se actualizaron conservando tu texto. Revisa las citas de las ocho secciones y guarda el borrador antes de publicar; las citas anteriores que ya no existen se quitaron.</p>}
    {!inaccessible && !['running', 'published', 'cancelled'].includes(draft.state) && <><button type="button" className="button--secondary" disabled={busy || dirty} onClick={() => onRefresh(draft)}>Actualizar fuentes conservando mi texto</button>{dirty && <p className="field__hint">Guarda los cambios privados antes de actualizar las fuentes para conservar también estas últimas ediciones.</p>}</>}
    {(uncertain || draft.state === 'unknown' || draft.state === 'running') && <p role="status" className="ai-notice">El envío puede haberse consumido. Consulta su estado antes de decidir otro intento. No se repetirá ninguna llamada automáticamente.</p>}
    <button type="button" className="button--secondary" disabled={busy} onClick={() => void run(() => source.getGuideAiDraft(draft.id), (next) => { setUncertain(false); onDraft(next); })}>Consultar estado guardado</button>
    {nextStep && !inaccessible && !['cancelled', 'published'].includes(draft.state) && <fieldset disabled={busy} className="ai-consent"><legend>Confirmar el siguiente envío</legend>
      <section aria-label="Texto del siguiente paso"><h4>Texto del siguiente paso</h4>
        {nextStep.kind === 'synthesis' ? <><p>La síntesis utilizará estos resúmenes intermedios y sus citas conservadas.</p>{draft.steps.filter((entry) => entry.kind === 'summary' && entry.state === 'succeeded').map((entry, index) => <div className="ai-fragment" key={entry.id}><h5>Resumen {index + 1}</h5>{entry.result && 'paragraphs' in entry.result && entry.result.paragraphs.map((paragraph, paragraphIndex) => <div key={paragraphIndex}><pre>{paragraph.text}</pre><p className="field__hint">Citas: {paragraph.citations.map((id) => { const fragment = draft.preparation.fragments.find((candidate) => candidate.id === id); return fragment ? fragmentLabel(draft.preparation, fragment) : 'Fuente no disponible'; }).join('; ')}</p></div>)}</div>)}</>
          : draft.preparation.fragments.filter((fragment) => nextStep.kind === 'direct' || draft.preparation.batches.find((batch) => batch.id === nextStep.batchId)?.fragmentIds.includes(fragment.id)).map((fragment) => <details className="ai-fragment" key={fragment.id}><summary>{fragmentLabel(draft.preparation, fragment)}</summary><pre>{fragment.text}</pre><small className="muted">Referencia: {fragment.id}</small></details>)}
      </section>
      <p>Se usará la clave personal de <strong>{data.me?.displayName ?? 'mi cuenta'}</strong> con el modelo <strong>{draft.preparation.model}</strong>. Revisa arriba el texto, las citas y las omisiones.</p>
      {mustAcknowledge && <label><input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} />Acepto otro intento manual y su posible consumo adicional; el resultado anterior de IA no pudo confirmarse.</label>}
      <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Revisé la vista previa y confirmo enviar el siguiente paso a Gemini con mi clave.</label>
      <button type="button" disabled={!generationAllowed || !confirmed || (mustAcknowledge && !acknowledge)} onClick={step}>{nextStep.kind === 'direct' ? 'Generar borrador privado' : 'Enviar el siguiente paso'}</button>
    </fieldset>}
    {result && !inaccessible && <fieldset disabled={busy || draft.state === 'published' || draft.state === 'cancelled'} className="guide-ai__form"><legend>Revisar y editar el borrador</legend>
      <label className="field"><span>Título de la guía generada</span><input value={result.title} maxLength={200} onChange={(event) => setResult({ ...result, title: event.target.value })} /></label>
      {GUIDE_SECTIONS.map((section) => { const value = result.sections.find((entry) => entry.id === section.id)!; if (!value) return null;
        return <details key={section.id} className="ai-fragment"><summary>{section.title}</summary>
          <label className="field"><span>Texto de {section.title}</span><textarea value={value.content} rows={6} maxLength={20000} onChange={(event) => setResult({ ...result, sections: result.sections.map((entry) => entry.id === section.id ? { ...entry, content: event.target.value } : entry) })} /></label>
          <details><summary>Citas utilizadas en esta sección</summary>{draft.preparation.fragments.map((fragment) => <label key={fragment.id} className="guide-ai__citation"><input type="checkbox" checked={value.citations.includes(fragment.id)} onChange={(event) => setResult({ ...result, sections: result.sections.map((entry) => entry.id === section.id ? { ...entry, citations: event.target.checked ? [...entry.citations, fragment.id] : entry.citations.filter((id) => id !== fragment.id) } : entry) })} />{fragmentLabel(draft.preparation, fragment)}</label>)}</details>
          <StructuredText text={value.content} />
        </details>;
      })}
      <button type="button" disabled={(!dirty && !draft.needsCitationReview) || editRevision !== draft.revision} onClick={() => void run(() => source.updateGuideAiDraft(draft.id, { expectedRevision: editRevision, result }), onDraft)}>Guardar cambios privados</button>
    </fieldset>}
    {draft.state === 'ready' && !inaccessible && <fieldset disabled={busy} className="ai-consent"><legend>Publicar para el grupo</legend><p>Publicar conserva las fuentes, citas y procedencia. Una versión nueva necesitará revisión de otro compañero.</p>
      <label className="field"><span>Destino de publicación</span><select value={target?.id ?? ''} onChange={(event) => { const guide = data.guides.find((entry) => entry.id === event.target.value); setTarget(guide ? { id: guide.id, version: guide.version } : undefined); }}><option value="">Crear una guía nueva</option>{data.guides.filter((guide) => !guide.withdrawnAt && guide.subjectId === draft.subjectId && guide.termId === draft.termId).map((guide) => <option key={guide.id} value={guide.id}>Nueva versión de {guide.title} · v{guide.version}</option>)}</select></label>
      {dirty && <p className="field__hint">Guarda los cambios privados antes de publicar.</p>}{targetChanged && <p role="alert" className="error">La guía de destino cambió. Revisa la versión actual antes de elegirla de nuevo.</p>}
      <button type="button" disabled={changed || dirty || targetChanged || draft.needsCitationReview} onClick={publish}>Publicar guía para el grupo</button>
    </fieldset>}
    {draft.state === 'published' && draft.publishedGuideId && <p role="status">Guía publicada. <Link to={`/m/guias/${draft.publishedGuideId}`}>Abrir la versión compartida</Link></p>}
    {cancelError && <p role="alert" className="error">{cancelError}</p>}
    {!['published', 'cancelled'].includes(draft.state) && <><p className="field__hint">Cancelar detiene los pasos pendientes. Un envío que ya llegó a Gemini puede generar consumo y terminar después.</p><button type="button" className="button--secondary" disabled={cancelling} onClick={() => void cancelPending()}>{cancelling ? 'Cancelando pasos…' : 'Cancelar pasos pendientes'}</button></>}
  </article>;
}

function GuideAiAttachmentPreparation({ candidate, transcriptionIds, onSaved }: { candidate: GuideAiCandidate; transcriptionIds: string[]; onSaved(value: GuideAiTranscription): void }) {
  const source = useDataSource(); const data = useSnapshot(); const files = guideAiAttachments(data, candidate);
  const [extracted, setExtracted] = useState<GuideDocumentExtraction>(); const [fileId, setFileId] = useState('');
  const [reviewed, setReviewed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const abort = useRef<AbortController | undefined>(undefined); const op = useRef(0);
  useEffect(() => () => { op.current++; abort.current?.abort(); }, [candidate.revision]);
  if (!files.length) return null;
  const extract = async (id: string) => {
    if (busy) return; const request = ++op.current; abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setBusy(true); setError(''); setExtracted(undefined); setReviewed(false); setFileId(id);
    try {
      const metadata = await source.getGuideAiFile(id); if (request !== op.current) return;
      if (metadata.size > GUIDE_AI_LIMITS.maxDocumentBytes) throw new Error('Omitido: la extracción admite hasta 10 MiB por documento. El archivo permanece disponible para descargar.');
      const blob = await source.downloadResourceFile(id, { signal: controller.signal });
      const next = await extractGuideDocument({ fileId: id, fileHash: metadata.fileHash, fileVersion: metadata.targetVersion, fileName: metadata.name, mimeType: metadata.contentType, blob, signal: controller.signal });
      if (request === op.current && !controller.signal.aborted) setExtracted(next);
    } catch (failure) { if (request === op.current && !controller.signal.aborted) setError(message(failure)); }
    finally { if (request === op.current) setBusy(false); }
  };
  const save = async () => {
    if (!extracted || !reviewed || busy || !extracted.text.trim()) return; const request = ++op.current; setBusy(true); setError('');
    try { const saved = await source.saveGuideAiTranscription({ id: crypto.randomUUID(), fileId, fileHash: extracted.fileHash,
      targetKind: candidate.kind, targetId: candidate.refId, targetVersion: extracted.fileVersion, text: extracted.segments.map((segment) => segment.text).join('\n'),
      segments: extracted.segments, omissions: extracted.omissions.map((omission) => omission.reason), reviewed: true });
      if (request === op.current) { onSaved(saved); setExtracted(undefined); setReviewed(false); }
    } catch (failure) { if (request === op.current) setError(message(failure)); } finally { if (request === op.current) setBusy(false); }
  };
  return <details className="guide-ai-attachments"><summary>Preparar texto de adjuntos ({files.length}) · {transcriptionIds.length} transcripciones elegidas</summary>
    <p className="field__hint">Procesamiento local: PDF textual (hasta 200 páginas), DOCX, texto y código. Hasta 10 MiB por documento y 32 MiB descomprimidos por DOCX. No se ejecuta código, no se descargan enlaces y los originales no se envían a Gemini.</p>
    <ul>{files.map((file) => <li key={file.id}>{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MiB · {!supportsGuideExtraction(file.name, file.contentType) ? <span>Omitido: formato no admitido para extraer texto.</span> : file.size > GUIDE_AI_LIMITS.maxDocumentBytes ? <span>Omitido: supera el límite de extracción de 10 MiB.</span> : <button type="button" className="link-button" disabled={busy} onClick={() => void extract(file.id)}>Extraer y revisar texto</button>}</li>)}</ul>
    {busy && <p role="status">Preparando texto del documento…</p>}{error && <p role="alert" className="error">{error}</p>}
    {extracted && <><p>Material preparado por el alumno: revisa la transcripción y conserva sus localizadores.</p>{extracted.omissions.length > 0 && <ul>{extracted.omissions.map((omission, index) => <li key={index}>{omission.reason}</li>)}</ul>}
      {extracted.segments.map((segment, index) => <label className="field" key={segment.id}><span>{locatorLabel(segment.locator)}</span><textarea value={segment.text} rows={4} onChange={(event) => { setReviewed(false); const segments = extracted.segments.map((entry, position) => position === index ? { ...entry, text: event.target.value } : entry); setExtracted({ ...extracted, segments, text: segments.map((entry) => entry.text).join('\n') }); }} /></label>)}
      {extracted.status === 'ready' && <><label className="check"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />Revisé este texto y sus localizadores; incluirlo como material preparado por mí.</label><button type="button" disabled={!reviewed || busy || !extracted.text.trim()} onClick={() => void save()}>Guardar transcripción revisada</button></>}
      <button type="button" className="button--secondary" onClick={() => { abort.current?.abort(); setExtracted(undefined); setReviewed(false); }}>Descartar transcripción</button>
    </>}
  </details>;
}
