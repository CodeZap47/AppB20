import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  EMPTY_TEACHING_EXPLANATION,
  MAX_TEACHING_QUESTION_LENGTH,
  MAX_TEACHING_TEXT_LENGTH,
  MAX_TEACHING_TOPIC_LENGTH,
  teachingCompletionError,
  teachingExplanationError,
  teachingNoteBody,
  type TeachingExplanation,
} from '@b20/core';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { RichText } from '../components/RichText';
import { SubjectSelect } from '../components/SubjectSelect';
import { useAction } from '../components/useAction';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Snapshot, TeachingPersonal, TeachingPractice, TeachingQuestion } from '../data/types';
import { formatTime, memberName } from '../lib/format';
import { matches } from '../lib/search';

const BASE = '/m/aprende-ensenando';
const STATUS_LABEL = { draft: 'Borrador', practicing: 'En práctica', completed: 'Completada' };
const EXPLANATION_FIELDS = [
  { id: 'concept', label: 'Concepto con tus palabras', hint: 'Explícalo como si tu compañero lo conociera por primera vez.' },
  { id: 'example', label: 'Un ejemplo', hint: 'Describe un caso concreto y por qué funciona.' },
  { id: 'limits', label: 'Dónde aplica y dónde no', hint: 'Cuenta cuándo es útil y en qué casos deja de servir.' },
] as const;

function NotFound() {
  return <Empty icon="lock" title="Esta práctica no está disponible"
    action={<Link to={BASE} className="button">Ver mis prácticas</Link>}>
    Solo su autor y el compañero invitado pueden abrirla. Si tu acceso cambió, vuelve al listado.
  </Empty>;
}

function ExplanationFields({ value, onChange, disabled = false }: {
  value: TeachingExplanation; onChange: (next: TeachingExplanation) => void; disabled?: boolean;
}) {
  return EXPLANATION_FIELDS.map(({ id, label, hint }) => <label key={id} className="field">
    <span className="field__label">{label}</span>
    <textarea value={value[id]} onChange={(e) => onChange({ ...value, [id]: e.target.value })}
      rows={id === 'concept' ? 5 : 3} maxLength={MAX_TEACHING_TEXT_LENGTH} disabled={disabled} />
    <span className="field__hint">{hint}</span>
  </label>);
}

function Explanation({ value }: { value: TeachingExplanation }) {
  return <div className="teaching-explanation">{EXPLANATION_FIELDS.map(({ id, label }) => <section key={id}>
    <h3>{label}</h3>
    {value[id].trim() ? <RichText text={value[id]} /> : <p className="muted">Todavía sin escribir.</p>}
  </section>)}</div>;
}

