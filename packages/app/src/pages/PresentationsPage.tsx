import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  emptyPresentationObservations, PRESENTATION_LIMITS, PRESENTATION_RUBRIC,
  presentationTextEstimate, type PresentationObservations,
} from '@b20/core';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { RichText } from '../components/RichText';
import { SubjectSelect } from '../components/SubjectSelect';
import { useAction } from '../components/useAction';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { DataSource, Snapshot } from '../data/types';
import type { PresentationAttempt, PresentationFeedback, PresentationPractice, PresentationQuestion } from '../data/presentationTypes';
import { formatTime, memberName } from '../lib/format';
import { matches } from '../lib/search';

const BASE = '/m/exposiciones';
const path = (id: string) => `${BASE}/${id}`;
const attemptPath = (practiceId: string, attemptId: string) => `${path(practiceId)}/intentos/${attemptId}`;
const requestId = () => crypto.randomUUID();

interface AttemptDraft {
  memberId: string; attemptId: string; body: string; observations: PresentationObservations;
  nextSteps: string; version: number; dirty: boolean; error?: string; stopNavigationWatch?: () => void;
}
// Solo memoria de esta fuente/cuenta: sobrevive a una reconexión, nunca se escribe en storage.
const attemptDrafts = new WeakMap<DataSource, AttemptDraft>();
function watchDraftNavigation(sourceRef: WeakRef<DataSource>, draftRef: WeakRef<AttemptDraft>, hash: string) {
  const onNavigate = () => {
    if (window.location.hash === hash) return;
    const source = sourceRef.deref(); const draft = draftRef.deref();
    if (source && draft && attemptDrafts.get(source) === draft) attemptDrafts.delete(source);
    window.removeEventListener('hashchange', onNavigate);
  };
  window.addEventListener('hashchange', onNavigate);
  return () => window.removeEventListener('hashchange', onNavigate);
}

function NotAvailable() {
  return <Empty icon="lock" title="Esta exposición no está disponible" action={<Link className="button" to={BASE}>Ver exposiciones</Link>}>
    Solo su autor y el revisor invitado pueden abrirla. Los borradores son exclusivos del autor.
  </Empty>;
}

function TermSelect({ data, subjectId, value, onChange, all = false }: {
  data: Snapshot; subjectId: string; value: string; onChange: (value: string) => void; all?: boolean;
}) {
  return <label className="field">Parcial <span className="field__optional">opcional</span><select value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">{all ? 'Todos' : 'Sin parcial'}</option>
    {data.terms.filter((term) => !subjectId || term.subjectId === subjectId).map((term) => <option value={term.id} key={term.id}>{term.name}</option>)}
  </select></label>;
}

