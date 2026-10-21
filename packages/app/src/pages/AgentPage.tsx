import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AGENT_LIMITS, AGENT_PREMISES_VERSION, agentOwnerName, renderAgentPremises, type AgentStage } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { agentStyleCandidates, simulateHelp, simulateReview, type AgentStyleCandidate } from '../data/agentDemo';
import type { AgentOriginalityMatch, AgentSessionRow, AgentStyleSnapshotRow } from '../data/agentTypes';
import { Avatar } from '../components/Avatar';
import { agentNameFor } from '../components/AgentHelpLink';
import { useAction } from '../components/useAction';
import '../components/ai.css';
import './agent.css';

type Tab = 'train' | 'profile' | 'help';
const TABS: [Tab, string][] = [['train', 'Entrenar estilo'], ['profile', 'Perfil de estilo'], ['help', 'Ayudar con una tarea']];
const STAGES: [AgentStage, string][] = [['understand', 'Entender consigna'], ['approach', 'Enfoque'], ['outline', 'Esquema'], ['review', 'Revisar mi borrador']];
const KIND_LABEL = { work: 'Trabajo', evidence: 'Evidencia', note: 'Nota' } as const;

/** Perfil desactualizado: cambió la selección, una fuente ya no está o tiene otra versión. */
function isOutdated(style: AgentStyleSnapshotRow | undefined, selected: string[], candidates: AgentStyleCandidate[]) {
  if (!style) return false;
  const used = style.sources.map((s) => `${s.kind}:${s.refId}`);
  return used.slice().sort().join() !== selected.slice().sort().join()
    || style.sources.some((s) => candidates.find((c) => c.key === `${s.kind}:${s.refId}`)?.version !== s.refVersion);
}

export function AgentPage() { const data = useSnapshot(); return <AgentWorkspace key={data.me?.id} />; }

