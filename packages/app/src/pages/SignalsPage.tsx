import { ShareToChatButton } from '../components/messaging/SharePostDialog';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { SignalCommand, SignalDefinition, SignalMedium, SignalsSnapshot, SignalDictionary, SignalVersion, SignalCard, SignalSession } from '../../../core/src/signals';
import { starterSignalDefinitions, encodeSignalMessage } from '../../../core/src/signals';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Snapshot } from '../data/types';
import { Empty } from '../components/Empty';
import { SubjectSelect } from '../components/SubjectSelect';
import './SignalsPage.css';

const media: Record<SignalMedium, string> = { pen: 'Lápiz o pluma', foot: 'Zapateadas', knuckle: 'Nudillos' };
const kinds = { reference: 'Referencia', answer: 'Respuesta', separator: 'Separador', repeat: 'Repetir', confirm: 'Confirmación', end: 'Final' };
const tabs = { diccionario: 'Diccionario', constructor: 'Constructor', practicar: 'Practicar', parejas: 'En pareja', fichas: 'Fichas' };
type Tab = keyof typeof tabs;
type CommandDraft = SignalCommand extends infer C ? C extends { requestId: string } ? Omit<C, 'requestId'> : never : never;
const date = (value: number) => new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
const name = (data: Snapshot, id: string) => id === data.me?.id ? 'Tú' : data.members.find((row) => row.id === id)?.displayName ?? 'Compañero';

function useSignalAction() {
  const source = useDataSource();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const busy = useRef(false);
  const request = useRef({ signature: '', id: '' });
  async function send(command: CommandDraft, success = 'Cambio guardado.') {
    if (busy.current) return { ok: false };
    busy.current = true; setPending(true); setNotice('');
    const signature = JSON.stringify(command);
    if (signature !== request.current.signature) request.current = { signature, id: crypto.randomUUID() };
    try {
      const id = await source.signalAction({ ...command, requestId: request.current.id } as SignalCommand);
      setError(''); setNotice(success); request.current = { signature: '', id: '' };
      return { ok: true, id };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar. Conservamos lo que escribiste.');
      return { ok: false };
    } finally { busy.current = false; setPending(false); }
  }
  const feedback = <>{error && <p className="error" role="alert">{error}</p>}{notice && <p className="signals-hint" role="status">{notice}</p>}</>;
  return { send, pending, feedback };
}

function MediumSelect({ value, onChange, allowed }: { value: SignalMedium; onChange: (value: SignalMedium) => void; allowed?: SignalMedium[] }) {
  return <label className="field">Medio<select value={value} onChange={(event) => onChange(event.target.value as SignalMedium)}>{Object.entries(media).filter(([id]) => !allowed || allowed.includes(id as SignalMedium)).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>;
}
function Panel({ title, children }: { title: string; children: ReactNode }) { return <section className="signals-panel"><h2>{title}</h2>{children}</section>; }
function Pattern({ tokens }: { tokens: readonly string[] }) {
  const symbols: Record<string, string> = { horizontal: '—', vertical: '│', 'diagonal-right': '╱', 'diagonal-left': '╲', tap: '●', pause: '·', golpe: '●', pausa: '·', long: '●—', short: '●', up: '↑', down: '↓' };
  return <span className="signals-sequence">{tokens.map((token, index) => token === '|' ? <span className="signals-separator" key={index} aria-label="separación">/</span> : <span key={index} className="signals-token">{symbols[token] && <span className="signals-token-symbol" aria-hidden="true">{symbols[token]}</span>}<span>{token}</span></span>)}</span>;
}
function Definitions({ definitions, medium }: { definitions: SignalDefinition[]; medium: SignalMedium }) {
  return <ul className="signals-signal-list">{definitions.filter((signal) => signal.medium === medium).map((signal) => <li key={signal.id}><div className="signals-signal-summary"><strong>{signal.label}</strong><span className="signals-meta">{kinds[signal.kind]}{(signal.kind === 'reference' || signal.kind === 'answer') && signal.value ? ` · ${signal.value}` : ''}</span></div><Pattern tokens={signal.pattern} />{signal.example && <p className="signals-hint">{signal.example}</p>}</li>)}</ul>;
}

export function SignalsPage() {
  const data = useSnapshot();
  if (data.connection !== 'ready' || !data.me || data.me.status !== 'active') return <Empty icon="lock" title="Conecta con el grupo para abrir Lenguaje de señales">Tus prácticas y fichas requieren una sesión activa.</Empty>;
  return <SignalsWorkspace key={data.me.id} data={data} signals={data.signals} />;
}
function SignalsWorkspace({ data, signals }: { data: Snapshot; signals: SignalsSnapshot }) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('pestana') ?? 'diccionario';
  const tab: Tab = requested in tabs ? requested as Tab : 'diccionario';
  const invites = signals.sessions.filter((row) => row.status === 'pending' && row.guestId === data.me!.id).length;
  return <div className="signals-page">
    <header className="signals-header"><div><p className="signals-eyebrow">Convenciones del grupo</p><h1>Lenguaje de señales</h1><p className="muted">Aprende una misma convención, construye mensajes y practica su interpretación con tus compañeros.</p></div></header>
    <p className="signals-private">Tus ejercicios, mensajes guardados y fichas son privados. En pareja solo compartes los turnos de esa sesión.</p>
    <nav className="signals-tabs" aria-label="Lenguaje de señales">{Object.entries(tabs).map(([id, title]) => <button type="button" key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => { const next = new URLSearchParams(params); next.set('pestana', id); setParams(next); }}>{title}{id === 'parejas' && invites > 0 ? ` (${invites})` : ''}</button>)}</nav>
    {tab === 'diccionario' && <DictionaryTab data={data} signals={signals} />}
    {tab === 'constructor' && <ConstructorTab signals={signals} />}
    {tab === 'practicar' && <PracticeTab signals={signals} />}
    {tab === 'parejas' && <PairsTab data={data} signals={signals} />}
    {tab === 'fichas' && <CardsTab data={data} signals={signals} />}
    <details className="signals-hint"><summary>Sobre esta función experimental</summary><p>Compartir respuestas o llevar anotaciones durante una evaluación puede incumplir sus reglas. Preparar una ficha no la convierte en material autorizado. Esta simulación en pantalla no detecta movimientos ni graba el salón.</p></details>
  </div>;
}