export function PresentationsPage() {
  const data = useSnapshot();
  const [params, setParams] = useSearchParams();
  const reviewing = params.get('pestana') === 'revisar';
  const archived = params.get('archivadas') === 'si';
  const subjectId = params.get('materia') ?? '';
  const termId = params.get('parcial') ?? '';
  const query = params.get('buscar') ?? '';
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key === 'materia') next.delete('parcial');
    setParams(next, { replace: true });
  };
  const mine = data.presentationPractices.filter((practice) => practice.ownerId === data.me?.id);
  const invited = data.presentationPractices.filter((practice) => practice.reviewerId === data.me?.id && practice.ownerId !== data.me?.id);
  const shown = (reviewing ? invited : mine).filter((practice) => practice.archived === archived)
    .filter((practice) => (!subjectId || practice.subjectId === subjectId) && (!termId || practice.termId === termId))
    .filter((practice) => matches(query, practice.title, practice.topic))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return <>
    <header className="page-header"><div><h1>Simulador de exposiciones</h1><p className="muted">Ensaya por escrito, responde preguntas y compara tus intentos.</p></div>
      <Link to={`${BASE}/nueva`} className="button with-icon"><Icon name="plus" size={18} /> Nueva exposición</Link></header>
    <p className="teaching-privacy with-icon"><Icon name="lock" size={16} /> Tus borradores y observaciones son privados. Tú eliges a quién invitar.</p>
    <div className="segmented teaching-tabs" role="group" aria-label="Exposiciones">
      <button type="button" aria-pressed={!reviewing} onClick={() => update('pestana', '')}>Mis prácticas <span className="chip__count">{mine.length}</span></button>
      <button type="button" aria-pressed={reviewing} onClick={() => update('pestana', 'revisar')}>Revisiones invitadas <span className="chip__count">{invited.length}</span></button>
    </div>
    <div className="row teaching-filters presentation-filters">
      <label className="field grow">Buscar por tema o título<input type="search" value={query} onChange={(e) => update('buscar', e.target.value)} /></label>
      <SubjectSelect subjects={data.subjects} value={subjectId} onChange={(value) => update('materia', value)} allowAll />
      <TermSelect data={data} subjectId={subjectId} value={termId} onChange={(value) => update('parcial', value)} all />
    </div>
    <label className="presentation-toggle"><input type="checkbox" checked={archived} onChange={(e) => update('archivadas', e.target.checked ? 'si' : '')} /> Ver archivadas</label>
    {shown.length ? <ul className="work-grid teaching-list">{shown.map((practice) => {
      const attempts = data.presentationAttempts.filter((attempt) => attempt.practiceId === practice.id && (!reviewing || attempt.status === 'completed'));
      return <li key={practice.id}><Link to={path(practice.id)} className="work-card">
        <span className="work-card__context">{data.subjects.find((subject) => subject.id === practice.subjectId)?.name}{practice.termId && ` · ${data.terms.find((term) => term.id === practice.termId)?.name ?? ''}`}</span>
        <strong className="work-card__title">{practice.title}</strong><span>{practice.topic}</span>
        <span className="badges"><span className="badge">{practice.targetMinutes} min objetivo</span><span className="badge">{attempts.length} {attempts.length === 1 ? 'intento' : 'intentos'}</span>{practice.archived && <span className="badge">Archivada</span>}</span>
        <span className="muted">{reviewing ? `De ${memberName(data.members, practice.ownerId)}` : practice.reviewerId ? `Revisor: ${memberName(data.members, practice.reviewerId)}` : 'Práctica personal'}</span>
        <span className="work-card__footer"><span className="work-card__date">{formatTime(practice.updatedAt)}</span></span>
      </Link></li>;
    })}</ul> : <Empty icon={query || subjectId || termId ? 'search' : 'folder'} title={query || subjectId || termId ? 'No hay exposiciones con estos filtros' : archived ? 'No tienes exposiciones archivadas' : reviewing ? 'No tienes revisiones invitadas' : 'Prepara tu primera exposición'}>
      {reviewing ? 'Aparecerán aquí los intentos concluidos de las prácticas a las que te inviten.' : 'Elige un tema, escribe un ensayo y mejora con cada intento.'}
    </Empty>}
  </>;
}

export function PresentationFormPage() {
  const data = useSnapshot();
  const { practiceId } = useParams();
  const [params] = useSearchParams();
  const practice = practiceId ? data.presentationPractices.find((item) => item.id === practiceId && item.ownerId === data.me?.id) : undefined;
  if (practiceId && (!practice || practice.archived)) return <NotAvailable />;
  const sourceKey = params.get('nota') ? `note:${params.get('nota')}` : params.get('guia') ? `guide:${params.get('guia')}` : '';
  return <ConfigurationForm key={`${data.me?.id}:${practiceId ?? sourceKey}`} practice={practice} data={data} sourceKey={sourceKey} />;
}