function AgentWorkspace() {
  const data = useSnapshot(); const source = useDataSource(); const action = useAction(); const [params, setParams] = useSearchParams();
  const bot = agentNameFor(data)!; const owner = agentOwnerName(data.me?.displayName ?? ''); const premises = renderAgentPremises(owner, bot);
  const profile = data.agentProfile; const accepted = profile?.premisesVersion === AGENT_PREMISES_VERSION;
  const candidates = useMemo(() => agentStyleCandidates(data), [data]);
  const [selected, setSelected] = useState<string[]>(() => data.agentSources.length ? data.agentSources.map((s) => `${s.kind}:${s.refId}`) : candidates.filter((c) => !c.coauthored).map((c) => c.key));
  const [consent, setConsent] = useState(false); const [confirmDisable, setConfirmDisable] = useState(false);
  const style = data.agentStyleSnapshots.at(-1); const outdated = isOutdated(style, selected, candidates);
  const state = !profile ? 'Sin activar' : !style ? 'Sin entrenar' : outdated ? 'Desactualizado' : 'Listo';
  const tab = (params.get('pestana') as Tab | null) ?? (params.get('tarea') ? 'help' : 'train');
  const go = (next: Tab) => setParams((current) => { const copy = new URLSearchParams(current); copy.set('pestana', next); return copy; });
  const train = async () => { const ok = await action.run(async () => { await source.trainAgent({ sources: selected.map((key) => { const [kind, refId] = key.split(':') as [AgentStyleCandidate['kind'], string]; return { kind, refId }; }), expectedStyleVersion: profile?.styleVersion ?? 0 }); return true; }); if (ok) go('profile'); };

  return <>
    <header className="page-header agent-header"><Avatar member={data.me} size={48} /><div><p className="eyebrow">Mi agente · 7.13</p><h1>{bot}</h1><p>Te ayuda a hacer la tarea con tu propia voz. Escribe contigo, no en tu lugar.</p></div>
      <div className="badges"><span className={`badge ${state === 'Listo' ? 'badge--resolved' : 'badge--open'}`}>{state}</span><span className="badge badge--ai">Sin Gemini todavía</span></div></header>
    <p className="ai-notice">Tu perfil, tus borradores y las comparaciones se guardan solo para ti. La ayuda por etapas y las sugerencias todavía se calculan sin Gemini y no usan tu clave.</p>

    <section className="panel agent-premises" id="premisas" aria-labelledby="premisas-titulo"><h2 id="premisas-titulo">Premisas de {bot}</h2><p className="muted">Texto literal, versión {premises.version}. Es el mismo que recibirá Gemini como instrucción.</p>
      <div className="agent-premises__cols"><div><h3>Lo que hace {bot}</h3><ol>{premises.does.map((p) => <li key={p.number} value={p.number}>{p.text}</li>)}</ol></div>
        <div><h3>Lo que no hace {bot}</h3><ol>{premises.doesNot.map((p) => <li key={p.number} value={p.number}>{p.text}</li>)}</ol></div></div>
      {!accepted && <div className="agent-consent"><label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />Leí las premisas y acepto que {bot} use los textos míos que elija para aprender mi estilo.</label>
        <button type="button" disabled={!consent || action.pending} onClick={() => void action.run(() => source.enableAgent({ premisesVersion: AGENT_PREMISES_VERSION }))}>{profile ? 'Aceptar las premisas nuevas' : `Activar a ${bot}`}</button></div>}
      {action.error && <p className="error" role="alert">{action.error}</p>}</section>

    {accepted && <>
      <div className="chips agent-tabs" role="tablist">{TABS.map(([id, label]) => <button key={id} type="button" role="tab" className="chip" aria-selected={tab === id} aria-pressed={tab === id} onClick={() => go(id)}>{label}</button>)}</div>

      {tab === 'train' && <section className="panel agent-panel"><h2>Entrenar estilo</h2><p>Elige tus textos para que {bot} aprenda cómo escribes. Solo aparecen trabajos, evidencias y notas propias; los coautorados no se incluyen solos. Hasta {AGENT_LIMITS.sources} textos.</p>
        {!candidates.length ? <p className="placeholder">Todavía no tienes textos propios publicados. Sube un trabajo o una evidencia en <Link to="/m/tareas">Tareas y Actividades</Link>.</p>
          : <ul className="agent-sources">{candidates.map((c) => <li key={c.key}><label className="check"><input type="checkbox" checked={selected.includes(c.key)} onChange={(e) => setSelected((keys) => e.target.checked ? candidates.map((x) => x.key).filter((k) => k === c.key || keys.includes(k)) : keys.filter((k) => k !== c.key))} /><span><strong>{c.title}</strong> <span className="muted">· {KIND_LABEL[c.kind]}{c.coauthored ? ' · Coautorado: incluir manualmente' : ''}</span><span className="agent-sources__excerpt">{c.text.slice(0, 140)}{c.text.length > 140 ? '…' : ''}</span></span></label></li>)}</ul>}
        <button type="button" disabled={!selected.length || selected.length > AGENT_LIMITS.sources || action.pending} onClick={() => void train()}>Entrenar a {bot}</button></section>}

      {tab === 'profile' && <section className="panel agent-panel"><h2>Perfil de estilo</h2>
        {!style ? <p className="placeholder">{bot} todavía no conoce tu estilo. <button type="button" className="link-button" onClick={() => go('train')}>Entrenar estilo</button></p> : <>
          {outdated && <p className="ai-notice">Cambiaste las fuentes o un texto desde el último entrenamiento. Vuelve a entrenar para actualizar el perfil.</p>}
          <p className="muted">Versión {style.version} · aprendido de {style.sources.length} textos ({style.features.words} palabras) · {style.createdAt.toLocaleString('es-MX')}</p>
          <ul className="cards agent-traits"><li className="card"><strong>Tono</strong><span>{style.features.tone}</span></li><li className="card"><strong>Largo de frase</strong><span>Unas {style.features.sentenceLength} palabras</span></li><li className="card"><strong>Estructura</strong><span>{style.features.structure}</span></li><li className="card"><strong>Nivel técnico</strong><span>{style.features.technical}</span></li></ul>
          {!!style.features.vocabulary.length && <><h3>Vocabulario frecuente</h3><div className="chips chips--small">{style.features.vocabulary.map((w) => <span key={w} className="chip">{w}</span>)}</div></>}
          {!!style.examples.length && <><h3>Así escribes</h3>{style.examples.map((e, i) => <blockquote key={i}>{e}</blockquote>)}</>}
        </>}</section>}

      {tab === 'help' && <AgentHelp bot={bot} style={outdated ? undefined : style} />}

      <details className="agent-disable"><summary>Desactivar a {bot}</summary><p>Se borran tu perfil de estilo, tus sesiones, borradores, sugerencias y comparaciones. Tus trabajos publicados no cambian.</p>
        <label className="check"><input type="checkbox" checked={confirmDisable} onChange={(e) => setConfirmDisable(e.target.checked)} />Entiendo que no se puede deshacer.</label>
        <button type="button" className="secondary" disabled={!confirmDisable || action.pending} onClick={() => void action.run(() => source.disableAgent())}>Desactivar y borrar mis datos del agente</button></details>
    </>}
    <p><a href="#premisas">Volver a las premisas de {bot}</a></p>
  </>;
}