/** La práctica es privada: el listado contiene solo lo recibido en la vista autorizada. */
export function TeachingPage() {
  const data = useSnapshot();
  const [params, setParams] = useSearchParams();
  const reviewing = params.get('pestana') === 'revisar';
  const query = params.get('buscar') ?? '';
  const subjectId = params.get('materia') ?? '';
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const mine = data.teachingPractices.filter((p) => p.ownerId === data.me?.id);
  const forReview = data.teachingPractices.filter((p) => p.reviewerId === data.me?.id);
  const shown = (reviewing ? forReview : mine)
    .filter((p) => !subjectId || p.subjectId === subjectId)
    .filter((p) => matches(query, p.topic))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return <>
    <header className="page-header">
      <div><h1>Aprende enseñando</h1><p className="muted">Explica con tus palabras, responde preguntas y mejora tu explicación.</p></div>
      <Link to={`${BASE}/nueva`} className="button with-icon"><Icon name="plus" size={18} /> Nueva práctica</Link>
    </header>
    <p className="teaching-privacy with-icon"><Icon name="lock" size={16} /> Tus prácticas son privadas. Puedes invitar a un compañero.</p>
    <div className="toolbar">
      <div className="segmented teaching-tabs" role="group" aria-label="Prácticas">
        <button type="button" aria-pressed={!reviewing} onClick={() => update('pestana', '')}>Mis prácticas <span className="chip__count">{mine.length}</span></button>
        <button type="button" aria-pressed={reviewing} onClick={() => update('pestana', 'revisar')}>Para revisar <span className="chip__count">{forReview.length}</span></button>
      </div>
    </div>
    <div className="row teaching-filters">
      <label className="field grow">Buscar por tema<input type="search" value={query} onChange={(e) => update('buscar', e.target.value)} placeholder="¿Qué quieres practicar?" /></label>
      <SubjectSelect subjects={data.subjects} value={subjectId} onChange={(value) => update('materia', value)} allowAll />
    </div>
    {shown.length ? <ul className="work-grid teaching-list">{shown.map((practice) => <li key={practice.id}>
      <Link to={`${BASE}/${practice.id}`} className="work-card">
        <span className="work-card__context">{data.subjects.find((s) => s.id === practice.subjectId)?.name}</span>
        <strong className="work-card__title">{practice.topic}</strong>
        <span className="badges"><span className={`badge badge--${practice.status === 'completed' ? 'resolved' : 'open'}`}>{STATUS_LABEL[practice.status]}</span></span>
        <span className="muted">{reviewing ? `De ${memberName(data.members, practice.ownerId)}` : practice.reviewerId ? `Con ${memberName(data.members, practice.reviewerId)}` : 'Práctica personal'}</span>
        <span className="work-card__footer"><span className="work-card__date">{formatTime(practice.updatedAt)}</span></span>
      </Link>
    </li>)}</ul> : <Empty icon={query || subjectId ? 'search' : 'chat'} title={query || subjectId ? 'No hay prácticas con estos filtros' : reviewing ? 'No tienes prácticas para revisar' : 'Empieza con un tema que quieras entender mejor'}>
      {reviewing ? 'Las prácticas aparecerán aquí cuando un compañero te invite.' : 'Escribe una explicación breve; puedes guardar un borrador y retomarlo después.'}
    </Empty>}
  </>;
}

/** La clave desmonta el formulario al cambiar de cuenta; las actualizaciones no pisan lo escrito. */
export function TeachingFormPage() {
  const data = useSnapshot();
  const [params] = useSearchParams();
  const sourceKey = params.get('nota') ? `note:${params.get('nota')}` : params.get('guia') ? `guide:${params.get('guia')}` : '';
  const roomId = params.get('sala') ?? '';
  const room = data.studyRooms?.find((candidate) => candidate.id === roomId && data.roomMembers.some((member) => member.roomId === candidate.id && member.memberId === data.me?.id && member.status === 'joined'));
  if (roomId && !room) return <Empty icon="lock" title="La sala no está disponible" action={<Link to="/m/salas" className="button">Ver salas</Link>}>Tu acceso cambió. Puedes empezar otra práctica desde Aprende enseñando.</Empty>;
  return <CreatePractice key={`${data.me?.id}:${roomId}:${sourceKey}`} data={data} sourceKey={sourceKey} room={room} />;
}

