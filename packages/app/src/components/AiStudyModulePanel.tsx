import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { validateAiModuleDraft, type AiGeneration, type AiModuleDraft, type AiPreparation, type AiPrepareInput, type AiStatus } from '@b20/core';
import { useSession } from '../auth/AuthContext';
import { config } from '../config';
import { AiClient, AiClientError } from '../data/aiClient';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { DemoDataSource } from '../data/demo';
import type { SpacedCollection, TeachingPractice } from '../data/types';
import { aiCandidateKey, aiSourceCandidates } from '../lib/aiSources';
import { AiSourcePreview } from './AiSourcePreview';

type Target = { practice: TeachingPractice; collection?: never } | { collection: SpacedCollection; practice?: never };

/** Session remounts discard every preview, response and operation receipt in memory. */
export function AiStudyModulePanel(props: Target) {
  const session = useSession();
  const data = useSnapshot();
  const simulated = useDataSource() instanceof DemoDataSource;
  const token = session?.status === 'signedIn' ? session.token : undefined;
  if (data.me?.status !== 'active' || (props.practice && props.practice.ownerId !== data.me.id)) return null;
  return <AiStudyModuleAccount key={`${data.me.id}:${token ?? 'demo'}:${props.practice?.id ?? props.collection?.id}`} {...props} token={token} simulated={simulated} />;
}