function AgentHelp({ bot, style }: { bot: string; style: AgentStyleSnapshotRow | undefined }) {
  const data = useSnapshot(); const source = useDataSource(); const action = useAction(); const [params, setParams] = useSearchParams();
  const assignment = data.assignments.find((a) => a.id === params.get('tarea'));
  const session = data.agentSessions.filter((s) => s.assignmentId === assignment?.id).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  const [requestId] = useState(() => crypto.randomUUID());
  const pick = (id: string) => setParams((current) => { const copy = new URLSearchParams(current); if (id) copy.set('tarea', id); else copy.delete('tarea'); copy.set('pestana', 'help'); return copy; });

  return <section className="panel agent-panel"><h2>Ayudar con una tarea</h2>
    <label className="field"><span>Tarea o actividad</span><select value={assignment?.id ?? ''} onChange={(e) => pick(e.target.value)}><option value="">Elige una tarea</option>{data.assignments.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label>
    {!style && <p className="ai-notice">{bot} no tiene un perfil de estilo vigente: sus pistas serán genéricas hasta que lo entrenes.</p>}
    {!assignment ? <p className="placeholder">Elige una tarea para que {bot} te ayude paso a paso.</p> : <>
      <p><Link to={`/m/tareas/${assignment.id}`}>Abrir consigna: {assignment.title}</Link></p>
      {!session ? <><p className="muted">Tu sesión guarda la etapa, tu borrador, las sugerencias y las comparaciones. Se borra sola tras {AGENT_LIMITS.sessionRetentionDays} días sin uso.</p>
        <button type="button" disabled={action.pending} onClick={() => void action.run(() => source.startAgentSession({ assignmentId: assignment.id, requestId: `${requestId}:${assignment.id}` }))}>Empezar con {bot}</button></>
        : <AgentSessionView key={`${session.id}:${session.draftVersion}`} bot={bot} session={session} style={style} />}
      {action.error && <p className="error" role="alert">{action.error}</p>}
      <div className="agent-actions"><button type="button" disabled title="El plug-in para subir tareas está pendiente (AG-5).">Subir tarea (plug-in, pendiente)</button></div>
    </>}
  </section>;
}

function AgentSessionView({ bot, session, style }: { bot: string; session: AgentSessionRow; style: AgentStyleSnapshotRow | undefined }) {
  const data = useSnapshot(); const source = useDataSource(); const action = useAction();
  const assignment = data.assignments.find((a) => a.id === session.assignmentId)!;
  const [draft, setDraft] = useState(session.draft); const dirty = draft !== session.draft;
  const suggestions = data.agentSuggestions.filter((s) => s.sessionId === session.id);
  const check = data.agentOriginalityChecks.filter((c) => c.sessionId === session.id).at(-1);
  const save = (stage: AgentStage, text: string) => action.run(() => source.saveAgentDraft({ sessionId: session.id, expectedDraftVersion: session.draftVersion, stage, draft: text }));

  return <>
    <div className="chips" role="tablist" aria-label="Etapas">{STAGES.map(([id, label]) => <button key={id} type="button" role="tab" className="chip" aria-selected={session.stage === id} aria-pressed={session.stage === id} disabled={action.pending} onClick={() => void save(id, session.draft)}>{label}</button>)}</div>
    {session.stage !== 'review' ? <div className="agent-output"><p className="badges"><span className="badge badge--personal">Borrador privado</span><span className="badge badge--ai">Generado con {bot}</span></p><ul>{simulateHelp(session.stage, assignment, style?.features).map((line, i) => <li key={i}>{line}</li>)}</ul><p className="muted">Fuente: consigna «{assignment.title}», versión {assignment.version}.</p></div> : <>
      <label className="field"><span>Mi borrador</span><textarea rows={10} value={draft} maxLength={AGENT_LIMITS.draftChars} onChange={(e) => setDraft(e.target.value)} placeholder={`Escribe aquí tu respuesta. ${bot} la revisa, no la escribe por ti.`} /></label>
      <p className="muted">Versión {session.draftVersion} guardada {session.updatedAt.toLocaleString('es-MX')}{dirty ? ' · tienes cambios sin guardar' : ''}</p>
      <div className="agent-actions"><button type="button" disabled={!dirty || action.pending} onClick={() => void save('review', draft)}>Guardar borrador</button>
        <button type="button" className="secondary" disabled={dirty || !session.draft.trim() || action.pending} onClick={() => void action.run(() => source.proposeAgentSuggestions({ sessionId: session.id, draftVersion: session.draftVersion, suggestions: simulateReview(session.draft, style?.features) }))}>Pedir sugerencias a {bot}</button>
        <button type="button" className="secondary" disabled={dirty || !session.draft.trim() || action.pending} onClick={() => void action.run(() => source.checkAgentOriginality({ sessionId: session.id, draftVersion: session.draftVersion }))}>Comparar con el grupo</button></div>
      {dirty && <p className="muted">Guarda tu borrador para pedir sugerencias o compararlo.</p>}
      {action.error && <p className="error" role="alert">{action.error}</p>}
      {!!suggestions.length && <><h3>Sugerencias de {bot}</h3><ul className="agent-suggestions">{suggestions.map((s) => { const stale = s.state === 'proposed' && !!s.original && s.draftVersion !== session.draftVersion; return <li key={s.id} data-state={stale ? 'rejected' : s.state}><p>{s.reason}</p>{s.original && <p className="agent-diff"><del>{s.original}</del> <ins>{s.replacement}</ins></p>}
        {stale ? <span className="muted">Ya no aplica: el borrador cambió.</span> : s.state === 'proposed' ? s.original ? <div className="agent-actions"><button type="button" className="secondary" disabled={action.pending} onClick={() => void action.run(() => source.resolveAgentSuggestion({ suggestionId: s.id, accept: true }))}>Aceptar</button><button type="button" className="secondary" disabled={action.pending} onClick={() => void action.run(() => source.resolveAgentSuggestion({ suggestionId: s.id, accept: false }))}>Rechazar</button></div>
          : <button type="button" className="secondary" disabled={action.pending} onClick={() => void action.run(() => source.resolveAgentSuggestion({ suggestionId: s.id, accept: false }))}>Entendido</button> : <span className="muted">{s.state === 'accepted' ? 'Aceptada' : 'Descartada'}</span>}</li>; })}</ul></>}
      {check && <><h3>Alerta de originalidad</h3>{check.draftVersion !== session.draftVersion && <p className="muted">Esta comparación es de la versión {check.draftVersion} de tu borrador. Vuelve a comparar para revisar la actual.</p>}
        {!check.matches.length ? <p className="muted">Tu borrador no se parece a lo que el grupo ya publicó.</p> : <><p className="ai-notice">Tu texto se parece a trabajos publicados. {bot} no lo reescribe por ti: revisa cada parte y escríbela con tus propias ideas.</p>
          <ul className="agent-matches">{check.matches.map((m) => <li key={m.refKey} data-level={m.level}><p><strong>{m.status === 'too_short' ? 'Oración copiada' : `${m.score}% parecido${m.level === 'block' ? ' (alto)' : ''}`}</strong> con «{m.title}» de {m.authorName}</p>
            {m.status === 'too_short' && <p className="muted">Tu texto es demasiado corto para calcular un porcentaje confiable; solo se buscan oraciones copiadas.</p>}
            {m.pairs.length ? m.pairs.map((pair, i) => <div key={i} className="agent-compare"><blockquote><span className="label">Tu texto</span>{pair.mine}</blockquote><blockquote><span className="label">Texto publicado · coincide el {Math.round(pair.ratio * 100)}% de tu oración</span>{pair.theirs}</blockquote></div>) : <p className="muted">El parecido está repartido en frases cortas; revisa el texto completo.</p>}
            <ExcludedNote excluded={m.excluded} />
            {check.acknowledged.includes(m.refKey) ? <span className="muted">Marcaste que reescribirás esta parte.</span> : <button type="button" className="secondary" disabled={action.pending} onClick={() => void action.run(() => source.acknowledgeAgentMatch({ checkId: check.id, refKey: m.refKey }))}>Reescribiré esta parte</button>}</li>)}</ul></>}</>}
    </>}
  </>;
}

function ExcludedNote({ excluded }: { excluded: AgentOriginalityMatch['excluded'] }) {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [excluded.codeLines && plural(excluded.codeLines, 'línea de código', 'líneas de código'), excluded.quotes && plural(excluded.quotes, 'cita entre comillas', 'citas entre comillas'), excluded.instructionGroups && 'el texto de la consigna'].filter(Boolean);
  return parts.length ? <p className="muted">No se contaron como parecido: {parts.join(', ')}.</p> : null;
}
