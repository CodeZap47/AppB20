import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { GUIDE_SECTIONS, parseTopics, type GuideAiDraft, type GuideAiDraftSummary,
  type GuideAiPreparation, type GuideAiResult, type GuideAiSourceRef, type GuideExamMaterial } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { DemoDataSource } from '../data/demo';
import type { GuideAiActions } from '../data/guideAiTypes';
import { AiClientError } from '../data/aiClient';
import { guideAiCandidateKey, guideAiCandidates, GUIDE_AI_SOURCE_LABELS, type GuideAiCandidate } from '../lib/guideAiSources';
import { GuideMaterialPicker } from './GuideMaterialPicker';
import { useGuideMaterialSelection } from '../lib/useGuideMaterialSelection';
import { GuideMaterialDraftStatus } from './GuideMaterialDraftStatus';
import { StructuredText } from './StructuredText';
import './ai.css';
import './GuideWizard.css';

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
  const [stage, setStage] = useState(0);
  const [refreshing, setRefreshing] = useState<{ id: string; expectedRevision: number }>();
  const refreshRequest = useRef<{ signature: string; id: string } | undefined>(undefined);
  const [guideType, setGuideType] = useState<'partial' | 'quarter'>('partial');
  const [subjectId, setSubjectId] = useState(''); const [termId, setTermId] = useState('');
  const [title, setTitle] = useState(''); const [topicsText, setTopicsText] = useState('');
  const [selected, setSelected] = useState<GuideAiSourceRef[]>([]);
  const [chosenFileIds, setChosenFileIds] = useState<string[]>([]);
  const [manualSections, setManualSections] = useState<string[] | undefined>();
  const [catalogue, setCatalogue] = useState<GuideAiCandidate[]>([]);
  const [pendingFiles, setPendingFiles] = useState(0);
  const [outputLimit, setOutputLimit] = useState(6000);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const operation = useRef(0); const active = data.me?.status === 'active';
  const heading = useRef<HTMLHeadingElement>(null);
  const topicsResult = useMemo(() => parseTopics(topicsText), [topicsText]);
  const topics = 'topics' in topicsResult ? topicsResult.topics : [];
  const subject = data.subjects.find((entry) => entry.id === subjectId);
  const scopeTerm = guideType === 'partial' ? termId || undefined : undefined;
  const candidates = catalogue.length ? catalogue : guideAiCandidates(data, subjectId);
  const selectionDraft = useGuideMaterialSelection({ subjectId, termId: scopeTerm, guideType, title, topicsText, sources: selected, chosenFileIds, ...(manualSections ? { manualSections } : {}) }, (saved) => {
    setSubjectId(saved.subjectId); setTermId(saved.termId ?? ''); setGuideType(saved.guideType); setTitle(saved.title); setTopicsText(saved.topicsText); setSelected(saved.sources); setChosenFileIds(saved.chosenFileIds); setManualSections(saved.manualSections); setStage(saved.sources.length ? 1 : 0);
  });
  const unavailable = selected.some((ref) => !candidates.some((candidate) => guideAiCandidateKey(candidate) === guideAiCandidateKey(ref)));
  const scopeReady = Boolean(subject && title.trim() && topics.length && (guideType === 'quarter' || termId));
  const eligible = Boolean(selectionDraft.ready && active && scopeReady && selected.length && !unavailable && !pendingFiles && status?.status.model);
  const reload = async () => { const [nextStatus, nextSummaries] = await Promise.all([source.getGuideAiStatus(), source.listGuideAiDrafts()]); return { nextStatus, nextSummaries }; };
  useEffect(() => {
    let current = true; setStatus(undefined); setSummaries([]); setDraft(undefined);
    if (active) void reload().then(({ nextStatus, nextSummaries }) => { if (current) { setStatus(nextStatus); setSummaries(nextSummaries); } }).catch((failure: unknown) => { if (current) setError(message(failure)); });
    return () => { current = false; operation.current++; };
  }, [source, active]);
  useEffect(() => { heading.current?.focus(); }, [stage]);
  const run = async <T,>(action: () => Promise<T>, done: (result: T) => void) => {
    if (busy) return; const version = ++operation.current; setBusy(true); setError(''); setNotice('');
    try { const result = await action(); if (operation.current === version) { done(result); const list = await source.listGuideAiDrafts(); if (operation.current === version) setSummaries(list); } }
    catch (failure) { if (operation.current === version) setError(message(failure)); }
    finally { if (operation.current === version) setBusy(false); }
  };
  const prepare = () => {
    if (!eligible || !subject) return;
    const input = { purpose: 'study_guide' as const, guideType, period: String(subject.period), subjectId, ...(scopeTerm ? { termId: scopeTerm } : {}), title: title.trim(), topics,
      reviewBeforeGenerate: refreshing ? draft?.preparation.input.reviewBeforeGenerate ?? false : true,
      sources: selected.map((ref) => ({ ...ref, topics: ref.topics.filter((topic) => topics.includes(topic)) })), maxOutputTokens: outputLimit };
    if (refreshing) {
      const signature = JSON.stringify([refreshing.id, refreshing.expectedRevision, input]);
      if (refreshRequest.current?.signature !== signature) refreshRequest.current = { signature, id: crypto.randomUUID() };
      void run(async () => { await selectionDraft.flush(); return source.refreshGuideAiDraft({ ...refreshing, input, requestId: refreshRequest.current!.id }); }, (next) => {
        setDraft(next); setStage(2); setRefreshing(undefined); refreshRequest.current = undefined;
        setNotice(next.needsCitationReview ? 'Fuentes actualizadas. Tu texto privado se conserva; revisa y guarda las citas antes de publicar.' : 'Preparación renovada. Revisa los temas antes de continuar.');
      });
    } else void run(async () => { await selectionDraft.flush(); return source.prepareGuideAiDraft({ id: crypto.randomUUID(), input }); }, (next) => { setDraft(next); setStage(2); setNotice('Material preparado. Revisa el envío para que la IA analice el temario y proponga preguntas.'); });
  };
  const startRefresh = (current: GuideAiDraft) => {
    const input = current.preparation.input;
    setGuideType(input.guideType ?? (input.termId ? 'partial' : 'quarter'));
    setSubjectId(input.subjectId); setTermId(input.termId ?? ''); setTitle(current.result?.title ?? input.title); setTopicsText(input.topics.join('\n'));
    setCatalogue([]);
    setChosenFileIds([...new Set(current.preparation.fragments.flatMap((fragment) => fragment.origins.flatMap((origin) => origin.fileId ? [origin.fileId] : [])))]);
    setSelected(input.sources.map((ref) => ({ ...ref, transcriptionIds: [] }))); setOutputLimit(input.maxOutputTokens); setStage(1);
    setRefreshing({ id: current.id, expectedRevision: current.revision }); refreshRequest.current = undefined;
    setNotice('Las transcripciones anteriores se quitaron de la selección. Revisa los documentos vigentes; tu texto guardado se conserva.');
  };
  const resetScope = (subject: string, term = '') => { if (subject !== subjectId) { setSelected([]); setChosenFileIds([]); setCatalogue([]); } else setSelected((refs) => refs.map((ref) => ({ ...ref, includeOutsideTerm: true }))); setSubjectId(subject); setTermId(term); };
  const progress = stage === 2 && draft?.result ? 3 : stage;
  return <section className="panel guide-ai guide-wizard" aria-label="Guías con IA">
    <header className="guide-wizard__header"><span className="guide-wizard__eyebrow">TU MATERIAL, CONECTADO</span><h2>Crear una guía con IA</h2><p>Del material del grupo a una guía que cubra tu temario. Tú eliges las fuentes y completas lo que haga falta.</p></header>
    <ol className="guide-wizard__steps" aria-label="Pasos para crear la guía">{['Definir guía', 'Elegir materiales', 'Completar temas', 'Revisar guía'].map((label, index) => <li key={label} aria-current={progress === index ? 'step' : undefined} data-complete={progress > index}><span>{progress > index ? '✓' : index + 1}</span>{label}</li>)}</ol>
    {simulated && <p className="ai-notice">Simulación local: textos y resultados ficticios. No se usan claves reales ni se llama a Gemini.</p>}
    {!active && <p className="ai-notice">Necesitas acceso vigente al grupo para preparar guías.</p>}
    <details className="guide-wizard__settings"><summary>Mi conexión con Gemini</summary><p><Link to="/ajustes">Configurar mi clave y consentimiento en Ajustes</Link>.</p>{status && <p>Modelo: <strong>{status.status.model || 'Pendiente de configurar'}</strong> · Clave de <strong>{data.me?.displayName ?? 'mi cuenta'}</strong>: {status.key.configured ? 'configurada' : 'sin configurar'} · Consentimiento: {status.status.consented ? 'vigente' : 'pendiente'}.</p>}</details>
    {status && !status.status.enabled && <p className="ai-notice">{status.status.reason || 'La generación todavía no está habilitada. Puedes revisar y preparar material.'}</p>}
    {stage < 2 && <fieldset disabled={busy || !active || !selectionDraft.ready} className="guide-ai__form">
      <h3 ref={heading} tabIndex={-1}>{stage === 0 ? '1. Define el alcance de tu guía' : '2. Elige los materiales'}</h3>
      <div hidden={stage !== 0}>
        <div className="guide-wizard__types" role="group" aria-label="Tipo de guía">
          <button type="button" aria-pressed={guideType === 'partial'} disabled={Boolean(refreshing)} onClick={() => { setGuideType('partial'); setSelected((refs) => refs.map((ref) => ({ ...ref, includeOutsideTerm: true }))); }}><strong>Para un parcial</strong><span>Estudia los temas de una evaluación.</span></button>
          <button type="button" aria-pressed={guideType === 'quarter'} disabled={Boolean(refreshing)} onClick={() => { setGuideType('quarter'); setTermId(''); }}><strong>Para el cuatrimestre</strong><span>Conecta todos los parciales de una materia.</span></button>
        </div>
        <div className="ai-scope">
          <label className="field"><span>Materia de la guía</span><select disabled={Boolean(refreshing)} value={subjectId} onChange={(event) => resetScope(event.target.value)}><option value="">Elige una materia</option>{data.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name} · {subject.period}º cuatrimestre</option>)}</select></label>
          {guideType === 'partial' && <label className="field"><span>Parcial de la guía</span><select disabled={Boolean(refreshing) || !subjectId} value={termId} onChange={(event) => resetScope(subjectId, event.target.value)}><option value="">Elige un parcial</option>{data.terms.filter((term) => term.subjectId === subjectId).map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}</select></label>}
        </div>
        {guideType === 'quarter' && subject && <p className="guide-wizard__scope">{subject.period}º cuatrimestre · Todos los parciales de {subject.name}</p>}
        <label className="field"><span>Título del borrador privado</span><input value={title} maxLength={200} placeholder={guideType === 'quarter' ? 'Guía integral de la materia' : 'Repaso para el parcial'} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="field"><span>Temario de la guía, un tema por línea</span><textarea readOnly={Boolean(refreshing && draft?.result && draft.preparation.input.reviewBeforeGenerate)} value={topicsText} rows={5} maxLength={4840} placeholder="Copia el temario del profesor o escribe los temas que necesitas estudiar." onChange={(event) => setTopicsText(event.target.value)} /></label>
        {refreshing && draft?.result && draft.preparation.input.reviewBeforeGenerate && <p className="field__hint">Esta actualización conserva el temario y tus respuestas. Para trabajar otro temario, crea una guía nueva desde Mis borradores privados.</p>}
        <p className="field__hint">La IA comparará estos temas con las fuentes elegidas para detectar explicaciones incompletas y hacerte preguntas.</p>
        {topicsText && 'problem' in topicsResult && <p className="field__hint">{topicsResult.problem}</p>}
        <div className="guide-wizard__actions"><button type="button" disabled={!scopeReady} onClick={() => setStage(1)}>Elegir materiales</button></div>
      </div><div hidden={stage !== 1}>
        <p className="guide-wizard__scope"><strong>{title}</strong> · {subject?.name} · {guideType === 'quarter' ? `${subject?.period}º cuatrimestre completo` : data.terms.find((entry) => entry.id === termId)?.name}</p>
        <GuideMaterialPicker key={subjectId} subjectId={subjectId} termId={scopeTerm} topics={topics} selected={selected} onChange={setSelected} onPendingFilesChange={setPendingFiles} onCandidatesChange={setCatalogue} chosenFileIds={chosenFileIds} onChosenFileIdsChange={setChosenFileIds} restoredTranscriptions={selectionDraft.saved?.transcriptions} disabled={busy || !active} />
        {unavailable && <div role="alert" className="error"><p>Una fuente ya no está disponible. Quítala para continuar.</p>{selected.filter((ref) => !candidates.some((candidate) => guideAiCandidateKey(candidate) === guideAiCandidateKey(ref))).map((ref) => <button type="button" key={guideAiCandidateKey(ref)} onClick={() => setSelected((value) => value.filter((entry) => guideAiCandidateKey(entry) !== guideAiCandidateKey(ref)))}>Quitar fuente no disponible: {GUIDE_AI_SOURCE_LABELS[ref.kind]}</button>)}</div>}
        <details><summary>Extensión de la respuesta</summary><label className="field"><span>Límite de tokens de salida por llamada</span><input type="number" min={256} max={8000} value={outputLimit} onChange={(event) => setOutputLimit(Number(event.target.value))} /></label><p className="field__hint">Una respuesta más extensa puede aumentar el consumo de tu cuenta de Gemini.</p></details>
        <div className="guide-wizard__actions"><button type="button" className="secondary" onClick={() => setStage(0)}>Volver al alcance</button><button type="button" disabled={!eligible || outputLimit < 256 || outputLimit > 8000} onClick={prepare}>{refreshing ? 'Actualizar preparación sin enviar a Gemini' : 'Preparar revisión de temas'}</button></div>
        {pendingFiles > 0 && <p className="field__hint" role="status">Revisa los {pendingFiles} archivos elegidos pendientes o quítalos de la selección para continuar.</p>}
        <p className="field__hint">Este paso guarda la selección. El análisis con IA se confirma en la siguiente pantalla.</p>
        {refreshing && <button type="button" className="secondary" onClick={() => { setRefreshing(undefined); refreshRequest.current = undefined; setStage(2); }}>Cancelar actualización de fuentes</button>}
      </div>
    </fieldset>}
    {stage < 2 && <GuideMaterialDraftStatus draft={selectionDraft} mode="ai" />}
    {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {draft && stage === 2 && <GuideAiDraftEditor key={draft.id} draft={draft} status={status} busy={busy} run={run} onDraft={setDraft} onRefresh={startRefresh} />}
    <details className="guide-wizard__drafts"><summary>Mis borradores privados ({summaries.length})</summary><section aria-label="Mis borradores privados">
      <button type="button" className="secondary" disabled={busy || !active} onClick={() => void run(reload, ({ nextStatus, nextSummaries }) => { setStatus(nextStatus); setSummaries(nextSummaries); })}>Actualizar borradores y configuración</button>
      {!summaries.length ? <p className="muted">Todavía no tienes borradores privados.</p> : <ul>{summaries.map((entry) => <li key={entry.id}><button type="button" className="link-button" disabled={busy} onClick={() => void run(() => source.getGuideAiDraft(entry.id), (next) => { setDraft(next); setStage(2); setRefreshing(undefined); refreshRequest.current = undefined; })}>{entry.title}</button> · {labels[entry.state]} · {entry.completedSteps}/{entry.totalSteps} pasos</li>)}</ul>}
      {stage === 2 && <button type="button" className="secondary" disabled={busy} onClick={() => { setDraft(undefined); setStage(0); setSelected([]); setChosenFileIds([]); setManualSections(undefined); setTitle(''); setTopicsText(''); setNotice(''); selectionDraft.open(crypto.randomUUID()); }}>Crear otra guía</button>}
    </section></details>
  </section>;
}
function message(failure: unknown) { return failure instanceof Error ? failure.message : 'No se pudo completar la operación. Revisa la conexión y vuelve a consultar el borrador.'; }