function DictionaryTab({ data, signals }: { data: Snapshot; signals: SignalsSnapshot }) {
  const action = useSignalAction();
  const [params, setParams] = useSearchParams();
  const requestedDictionary = params.get('diccionario') ?? '';
  const [subjectId, setSubject] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(requestedDictionary);
  useEffect(() => { setSelected(requestedDictionary); setVersionNumber(0); }, [requestedDictionary]);
  const select = (id: string) => { setSelected(id); setVersionNumber(0); const next = new URLSearchParams(params); next.set('diccionario', id); setParams(next); };
  const [creating, setCreating] = useState(false);
  const [medium, setMedium] = useState<SignalMedium>('pen');
  const [versionNumber, setVersionNumber] = useState(0);
  const rows = signals.dictionaries.filter((row) => (!subjectId || row.subjectId === subjectId) && `${row.title} ${row.topic}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const dictionary = signals.dictionaries.find((row) => row.id === selected);
  const versions = signals.versions.filter((row) => row.dictionaryId === selected).sort((a, b) => b.number - a.number);
  const version = versions.find((row) => row.number === versionNumber) ?? versions[0];
  const proposals = dictionary ? signals.dictionaries.filter((row) => row.proposalFor === dictionary.id && row.publishedVersion > 0 && !row.archived) : [];
  return <>
    <div className="signals-fields"><label className="field">Buscar diccionario<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label><SubjectSelect subjects={data.subjects} value={subjectId} onChange={setSubject} allowAll /><button type="button" onClick={() => setCreating(!creating)}>{creating ? 'Cerrar formulario' : 'Crear diccionario'}</button></div>
    {creating && <DictionaryCreate data={data} onCreated={(id) => { select(id); setCreating(false); }} />}
    <div className="signals-layout"><div className="signals-stack" aria-label="Diccionarios">{rows.map((row) => {
      const recommended = signals.recommendations.some((item) => item.dictionaryId === row.id);
      return <article key={row.id} className={`signals-card${selected === row.id ? ' is-selected' : ''}`}><span className="signals-meta">{data.subjects.find((subject) => subject.id === row.subjectId)?.name} · {row.topic}</span><h3>{row.title}</h3>{recommended && <span className="signals-badge">Convención recomendada</span>}<p className="signals-meta">{row.archived ? 'Archivado' : row.publishedVersion ? `Versión publicada ${row.publishedVersion}` : 'Borrador privado'} · {name(data, row.authorId)}</p><button type="button" className="secondary" onClick={() => select(row.id)}>Abrir diccionario</button></article>;
    })}{!rows.length && <p className="signals-empty">Todavía no hay diccionarios con estos filtros. Crea uno con las convenciones iniciales para empezar.</p>}</div>
    {requestedDictionary && !dictionary && <p className="signals-hint" role="status">El diccionario solicitado no está disponible para tu cuenta.</p>}
    {dictionary ? <div className="signals-stack"><Panel title={dictionary.title}>
      <p className="signals-meta">{dictionary.topic} · {name(data, dictionary.authorId)} · {date(dictionary.updatedAt)}</p>
      {dictionary.archived && <p className="signals-preview">Este diccionario conserva su historial. Restáuralo para iniciar nuevas prácticas.</p>}
      <div className="signals-fields"><MediumSelect value={medium} onChange={setMedium} />{versions.length > 0 && <label className="field">Versión publicada<select value={version?.number ?? ''} onChange={(event) => setVersionNumber(Number(event.target.value))}>{versions.map((row) => <option key={row.number} value={row.number}>Versión {row.number} · {date(row.createdAt)}</option>)}</select></label>}</div>
      {version ? <Definitions definitions={version.definitions} medium={medium} /> : <p className="signals-hint">El diccionario aún no tiene una versión publicada. Revisa su borrador antes de publicarlo.</p>}
      <div className="signals-actions">
        {dictionary.publishedVersion > 0 && !dictionary.archived && <ShareToChatButton target={{ kind: 'signal-dictionary', id: dictionary.id }} />}
        {dictionary.authorId === data.me!.id && <button type="button" className="secondary" disabled={action.pending} onClick={() => void action.send({ action: 'archiveDictionary', dictionaryId: dictionary.id, expectedVersion: dictionary.version, archived: !dictionary.archived }, dictionary.archived ? 'Diccionario restaurado.' : 'Diccionario archivado.')}>{dictionary.archived ? 'Restaurar diccionario' : 'Archivar diccionario'}</button>}
        {version && !dictionary.archived && dictionary.authorId !== data.me!.id && <button type="button" className="secondary" disabled={action.pending} onClick={async () => { const result = await action.send({ action: 'createDictionary', subjectId: dictionary.subjectId, topic: dictionary.topic, title: `Propuesta: ${dictionary.title}`.slice(0, 160), definitions: version.definitions, proposalFor: dictionary.id }, 'Propuesta creada. Edita y publica su versión para que el autor la revise.'); if (result.ok && result.id) select(result.id); }}>Proponer un cambio</button>}
        {data.me!.isCreator && dictionary.publishedVersion > 0 && !dictionary.archived && <button type="button" className="secondary" disabled={action.pending} onClick={() => void action.send({ action: 'recommendDictionary', dictionaryId: dictionary.id, expectedVersion: signals.recommendations.find((item) => item.subjectId === dictionary.subjectId && item.topic.toLocaleLowerCase('es') === versions.find((entry) => entry.number === dictionary.publishedVersion)?.topic.toLocaleLowerCase('es'))?.version ?? 0 }, 'Convención recomendada actualizada.')}>Recomendar al grupo</button>}
      </div>{action.feedback}
    </Panel>
    {dictionary.authorId === data.me!.id && !dictionary.archived && <DictionaryEditor key={dictionary.id} dictionary={dictionary} published={versions.find((row) => row.number === dictionary.publishedVersion)} />}
    {dictionary.authorId === data.me!.id && proposals.length > 0 && <Panel title="Propuestas para revisar">{proposals.map((proposal) => <article className="signals-card" key={proposal.id}><strong>{proposal.title}</strong><p className="signals-meta">{name(data, proposal.authorId)} · Versión {proposal.publishedVersion}</p><p className="signals-hint">Abre la propuesta para comparar sus convenciones antes de incorporarla como una nueva versión.</p><div className="signals-actions"><button type="button" className="secondary" onClick={() => select(proposal.id)}>Consultar propuesta</button><button type="button" disabled={action.pending} onClick={() => void action.send({ action: 'acceptProposal', dictionaryId: dictionary.id, proposalId: proposal.id, expectedVersion: dictionary.version, proposalVersion: proposal.version }, 'Propuesta incorporada en una nueva versión.')}>Aceptar propuesta</button></div></article>)}</Panel>}
    </div> : <Panel title="Una convención compartida"><p className="muted">Selecciona un diccionario para consultar sus tres medios, sus versiones y las propuestas del grupo.</p></Panel>}
    </div>
  </>;
}

function DictionaryCreate({ data, onCreated }: { data: Snapshot; onCreated: (id: string) => void }) {
  const action = useSignalAction();
  const [subjectId, setSubject] = useState(data.subjects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); const result = await action.send({ action: 'createDictionary', subjectId, topic, title, definitions: starterSignalDefinitions() }, 'Borrador creado con convenciones para los tres medios.'); if (result.ok && result.id) onCreated(result.id); }
  return <Panel title="Nuevo diccionario"><form className="signals-stack" onSubmit={submit}><div className="signals-fields"><SubjectSelect subjects={data.subjects} value={subjectId} onChange={setSubject} /><label className="field">Tema<input required maxLength={240} value={topic} onChange={(event) => setTopic(event.target.value)} /></label></div><label className="field">Nombre del diccionario<input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label><p className="signals-hint">Empieza con dígitos, respuestas A–D y los controles necesarios en los tres medios. El borrador solo lo ves tú hasta publicarlo.</p>{action.feedback}<button type="submit" disabled={action.pending || !subjectId}>Crear borrador</button></form></Panel>;
}

function DictionaryEditor({ dictionary, published }: { dictionary: SignalDictionary; published?: SignalVersion }) {
  const action = useSignalAction();
  const [title, setTitle] = useState(dictionary.title);
  const [topic, setTopic] = useState(dictionary.topic);
  const [definitions, setDefinitions] = useState(dictionary.draft);
  const [baseVersion, setBaseVersion] = useState(dictionary.version);
  const [medium, setMedium] = useState<SignalMedium>('pen');
  const dirty = title !== dictionary.title || topic !== dictionary.topic || JSON.stringify(definitions) !== JSON.stringify(dictionary.draft);
  const changes = definitions.filter((signal) => JSON.stringify(signal) !== JSON.stringify(published?.definitions.find((old) => old.id === signal.id))).length + (published?.definitions.filter((old) => !definitions.some((signal) => signal.id === old.id)).length ?? 0);
  function update(id: string, patch: Partial<SignalDefinition>) { setDefinitions((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row)); }
  function reload() { setTitle(dictionary.title); setTopic(dictionary.topic); setDefinitions(dictionary.draft); setBaseVersion(dictionary.version); }
  async function save(event: FormEvent) { event.preventDefault(); const result = await action.send({ action: 'saveDictionary', dictionaryId: dictionary.id, expectedVersion: baseVersion, title, topic, definitions }, 'Borrador guardado. Revisa las diferencias antes de publicar.'); if (result.ok) setBaseVersion(baseVersion + 1); }
  return <Panel title="Editar mi borrador"><form className="signals-stack" onSubmit={save}>
    <div className="signals-fields"><label className="field">Nombre<input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="field">Tema del borrador<input required maxLength={240} value={topic} onChange={(event) => setTopic(event.target.value)} /></label><MediumSelect value={medium} onChange={setMedium} /></div>
    <p className="signals-preview">{published ? `${changes} convenciones nuevas o modificadas respecto a la versión ${published.number}.` : 'Primera publicación: revisa las convenciones de los tres medios.'} Los mensajes y prácticas anteriores conservarán su versión.</p>
    {baseVersion !== dictionary.version && <p className="signals-hint">Hay otra versión guardada. Conservamos tus cambios. <button type="button" className="link-button" onClick={reload}>Cargar versión actual</button></p>}
    <ul className="signals-signal-list">{definitions.filter((signal) => signal.medium === medium).map((signal) => <li key={signal.id}><details><summary>{signal.label || 'Nueva señal'} · {kinds[signal.kind]}{signal.kind === 'reference' || signal.kind === 'answer' ? ` ${signal.value}` : ''}</summary><div className="signals-signal-editor"><label className="field">Nombre de la señal<input required value={signal.label} maxLength={160} onChange={(event) => update(signal.id, { label: event.target.value })} /></label><label className="field">Función<select value={signal.kind} onChange={(event) => update(signal.id, { kind: event.target.value as SignalDefinition['kind'] })}>{Object.entries(kinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>{signal.kind === 'reference' || signal.kind === 'answer' ? <label className="field">Valor o significado<input maxLength={500} value={signal.value} onChange={(event) => update(signal.id, { value: event.target.value })} /></label> : <div className="field"><span>Significado del control</span><p className="signals-hint">{kinds[signal.kind]}</p></div>}<label className="field">Secuencia, separada por espacios<input required value={signal.pattern.join(' ')} onChange={(event) => update(signal.id, { pattern: event.target.value.split(/\s+/).filter(Boolean) })} /></label><label className="field signals-wide">Ejemplo<textarea maxLength={2000} value={signal.example} onChange={(event) => update(signal.id, { example: event.target.value })} /></label><Pattern tokens={signal.pattern} /><button type="button" className="secondary" onClick={() => setDefinitions((rows) => rows.filter((row) => row.id !== signal.id))}>Quitar señal</button></div></details></li>)}</ul>
    <p className="signals-hint">Cada elemento es una posición o un evento. Las pausas también cuentan; dos señales no pueden usar la misma secuencia ni prefijos ambiguos.</p>
    <div className="signals-actions"><button type="button" className="secondary" onClick={() => setDefinitions((rows) => [...rows, { id: crypto.randomUUID(), label: 'Nueva señal', kind: 'answer', value: '', medium, pattern: [], example: '' }])}>Añadir señal</button><button type="submit" disabled={action.pending}>Guardar borrador</button><button type="button" disabled={action.pending || dirty || baseVersion !== dictionary.version} onClick={async () => { const result = await action.send({ action: 'publishDictionary', dictionaryId: dictionary.id, expectedVersion: baseVersion }, 'Nueva versión publicada para el grupo.'); if (result.ok) setBaseVersion(baseVersion + 1); }}>Publicar versión revisada</button></div>{action.feedback}
  </form></Panel>;
}

function useVersionChoice(signals: SignalsSnapshot) {
  const available = signals.dictionaries.filter((row) => row.publishedVersion > 0 && !row.archived);
  const recommended = available.find((row) => signals.recommendations.some((recommendation) => recommendation.dictionaryId === row.id));
  const [dictionaryId, setDictionaryId] = useState('');
  const [versionNumber, setVersionNumber] = useState(0);
  const [requestedMedium, setMedium] = useState<SignalMedium>('pen');
  const dictionary = available.find((row) => row.id === dictionaryId) ?? recommended ?? available[0];
  const versions = signals.versions.filter((row) => row.dictionaryId === dictionary?.id).sort((a, b) => b.number - a.number);
  const version = versions.find((row) => row.number === versionNumber) ?? versions[0];
  const allowed = (Object.keys(media) as SignalMedium[]).filter((item) => version?.definitions.some((definition) => definition.medium === item));
  const medium = allowed.includes(requestedMedium) ? requestedMedium : allowed[0] ?? 'pen';
  const controls = <div className="signals-fields"><label className="field">Diccionario<select value={dictionary?.id ?? ''} onChange={(event) => { setDictionaryId(event.target.value); setVersionNumber(0); }}>{!available.length && <option value="">No hay versiones publicadas</option>}{available.map((row) => <option key={row.id} value={row.id}>{row.title}{signals.recommendations.some((item) => item.dictionaryId === row.id) ? ' · Recomendado' : ''}</option>)}</select></label><label className="field">Versión<select value={version?.number ?? ''} onChange={(event) => setVersionNumber(Number(event.target.value))}>{!versions.length && <option value="">Sin versión</option>}{versions.map((row) => <option key={row.id} value={row.number}>Versión {row.number}</option>)}</select></label><MediumSelect value={medium} onChange={setMedium} allowed={allowed.length ? allowed : undefined} /></div>;
  return { dictionary, version, medium, controls };
}
function Sequence({ value }: { value: string[][] }) { return <div className="signals-display">{value.map((tokens, index) => <div key={index} className="signals-sequence"><span className="signals-meta">{index + 1}.</span><Pattern tokens={tokens} /></div>)}</div>; }
function NoPublishedDictionary() { return <p className="signals-empty">Publica un diccionario en el primer apartado para usar el constructor y las prácticas.</p>; }

function ConstructorTab({ signals }: { signals: SignalsSnapshot }) {
  const choice = useVersionChoice(signals);
  const action = useSignalAction();
  const [reference, setReference] = useState('1');
  const [answer, setAnswer] = useState('A');
  const [repeat, setRepeat] = useState(false);
  const answers = [...new Set(choice.version?.definitions.filter((signal) => signal.kind === 'answer' && signal.medium === choice.medium).map((signal) => signal.value) ?? [])];
  const selectedAnswer = answers.includes(answer) ? answer : answers[0] ?? '';
  let sequence: string[][] = []; let problem = '';
  if (choice.version) { try { sequence = encodeSignalMessage(choice.version.definitions, choice.medium, reference, selectedAnswer, repeat); } catch (cause) { problem = cause instanceof Error ? cause.message : 'El mensaje no se puede representar.'; } }
  async function submit(event: FormEvent) { event.preventDefault(); if (choice.dictionary && choice.version) await action.send({ action: 'saveMessage', dictionaryId: choice.dictionary.id, dictionaryVersion: choice.version.number, medium: choice.medium, reference, answer: selectedAnswer, repeat }, 'Mensaje guardado en tu archivo privado.'); }
  return <div className="signals-stack"><Panel title="Construye un mensaje"><p className="muted">Distingue la pregunta de la respuesta y termina con una confirmación. La vista previa no se guarda hasta que tú lo eliges.</p>{choice.controls}
    {choice.version ? <form className="signals-stack" onSubmit={submit}><div className="signals-fields"><label className="field">Referencia de la pregunta<input required inputMode="numeric" maxLength={3} value={reference} onChange={(event) => setReference(event.target.value)} /></label><label className="field">Respuesta<select value={selectedAnswer} onChange={(event) => setAnswer(event.target.value)}>{answers.map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div><label className="signals-check"><input type="checkbox" checked={repeat} onChange={(event) => setRepeat(event.target.checked)} /> Añadir solicitud de repetición</label>
    <p className="signals-preview">Pregunta {reference || '…'} → respuesta {selectedAnswer} → confirmación → final{repeat ? ' · con repetición' : ''}</p>{problem ? <p className="error" role="alert">{problem}</p> : <Sequence value={sequence} />}
    <div className="signals-actions"><button type="submit" disabled={action.pending || !!problem}>Guardar mensaje privado</button><button type="button" className="secondary" onClick={() => { setReference(''); setRepeat(false); }}>Limpiar mensaje</button></div>{action.feedback}</form> : <NoPublishedDictionary />}
  </Panel><Panel title="Mis mensajes guardados">{signals.messages.length ? <ul className="signals-history">{signals.messages.map((message) => <li key={message.id}><div className="signals-signal-summary"><strong>Pregunta {message.reference} → {message.answer}</strong><span className="signals-meta">{media[message.medium]} · Versión {message.dictionaryVersion} · {date(message.createdAt)}</span></div><details><summary>Consultar secuencia</summary><Sequence value={message.sequence} /></details><button type="button" className="link-button" disabled={action.pending} onClick={() => void action.send({ action: 'trash', kind: 'message', id: message.id, expectedVersion: message.version }, 'Mensaje enviado a la papelera.')}>Enviar a papelera</button></li>)}</ul> : <p className="signals-empty">Los mensajes que guardes aparecerán aquí. Solo tú puedes verlos.</p>}</Panel><SignalTrash signals={signals} kinds={['message']} /></div>;
}

function PracticeTab({ signals }: { signals: SignalsSnapshot }) {
  const choice = useVersionChoice(signals);
  const action = useSignalAction();
  const [mode, setMode] = useState<'recognize' | 'encode'>('recognize');
  const [selected, setSelected] = useState('');
  const active = signals.attempts.find((row) => row.id === selected) ?? signals.attempts.find((row) => row.status === 'pending');
  const finished = signals.attempts.filter((row) => row.status !== 'pending').sort((a, b) => b.createdAt - a.createdAt);
  const correct = finished.filter((row) => row.correct).length;
  async function start() { if (!choice.dictionary || !choice.version) return; const result = await action.send({ action: 'startAttempt', dictionaryId: choice.dictionary.id, dictionaryVersion: choice.version.number, medium: choice.medium, mode }, 'Ejercicio preparado.'); if (result.ok && result.id) setSelected(result.id); }
  return <div className="signals-stack"><Panel title="Practica a tu ritmo">{choice.controls}{choice.version ? <><div className="signals-fields"><label className="field">Tipo de ejercicio<select value={mode} onChange={(event) => setMode(event.target.value as 'recognize' | 'encode')}><option value="recognize">Reconocer una secuencia</option><option value="encode">Construir la secuencia inversa</option></select></label><button type="button" disabled={action.pending} onClick={() => void start()}>Empezar ejercicio</button></div><details><summary>Tarjetas para aprender las convenciones</summary><Definitions definitions={choice.version.definitions} medium={choice.medium} /></details>{action.feedback}</> : <NoPublishedDictionary />}</Panel>
    {active && <AttemptPane key={active.id} attempt={active} />}
    <Panel title="Mi historial"><p className="signals-hint">{finished.length} ejercicios terminados · {correct} interpretaciones acertadas · {finished.length - correct} para repasar. Estos resultados no son una calificación académica.</p>{finished.length ? <ul className="signals-history">{finished.map((attempt) => <li key={attempt.id}><div className="signals-signal-summary"><strong>{attempt.status === 'abandoned' ? 'Abandonado' : attempt.correct ? 'Interpretación acertada' : 'Confusión por repasar'}</strong><span className="signals-meta">{media[attempt.medium]} · Versión {attempt.dictionaryVersion} · {date(attempt.createdAt)}</span></div><p>Tu respuesta: {attempt.response || 'Sin respuesta'} · Convención: {attempt.expected}</p><div className="signals-actions"><button type="button" className="link-button" onClick={() => setSelected(attempt.id)}>Revisar ejercicio</button><button type="button" className="link-button" disabled={action.pending} onClick={() => void action.send({ action: 'trash', kind: 'attempt', id: attempt.id, expectedVersion: attempt.version }, 'Intento enviado a la papelera.')}>Enviar a papelera</button></div></li>)}</ul> : <p className="signals-empty">Termina un ejercicio para revisar los aciertos y las confusiones.</p>}</Panel><SignalTrash signals={signals} kinds={['attempt']} /></div>;
}

function AttemptPane({ attempt }: { attempt: SignalsSnapshot['attempts'][number] }) {
  const action = useSignalAction();
  const [answer, setAnswer] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); await action.send({ action: 'answerAttempt', attemptId: attempt.id, expectedVersion: attempt.version, answer }, 'Respuesta registrada.'); }
  return <Panel title={attempt.mode === 'recognize' ? '¿Qué mensaje representa?' : 'Elige la secuencia correspondiente'}><p className="signals-meta">{media[attempt.medium]} · Versión {attempt.dictionaryVersion}</p><p>{attempt.prompt}</p>{attempt.sequence.length > 0 && <Sequence value={attempt.sequence} />}{attempt.status === 'pending' ? <form className="signals-stack" onSubmit={submit}><fieldset><legend>Tu interpretación</legend><div className="signals-stack">{attempt.options.map((option, index) => <label className="signals-check" key={option}><input type="radio" name={`answer-${attempt.id}`} value={option} checked={answer === option} onChange={() => setAnswer(option)} /><span>{attempt.mode === 'encode' ? <><strong>Opción {index + 1}: </strong>{option}</> : option}</span></label>)}</div></fieldset><div className="signals-actions"><button type="submit" disabled={action.pending || !answer}>Comprobar interpretación</button><button type="button" className="secondary" disabled={action.pending} onClick={() => void action.send({ action: 'abandonAttempt', attemptId: attempt.id, expectedVersion: attempt.version }, 'Ejercicio cerrado. Puedes consultar la convención.')}>Abandonar y ver solución</button></div>{action.feedback}</form> : <div className={`signals-feedback${!attempt.correct ? ' is-wrong' : ''}`} role="status"><strong>{attempt.correct ? 'Interpretación acertada' : 'Una convención para repasar'}</strong><p>Respuesta esperada: {attempt.expected}</p><p className="signals-hint">La comprobación compara la interpretación con el diccionario. No verifica la respuesta académica transmitida.</p></div>}</Panel>;
}

const sessionLabels: Record<SignalSession['status'], string> = { pending: 'Invitación pendiente', accepted: 'Invitación aceptada', active: 'En curso', finished: 'Finalizada', rejected: 'Rechazada', cancelled: 'Cancelada', expired: 'Caducada' };
function PairsTab({ data, signals }: { data: Snapshot; signals: SignalsSnapshot }) {
  const choice = useVersionChoice(signals);
  const action = useSignalAction();
  const [guestId, setGuestId] = useState('');
  const [selected, setSelected] = useState('');
  const partners = data.members.filter((member) => member.status === 'active' && member.id !== data.me!.id);
  const session = signals.sessions.find((row) => row.id === selected);
  const invitations = signals.sessions.filter((row) => row.status === 'pending' && row.guestId === data.me!.id);
  async function invite(event: FormEvent) { event.preventDefault(); if (!choice.dictionary || !choice.version) return; const result = await action.send({ action: 'invitePartner', guestId, dictionaryId: choice.dictionary.id, dictionaryVersion: choice.version.number, medium: choice.medium }, 'Invitación creada. Tu compañero debe aceptarla antes de practicar.'); if (result.ok && result.id) setSelected(result.id); }
  return <div className="signals-stack">
    {invitations.length > 0 && <Panel title="Invitaciones recibidas">{invitations.map((row) => <article className="signals-card" key={row.id}><strong>{name(data, row.hostId)} te invita a practicar</strong><p>{signals.dictionaries.find((item) => item.id === row.dictionaryId)?.title ?? 'Diccionario'} · Versión {row.dictionaryVersion} · {media[row.medium]}</p><p className="signals-hint">Al aceptar compartirás únicamente las secuencias, respuestas y resultados de los turnos de esta sesión. Caduca el {date(row.expiresAt)}.</p><div className="signals-actions"><button type="button" disabled={action.pending} onClick={async () => { const result = await action.send({ action: 'respondInvitation', sessionId: row.id, expectedVersion: row.version, accept: true }, 'Invitación aceptada.'); if (result.ok) setSelected(row.id); }}>Aceptar invitación</button><button type="button" className="secondary" disabled={action.pending} onClick={() => void action.send({ action: 'respondInvitation', sessionId: row.id, expectedVersion: row.version, accept: false }, 'Invitación rechazada.')}>Rechazar invitación</button></div></article>)}{action.feedback}</Panel>}
    <Panel title="Organiza una práctica en pareja">{choice.controls}{choice.version ? <form onSubmit={invite} className="signals-stack"><label className="field">Compañero<select required value={guestId} onChange={(event) => setGuestId(event.target.value)}><option value="">Elige a un compañero</option>{partners.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label><p className="signals-hint">La pareja conserva la misma versión durante toda la sesión. No se enviarán mensajes en tu nombre ni se abrirá un chat.</p><button type="submit" disabled={action.pending || !guestId}>Invitar a practicar</button>{action.feedback}</form> : <NoPublishedDictionary />}</Panel>
    <div className="signals-layout"><Panel title="Mis sesiones"><ul className="signals-history">{signals.sessions.map((row) => <li key={row.id}><strong>{name(data, row.hostId === data.me!.id ? row.guestId : row.hostId)}</strong><p className="signals-meta">{sessionLabels[row.status]} · {media[row.medium]} · Versión {row.dictionaryVersion}</p><button type="button" className="secondary" onClick={() => setSelected(row.id)}>Abrir sesión</button></li>)}</ul>{!signals.sessions.length && <p className="signals-empty">Todavía no hay sesiones. Invita a un compañero para alternar emisor y receptor.</p>}</Panel>
      {session ? <SessionPane key={session.id} data={data} signals={signals} session={session} /> : <Panel title="Turnos compartidos"><p className="muted">Abre una sesión para continuar desde el último turno guardado.</p></Panel>}
    </div><SignalTrash signals={signals} kinds={['session']} />
  </div>;
}
function SessionPane({ data, signals, session }: { data: Snapshot; signals: SignalsSnapshot; session: SignalSession }) {
  const action = useSignalAction();
  const [reference, setReference] = useState('1');
  const [answer, setAnswer] = useState('A');
  const [response, setResponse] = useState('');
  const [repeat, setRepeat] = useState(false);
  const turns = signals.turns.filter((row) => row.sessionId === session.id).sort((a, b) => a.number - b.number);
  const pending = turns.find((turn) => turn.status === 'pending');
  const nextSender = session.turnNumber % 2 === 1 ? session.hostId : session.guestId;
  const version = signals.versions.find((row) => row.dictionaryId === session.dictionaryId && row.number === session.dictionaryVersion);
  const answers = [...new Set(version?.definitions.filter((signal) => signal.medium === session.medium && signal.kind === 'answer').map((signal) => signal.value) ?? [])];
  const selectedAnswer = answers.includes(answer) ? answer : answers[0] ?? '';
  const ended = ['finished', 'cancelled', 'rejected', 'expired'].includes(session.status);
  let preview: string[][] = []; let problem = '';
  if (version) try { preview = encodeSignalMessage(version.definitions, session.medium, reference, selectedAnswer, repeat); } catch (cause) { problem = cause instanceof Error ? cause.message : 'El mensaje está incompleto.'; }
  async function send(event: FormEvent) { event.preventDefault(); await action.send({ action: 'sendTurn', sessionId: session.id, expectedVersion: session.version, reference, answer: selectedAnswer, repeat }, 'Secuencia enviada a tu compañero.'); }
  async function receive(event: FormEvent) { event.preventDefault(); if (!pending) return; const result = await action.send({ action: 'answerTurn', turnId: pending.id, expectedVersion: pending.version, answer: response }, 'Interpretación registrada.'); if (result.ok) setResponse(''); }
  return <Panel title={`Sesión con ${name(data, session.hostId === data.me!.id ? session.guestId : session.hostId)}`}><p className="signals-meta">{sessionLabels[session.status]} · {media[session.medium]} · Versión {session.dictionaryVersion}</p>
    {session.status === 'pending' && <p>El invitado debe aceptar antes de abrir los turnos.</p>}
    {session.status === 'accepted' && <button type="button" disabled={action.pending} onClick={() => void action.send({ action: 'startSession', sessionId: session.id, expectedVersion: session.version }, 'Sesión iniciada.')}>Comenzar sesión</button>}
    {session.status === 'active' && <>
      {pending ? <div className="signals-stack"><h3>Turno {pending.number} · {pending.senderId === data.me!.id ? 'Eres emisor' : 'Eres receptor'}</h3><Sequence value={pending.sequence} />{pending.receiverId === data.me!.id ? <form className="signals-stack" onSubmit={receive}><label className="field">Mensaje interpretado<input required value={response} onChange={(event) => setResponse(event.target.value)} placeholder="Por ejemplo: 12 → A" maxLength={500} /></label><button type="submit" disabled={action.pending || !response.trim()}>Enviar interpretación</button></form> : <p className="signals-hint">Tu compañero está interpretando la secuencia. El objetivo se mostrará a ambos después de responder.</p>}</div> : nextSender === data.me!.id ? <form className="signals-stack" onSubmit={send}><h3>Tu turno de emitir</h3><div className="signals-fields"><label className="field">Referencia de la pregunta<input required inputMode="numeric" maxLength={3} value={reference} onChange={(event) => setReference(event.target.value)} /></label><label className="field">Respuesta<select value={selectedAnswer} onChange={(event) => setAnswer(event.target.value)}>{answers.map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div><label className="signals-check"><input type="checkbox" checked={repeat} onChange={(event) => setRepeat(event.target.checked)} /> Solicitar repetición</label>{problem ? <p className="error" role="alert">{problem}</p> : <Sequence value={preview} />}<button type="submit" disabled={action.pending || !!problem || !version}>Enviar secuencia</button></form> : <p className="signals-preview">Es el turno de emitir de {name(data, nextSender)}. La secuencia aparecerá aquí cuando la envíe.</p>}
      <button type="button" className="secondary" disabled={action.pending} onClick={() => void action.send({ action: 'endSession', sessionId: session.id, expectedVersion: session.version }, 'Sesión finalizada. Conservas los turnos compartidos.')}>Finalizar sesión</button>
    </>}
    {!ended && <button type="button" className="link-button" disabled={action.pending} onClick={() => void action.send({ action: 'cancelSession', sessionId: session.id, expectedVersion: session.version }, 'Sesión cancelada. No se admitirán nuevos turnos.')}>{session.status === 'pending' ? 'Cancelar invitación' : 'Salir y cancelar sesión'}</button>}
    {ended && <button type="button" className="secondary" disabled={action.pending} onClick={() => void action.send({ action: 'trash', kind: 'session', id: session.id, expectedVersion: session.version }, 'Sesión retirada de tu historial. El compañero conserva el suyo.')}>Retirar de mi historial</button>}
    {action.feedback}
    {turns.some((turn) => turn.status === 'answered') && <><h3>Turnos terminados</h3><ul className="signals-history">{turns.filter((turn) => turn.status === 'answered').map((turn) => <li key={turn.id}><strong>Turno {turn.number} · {turn.correct ? 'Interpretación acertada' : 'Revisar convención'}</strong><p>Objetivo: {turn.expected} · Interpretación: {turn.response}</p><p className="signals-meta">Emisor: {name(data, turn.senderId)} · Receptor: {name(data, turn.receiverId)}</p><details><summary>Ver secuencia</summary><Sequence value={turn.sequence} /></details></li>)}</ul></>}
  </Panel>;
}

type CardSourceOption = { key: string; kind: 'note' | 'work'; id: string; title: string; subjectId: string; version: number; href: string };
function cardSources(data: Snapshot): CardSourceOption[] {
  const notes = data.notes.filter((note) => !note.withdrawnAt).map((note) => ({ key: `note:${note.id}`, kind: 'note' as const, id: note.id, title: `Nota · ${note.title}`, subjectId: note.subjectId, version: note.version, href: `/m/notas/${note.id}` }));
  const works = data.works.filter((work) => !work.withdrawnAt).flatMap((work) => { const assignment = data.assignments.find((row) => row.id === work.assignmentId); return assignment ? [{ key: `work:${work.id}`, kind: 'work' as const, id: work.id, title: `Trabajo · ${work.title || assignment.title}`, subjectId: assignment.subjectId, version: work.version, href: `/m/tareas/${work.assignmentId}` }] : []; });
  return [...notes, ...works];
}
function CardsTab({ data, signals }: { data: Snapshot; signals: SignalsSnapshot }) {
  const action = useSignalAction();
  const [query, setQuery] = useState('');
  const [subjectId, setSubject] = useState('');
  const [selected, setSelected] = useState('');
  const [creating, setCreating] = useState(false);
  const card = signals.cards.find((row) => row.id === selected);
  const rows = signals.cards.filter((row) => (!subjectId || row.subjectId === subjectId) && `${row.topic} ${row.reference} ${row.body}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt);
  const sources = cardSources(data);
  return <div className="signals-stack"><div className="signals-fields"><label className="field">Buscar ficha<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label><SubjectSelect subjects={data.subjects} value={subjectId} onChange={setSubject} allowAll /><button type="button" onClick={() => { setSelected(''); setCreating(!creating); }}>{creating ? 'Cerrar formulario' : 'Crear ficha privada'}</button></div>
    {(creating || card) && <CardEditor key={card?.id ?? 'new'} data={data} card={card} onSaved={(id) => { setSelected(id); setCreating(false); }} />}
    <Panel title="Mis fichas de anotaciones">{rows.length ? <div className="signals-grid">{rows.map((row) => {
      const source = row.source && sources.find((item) => item.kind === row.source?.kind && item.id === row.source.id);
      const revisions = signals.cardRevisions.filter((revision) => revision.cardId === row.id).sort((a, b) => b.number - a.number);
      return <article className="signals-card" key={row.id}><span className="signals-meta">{data.subjects.find((item) => item.id === row.subjectId)?.name} · {row.topic}</span><h3>{row.reference}</h3><p>{row.body}</p>{row.conditions && <p className="signals-hint">Condiciones y contexto: {row.conditions}</p>}<p className="signals-meta">Soporte: {row.support} · Revisión {row.version} · {date(row.updatedAt)}</p>
      {row.sourceAvailable === false ? <p className="signals-hint">La fuente ya no está disponible. Tu anotación permanece privada.</p> : row.source ? <p className="signals-hint">{source ? <Link to={source.href}>{source.title} · Versión citada {row.source.version}{row.source.location ? ` · ${row.source.location}` : ''}</Link> : 'La fuente ya no está disponible. Tu anotación permanece privada.'}</p> : <p className="signals-hint">Anotación propia, sin fuente enlazada.</p>}
      <div className="signals-actions"><button type="button" className="secondary" onClick={() => { setSelected(row.id); setCreating(false); }}>Editar ficha</button><button type="button" className="link-button" disabled={action.pending} onClick={() => void action.send({ action: 'trash', kind: 'card', id: row.id, expectedVersion: row.version }, 'Ficha enviada a la papelera.')}>Enviar a papelera</button></div>
      {revisions.length > 0 && <details><summary>Historial de revisiones ({revisions.length})</summary><ul className="signals-history">{revisions.map((revision) => <li key={revision.id}><strong>Revisión {revision.number} · {date(revision.createdAt)}</strong><p>{revision.card.reference}</p><p>{revision.card.body}</p>{revision.card.conditions && <p className="signals-hint">{revision.card.conditions}</p>}{revision.card.sourceAvailable === false && <p className="signals-hint">La fuente de esta revisión ya no está disponible.</p>}<span className="signals-meta">Autor: {name(data, revision.authorId)}</span></li>)}</ul></details>}
      </article>;
    })}</div> : <p className="signals-empty">No hay fichas con estos filtros. Crea una anotación breve y conserva su procedencia.</p>}{action.feedback}</Panel><SignalTrash signals={signals} kinds={['card']} /></div>;
}
function CardEditor({ data, card, onSaved }: { data: Snapshot; card?: SignalCard; onSaved: (id: string) => void }) {
  const action = useSignalAction();
  const [subjectId, setSubject] = useState(card?.subjectId ?? data.subjects[0]?.id ?? '');
  const [topic, setTopic] = useState(card?.topic ?? '');
  const [reference, setReference] = useState(card?.reference ?? '');
  const [body, setBody] = useState(card?.body ?? '');
  const [conditions, setConditions] = useState(card?.conditions ?? '');
  const [support, setSupport] = useState(card?.support ?? 'Ficha de repaso');
  const [source, setSource] = useState(card?.source);
  const [baseVersion, setBaseVersion] = useState(card?.version ?? 0);
  const sources = cardSources(data).filter((row) => row.subjectId === subjectId);
  const sourceKey = source ? `${source.kind}:${source.id}` : '';
  const currentSource = sources.find((row) => row.key === sourceKey);
  function chooseSource(key: string) { const row = sources.find((item) => item.key === key); setSource(row ? { kind: row.kind, id: row.id, version: row.version, location: '' } : undefined); }
  async function submit(event: FormEvent) { event.preventDefault(); const result = await action.send({ action: 'saveCard', cardId: card?.id, expectedVersion: baseVersion, subjectId, topic, reference, body, conditions, support, source }, 'Ficha privada guardada con su revisión.'); if (result.ok && result.id) { setBaseVersion(baseVersion + 1); onSaved(result.id); } }
  function reload() { if (!card) return; setSubject(card.subjectId); setTopic(card.topic); setReference(card.reference); setBody(card.body); setConditions(card.conditions); setSupport(card.support); setSource(card.source); setBaseVersion(card.version); }
  return <Panel title={card ? 'Editar ficha privada' : 'Nueva ficha privada'}><form className="signals-stack" onSubmit={submit}><div className="signals-fields"><SubjectSelect subjects={data.subjects} value={subjectId} onChange={(value) => { setSubject(value); setSource(undefined); }} /><label className="field">Tema de la ficha<input required maxLength={240} value={topic} onChange={(event) => setTopic(event.target.value)} /></label></div>
    <label className="field">Pregunta o referencia<input required maxLength={500} value={reference} onChange={(event) => setReference(event.target.value)} /></label><label className="field">Anotación breve<textarea required maxLength={4000} rows={4} value={body} onChange={(event) => setBody(event.target.value)} /></label><label className="field">Condiciones, unidades o pasos importantes<textarea maxLength={2000} value={conditions} onChange={(event) => setConditions(event.target.value)} /></label><label className="field">Soporte previsto<input required maxLength={160} value={support} onChange={(event) => setSupport(event.target.value)} placeholder="Por ejemplo: ficha de repaso o borrador" /></label>
    <label className="field">Material de origen<select value={sourceKey} onChange={(event) => chooseSource(event.target.value)}><option value="">Anotación propia, sin fuente</option>{source && !currentSource && <option value={sourceKey}>Fuente anterior no disponible</option>}{sources.map((row) => <option key={row.key} value={row.key}>{row.title} · Versión {row.version}</option>)}</select></label>
    {source && <><label className="field">Ubicación en la fuente<input maxLength={500} value={source.location} onChange={(event) => setSource({ ...source, location: event.target.value })} placeholder="Página, sección o apartado" /></label><p className="signals-hint">Versión citada: {source.version}.{currentSource && currentSource.version !== source.version && <> La fuente tiene una versión nueva. <button type="button" className="link-button" onClick={() => setSource({ ...source, version: currentSource.version })}>Usar versión {currentSource.version}</button></>}</p></>}
    {card && baseVersion !== card.version && <p className="signals-hint">La ficha cambió en otra sesión. Tus cambios siguen aquí. <button type="button" className="link-button" onClick={reload}>Cargar revisión actual</button></p>}
    <p className="signals-hint">La ficha será privada. Se guarda la referencia del material, sin copiar sus archivos ni conceder permisos sobre él.</p>{action.feedback}<button type="submit" disabled={action.pending || !subjectId}>Guardar ficha</button>
  </form></Panel>;
}
function SignalTrash({ signals, kinds: allowed }: { signals: SignalsSnapshot; kinds: SignalsSnapshot['trash'][number]['kind'][] }) {
  const action = useSignalAction();
  const rows = signals.trash.filter((row) => allowed.includes(row.kind));
  if (!rows.length) return null;
  return <section className="signals-panel"><details><summary>Papelera ({rows.length}) · Recuperable durante 30 días</summary><ul className="signals-history">{rows.map((row) => <li key={`${row.kind}:${row.id}`}><strong>{row.title}</strong><p className="signals-meta">Retirado el {date(row.deletedAt)}</p><button type="button" className="secondary" disabled={action.pending} onClick={() => void action.send({ action: 'restore', kind: row.kind, id: row.id, expectedVersion: row.version }, 'Contenido restaurado.')}>Restaurar</button></li>)}</ul>{action.feedback}</details></section>;
}