function CreatePractice({ data, sourceKey, room }: { data: Snapshot; sourceKey: string; room?: { id: string; subjectId: string; topic: string; title: string } }) {
  const source = useDataSource();
  const navigate = useNavigate();
  const sourceNote = sourceKey.startsWith('note:') ? data.notes.find((n) => `note:${n.id}` === sourceKey && !n.withdrawnAt) : undefined;
  const sourceGuide = sourceKey.startsWith('guide:') ? data.guides.find((g) => `guide:${g.id}` === sourceKey && !g.withdrawnAt) : undefined;
  const [subjectId, setSubjectId] = useState(room?.subjectId ?? sourceNote?.subjectId ?? sourceGuide?.subjectId ?? data.subjects[0]?.id ?? '');
  const [topic, setTopic] = useState(room?.topic || sourceNote?.topic || sourceNote?.title || sourceGuide?.title || '');
  const [selectedSource, setSelectedSource] = useState(sourceKey);
  const [initial, setInitial] = useState<TeachingExplanation>({ ...EMPTY_TEACHING_EXPLANATION });
  const { error, pending, run } = useAction();
  const notes = data.notes.filter((n) => !n.withdrawnAt && n.subjectId === subjectId && (n.visibility === 'group' || n.authorId === data.me?.id));
  const guides = data.guides.filter((g) => !g.withdrawnAt && g.subjectId === subjectId);
  const accessible = !selectedSource || notes.some((n) => `note:${n.id}` === selectedSource) || guides.some((g) => `guide:${g.id}` === selectedSource);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending || !accessible) return;
    const separator = selectedSource.indexOf(':');
    const id = await run(() => source.createTeachingPractice({ subjectId, topic, initial,
      source: selectedSource ? { kind: selectedSource.slice(0, separator) as 'note' | 'guide', id: selectedSource.slice(separator + 1) } : undefined }));
    if (id) void navigate(`${BASE}/${id}`);
  };
  return <>
    <Link to={BASE} className="back with-icon"><Icon name="back" size={16} /> Aprende enseñando</Link>
    <header className="page-header"><div><h1>Nueva práctica</h1><p className="muted">Elige un tema y empieza a explicarlo. No necesitas terminar para guardar.</p></div></header>
    {room && <p className="teaching-privacy with-icon"><Icon name="lock" size={16} /> Desde «{room.title}». Esta práctica no se comparte con la sala. Puedes publicar tu explicación revisada como nota cuando quieras compartirla.</p>}
    {!data.subjects.length ? <Empty icon="folder" title="Primero necesitas una materia">Agrega una materia desde Tareas y Actividades para organizar tus prácticas.</Empty> : <form className="form form--wide panel" onSubmit={submit} aria-busy={pending}>
      <fieldset className="teaching-fields" disabled={pending}>
        <div className="form__grid"><SubjectSelect subjects={data.subjects} value={subjectId} onChange={(value) => { setSubjectId(value); setSelectedSource(''); }} />
          <label className="field"><span className="field__label">Tema</span><input value={topic} onChange={(e) => setTopic(e.target.value)} required maxLength={MAX_TEACHING_TOPIC_LENGTH} /></label></div>
        <label className="field"><span className="field__label">Nota o guía de referencia <span className="field__optional">opcional</span></span>
          <select value={selectedSource} onChange={(e) => setSelectedSource(e.target.value)}>
            <option value="">Sin fuente</option>
            {!accessible && <option value={selectedSource}>Fuente no disponible</option>}
            {notes.length > 0 && <optgroup label="Notas de clase">{notes.map((n) => <option key={n.id} value={`note:${n.id}`}>{n.title}{n.visibility === 'personal' ? ' · Personal' : ''}</option>)}</optgroup>}
            {guides.length > 0 && <optgroup label="Guías de estudio">{guides.map((g) => <option key={g.id} value={`guide:${g.id}`}>{g.title}</option>)}</optgroup>}
          </select><span className="field__hint">La referencia es solo para ti. Su contenido no se copia a la explicación.</span>
        </label>
        {!accessible && <p className="error" role="alert">Ya no puedes usar esta fuente. Elige otra o continúa sin fuente.</p>}
        <section className="form__section"><h2>Tu primera explicación</h2><ExplanationFields value={initial} onChange={setInitial} /></section>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form__actions"><Link to={BASE} className="button secondary">Cancelar</Link><button type="submit" disabled={pending || !topic.trim() || !accessible}>{pending ? 'Guardando…' : 'Guardar borrador'}</button></div>
    </form>}
  </>;
}

export function TeachingPracticePage() {
  const { practiceId = '' } = useParams();
  const data = useSnapshot();
  const practice = data.teachingPractices.find((p) => p.id === practiceId);
  if (!practice || !data.me || (practice.ownerId !== data.me.id && practice.reviewerId !== data.me.id)) return <NotFound />;
  const personal = practice.ownerId === data.me.id ? data.teachingPersonal.find((p) => p.practiceId === practice.id) : undefined;
  return <PracticeDetail key={`${data.me.id}:${practice.id}`} practice={practice} personal={personal} data={data} />;
}