function ConfigurationForm({ practice, data, sourceKey }: { practice?: PresentationPractice; data: Snapshot; sourceKey: string }) {
  const source = useDataSource();
  const navigate = useNavigate();
  const initialSource = practice?.sourceKind && practice.sourceId ? `${practice.sourceKind}:${practice.sourceId}` : sourceKey;
  const note = initialSource.startsWith('note:') ? data.notes.find((item) => `note:${item.id}` === initialSource) : undefined;
  const guide = initialSource.startsWith('guide:') ? data.guides.find((item) => `guide:${item.id}` === initialSource) : undefined;
  const [subjectId, setSubjectId] = useState(practice?.subjectId ?? note?.subjectId ?? guide?.subjectId ?? data.subjects[0]?.id ?? '');
  const [termId, setTermId] = useState(practice?.termId ?? guide?.termId ?? '');
  const [title, setTitle] = useState(practice?.title ?? note?.title ?? guide?.title ?? '');
  const [topic, setTopic] = useState(practice?.topic ?? note?.topic ?? note?.title ?? guide?.title ?? '');
  const [audience, setAudience] = useState(practice?.audience ?? '');
  const [minutes, setMinutes] = useState(String(practice?.targetMinutes ?? 5));
  const [points, setPoints] = useState(practice?.keyPoints.join('\n') ?? '');
  const [selectedSource, setSelectedSource] = useState(initialSource);
  const [version] = useState(practice?.version);
  const [token] = useState(requestId);
  const { error, pending, run } = useAction();
  const busy = useRef(false);
  const notes = data.notes.filter((item) => item.subjectId === subjectId && (item.visibility === 'group' || item.authorId === data.me?.id));
  const guides = data.guides.filter((item) => item.subjectId === subjectId);
  const accessible = !selectedSource || notes.some((item) => `note:${item.id}` === selectedSource) || guides.some((item) => `guide:${item.id}` === selectedSource);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || !accessible) return;
    busy.current = true;
    const separator = selectedSource.indexOf(':');
    const id = await run(() => source.savePresentationPractice({ id: practice?.id, subjectId, termId: termId || undefined,
      title, topic, audience, targetMinutes: Number(minutes), keyPoints: points.split('\n').map((value) => value.trim()).filter(Boolean),
      source: selectedSource ? { kind: selectedSource.slice(0, separator) as 'note' | 'guide', id: selectedSource.slice(separator + 1) } : undefined,
      expectedVersion: version, requestId: token }));
    busy.current = false;
    if (id) void navigate(path(id));
  };
  return <>
    <Link to={practice ? path(practice.id) : BASE} className="back">← Exposiciones</Link>
    <header className="page-header"><div><h1>{practice ? 'Configurar exposición' : 'Nueva exposición'}</h1><p className="muted">{practice ? 'Los cambios se aplicarán al siguiente intento. El historial conserva su configuración original.' : 'Prepara el contexto; después podrás escribir tu primer intento.'}</p></div></header>
    {!data.subjects.length ? <Empty icon="folder" title="Primero necesitas una materia">Agrega una materia desde Tareas y Actividades.</Empty> : <form className="form form--wide panel" onSubmit={submit} aria-busy={pending}>
      <fieldset className="teaching-fields" disabled={pending}>
        <div className="form__grid"><SubjectSelect subjects={data.subjects} value={subjectId} onChange={(value) => { setSubjectId(value); setTermId(''); setSelectedSource(''); }} />
          <TermSelect data={data} subjectId={subjectId} value={termId} onChange={setTermId} /></div>
        <label className="field">Título<input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={PRESENTATION_LIMITS.title} /></label>
        <label className="field">Tema<input value={topic} onChange={(e) => setTopic(e.target.value)} required maxLength={PRESENTATION_LIMITS.topic} /></label>
        <div className="form__grid"><label className="field">Público<input value={audience} onChange={(e) => setAudience(e.target.value)} required maxLength={PRESENTATION_LIMITS.audience} placeholder="Compañeros que empiezan a conocer el tema" /></label>
          <label className="field">Duración objetivo (minutos)<input type="number" min="1" max={PRESENTATION_LIMITS.maxMinutes} step="1" value={minutes} onChange={(e) => setMinutes(e.target.value)} required /></label></div>
        <label className="field">Puntos a cubrir<textarea rows={4} value={points} onChange={(e) => setPoints(e.target.value)} required maxLength={PRESENTATION_LIMITS.keyPoints * (PRESENTATION_LIMITS.keyPoint + 1)} />
          <span className="field__hint">Un punto por línea; hasta 12, de 300 caracteres cada uno.</span></label>
        <label className="field">Nota o guía de referencia <span className="field__optional">opcional</span><select value={selectedSource} onChange={(e) => setSelectedSource(e.target.value)}>
          <option value="">Sin fuente</option>{!accessible && <option value={selectedSource}>Fuente no disponible</option>}
          {notes.length > 0 && <optgroup label="Notas de clase">{notes.map((item) => <option value={`note:${item.id}`} key={item.id}>{item.title}{item.visibility === 'personal' ? ' · Personal' : ''}</option>)}</optgroup>}
          {guides.length > 0 && <optgroup label="Guías de estudio">{guides.map((item) => <option value={`guide:${item.id}`} key={item.id}>{item.title}</option>)}</optgroup>}
        </select><span className="field__hint">Se conserva la versión de referencia. Su contenido no se copia al ensayo ni se publica.</span></label>
      </fieldset>
      {!accessible && <p className="error" role="alert">Ya no puedes usar esta fuente. Elige otra o continúa sin referencia.</p>}
      {practice && practice.version !== version && <p className="error" role="alert">La configuración cambió en otra pestaña. Conservamos lo que escribiste; vuelve al detalle para cargar la versión actual antes de guardar.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form__actions"><Link className="button secondary" to={practice ? path(practice.id) : BASE}>Cancelar</Link><button type="submit" disabled={pending || !accessible || !title.trim() || !topic.trim() || !audience.trim() || !points.trim()}>{pending ? 'Guardando…' : 'Guardar exposición'}</button></div>
    </form>}
  </>;
}

function SourceReference({ value, data }: { value: Pick<PresentationPractice, 'sourceKind' | 'sourceId' | 'sourceVersion' | 'subjectId'>; data: Snapshot }) {
  if (!value.sourceKind || !value.sourceId) return <p className="muted">Sin nota o guía de referencia.</p>;
  const item = value.sourceKind === 'note' ? data.notes.find((note) => note.id === value.sourceId && (note.visibility === 'group' || note.authorId === data.me?.id)) : data.guides.find((guide) => guide.id === value.sourceId);
  if (!item || item.subjectId !== value.subjectId) return <p className="muted">La referencia ya no está accesible. El ensayo se conserva y puedes configurar otra fuente para un intento futuro.</p>;
  return <><p><Link to={`/m/${value.sourceKind === 'note' ? 'notas' : 'guias'}/${item.id}`}>{item.title}</Link> · versión de origen {value.sourceVersion}</p>
    {item.version !== value.sourceVersion && <p className="presentation-notice" role="status">La fuente cambió a la versión {item.version}. Tu ensayo conserva la referencia original; no reemplazamos su contenido.</p>}</>;
}

