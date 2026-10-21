import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { agentOwnerName, renderAgentPremises } from '@b20/core';
import { useSnapshot } from '../data/DataContext';
import { agentStyleCandidates, agentOriginality, simulateHelp, simulateReview, simulateStyleProfile, type AgentOriginalityMatch, type AgentStyleProfile, type AgentSuggestion } from '../data/agentDemo';
import { Avatar } from '../components/Avatar';
import { agentNameFor } from '../components/AgentHelpLink';
import '../components/ai.css';
import './agent.css';

type Tab = 'train' | 'profile' | 'help';
type Stage = 'understand' | 'approach' | 'outline' | 'review';
const TABS: [Tab, string][] = [['train', 'Entrenar estilo'], ['profile', 'Perfil de estilo'], ['help', 'Ayudar con una tarea']];
const STAGES: [Stage, string][] = [['understand', 'Entender consigna'], ['approach', 'Enfoque'], ['outline', 'Esquema'], ['review', 'Revisar mi borrador']];
const KIND_LABEL = { work: 'Trabajo', evidence: 'Evidencia', note: 'Nota' } as const;

export function AgentPage() { const data = useSnapshot(); return <AgentWorkspace key={data.me?.id} />; }

function AgentWorkspace() {
  const data = useSnapshot(); const [params, setParams] = useSearchParams(); const bot = agentNameFor(data)!;
  const owner = agentOwnerName(data.me?.displayName ?? ''); const premises = renderAgentPremises(owner, bot);
  const candidates = useMemo(() => agentStyleCandidates(data), [data]);
  const [selected, setSelected] = useState<string[]>(() => candidates.filter((c) => !c.coauthored).map((c) => c.key));
  const [consent, setConsent] = useState(false); const [profile, setProfile] = useState<AgentStyleProfile>();
  const tab = (params.get('pestana') as Tab | null) ?? (params.get('tarea') ? 'help' : 'train');
  const outdated = !!profile && (profile.sourceKeys.join() !== selected.join() || candidates.some((c) => profile.sourceKeys.includes(c.key) && c.updatedAt > profile.trainedAt));
  const state = !profile ? 'Sin entrenar' : outdated ? 'Desactualizado' : 'Listo';
  const go = (next: Tab) => setParams((current) => { const copy = new URLSearchParams(current); copy.set('pestana', next); return copy; });
  const train = () => { setProfile(simulateStyleProfile(candidates.filter((c) => selected.includes(c.key)))); go('profile'); };

  return <>
    <header className="page-header agent-header"><Avatar member={data.me} size={48} /><div><p className="eyebrow">Mi agente · 7.13</p><h1>{bot}</h1><p>Te ayuda a hacer la tarea con tu propia voz. Escribe contigo, no en tu lugar.</p></div>
      <div className="badges"><span className={`badge ${state === 'Listo' ? 'badge--resolved' : 'badge--open'}`}>{state}</span><span className="badge badge--ai">Simulación sin Gemini</span></div></header>
    <p className="ai-notice">En esta versión (AG-1) las respuestas de {bot} son simuladas en tu navegador: no se llama a Gemini, no se usa tu clave y nada se guarda en el servidor.</p>

    <section className="panel agent-premises" id="premisas" aria-labelledby="premisas-titulo"><h2 id="premisas-titulo">Premisas de {bot}</h2><p className="muted">Texto literal, versión {premises.version}. Es el mismo que recibirá Gemini como instrucción.</p>
      <div className="agent-premises__cols"><div><h3>Lo que hace {bot}</h3><ol>{premises.does.map((p) => <li key={p.number} value={p.number}>{p.text}</li>)}</ol></div>
        <div><h3>Lo que no hace {bot}</h3><ol>{premises.doesNot.map((p) => <li key={p.number} value={p.number}>{p.text}</li>)}</ol></div></div></section>

    <div className="chips agent-tabs" role="tablist">{TABS.map(([id, label]) => <button key={id} type="button" role="tab" className="chip" aria-selected={tab === id} aria-pressed={tab === id} onClick={() => go(id)}>{label}</button>)}</div>

    {tab === 'train' && <section className="panel agent-panel"><h2>Entrenar estilo</h2><p>Elige tus textos para que {bot} aprenda cómo escribes. Solo aparecen trabajos, evidencias y notas propias; los coautorados no se incluyen solos.</p>
      {!candidates.length ? <p className="placeholder">Todavía no tienes textos propios publicados. Sube un trabajo o una evidencia en <Link to="/m/tareas">Tareas y Actividades</Link>.</p>
        : <ul className="agent-sources">{candidates.map((c) => <li key={c.key}><label className="check"><input type="checkbox" checked={selected.includes(c.key)} onChange={(e) => setSelected((keys) => e.target.checked ? candidates.map((x) => x.key).filter((k) => k === c.key || keys.includes(k)) : keys.filter((k) => k !== c.key))} /><span><strong>{c.title}</strong> <span className="muted">· {KIND_LABEL[c.kind]}{c.coauthored ? ' · Coautorado: incluir manualmente' : ''}</span><span className="agent-sources__excerpt">{c.text.slice(0, 140)}{c.text.length > 140 ? '…' : ''}</span></span></label></li>)}</ul>}
      <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />Leí las premisas y acepto que {bot} use estos textos míos para aprender mi estilo.</label>
      <button type="button" disabled={!consent || !selected.length} onClick={train}>Entrenar a {bot}</button></section>}

    {tab === 'profile' && <section className="panel agent-panel"><h2>Perfil de estilo</h2>
      {!profile ? <p className="placeholder">{bot} todavía no conoce tu estilo. <button type="button" className="link-button" onClick={() => go('train')}>Entrenar estilo</button></p> : <>
        {outdated && <p className="ai-notice">Cambiaste las fuentes o un texto desde el último entrenamiento. Vuelve a entrenar para actualizar el perfil.</p>}
        <p className="muted">Aprendido de {profile.sourceKeys.length} textos ({profile.words} palabras) · {profile.trainedAt.toLocaleString('es-MX')}</p>
        <ul className="cards agent-traits"><li className="card"><strong>Tono</strong><span>{profile.tone}</span></li><li className="card"><strong>Largo de frase</strong><span>Unas {profile.sentenceLength} palabras</span></li><li className="card"><strong>Estructura</strong><span>{profile.structure}</span></li><li className="card"><strong>Nivel técnico</strong><span>{profile.technical}</span></li></ul>
        {!!profile.vocabulary.length && <><h3>Vocabulario frecuente</h3><div className="chips chips--small">{profile.vocabulary.map((w) => <span key={w} className="chip">{w}</span>)}</div></>}
        {!!profile.examples.length && <><h3>Así escribes</h3>{profile.examples.map((e, i) => <blockquote key={i}>{e}</blockquote>)}</>}
      </>}</section>}

    {tab === 'help' && <AgentHelp bot={bot} profile={outdated ? undefined : profile} />}
    <p><a href="#premisas">Volver a las premisas de {bot}</a></p>
  </>;
}