function PracticeDetail({ practice, personal, data }: { practice: TeachingPractice; personal?: TeachingPersonal; data: Snapshot }) {
  const owner = practice.ownerId === data.me?.id;
  const questions = data.teachingQuestions.filter((q) => q.practiceId === practice.id);
  return <>
    <Link to={BASE} className="back with-icon"><Icon name="back" size={16} /> Aprende enseñando</Link>
    <header className="page-header"><div>
      <p className="eyebrow">{data.subjects.find((s) => s.id === practice.subjectId)?.name}</p>
      <h1>{practice.topic}</h1><p className="muted">{owner ? 'Tu práctica' : `Práctica de ${memberName(data.members, practice.ownerId)}`} · {formatTime(practice.updatedAt)}</p>
    </div><span className={`badge badge--${practice.status === 'completed' ? 'resolved' : 'open'}`}>{STATUS_LABEL[practice.status]}</span></header>
    <div className="detail teaching-detail">
      <div className="detail__main">
        {owner && practice.status === 'draft' ? <OwnerExplanationEditor key="draft" practice={practice} personal={personal} questions={questions} /> : <section className="panel">
          <h2>Explicación inicial</h2><p className="muted">La conservamos para que puedas ver cómo cambió tu comprensión.</p><Explanation value={practice.initial} />
        </section>}
        {practice.status === 'draft' && !owner && <p className="placeholder">El autor está preparando su explicación. Podrás preguntar cuando comience la práctica.</p>}
        {practice.status !== 'draft' && <section className="panel teaching-questions">
          <h2>Preguntas para profundizar</h2><p className="muted">{owner ? 'Responde al menos una y usa lo que descubras para mejorar tu explicación.' : 'Lee la explicación y ayuda con preguntas concretas.'}</p>
          <ol className="teaching-question-list">{questions.map((q) => <li key={q.id}>
            <p className="eyebrow">{q.kind === 'guided' ? 'Pregunta orientadora' : `Pregunta de ${memberName(data.members, q.authorId)}`}</p>
            <h3 className="prewrap">{q.text}</h3>
            {owner && practice.status === 'practicing' ? <QuestionAnswer key={`${data.me?.id}:${q.id}`} question={q} /> : q.answer.trim() ? <RichText text={q.answer} /> : <p className="muted">Todavía sin respuesta.</p>}
          </li>)}</ol>
          {!owner && practice.status === 'practicing' && <PeerQuestion practiceId={practice.id} />}
        </section>}
        {practice.status !== 'draft' && (owner && practice.status === 'practicing' ? <OwnerExplanationEditor key="practicing" practice={practice} personal={personal} questions={questions} /> : <section className="panel">
          <h2>Explicación revisada</h2><Explanation value={practice.revised} />
        </section>)}
        {owner && practice.status === 'completed' && <CompletedPractice practice={practice} personal={personal} />}
      </div>
      <aside className="detail__side">
        <section className="panel"><h2 className="label">Participación privada</h2><p className="teaching-privacy with-icon"><Icon name="lock" size={16} /> Solo el autor y su compañero invitado.</p>
          {owner ? <ReviewerForm key={`${practice.reviewerId ?? ''}:${practice.status}`} practice={practice} data={data} /> : <p className="muted">Puedes leer las explicaciones guardadas y conversar mediante preguntas.</p>}
        </section>
        {owner && <section className="panel"><h2 className="label">Tu referencia</h2><SourceReference personal={personal} data={data} /><p className="field__hint">La referencia, tu reflexión y los temas para repasar solo los ves tú.</p></section>}
        <section className="panel"><h2 className="label">Cómo practicar</h2><ol className="teaching-steps"><li>Explica el concepto con un ejemplo.</li><li>Responde preguntas y detecta dudas.</li><li>Reescribe y reflexiona sobre lo aprendido.</li></ol><p className="muted">Al terminar puedes compartir únicamente la explicación revisada como nota del grupo.</p></section>
      </aside>
    </div>
  </>;
}