function Configuration({ value }: { value: Pick<PresentationPractice, 'topic' | 'audience' | 'targetMinutes' | 'keyPoints'> }) {
  return <dl className="presentation-context"><div><dt>Tema</dt><dd>{value.topic}</dd></div><div><dt>Público</dt><dd>{value.audience}</dd></div><div><dt>Duración objetivo</dt><dd>{value.targetMinutes} minutos</dd></div><div><dt>Puntos a cubrir</dt><dd><ul>{value.keyPoints.map((point, index) => <li key={index}>{point}</li>)}</ul></dd></div></dl>;
}

export function PresentationPracticePage() {
  const data = useSnapshot();
  const { practiceId = '' } = useParams();
  const practice = data.presentationPractices.find((item) => item.id === practiceId);
  if (!practice || !data.me || (practice.ownerId !== data.me.id && practice.reviewerId !== data.me.id)) return <NotAvailable />;
  return <PracticeDetail key={`${data.me.id}:${practice.id}`} data={data} practice={practice} />;
}

function PracticeDetail({ data, practice }: { data: Snapshot; practice: PresentationPractice }) {
  const source = useDataSource();
  const navigate = useNavigate();
  const owner = practice.ownerId === data.me?.id;
  const attempts = data.presentationAttempts.filter((attempt) => attempt.practiceId === practice.id && (owner || attempt.status === 'completed')).sort((a, b) => b.number - a.number);
  const { pending, error, run } = useAction();
  const busy = useRef(false);
  const token = useRef<{ id: string; version?: number }>({ id: requestId() });
  const create = async () => {
    if (busy.current) return;
    busy.current = true;
    token.current.version ??= practice.version;
    const id = await run(() => source.createPresentationAttempt(practice.id, token.current.id, token.current.version!));
    busy.current = false;
    if (id) void navigate(attemptPath(practice.id, id));
  };
  return <>
    <Link to={BASE} className="back">← Exposiciones</Link>
    <header className="page-header"><div><p className="eyebrow">{data.subjects.find((subject) => subject.id === practice.subjectId)?.name}{practice.termId && ` · ${data.terms.find((term) => term.id === practice.termId)?.name ?? ''}`}</p>
      <h1>{practice.title}</h1><p className="muted">{owner ? 'Tu exposición' : `Exposición de ${memberName(data.members, practice.ownerId)}`} · {formatTime(practice.updatedAt)}</p></div>
      {practice.archived ? <span className="badge">Archivada</span> : owner && <Link className="button secondary" to={`${path(practice.id)}/editar`}>Configurar exposición</Link>}</header>
    {practice.archived && <p className="presentation-notice">Esta exposición está archivada. El historial se conserva y es de solo lectura.</p>}
    <div className="detail presentation-detail"><main className="detail__main">
      <section className="panel"><h2>Contexto de la exposición</h2><Configuration value={practice} />{owner && <p className="field__hint">Cada intento conserva el contexto que tenía al crearse.</p>}</section>
      <section className="panel"><div className="row row--between"><h2>Historial de intentos</h2>{owner && !practice.archived && <button type="button" disabled={pending || attempts.some((attempt) => attempt.status === 'draft')} onClick={() => void create()}>{pending ? 'Creando…' : attempts.length ? 'Nuevo intento' : 'Crear primer intento'}</button>}</div>
        {owner && !practice.archived && attempts.some((attempt) => attempt.status === 'draft') && <p className="field__hint">Retoma y concluye el borrador antes de comenzar otro intento.</p>}
        {owner && attempts.length > 0 && !attempts.some((attempt) => attempt.status === 'draft') && <p className="muted">El siguiente intento copiará la explicación anterior. Las preguntas, respuestas y observaciones anteriores se conservan en su intento.</p>}
        {attempts.length ? <ol className="presentation-attempts">{attempts.map((attempt) => <li key={attempt.id}><Link to={attemptPath(practice.id, attempt.id)}><strong>Intento {attempt.number}</strong><span className="badge">{attempt.status === 'draft' ? 'Borrador privado' : 'Concluido'}</span><span className="muted">{formatTime(attempt.completedAt ?? attempt.updatedAt)}</span></Link></li>)}</ol> : <p className="muted">{owner ? 'Todavía no hay intentos. Empieza con una explicación breve y guarda tus avances.' : 'El autor aún no ha concluido un intento.'}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </main><aside className="detail__side">
      <section className="panel"><h2>Revisión por un compañero</h2>{owner ? <ReviewerForm key={`${practice.id}:${practice.archived}`} practice={practice} data={data} /> : <p className="muted">Tienes acceso a los intentos concluidos, sus preguntas, respuestas y comentarios de revisión. Las observaciones personales del autor son privadas.</p>}</section>
      {owner && <section className="panel"><h2>Tu referencia</h2><SourceReference value={practice} data={data} /></section>}
      <section className="panel"><h2>Ensayo por texto</h2><p className="muted">Preguntas de apoyo con plantillas locales. La retroalimentación es orientativa y no representa una nota oficial.</p><p className="field__hint">Esta versión no graba audio ni usa IA.</p></section>
      {owner && <ArchiveForm practice={practice} />}
    </aside></div>
  </>;
}

function ReviewerForm({ practice, data }: { practice: PresentationPractice; data: Snapshot }) {
  const source = useDataSource();
  const [reviewer, setReviewer] = useState(practice.reviewerId ?? '');
  const [version, setVersion] = useState(practice.version);
  const [saved, setSaved] = useState(false);
  const { error, pending, run } = useAction();
  const busy = useRef(false);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const ok = await run(async () => { await source.setPresentationReviewer(practice.id, reviewer || undefined, version); return true; });
    busy.current = false;
    if (ok) { setVersion(version + 1); setSaved(true); }
  };
  return <form className="form" onSubmit={save} aria-busy={pending}>
    <label className="field">Compañero revisor<select value={reviewer} disabled={pending || practice.archived} onChange={(e) => { setReviewer(e.target.value); setSaved(false); }}><option value="">Solo yo</option>
      {data.members.filter((member) => member.status === 'active' && member.id !== practice.ownerId).map((member) => <option value={member.id} key={member.id}>{member.displayName}</option>)}
    </select></label>
    <p className="field__hint">Al invitar, compartes el contexto, las explicaciones concluidas, las preguntas y sus respuestas. El revisor puede leer y editar su propia retroalimentación. No se comparten borradores, observaciones personales ni siguientes pasos. El contenido de la fuente no se comparte.</p>
    <p className="field__hint">Puedes retirar el acceso o cambiar de revisor. Sus comentarios anteriores permanecerán en tu historial.</p>
    {!practice.archived && <button type="submit" className="secondary" disabled={pending || reviewer === (practice.reviewerId ?? '')}>{pending ? 'Guardando…' : reviewer ? 'Invitar revisor y compartir intentos concluidos' : 'Retirar acceso del revisor'}</button>}
    {error && <p className="error" role="alert">{error}</p>}{saved && <p role="status" className="muted">Acceso del revisor actualizado.</p>}
  </form>;
}