function GuideAiPreview({ preparation, status }: { preparation: GuideAiPreparation; status?: Awaited<ReturnType<GuideAiActions['getGuideAiStatus']>> }) {
  return <section className="ai-preview" aria-label="Vista previa del envío de la guía"><h4>Texto exacto preparado para Gemini</h4>
    <p>Título solicitado: <strong>{preparation.input.title}</strong>. {preparation.input.guideType === 'quarter' ? 'Guía cuatrimestral · todos los parciales de la materia.' : preparation.input.termId ? 'Guía de parcial.' : ''}</p>
    {Boolean(preparation.input.clarifications?.length) && <details><summary>Aportes tuyos que también se enviarán</summary>{preparation.input.clarifications?.map((entry) => <div key={entry.questionId}><strong>{entry.topic}: {entry.question}</strong><p>{entry.answer || 'Pendiente, sin información adicional.'}</p></div>)}</details>}
    <h5>Temario que se enviará</h5><ol>{preparation.input.topics.map((topic) => <li key={topic}>{topic}</li>)}</ol>
    <p>Modelo <strong>{preparation.model}</strong> · {preparation.sources.length} fuentes · {preparation.fragments.reduce((count, fragment) => count + fragment.text.length, 0).toLocaleString('es-MX')} caracteres · {preparation.estimatedCalls} {preparation.estimatedCalls === 1 ? 'llamada prevista' : 'llamadas previstas'}.</p>
    <p>Estimación total: {preparation.estimatedInputTokens.toLocaleString('es-MX')} tokens de entrada y hasta {preparation.estimatedOutputTokens.toLocaleString('es-MX')} de salida. Cada llamada cuenta contra tus límites y puede generar cargos en tu cuenta de Gemini.</p>
    {status && <p className="field__hint">Límites compartidos por persona: {status.status.limits.maxConcurrent} generación simultánea, {status.status.limits.requestsPerHour} llamadas por hora, {status.status.limits.requestsPerDay} por día y presupuesto de {status.status.limits.dailyEstimatedTokens.toLocaleString('es-MX')} tokens estimados diarios. Si falta presupuesto se conserva lo completado.</p>}
    <ul>{preparation.sources.map((entry) => <li key={guideAiCandidateKey(entry)}>{entry.title} · v{entry.version} · {entry.status === 'prepared' ? 'Texto preparado, todavía sin contar como cobertura utilizada' : entry.reason || 'Pendiente'}</li>)}</ul>
    {preparation.omissions.length > 0 && <div className="ai-notice"><h5>Material omitido</h5><ul>{preparation.omissions.map((omission, index) => <li key={index}>{omission}</li>)}</ul></div>}
    {preparation.fragments.map((fragment) => <details className="ai-fragment" key={fragment.id}><summary>{fragmentLabel(preparation, fragment)}</summary><pre>{fragment.text}</pre><small className="muted">Referencia: {fragment.id}</small></details>)}
  </section>;
}
function GuideTopicReview({ draft, busy, changed, run, onDraft, onRefresh }: {
  draft: GuideAiDraft; busy: boolean; changed: boolean;
  run<T>(action: () => Promise<T>, done: (value: T) => void): Promise<void>;
  onDraft(draft: GuideAiDraft): void; onRefresh(draft: GuideAiDraft): void;
}) {
  const source = useDataSource();
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (draft.assessment && !draft.topicsReviewed) reviewHeading.current?.focus(); }, [draft.assessment]);
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries((draft.preparation.input.clarifications ?? []).filter((entry) => draft.assessment?.questions.some((question) => question.id === entry.questionId && question.topic === entry.topic && question.question === entry.question)).map((entry) => [entry.questionId, entry.answer])));
  const [acknowledgeGaps, setAcknowledgeGaps] = useState(false);
  const assessment = draft.assessment;
  if (!assessment) return null;
  const coverageLabels = { covered: 'Con sustento', thin: 'Necesita más detalle', missing: 'Sin material suficiente' };
  const unanswered = assessment.questions.filter((question) => !answers[question.id]?.trim());
  const gaps = assessment.topics.filter((topic) => topic.coverage !== 'covered' && !assessment.questions.some((question) => question.topic === topic.topic && answers[question.id]?.trim()));
  const needsAcknowledgement = unanswered.length > 0 || gaps.length > 0;
  const completed = Boolean(draft.topicsReviewed);
  return <section className="guide-topic-review" aria-label="Revisión de temas con IA">
    <div className="guide-topic-review__heading"><h4 ref={reviewHeading} tabIndex={-1}>3. Completa los temas con la IA</h4><span className="badge">{completed ? 'Revisión guardada' : 'Antes de generar'}</span></div>
    <p>La IA comparó tu temario con el contenido seleccionado. Revisa sus observaciones y aporta los detalles que falten.</p>
    {Boolean(draft.previousClarifications?.length) && <details className="guide-topic-review__answered"><summary>Tus respuestas anteriores se conservan ({draft.previousClarifications?.length})</summary><p>Al cambiar los materiales se repite el análisis. Puedes consultar tus aportes y reutilizarlos en las preguntas del mismo tema.</p>{draft.previousClarifications?.map((entry, index) => <div key={`${entry.questionId}:${index}`}><strong>{entry.topic} · {entry.question}</strong><p>{entry.answer}</p></div>)}</details>}
    <ul className="guide-topic-review__topics">{assessment.topics.map((topic) => <li key={topic.topic} data-coverage={topic.coverage}>
      <span className="badge">{coverageLabels[topic.coverage]}</span><h5>{topic.topic}</h5><p>{topic.reason}</p>
      {topic.citations.length > 0 && <details><summary>Ver el sustento en tus materiales</summary><ul>{topic.citations.map((id) => { const fragment = draft.preparation.fragments.find((entry) => entry.id === id); return fragment ? <li key={id}>{fragmentLabel(draft.preparation, fragment)}<StructuredText text={fragment.text} /></li> : null; })}</ul></details>}
    </li>)}</ul>
    {completed ? <div className="guide-topic-review__answered"><p role="status">Temario revisado. Tus respuestas se guardaron y se usarán para redactar la guía.</p><details><summary>Ver mis aportes y temas pendientes</summary>{assessment.questions.map((question) => <div key={question.id}><strong>{question.question}</strong><p>{draft.preparation.input.clarifications?.find((entry) => entry.questionId === question.id)?.answer || 'Pendiente: no se aportó información adicional.'}</p></div>)}</details></div>
      : <fieldset className="guide-topic-review__questions" disabled={busy || changed || ['cancelled', 'published', 'running'].includes(draft.state)}><legend>Preguntas para completar tu guía</legend>
        {!assessment.questions.length && <p>La IA no tiene preguntas adicionales. Confirma la revisión del temario para continuar.</p>}
        {assessment.questions.map((question, index) => <div className="guide-topic-review__question" key={question.id}><label className="field"><small>{question.topic}</small><span>{index + 1}. {question.question}</span><textarea rows={3} maxLength={4000} value={answers[question.id] ?? ''} placeholder="Escribe lo que explicó el profesor, precisa el alcance o agrega un ejemplo." onChange={(event) => { setAnswers((value) => ({ ...value, [question.id]: event.target.value })); setAcknowledgeGaps(false); }} /><small>Si no tienes la respuesta, puedes agregar material o continuar dejando el tema pendiente.</small></label>{draft.previousClarifications?.filter((entry) => entry.topic === question.topic).map((entry, priorIndex) => <button type="button" className="secondary" key={`${entry.questionId}:${priorIndex}`} onClick={() => { setAnswers((value) => ({ ...value, [question.id]: entry.answer })); setAcknowledgeGaps(false); }}>Usar respuesta anterior{priorIndex ? ` ${priorIndex + 1}` : ''}</button>)}</div>)}
        <p className="field__hint">Tus respuestas son aportes tuyos. Se incorporan al borrador y podrán formar parte de la guía que publiques.</p>
        {needsAcknowledgement && <label className="guide-topic-review__ack"><input type="checkbox" checked={acknowledgeGaps} onChange={(event) => setAcknowledgeGaps(event.target.checked)} />Revisé los temas pendientes y quiero continuar. La guía debe señalar las limitaciones del material.</label>}
        <div className="guide-wizard__actions"><button type="button" className="secondary" onClick={() => onRefresh(draft)}>Agregar o cambiar materiales</button><button type="button" disabled={needsAcknowledgement && !acknowledgeGaps} onClick={() => void run(() => source.reviewGuideAiTopics(draft.id, { expectedRevision: draft.revision, answers: assessment.questions.map((question) => ({ questionId: question.id, answer: answers[question.id]?.trim() ?? '' })), acknowledgeGaps }), onDraft)}>Guardar respuestas y continuar</button></div>
      </fieldset>}
  </section>;
}