function OwnerExplanationEditor({ practice, personal, questions }: { practice: TeachingPractice; personal?: TeachingPersonal; questions: TeachingQuestion[] }) {
  const source = useDataSource();
  const [initial, setInitial] = useState({ ...practice.initial });
  const [revised, setRevised] = useState({ ...practice.revised });
  const [reflection, setReflection] = useState(personal?.reflection ?? '');
  const [topicsToReview, setTopicsToReview] = useState(personal?.topicsToReview ?? '');
  const [saved, setSaved] = useState(false);
  const { error, pending, run } = useAction();
  const draft = practice.status === 'draft';
  const validation = draft ? teachingExplanationError(initial, true) : teachingCompletionError(revised, reflection, questions.filter((q) => q.answer.trim()).length);
  const save = () => source.saveTeachingPractice(practice.id, { initial, revised, reflection, topicsToReview });
  const act = async (next = false) => {
    if (pending) return;
    const success = await run(async () => { await save(); if (next) { if (draft) await source.startTeachingPractice(practice.id); else await source.completeTeachingPractice(practice.id); } return true; });
    if (success) setSaved(true);
  };
  return <form className="form panel teaching-editor" onSubmit={(e) => { e.preventDefault(); void act(); }} aria-busy={pending} onChange={() => setSaved(false)}>
    <h2>{draft ? 'Tu primera explicación' : 'Mejora tu explicación'}</h2>
    <p className="muted">{draft ? 'Puedes guardar lo que lleves. Completa los tres campos para comenzar las preguntas.' : 'Integra lo que aprendiste al responder; tu explicación inicial se conserva.'}</p>
    <ExplanationFields value={draft ? initial : revised} onChange={draft ? setInitial : setRevised} disabled={pending} />
    {!draft && <section className="form__section teaching-personal"><h2 className="with-icon"><Icon name="lock" size={16} /> Solo para ti</h2>
      <label className="field"><span className="field__label">Reflexión personal</span><textarea value={reflection} onChange={(e) => setReflection(e.target.value)} rows={4} maxLength={MAX_TEACHING_TEXT_LENGTH} disabled={pending} /><span className="field__hint">¿Qué entendiste mejor y qué cambió en tu explicación?</span></label>
      <label className="field"><span className="field__label">Temas para repasar <span className="field__optional">opcional</span></span><textarea value={topicsToReview} onChange={(e) => setTopicsToReview(e.target.value)} rows={3} maxLength={MAX_TEACHING_QUESTION_LENGTH} disabled={pending} /></label>
    </section>}
    {error && <p className="error" role="alert">{error}</p>}
    {saved && <p className="muted" role="status">Cambios guardados.</p>}
    {validation && <p className="field__hint">{validation}</p>}
    <div className="form__actions"><button type="submit" className="secondary" disabled={pending}>{pending ? 'Guardando…' : 'Guardar cambios'}</button>
      <button type="button" disabled={pending || Boolean(validation)} onClick={() => void act(true)}>{draft ? 'Guardar y comenzar práctica' : 'Guardar y completar práctica'}</button></div>
  </form>;
}

function ReviewerForm({ practice, data }: { practice: TeachingPractice; data: Snapshot }) {
  const source = useDataSource();
  const [reviewerId, setReviewerId] = useState(practice.reviewerId ?? '');
  const { error, pending, run } = useAction();
  const [saved, setSaved] = useState(false);
  const members = data.members.filter((m) => m.status === 'active' && m.id !== practice.ownerId);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (await run(async () => { await source.setTeachingReviewer(practice.id, reviewerId || undefined); return true; })) setSaved(true);
  };
  return <form className="form" onSubmit={submit} aria-busy={pending}>
    <label className="field">Compañero invitado<select value={reviewerId} onChange={(e) => { setReviewerId(e.target.value); setSaved(false); }} disabled={pending}>
      <option value="">Solo yo</option>{members.map((m) => <option key={m.id} value={m.id} disabled={practice.status !== 'practicing' && m.id !== practice.reviewerId}>{m.displayName}</option>)}
    </select></label>
    <p className="field__hint">{practice.status === 'draft' ? 'Comienza la práctica para invitar a un compañero.' : practice.status === 'completed' ? 'Reabre la práctica para invitar a otro compañero. Puedes retirar su acceso ahora.' : 'Al guardar, tendrá acceso inmediato. Puedes retirarlo o elegir a otra persona.'}</p>
    <button type="submit" className="secondary" disabled={pending || reviewerId === (practice.reviewerId ?? '')}>{pending ? 'Guardando…' : reviewerId ? 'Guardar compañero' : 'Retirar acceso'}</button>
    {error && <p className="error" role="alert">{error}</p>}{saved && <p className="muted" role="status">Participación actualizada.</p>}
  </form>;
}