function ArchiveForm({ practice }: { practice: PresentationPractice }) {
  const source = useDataSource();
  const { error, pending, run } = useAction();
  return <section className="panel"><h2>{practice.archived ? 'Restaurar práctica' : 'Archivar práctica'}</h2><p className="muted">Se conserva todo el historial. Una práctica archivada es de solo lectura.</p>
    <button type="button" className="secondary" disabled={pending} onClick={() => void run(() => source.archivePresentationPractice(practice.id, !practice.archived, practice.version))}>{pending ? 'Guardando…' : practice.archived ? 'Restaurar exposición' : 'Archivar exposición'}</button>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

export function PresentationAttemptPage() {
  const data = useSnapshot();
  const { practiceId = '', attemptId = '' } = useParams();
  const practice = data.presentationPractices.find((item) => item.id === practiceId);
  const attempt = data.presentationAttempts.find((item) => item.id === attemptId && item.practiceId === practiceId);
  if (!data.me || !practice || !attempt || (practice.ownerId !== data.me.id && (practice.reviewerId !== data.me.id || attempt.status !== 'completed'))) return <NotAvailable />;
  return <AttemptDetail key={`${data.me.id}:${attempt.id}`} data={data} practice={practice} attempt={attempt} />;
}

function AttemptDetail({ data, practice, attempt }: { data: Snapshot; practice: PresentationPractice; attempt: PresentationAttempt }) {
  const owner = practice.ownerId === data.me?.id;
  const questions = data.presentationQuestions.filter((question) => question.attemptId === attempt.id);
  const previous = owner ? data.presentationAttempts.filter((item) => item.practiceId === practice.id && item.number < attempt.number && item.status === 'completed').sort((a, b) => b.number - a.number)[0] : undefined;
  return <>
    <Link to={path(practice.id)} className="back">← {practice.title}</Link>
    <header className="page-header"><div><p className="eyebrow">{attempt.title} · {data.subjects.find((subject) => subject.id === attempt.subjectId)?.name}{attempt.termId && ` · ${data.terms.find((term) => term.id === attempt.termId)?.name ?? ''}`}</p><h1>Intento {attempt.number}</h1><p className="muted">{formatTime(attempt.completedAt ?? attempt.updatedAt)}</p></div><span className="badge">{attempt.status === 'completed' ? 'Concluido' : 'Borrador privado'}</span></header>
    {practice.archived && <p className="presentation-notice">Exposición archivada: el intento y su historial son de solo lectura.</p>}
    <div className="detail presentation-detail"><main className="detail__main">
      {owner ? <AttemptEditor attempt={attempt} practice={practice} data={data} /> : <section className="panel"><h2>Explicación concluida</h2><RichText text={attempt.body} /><TimeEstimate body={attempt.body} /></section>}
      {previous && <details className="panel presentation-comparison"><summary>Comparar con el intento {previous.number}</summary><p className="muted">Explicación anterior, conservada sin cambios.</p><RichText text={previous.body} /><Link to={attemptPath(practice.id, previous.id)}>Abrir intento anterior, preguntas y observaciones</Link></details>}
      {attempt.status === 'completed' && <>
        <section className="panel"><h2>Preguntas de apoyo</h2><p className="muted">Las cinco preguntas orientadoras usan plantillas locales, sin IA. Las preguntas que escribas también se comparten con el revisor invitado.</p>
          <ol className="teaching-question-list">{questions.map((question) => <li key={question.id}><p className="eyebrow">{question.kind === 'guided' ? 'Plantilla local' : question.kind === 'peer' ? `Pregunta del revisor: ${memberName(data.members, question.authorId)}` : 'Pregunta del autor'}</p><h3 className="prewrap">{question.text}</h3>
            {owner && !practice.archived ? <AnswerForm key={`${data.me?.id}:${question.id}`} question={question} /> : question.answer ? <RichText text={question.answer} /> : <p className="muted">Todavía sin respuesta.</p>}
          </li>)}</ol>
          {!practice.archived && <QuestionForm attemptId={attempt.id} />}
        </section>
        <section className="panel"><h2>Retroalimentación orientativa</h2><p className="muted">Comentarios de compañeros para mejorar; no son una nota oficial.</p>
          {data.presentationFeedback.filter((feedback) => feedback.attemptId === attempt.id).map((feedback) => <FeedbackRead key={feedback.id} value={feedback} data={data} />)}
          {!owner && !practice.archived && <FeedbackForm key={`${data.me?.id}:${attempt.id}`} attemptId={attempt.id} value={data.presentationFeedback.find((feedback) => feedback.attemptId === attempt.id && feedback.authorId === data.me?.id)} />}
          {owner && !data.presentationFeedback.some((feedback) => feedback.attemptId === attempt.id) && <p className="muted">Todavía no hay comentarios de revisión.</p>}
        </section>
      </>}
    </main><aside className="detail__side"><section className="panel"><h2>Contexto de este intento</h2><Configuration value={attempt} /><p className="field__hint">Este contexto se conserva aunque cambie la configuración de la práctica.</p></section>
      {owner && <section className="panel"><h2>Referencia de este intento</h2><SourceReference value={attempt} data={data} /></section>}
      <section className="panel"><h2>Cómo ensayar</h2><ol className="teaching-steps"><li>Escribe tu explicación y guarda el borrador.</li><li>Concluye el intento para conservar su versión.</li><li>Responde preguntas y revisa comentarios.</li><li>Crea otro intento para mejorar.</li></ol></section>
    </aside></div>
  </>;
}

function TimeEstimate({ body }: { body: string }) {
  const estimate = presentationTextEstimate(body);
  return <p className="field__hint">{estimate.words} palabras · {estimate.minutes.toLocaleString('es-MX')} min estimados a 120 palabras/minuto. Referencia orientativa; no mide una exposición oral real.</p>;
}

function ObservationFields({ value, onChange, disabled }: { value: PresentationObservations; onChange: (value: PresentationObservations) => void; disabled: boolean }) {
  return PRESENTATION_RUBRIC.map(({ key, label, prompt }) => <label className="field" key={key}>{label}<textarea value={value[key]} rows={3} maxLength={PRESENTATION_LIMITS.observation} onChange={(e) => onChange({ ...value, [key]: e.target.value })} disabled={disabled} /><span className="field__hint">{prompt}</span></label>);
}

function AttemptEditor({ attempt, practice, data }: { attempt: PresentationAttempt; practice: PresentationPractice; data: Snapshot }) {
  const source = useDataSource();
  const personal = data.presentationPersonal.find((item) => item.attemptId === attempt.id);
  const [cache] = useState<AttemptDraft>(() => {
    const previous = attemptDrafts.get(source);
    if (previous && previous.memberId === data.me?.id && previous.attemptId === attempt.id) return previous;
    previous?.stopNavigationWatch?.();
    return { memberId: data.me!.id, attemptId: attempt.id, body: attempt.body,
      observations: personal ? { clarity: personal.clarity, examples: personal.examples, decisions: personal.decisions, limitations: personal.limitations } : emptyPresentationObservations(),
      nextSteps: personal?.nextSteps ?? '', version: attempt.version, dirty: false };
  });
  const [body, setBody] = useState(cache.body);
  const [observations, setObservations] = useState<PresentationObservations>(cache.observations);
  const [nextSteps, setNextSteps] = useState(cache.nextSteps);
  const [version, setVersion] = useState(cache.version);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(cache.dirty);
  const [completed, setCompleted] = useState(attempt.status === 'completed');
  const { pending, run } = useAction();
  const busy = useRef(false);
  const locked = practice.archived || completed || attempt.status === 'completed';
  const stale = attempt.version > version;
  Object.assign(cache, { body, observations, nextSteps, version, dirty });
  useEffect(() => {
    cache.stopNavigationWatch?.(); cache.stopNavigationWatch = undefined;
    if (attempt.status === 'draft') attemptDrafts.set(source, cache);
    return () => {
      if (attemptDrafts.get(source) !== cache) return;
      const snapshot = source.getSnapshot();
      if (snapshot.connection === 'ready' || (snapshot.me && snapshot.me.id !== cache.memberId)) attemptDrafts.delete(source);
      else cache.stopNavigationWatch = watchDraftNavigation(new WeakRef(source), new WeakRef(cache), window.location.hash);
    };
  }, [cache, source, attempt.status]);
  const change = () => { setSaved(false); setDirty(true); };
  const save = async (conclude = false) => {
    if (busy.current || locked) return;
    busy.current = true;
    const ok = await run(async () => {
      try {
        await source.savePresentationAttempt(attempt.id, { body, ...observations, nextSteps }, version);
        const savedVersion = version + 1;
        cache.version = savedVersion;
        setVersion(savedVersion); setSaved(true); setDirty(false);
        if (conclude) {
          await source.completePresentationAttempt(attempt.id, savedVersion);
          setVersion(savedVersion + 1); setCompleted(true); attemptDrafts.delete(source);
        }
        cache.error = undefined;
        return true;
      } catch (failure) {
        cache.error = failure instanceof Error ? failure.message : 'No pudimos guardar el intento.';
        throw failure;
      }
    });
    busy.current = false;
    if (!ok) setSaved(false);
  };
  const reload = () => {
    setBody(attempt.body); setObservations(personal ? { clarity: personal.clarity, examples: personal.examples, decisions: personal.decisions, limitations: personal.limitations } : emptyPresentationObservations());
    setNextSteps(personal?.nextSteps ?? ''); setVersion(attempt.version); setCompleted(attempt.status === 'completed'); setDirty(false); setSaved(false); cache.error = undefined;
  };
  return <form className="form panel teaching-editor" onSubmit={(event) => { event.preventDefault(); void save(); }} aria-busy={pending} onChange={change}>
    <h2>{locked ? 'Explicación conservada' : 'Tu explicación'}</h2>
    {stale && <p role="alert" className="error">Este intento cambió en otra pestaña. Conservamos tu texto local; puedes copiarlo antes de cargar la versión guardada.</p>}
    {stale && <button type="button" className="secondary" onClick={reload} disabled={pending}>Cargar versión guardada</button>}
    <label className="field">Explicación del tema<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} maxLength={PRESENTATION_LIMITS.body} disabled={pending} readOnly={locked} /></label><TimeEstimate body={body} />
    {locked && dirty && <p className="presentation-notice">Esta es tu edición local pendiente. El intento concluido conserva la explicación guardada en el servidor.</p>}
    <section className="form__section teaching-personal"><h2 className="with-icon"><Icon name="lock" size={16} /> Observaciones personales</h2><p className="field__hint">Solo tú puedes ver estas observaciones y tus siguientes pasos, incluso si invitas a un revisor.</p>
      <ObservationFields value={observations} onChange={setObservations} disabled={pending || locked} />
      <label className="field">Siguientes pasos<textarea value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} rows={3} maxLength={PRESENTATION_LIMITS.nextSteps} disabled={pending || locked} /></label>
    </section>
    {cache.error && <p className="error" role="alert">{cache.error} Tu texto permanece aquí para reintentar.</p>}
    {saved && <p className="muted" role="status">{completed ? 'Intento concluido. La explicación quedó conservada.' : 'Borrador guardado.'}</p>}
    {!locked && <><p className="field__hint">Al concluir, la explicación y tus observaciones quedan conservadas. Para cambiarlas, crea un nuevo intento. Se añadirán cinco preguntas de apoyo con plantillas locales.</p>
      <div className="form__actions"><button type="submit" className="secondary" disabled={pending}>{pending ? 'Guardando…' : 'Guardar borrador'}</button><button type="button" disabled={pending || !body.trim()} onClick={() => void save(true)}>Guardar y concluir intento</button></div></>}
  </form>;
}