function GuideAiDraftEditor({ draft, status, busy, run, onDraft, onRefresh }: { draft: GuideAiDraft; status?: Awaited<ReturnType<GuideAiActions['getGuideAiStatus']>>; busy: boolean;
  run<T>(action: () => Promise<T>, done: (value: T) => void): Promise<void>; onDraft(draft: GuideAiDraft): void; onRefresh(draft: GuideAiDraft): void }) {
  const source = useDataSource(); const data = useSnapshot();
  const draftHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { draftHeading.current?.focus(); }, [draft.id]);
  const [confirmed, setConfirmed] = useState(false); const [acknowledge, setAcknowledge] = useState(false);
  const [result, setResult] = useState<GuideAiResult | undefined>(draft.result); const [editRevision, setEditRevision] = useState(draft.revision);
  const [target, setTarget] = useState<{ id: string; version: number }>();
  useEffect(() => { setTarget(undefined); }, [draft.subjectId, draft.termId]);
  const [uncertain, setUncertain] = useState(false); const generationId = useRef(crypto.randomUUID());
  const [cancelling, setCancelling] = useState(false); const [cancelError, setCancelError] = useState('');
  const [needsUnknownAcknowledgement, setNeedsUnknownAcknowledgement] = useState(false);
  const publication = useRef({ revision: draft.revision, target: '', id: crypto.randomUUID() });
  useEffect(() => { setConfirmed(false); setAcknowledge(false); setUncertain(false); setResult(draft.result); setEditRevision(draft.revision); generationId.current = crypto.randomUUID(); }, [draft.revision, draft.id]);
  const [examMaterials, setExamMaterials] = useState<GuideExamMaterial[]>([]);
  useEffect(() => {
    let alive = true; setExamMaterials([]);
    const exams = draft.preparation.sources.filter((entry) => entry.kind === 'exam');
    void Promise.allSettled(exams.map((entry) => source.getGuideExamMaterial(entry.refId, entry.examVersion ?? entry.version, entry.includeSolutions === true))).then((items) => {
      if (alive) setExamMaterials(items.flatMap((item) => item.status === 'fulfilled' ? [item.value] : []));
    });
    return () => { alive = false; };
  }, [source, draft.id, draft.subjectId, draft.revision]);
  const currentCandidates = guideAiCandidates(data, draft.subjectId, undefined, examMaterials, true);
  const changed = draft.preparation.sources.some((entry) => { const candidate = currentCandidates.find((ref) => guideAiCandidateKey(ref) === guideAiCandidateKey(entry)); return !candidate || candidate.version !== entry.version || candidate.termId !== entry.termId; });
  const inaccessible = draft.preparation.fragments.some((fragment) => fragment.origins.some((origin) => !currentCandidates.some((candidate) => guideAiCandidateKey(candidate) === guideAiCandidateKey(origin))
    || (origin.field.startsWith('respuesta:') && !data.answers.some((answer) => answer.id === origin.field.split(':')[1] && !answer.withdrawnAt))));
  const nextStep = draft.steps.find((step) => step.state === 'pending' || step.state === 'failed' || step.state === 'unknown');
  const waitingForTopics = Boolean(draft.preparation.input.reviewBeforeGenerate && (nextStep?.kind === 'direct' || nextStep?.kind === 'synthesis') && !draft.topicsReviewed);
  const generationAllowed = Boolean(!waitingForTopics && status?.status.enabled && status.key.configured && status.status.consented && draft.preparation.canGenerate && !changed && !uncertain && !['published', 'cancelled', 'running'].includes(draft.state));
  const targetGuide = target && data.guides.find((guide) => guide.id === target.id);
  const targetChanged = Boolean(target && (!targetGuide || targetGuide.version !== target.version));
  const dirty = JSON.stringify(result) !== JSON.stringify(draft.result);
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
  return <article className="guide-ai-draft" aria-label="Borrador privado de la guía"><h3 ref={draftHeading} tabIndex={-1}>{draft.title} <span className="badge">Privado · {labels[draft.state]}</span></h3>
    <p>Progreso guardado: {draft.completedSteps} de {draft.totalSteps} pasos. Puedes cerrar esta pantalla y volver a consultar el borrador.</p>
    <ul>{draft.steps.map((entry, index) => <li key={entry.id}>Paso {index + 1}: {entry.kind === 'assessment' ? 'Análisis del temario y preguntas' : entry.kind === 'summary' ? 'Resumen de materiales' : entry.kind === 'synthesis' ? 'Síntesis final' : 'Guía completa'} · {stepLabels[entry.state]}{entry.error && <span> · {entry.error}</span>}</li>)}</ul>
    {!inaccessible && <><GuideAiPreview preparation={draft.preparation} status={status} /><GuideTopicReview key={`${draft.id}:${draft.assessment ? JSON.stringify(draft.assessment) : 'pending'}`} draft={draft} busy={busy} changed={changed} run={run} onDraft={onDraft} onRefresh={onRefresh} /></>}
    {inaccessible && <p role="alert" className="ai-notice">Una fuente citada dejó de estar disponible. Su texto preparado se ocultó. Conservamos este borrador; prepara uno nuevo desde la selección de material disponible.</p>}
    {changed && <p role="alert" className="error">Una fuente cambió o dejó de estar disponible. Este borrador se conserva: selecciona y prepara el material actualizado antes de publicar.</p>}
    {draft.needsCitationReview && <p role="status" className="ai-notice">Las fuentes se actualizaron conservando tu texto. Revisa las citas de las ocho secciones y guarda el borrador antes de publicar; las citas anteriores que ya no existen se quitaron.</p>}
    {!inaccessible && !['running', 'published', 'cancelled'].includes(draft.state) && <><button type="button" className="button--secondary" disabled={busy || dirty} onClick={() => onRefresh(draft)}>Actualizar fuentes conservando mi texto</button>{dirty && <p className="field__hint">Guarda los cambios privados antes de actualizar las fuentes para conservar también estas últimas ediciones.</p>}</>}
    {(uncertain || draft.state === 'unknown' || draft.state === 'running') && <p role="status" className="ai-notice">El envío puede haberse consumido. Consulta su estado antes de decidir otro intento. No se repetirá ninguna llamada automáticamente.</p>}
    <button type="button" className="button--secondary" disabled={busy} onClick={() => void run(() => source.getGuideAiDraft(draft.id), (next) => { setUncertain(false); onDraft(next); })}>Consultar estado guardado</button>
    {nextStep && !waitingForTopics && !inaccessible && !['cancelled', 'published'].includes(draft.state) && <fieldset disabled={busy} className="ai-consent"><legend>Confirmar el siguiente envío</legend>
      <section aria-label="Texto del siguiente paso"><h4>Texto del siguiente paso</h4>
        {(nextStep.kind === 'synthesis' || nextStep.kind === 'assessment' && draft.preparation.batches.length > 1) ? <><p>La síntesis utilizará estos resúmenes intermedios y sus citas conservadas.</p>{draft.steps.filter((entry) => entry.kind === 'summary' && entry.state === 'succeeded').map((entry, index) => <div className="ai-fragment" key={entry.id}><h5>Resumen {index + 1}</h5>{entry.result && 'paragraphs' in entry.result && entry.result.paragraphs.map((paragraph, paragraphIndex) => <div key={paragraphIndex}><pre>{paragraph.text}</pre><p className="field__hint">Citas: {paragraph.citations.map((id) => { const fragment = draft.preparation.fragments.find((candidate) => candidate.id === id); return fragment ? fragmentLabel(draft.preparation, fragment) : 'Fuente no disponible'; }).join('; ')}</p></div>)}</div>)}</>
          : draft.preparation.fragments.filter((fragment) => nextStep.kind === 'assessment' || nextStep.kind === 'direct' || draft.preparation.batches.find((batch) => batch.id === nextStep.batchId)?.fragmentIds.includes(fragment.id)).map((fragment) => <details className="ai-fragment" key={fragment.id}><summary>{fragmentLabel(draft.preparation, fragment)}</summary><pre>{fragment.text}</pre><small className="muted">Referencia: {fragment.id}</small></details>)}
      </section>
      <p>Se usará la clave personal de <strong>{data.me?.displayName ?? 'mi cuenta'}</strong> con el modelo <strong>{draft.preparation.model}</strong>. Revisa arriba el texto, las citas y las omisiones.</p>
      {mustAcknowledge && <label><input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} />Acepto otro intento manual y su posible consumo adicional; el resultado anterior de IA no pudo confirmarse.</label>}
      <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Revisé la vista previa y confirmo enviar el siguiente paso a Gemini con mi clave.</label>
      <button type="button" disabled={!generationAllowed || !confirmed || (mustAcknowledge && !acknowledge)} onClick={step}>{nextStep.kind === 'assessment' ? 'Analizar temas y hacer preguntas' : nextStep.kind === 'direct' ? 'Generar borrador privado' : 'Enviar el siguiente paso'}</button>
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
    {draft.preparation.sources.some((entry) => entry.visibility === 'personal') && <p className="ai-notice">Esta guía usa materiales personales. Tu borrador se conserva privado; para publicarlo retira esas fuentes y vuelve a generar, o compártelas desde su módulo y actualiza la preparación.</p>}
    {draft.state === 'ready' && !inaccessible && <fieldset disabled={busy} className="ai-consent"><legend>Publicar para el grupo</legend><p>Publicar conserva las fuentes, citas y procedencia. Una versión nueva necesitará revisión de otro compañero.</p>
      <label className="field"><span>Destino de publicación</span><select value={target?.id ?? ''} onChange={(event) => { const guide = data.guides.find((entry) => entry.id === event.target.value); setTarget(guide ? { id: guide.id, version: guide.version } : undefined); }}><option value="">Crear una guía nueva</option>{data.guides.filter((guide) => !guide.withdrawnAt && guide.subjectId === draft.subjectId && guide.termId === draft.termId).map((guide) => <option key={guide.id} value={guide.id}>Nueva versión de {guide.title} · v{guide.version}</option>)}</select></label>
      {dirty && <p className="field__hint">Guarda los cambios privados antes de publicar.</p>}{targetChanged && <p role="alert" className="error">La guía de destino cambió. Revisa la versión actual antes de elegirla de nuevo.</p>}
      <button type="button" disabled={changed || dirty || targetChanged || draft.needsCitationReview || draft.preparation.sources.some((entry) => entry.visibility === 'personal')} onClick={publish}>Publicar guía para el grupo</button>
    </fieldset>}
    {draft.state === 'published' && draft.publishedGuideId && <p role="status">Guía publicada. <Link to={`/m/guias/${draft.publishedGuideId}`}>Abrir la versión compartida</Link></p>}
    {cancelError && <p role="alert" className="error">{cancelError}</p>}
    {!['published', 'cancelled'].includes(draft.state) && <><p className="field__hint">Cancelar detiene los pasos pendientes. Un envío que ya llegó a Gemini puede generar consumo y terminar después.</p><button type="button" className="button--secondary" disabled={cancelling} onClick={() => void cancelPending()}>{cancelling ? 'Cancelando pasos…' : 'Cancelar pasos pendientes'}</button></>}
  </article>;
}