function AgentHelp({ bot, profile }: { bot: string; profile: AgentStyleProfile | undefined }) {
  const data = useSnapshot(); const [params, setParams] = useSearchParams();
  const assignments = data.assignments; const assignment = assignments.find((a) => a.id === params.get('tarea'));
  const [stage, setStage] = useState<Stage>('understand'); const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState<AgentSuggestion[]>(); const [matches, setMatches] = useState<AgentOriginalityMatch[]>(); const [own, setOwn] = useState<string[]>([]);
  const pick = (id: string) => { setParams((current) => { const copy = new URLSearchParams(current); if (id) copy.set('tarea', id); else copy.delete('tarea'); copy.set('pestana', 'help'); return copy; }); setStage('understand'); setDraft(''); setSuggestions(undefined); setMatches(undefined); setOwn([]); };
  const resolve = (s: AgentSuggestion, accept: boolean) => { if (accept && s.original) setDraft((text) => text.replace(s.original, s.replacement)); setSuggestions((list) => list?.map((x) => x.id === s.id ? { ...x, state: accept ? 'accepted' : 'rejected' } : x)); setMatches(undefined); };
  const edit = (text: string) => { setDraft(text); setMatches(undefined); };

  return <section className="panel agent-panel"><h2>Ayudar con una tarea</h2>
    <label className="field"><span>Tarea o actividad</span><select value={assignment?.id ?? ''} onChange={(e) => pick(e.target.value)}><option value="">Elige una tarea</option>{assignments.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label>
    {!profile && <p className="ai-notice">{bot} no tiene un perfil de estilo vigente: sus pistas serán genéricas hasta que lo entrenes.</p>}
    {!assignment ? <p className="placeholder">Elige una tarea para que {bot} te ayude paso a paso.</p> : <>
      <p><Link to={`/m/tareas/${assignment.id}`}>Abrir consigna: {assignment.title}</Link></p>
      <div className="chips" role="tablist" aria-label="Etapas">{STAGES.map(([id, label]) => <button key={id} type="button" role="tab" className="chip" aria-selected={stage === id} aria-pressed={stage === id} onClick={() => setStage(id)}>{label}</button>)}</div>
      {stage !== 'review' ? <div className="agent-output"><p className="badges"><span className="badge badge--personal">Borrador privado</span><span className="badge badge--ai">Generado con {bot}</span></p><ul>{simulateHelp(stage, assignment, profile).map((line, i) => <li key={i}>{line}</li>)}</ul><p className="muted">Fuente: consigna «{assignment.title}», versión {assignment.version}.</p></div> : <>
        <label className="field"><span>Mi borrador</span><textarea rows={10} value={draft} onChange={(e) => edit(e.target.value)} placeholder={`Escribe aquí tu respuesta. ${bot} la revisa, no la escribe por ti.`} /></label>
        <div className="agent-actions"><button type="button" disabled={!draft.trim()} onClick={() => setSuggestions(simulateReview(draft, profile))}>Pedir sugerencias a {bot}</button><button type="button" className="secondary" disabled={!draft.trim()} onClick={() => { setMatches(agentOriginality(draft, data, assignment)); setOwn([]); }}>Comparar con el grupo</button></div>
        {suggestions && <><h3>Sugerencias de {bot}</h3>{!suggestions.length ? <p className="muted">Sin sugerencias: tu borrador ya se lee como tú.</p> : <ul className="agent-suggestions">{suggestions.map((s) => <li key={s.id} data-state={s.state}><p>{s.reason}</p>{s.original && <p className="agent-diff"><del>{s.original}</del> <ins>{s.replacement}</ins></p>}
          {s.state === 'proposed' ? s.original ? <div className="agent-actions"><button type="button" className="secondary" onClick={() => resolve(s, true)}>Aceptar</button><button type="button" className="secondary" onClick={() => resolve(s, false)}>Rechazar</button></div> : <button type="button" className="secondary" onClick={() => resolve(s, false)}>Entendido</button> : <span className="muted">{s.state === 'accepted' ? 'Aceptada' : 'Descartada'}</span>}</li>)}</ul>}</>}
        {matches && <><h3>Alerta de originalidad</h3>{!matches.length ? <p className="muted">Tu borrador no se parece a lo que el grupo ya publicó.</p> : <><p className="ai-notice">Tu texto se parece a trabajos publicados. {bot} no lo reescribe por ti: revisa cada parte y escríbela con tus propias ideas.</p>
          <ul className="agent-matches">{matches.map((m) => <li key={m.refKey} data-level={m.level}><p><strong>{m.status === 'too_short' ? 'Oración copiada' : `${m.score}% parecido${m.level === 'block' ? ' (alto)' : ''}`}</strong> con «{m.title}» de {m.authorName}</p>
            {m.status === 'too_short' && <p className="muted">Tu texto es demasiado corto para calcular un porcentaje confiable; solo se buscan oraciones copiadas.</p>}
            {m.pairs.length ? m.pairs.map((pair, i) => <div key={i} className="agent-compare"><blockquote><span className="label">Tu texto</span>{pair.mine}</blockquote><blockquote><span className="label">Texto publicado · coincide el {Math.round(pair.ratio * 100)}% de tu oración</span>{pair.theirs}</blockquote></div>) : <p className="muted">El parecido está repartido en frases cortas; revisa el texto completo.</p>}
            <ExcludedNote excluded={m.excluded} />
            {own.includes(m.refKey) ? <span className="muted">Marcaste que reescribirás esta parte.</span> : <button type="button" className="secondary" onClick={() => setOwn((keys) => [...keys, m.refKey])}>Reescribiré esta parte</button>}</li>)}</ul></>}</>}
      </>}
      <div className="agent-actions"><button type="button" disabled title="El plug-in para subir tareas está pendiente (AG-5).">Subir tarea (plug-in, pendiente)</button></div>
    </>}
  </section>;
}

function ExcludedNote({ excluded }: { excluded: AgentOriginalityMatch['excluded'] }) {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [excluded.codeLines && plural(excluded.codeLines, 'línea de código', 'líneas de código'), excluded.quotes && plural(excluded.quotes, 'cita entre comillas', 'citas entre comillas'), excluded.instructionGroups && 'el texto de la consigna'].filter(Boolean);
  return parts.length ? <p className="muted">No se contaron como parecido: {parts.join(', ')}.</p> : null;
}