function AnswerForm({ question }: { question: PresentationQuestion }) {
  const source = useDataSource();
  const [answer, setAnswer] = useState(question.answer);
  const [version, setVersion] = useState(question.version);
  const [saved, setSaved] = useState(false);
  const { error, pending, run } = useAction();
  const busy = useRef(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy.current) return; busy.current = true;
    const ok = await run(async () => { await source.answerPresentationQuestion(question.id, answer, version); return true; }); busy.current = false;
    if (ok) { setVersion(version + 1); setSaved(true); }
  };
  return <form className="form" onSubmit={submit} aria-busy={pending}>
    <label className="field">Tu respuesta<textarea value={answer} onChange={(e) => { setAnswer(e.target.value); setSaved(false); }} rows={3} maxLength={PRESENTATION_LIMITS.answer} disabled={pending} /></label>
    {question.version > version && <p className="error" role="alert">La respuesta cambió en otra pestaña. Tu edición se conserva; copia el texto y vuelve a abrir el intento para cargar la versión actual.</p>}
    <div className="row"><button type="submit" className="secondary" disabled={pending || !answer.trim()}>{pending ? 'Guardando…' : 'Guardar respuesta'}</button>{saved && <span role="status" className="muted">Respuesta guardada.</span>}</div>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

function QuestionForm({ attemptId }: { attemptId: string }) {
  const source = useDataSource();
  const [text, setText] = useState('');
  const token = useRef(requestId());
  const busy = useRef(false);
  const { error, pending, run } = useAction();
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy.current) return; busy.current = true;
    const id = await run(() => source.askPresentationQuestion(attemptId, text, token.current)); busy.current = false;
    if (id) { setText(''); token.current = requestId(); }
  };
  return <form className="form teaching-peer-question" onSubmit={submit} aria-busy={pending}><label className="field">Añadir una pregunta<textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={PRESENTATION_LIMITS.question} disabled={pending} /></label>
    <button type="submit" disabled={pending || !text.trim()}>{pending ? 'Enviando…' : 'Enviar pregunta'}</button>{error && <p className="error" role="alert">{error}</p>}
  </form>;
}