function SourceReference({ personal, data }: { personal?: TeachingPersonal; data: Snapshot }) {
  if (!personal?.sourceKind || !personal.sourceId) return <p className="muted">Sin nota o guía de referencia.</p>;
  const item = personal.sourceKind === 'note' ? data.notes.find((n) => n.id === personal.sourceId) : data.guides.find((g) => g.id === personal.sourceId);
  if (!item) return <p className="muted">Esta referencia ya no está disponible.</p>;
  return <p><Link to={`/m/${personal.sourceKind === 'note' ? 'notas' : 'guias'}/${item.id}`}>{item.title}</Link></p>;
}

function QuestionAnswer({ question }: { question: TeachingQuestion }) {
  const source = useDataSource();
  const [answer, setAnswer] = useState(question.answer);
  const [saved, setSaved] = useState(false);
  const { error, pending, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (await run(async () => { await source.answerTeachingQuestion(question.id, answer); return true; })) setSaved(true);
  };
  return <form className="form" onSubmit={submit} aria-busy={pending}>
    <label className="field"><span className="field__label">Tu respuesta</span><textarea value={answer} onChange={(e) => { setAnswer(e.target.value); setSaved(false); }} rows={3} maxLength={MAX_TEACHING_QUESTION_LENGTH} disabled={pending} /></label>
    <div className="row"><button type="submit" className="secondary" disabled={pending || !answer.trim()}>{pending ? 'Guardando…' : 'Guardar respuesta'}</button>{saved && <span className="muted" role="status">Respuesta guardada.</span>}</div>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

function PeerQuestion({ practiceId }: { practiceId: string }) {
  const source = useDataSource();
  const [text, setText] = useState('');
  const { error, pending, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (await run(() => source.askTeachingQuestion(practiceId, text))) setText('');
  };
  return <form className="form teaching-peer-question" onSubmit={submit} aria-busy={pending}>
    <label className="field"><span className="field__label">Haz una pregunta</span><textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={MAX_TEACHING_QUESTION_LENGTH} placeholder="¿Qué parte necesita un ejemplo o una explicación más clara?" disabled={pending} /></label>
    <div className="row"><button type="submit" disabled={pending || !text.trim()}>{pending ? 'Enviando…' : 'Enviar pregunta'}</button></div>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

function CompletedPractice({ practice, personal }: { practice: TeachingPractice; personal?: TeachingPersonal }) {
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const [publishedId, setPublishedId] = useState(personal?.publishedNoteId);
  const noteId = personal?.publishedNoteId ?? publishedId;
  const publish = async () => {
    if (pending) return;
    const id = await run(() => source.publishTeachingExplanation(practice.id));
    if (id) setPublishedId(id);
  };
  return <>
    <section className="panel teaching-personal"><h2 className="with-icon"><Icon name="lock" size={16} /> Tu reflexión personal</h2><RichText text={personal?.reflection ?? ''} />
      {personal?.topicsToReview && <><h3>Temas para repasar</h3><RichText text={personal.topicsToReview} /></>}
      <button type="button" className="secondary" disabled={pending} onClick={() => void run(() => source.reopenTeachingPractice(practice.id))}>Reabrir práctica</button>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
    <section className="panel"><h2>Compartir lo que aprendiste</h2>
      {noteId ? <><p className="muted">Tu explicación ya tiene una nota del grupo. Puedes editarla desde Notas de clase.</p><Link to={`/m/notas/${noteId}`} className="button secondary">Abrir nota publicada</Link></> : <>
        <p className="muted">Se publicará únicamente la explicación revisada. Tu reflexión, referencia y conversación permanecen privadas.</p>
        <details className="teaching-preview" open><summary>Vista previa de la nota del grupo</summary><article><h3>{practice.topic}</h3><p className="muted">Apunte de alumno · Compartida con el grupo</p><RichText text={teachingNoteBody(practice.revised)} /></article></details>
        <button type="button" disabled={pending} onClick={() => void publish()}>{pending ? 'Publicando…' : 'Publicar explicación en Notas de clase'}</button>
      </>}
    </section>
  </>;
}