function AiStudyModuleAccount({ token, simulated, ...target }: Target & { token?: string; simulated: boolean }) {
  const data = useSnapshot();
  const tokenRef = useRef(token); tokenRef.current = token;
  const client = useMemo(() => simulated ? undefined : new AiClient({ apiUrl: config.apiUrl, getToken: () => tokenRef.current }), [token, simulated]);
  const purpose = target.practice ? 'teaching_questions' as const : 'spaced_cards' as const;
  const subjectId = target.practice?.subjectId ?? target.collection!.subjectId;
  const candidates = aiSourceCandidates(data, subjectId).filter((entry) => ['note', 'guide'].includes(entry.kind)
    && (target.collection?.visibility !== 'group' || !entry.personal));
  const [sourceKey, setSourceKey] = useState('');
  const [count, setCount] = useState(target.practice ? 3 : 5);
  const [status, setStatus] = useState<AiStatus>();
  const [preparation, setPreparation] = useState<AiPreparation>();
  const [generation, setGeneration] = useState<AiGeneration>();
  const [history, setHistory] = useState<AiGeneration[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [unknownRisk, setUnknownRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | undefined>(undefined);
  const attempt = useRef<string | undefined>(undefined);
  const source = candidates.find((candidate) => aiCandidateKey(candidate) === sourceKey);
  // Reflection, answers, reviewer and review history deliberately do not participate in this signature.
  const revision = JSON.stringify([purpose, sourceKey, source?.revision, count, target.collection?.version,
    target.practice && [target.practice.topic, target.practice.initial, target.practice.revised, target.practice.status]]);
  const latestRevision = useRef(revision); latestRevision.current = revision;
  const preparedRevision = useRef<string | undefined>(undefined);
  const stale = Boolean(preparation && preparedRevision.current !== revision);
  useEffect(() => {
    const active = new AbortController(); controller.current = active;
    if (client && token) void Promise.all([client.request<AiStatus>('/ai/status', 'GET', undefined, active.signal),
      client.request<AiGeneration[]>('/ai/generations', 'GET', undefined, active.signal)]).then(([next, rows]) => {
      if (!active.signal.aborted) { setStatus(next); setHistory(rows); }
    }).catch((cause) => { if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : 'No se pudo consultar Gemini.'); });
    return () => { active.abort(); client?.cancelPending(); };
  }, [client, token]);
  useEffect(() => { setConfirmed(false); attempt.current = undefined; setGeneration(undefined); }, [revision]);
  const operation = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); }
    catch (cause) { if (!controller.current?.signal.aborted) setError(cause instanceof Error ? cause.message : 'No se pudo confirmar la operación.'); }
    finally { if (!controller.current?.signal.aborted) setBusy(false); }
  };
  const prepare = () => void operation(async () => {
    if (!client) return;
    const topic = (target.practice?.topic ?? source?.topics[0] ?? source?.title ?? '').slice(0, 120);
    const sources: AiPrepareInput['sources'] = target.practice ? [{ kind: 'teaching', refId: target.practice.id, topics: [topic], includeUnplaced: true }] : [];
    if (source) sources.push({ kind: source.kind, refId: source.refId, topics: [topic], includeUnplaced: true });
    const input: AiPrepareInput = { subjectId, topics: [topic], sources,
      config: { purpose, questionCount: count, types: ['single'], difficulty: 'intermediate' } };
    const captured = revision;
    const result = await client.request<AiPreparation>('/ai/preparations', 'POST', input, controller.current?.signal);
    if (latestRevision.current === captured) { preparedRevision.current = captured; setPreparation(result); setConfirmed(false); setGeneration(undefined); attempt.current = undefined; }
  });
  const generate = () => void operation(async () => {
    if (!client || !preparation || stale) return;
    const captured = revision;
    attempt.current ??= crypto.randomUUID();
    const next = await client.request<AiGeneration>('/ai/generations', 'POST', { id: attempt.current, preparationId: preparation.id,
      fingerprint: preparation.fingerprint, config: preparation.config, confirmed, acknowledgeUnknown: unknownRisk }, controller.current?.signal);
    if (latestRevision.current === captured) { setGeneration(next); setHistory((rows) => [next, ...rows.filter((row) => row.id !== next.id)]); }
  });
  const historyForTarget = history.filter((entry) => entry.preparation?.config.purpose === purpose
    && (target.practice ? entry.preparation.sources.some((source) => source.kind === 'teaching' && source.refId === target.practice.id)
      : entry.preparation.subjectId === subjectId));
  return <section className="panel ai-study-module" aria-label={target.practice ? 'Preguntas clarificadoras con Gemini' : 'Tarjetas con Gemini'}>
    <h2>{target.practice ? 'Preguntas clarificadoras con Gemini' : 'Crear tarjetas con Gemini'}</h2>
    <p>{target.practice ? 'Prepara la explicación que ya guardaste. Revisa el texto exacto antes de enviarlo; las preguntas quedan privadas hasta que decidas incorporarlas a esta práctica.'
      : 'Selecciona una nota o guía. Los borradores quedan privados y solo se añaden a esta colección después de revisarlos.'}</p>
    {target.practice && <p>Las preguntas que incorpores podrán consultarlas tú y el compañero actualmente invitado a tu práctica.</p>}
    <p className="field__hint">{target.practice ? 'No se envían tu reflexión, respuestas, historial, datos del compañero ni conversaciones.' : 'No se envían tus respuestas, avances, historial de revisiones ni conversaciones. Los intervalos de repaso se conservan.'}</p>
    <p><Link to="/ajustes">Configurar clave personal y consentimiento de Gemini</Link></p>
    {simulated ? <p className="ai-notice">La demo no envía esta práctica ni las tarjetas a Gemini. Puedes usar todos los ejercicios manuales.</p> : <>
      <label className="field">{target.practice ? 'Contexto adicional de una nota o guía (opcional)' : 'Nota o guía para las tarjetas'}<select value={sourceKey} disabled={busy} onChange={(event) => setSourceKey(event.target.value)}>
        <option value="">{target.practice ? 'Solo mi explicación guardada' : 'Selecciona una fuente'}</option>
        {candidates.map((entry) => <option key={aiCandidateKey(entry)} value={aiCandidateKey(entry)}>{entry.title} · v{entry.version}{entry.personal ? ' · Personal' : ''}</option>)}
      </select></label>
      {sourceKey && !source && <p className="error" role="alert">La fuente ya no está disponible. Elige otra antes de preparar.</p>}
      <label className="field">Cantidad máxima<input type="number" value={count} min={1} max={10} disabled={busy} onChange={(event) => setCount(Number(event.target.value))} /></label>
      <button type="button" disabled={busy || !client || !status?.model || (!target.practice && !source) || Boolean(sourceKey && !source) || count < 1 || count > 10 || !Number.isInteger(count)} onClick={prepare}>Preparar texto exacto</button>
      {status && !status.enabled && <p className="ai-notice">{status.reason ?? 'Gemini está desactivado para el grupo.'}</p>}
      {stale && <p className="ai-notice" role="status">La explicación, fuente o selección cambió. Prepara y confirma otra vista previa.</p>}
      {preparation && !stale && <><AiSourcePreview preparation={preparation} />
        <p>Se usará tu clave personal, modelo {preparation.model}, y hasta {preparation.estimatedInputTokens + preparation.estimatedOutputTokens} tokens estimados. Gemini puede consumir cuota o generar cargos en tu proyecto.</p>
        <label className="check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />Revisé este texto exacto y sus omisiones. Autorizo enviarlo a Gemini con mi clave.</label>
        <label className="check"><input type="checkbox" checked={unknownRisk} disabled={busy} onChange={(event) => setUnknownRisk(event.target.checked)} />Si existe un envío incierto, entiendo que otra solicitud puede consumir cuota adicional.</label>
        <button type="button" disabled={busy || !confirmed || !status?.enabled || !status.configured || !status.consented || !preparation.canGenerate || preparation.expiresAt <= Date.now()} onClick={generate}>{attempt.current ? 'Consultar o reintentar la misma generación' : 'Generar borrador privado'}</button>
      </>}
      {historyForTarget.length > 0 && <details><summary>Mis borradores privados ({historyForTarget.length})</summary><ul>{historyForTarget.map((entry) => <li key={entry.id}><button type="button" className="link-button" disabled={busy} onClick={() => void operation(async () => {
        const result = await client!.request<AiGeneration>(`/ai/generations/${entry.id}`, 'GET', undefined, controller.current?.signal); setGeneration(result);
      })}>{new Date(entry.createdAt).toLocaleString('es-MX')} · {entry.state}</button></li>)}</ul></details>}
      {generation && <p role="status">Estado: {generation.state}. {generation.error}</p>}
      {generation?.state === 'unknown' && <p className="ai-notice">Esta operación no se vuelve a enviar automáticamente. Puede haber consumido cuota.</p>}
      {generation?.state === 'succeeded' && generation.preparation && <AiStudyDraftReview key={generation.id} client={client!} generation={generation}
        collection={target.collection} signal={controller.current?.signal} />}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

interface ReviewedEntry { index: number; selected: boolean; text?: string; question?: string; explanation?: string; hint?: string }
export function AiStudyDraftReview({ client, generation, collection, signal }: { client: AiClient; generation: AiGeneration; collection?: SpacedCollection; signal?: AbortSignal }) {
  let draft: AiModuleDraft | undefined;
  try { if (generation.preparation) draft = validateAiModuleDraft(generation.result, generation.preparation, generation.preparation.config); } catch { /* Invalid results are never accepted. */ }
  const [entries, setEntries] = useState<ReviewedEntry[]>(() => !draft ? [] : draft.purpose === 'teaching_questions'
    ? draft.questions.map((question, index) => ({ index, selected: true, text: question.text }))
    : draft.cards.map((card, index) => ({ index, selected: true, question: card.question, explanation: card.explanation, hint: card.hint })));
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(Boolean(generation.acceptance));
  const [error, setError] = useState('');
  const submitted = useRef<Record<string, unknown> | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  if (!draft || !generation.preparation) return <p className="error" role="alert">El borrador no tiene una estructura válida.</p>;
  const frozen = busy || accepted || Boolean(submitted.current);
  const amend = (index: number, update: Partial<ReviewedEntry>) => setEntries((rows) => rows.map((entry) => entry.index === index ? { ...entry, ...update } : entry));
  const accept = async () => {
    if (busy || accepted || !reviewed || !entries.some((entry) => entry.selected)) return;
    submitted.current ??= { reviewed: true, selection: entries.filter((entry) => entry.selected).map(({ selected: _selected, ...entry }) => entry),
      ...(collection ? { collectionId: collection.id, expectedCollectionVersion: collection.version } : {}) };
    setBusy(true); setError('');
    try { await client.request(`/ai/generations/${generation.id}/publish`, 'POST', submitted.current, signal); if (alive.current && !signal?.aborted) setAccepted(true); }
    catch (cause) {
      if (cause instanceof AiClientError && !['network', 'database_unavailable', 'unknown', 'request_failed', 'protocol'].includes(cause.code)) submitted.current = undefined;
      if (alive.current && !signal?.aborted) setError(cause instanceof Error ? cause.message : 'No se pudo confirmar la incorporación.');
    }
    finally { if (alive.current && !signal?.aborted) setBusy(false); }
  };
  const selectedEntries = entries.filter((entry) => entry.selected);
  const reviewedQuestions = selectedEntries.map((entry) => (entry.text ?? entry.question ?? '').trim().toLocaleLowerCase('es'));
  const invalidSelection = selectedEntries.some((entry) => draft.purpose === 'teaching_questions'
    ? !entry.text?.trim() || entry.text.length > 3900
    : !entry.question?.trim() || entry.question.length > 1000 || !entry.explanation?.trim() || entry.explanation.length > 18_000 || (entry.hint?.length ?? 0) > 2000)
    || new Set(reviewedQuestions).size !== reviewedQuestions.length
    || selectedEntries.reduce((total, entry) => total + (entry.explanation?.length ?? 0), 0) > 70_000;
  const blocked = draft.purpose === 'spaced_cards' && (!collection || collection.archived || (collection.visibility === 'group' && generation.preparation.sources.some((source) => source.visibility === 'personal')));
  return <article aria-label="Revisar borrador privado">
    <h3>{draft.purpose === 'teaching_questions' ? 'Revisa las preguntas antes de incorporarlas' : draft.title}</h3>
    <p className="ai-notice">Borrador privado de Gemini. Puedes corregir y seleccionar cada elemento antes de aceptarlo. Comprueba su contenido y sus citas.</p>
    <fieldset disabled={frozen}>{entries.map((entry) => <section key={entry.index}>
      <label className="check"><input type="checkbox" checked={entry.selected} onChange={(event) => amend(entry.index, { selected: event.target.checked })} />Incorporar elemento {entry.index + 1}</label>
      {draft.purpose === 'teaching_questions' ? <label className="field">Pregunta<textarea value={entry.text} maxLength={3900} rows={3} onChange={(event) => amend(entry.index, { text: event.target.value })} /></label>
        : <><label className="field">Pregunta<textarea value={entry.question} maxLength={1000} rows={3} onChange={(event) => amend(entry.index, { question: event.target.value })} /></label>
          <label className="field">Explicación<textarea value={entry.explanation} maxLength={18_000} rows={5} onChange={(event) => amend(entry.index, { explanation: event.target.value })} /></label>
          <label className="field">Pista<textarea value={entry.hint} maxLength={2000} rows={2} onChange={(event) => amend(entry.index, { hint: event.target.value })} /></label></>}
      <p className="field__hint">Referencias: {(draft.purpose === 'teaching_questions' ? draft.questions[entry.index]! : draft.cards[entry.index]!).citations.map((citation) => generation.preparation!.fragments.find((fragment) => fragment.id === citation)!.origins.map((origin) => `${origin.kind}:${origin.refId} v${origin.version}`).join(', ')).join('; ')}</p>
    </section>)}
      <label className="check"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />Revisé el contenido seleccionado y sus referencias; quiero incorporarlo {draft.purpose === 'teaching_questions' ? 'a mi práctica privada' : collection?.visibility === 'group' ? 'a esta colección del grupo' : 'a mi colección personal'}.</label>
    </fieldset>
    {blocked && <p className="error" role="alert">Este borrador necesita una colección compatible. Las fuentes personales solo se incorporan a una colección personal.</p>}
    {invalidSelection && <p className="error" role="alert">Completa los textos seleccionados, respeta sus límites y evita preguntas repetidas antes de incorporar.</p>}
    <button type="button" disabled={busy || accepted || !reviewed || !selectedEntries.length || invalidSelection || blocked} onClick={() => void accept()}>{accepted ? 'Incorporación confirmada' : submitted.current ? 'Consultar o reintentar la misma incorporación' : 'Incorporar selección revisada'}</button>
    {accepted && <p role="status">Se incorporó tu selección. No se publicó ninguna explicación ni se modificó tu historial o programación de repaso.</p>}
    {error && <p className="error" role="alert">{error} {submitted.current ? 'Conservamos la misma selección para reintentar sin duplicarla.' : 'Puedes corregir la selección antes de volver a intentar.'}</p>}
  </article>;
}