function FeedbackRead({ value, data }: { value: PresentationFeedback; data: Snapshot }) {
  return <article className="presentation-feedback"><h3>{memberName(data.members, value.authorId)}</h3><p className="field__hint">{formatTime(value.updatedAt)} · versión {value.version}</p>
    {PRESENTATION_RUBRIC.map(({ key, label }) => value[key] && <section key={key}><h4>{label}</h4><RichText text={value[key]} /></section>)}{value.comment && <section><h4>Comentario general</h4><RichText text={value.comment} /></section>}
  </article>;
}

function FeedbackForm({ attemptId, value }: { attemptId: string; value?: PresentationFeedback }) {
  const source = useDataSource();
  const [observations, setObservations] = useState<PresentationObservations>(value ? { clarity: value.clarity, examples: value.examples, decisions: value.decisions, limitations: value.limitations } : emptyPresentationObservations);
  const [comment, setComment] = useState(value?.comment ?? '');
  const [version, setVersion] = useState(value?.version);
  const [saved, setSaved] = useState(false);
  const { error, pending, run } = useAction();
  const busy = useRef(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy.current) return; busy.current = true;
    const ok = await run(async () => { await source.savePresentationFeedback(attemptId, { ...observations, comment }, version); return true; }); busy.current = false;
    if (ok) { setVersion((version ?? 0) + 1); setSaved(true); }
  };
  return <form className="form teaching-peer-question" onSubmit={submit} aria-busy={pending} onChange={() => setSaved(false)}><h3>Tu revisión</h3>
    <ObservationFields value={observations} onChange={setObservations} disabled={pending} />
    <label className="field">Comentario general<textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={PRESENTATION_LIMITS.observation} disabled={pending} /></label>
    {value && value.version > (version ?? 0) && <p className="error" role="alert">Tu revisión cambió en otra pestaña. Conservamos este texto para que puedas copiarlo antes de cargar la versión actual.</p>}
    <button type="submit" disabled={pending || ![...Object.values(observations), comment].some((text) => text.trim())}>{pending ? 'Guardando…' : 'Guardar retroalimentación'}</button>
    {error && <p className="error" role="alert">{error}</p>}{saved && <p role="status" className="muted">Retroalimentación guardada.</p>}
  </form>;
}
