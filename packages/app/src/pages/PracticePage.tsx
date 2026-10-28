import { ShareToChatButton } from '../components/messaging/SharePostDialog';
import { ResourceComments } from '../components/whatsNew/ResourceComments';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { ChallengeDifficulty, CodeReviewCommentKind, CodeReviewResolution } from '../../../core/src/practice';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { CodingChallenge, CodeReview, CodeReviewComment, CodeReviewVersion, PracticeSnapshot } from '../data/practiceTypes';
import type { Member, Snapshot } from '../data/types';
import { SubjectSelect } from '../components/SubjectSelect';
import { Empty } from '../components/Empty';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { RichText } from '../components/RichText';
import { useAction } from '../components/useAction';
import { formatTime, memberName } from '../lib/format';
import './practice.css';
import './ChallengesPage.css';

function usePracticeRequest() {
  const latest = useRef({ signature: '', id: '' });
  return Object.assign((input: unknown) => { const signature = JSON.stringify(input); if (latest.current.signature !== signature) latest.current = { signature, id: crypto.randomUUID() }; return latest.current.id; }, { reset() { latest.current = { signature: '', id: '' }; } });
}
const levels = { basic: 'Básico', intermediate: 'Intermedio', advanced: 'Avanzado' };
const kinds = { error: 'Error', suggestion: 'Sugerencia', question: 'Pregunta' };
const resolutions = { pending: 'Pendiente', applied: 'Aplicada', dismissed: 'Descartada' };
function ErrorMessage({ error }: { error: string | null }) { return error ? <p className="error" role="alert">{error}</p> : null; }
function NotFound({ review = false }: { review?: boolean }) { return <Empty icon="lock" title="Este contenido no está disponible" action={<Link to={review ? '/m/revision-codigo' : '/m/retos'} className="button">Volver al listado</Link>}>Tu acceso puede haber cambiado. Actualiza la conexión para continuar.</Empty>; }
function Author({ members, id }: { members: Member[]; id: string }) { return <span className="muted">{memberName(members, id)}</span>; }

export function ChallengesPage() {
  const data = useSnapshot();
  const [query, setQuery] = useState('');
  const [subjectId, setSubject] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [status, setStatus] = useState('open');
  const rows = data.codingChallenges.filter((row) =>
    (!subjectId || row.subjectId === subjectId) &&
    (!difficulty || row.difficulty === difficulty) &&
    (status === 'all' || row.closed === (status === 'closed')) &&
    `${row.title} ${row.topic}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  ).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const filtering = Boolean(query || subjectId || difficulty || status !== 'open');
  function clearFilters() { setQuery(''); setSubject(''); setDifficulty(''); setStatus('open'); }

  return <div className="challenges-page">
    <header className="challenges-header">
      <div>
        <p className="challenges-eyebrow"><Icon name="book" size={16} /> Aprende resolviendo</p>
        <h1>Retos</h1>
        <p className="muted">Un problema, distintas formas de resolverlo. Practica a tu ritmo y comparte lo que aprendiste.</p>
      </div>
      <Link className="button with-icon challenges-primary" to="/m/retos/nuevo"><Icon name="plus" size={18} /> Crear reto</Link>
    </header>

    <section className="challenges-surface challenges-filters" aria-label="Filtrar retos">
      <label className="field challenges-search">Tema o título
        <span className="challenges-search__control"><Icon name="search" size={19} /><input type="search" placeholder="Encuentra tu próximo reto…" value={query} onChange={(e) => setQuery(e.target.value)} /></span>
      </label>
      <div className="challenges-filter-fields">
        <SubjectSelect subjects={data.subjects} value={subjectId} onChange={setSubject} allowAll />
        <label className="field">Dificultad<select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option value="">Todas</option>{Object.entries(levels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field">Estado<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Abiertos</option><option value="closed">Cerrados</option><option value="all">Todos</option></select></label>
      </div>
    </section>
    <div className="challenges-results">
      <p aria-live="polite">{rows.length} {rows.length === 1 ? 'reto' : 'retos'} {status === 'open' ? 'para practicar' : 'en este listado'}</p>
      {filtering && <button type="button" className="link-button" onClick={clearFilters}>Limpiar filtros</button>}
    </div>

    {rows.length ? <ul className="challenges-grid" aria-label="Retos de programación">
      {rows.map((row) => {
        const author = data.members.find((member) => member.id === row.authorId);
        const solutionCount = data.challengeSolutions.filter((solution) => solution.challengeId === row.id).length;
        return <li key={row.id}>
          <Link className="challenges-card" to={`/m/retos/${row.id}`}>
            <span className="challenges-card__top"><span className="challenges-card__icon"><Icon name="file" size={21} /></span><span className={`challenges-level challenges-level--${row.difficulty}`}>{levels[row.difficulty]}</span></span>
            <span className="challenges-card__subject">{data.subjects.find((subject) => subject.id === row.subjectId)?.name ?? 'Materia desconocida'}</span>
            <strong className="challenges-card__title">{row.title}</strong>
            <span className="challenges-card__topic">{row.topic}</span>
            <span className="challenges-card__objective">{row.objective}</span>
            <span className="challenges-card__facts"><span><Icon name="chat" size={14} /> {solutionCount} {solutionCount === 1 ? 'solución' : 'soluciones'}</span><span><Icon name="lock" size={14} /> {row.hintCount} {row.hintCount === 1 ? 'pista' : 'pistas'}</span></span>
            <span className="challenges-card__footer"><Avatar member={author} size={26} /><span className="challenges-card__author">{row.authorId === data.me?.id ? 'Tú' : memberName(data.members, row.authorId)}</span><span className={`challenges-status${row.closed ? ' challenges-status--closed' : ''}`}>{row.closed ? 'Cerrado' : 'Abierto'}</span></span>
          </Link>
        </li>;
      })}
    </ul> : <div className="challenges-surface challenges-empty">
      <Empty icon={data.codingChallenges.length ? 'search' : 'file'} title={data.codingChallenges.length ? 'No hay retos con estos filtros' : 'Todavía no hay retos'} action={data.codingChallenges.length ? <button type="button" className="secondary" onClick={() => { clearFilters(); setStatus('all'); }}>Ver todos los retos</button> : <Link className="button with-icon" to="/m/retos/nuevo"><Icon name="plus" size={16} /> Crear reto</Link>}>
        {data.codingChallenges.length ? 'Prueba otra materia, dificultad o estado para encontrar un reto.' : 'Crea un reto con objetivo, instrucciones y un ejemplo para empezar.'}
      </Empty>
    </div>}
  </div>;
}

export function ChallengeCreatePage() {
  const data = useSnapshot();
  return <ChallengeCreateForm key={data.me?.id} data={data} />;
}
function ChallengeCreateForm({ data }: { data: Snapshot }) {
  const source = useDataSource();
  const navigate = useNavigate();
  const { pending, error, run } = useAction();
  const request = usePracticeRequest();
  const [subjectId, setSubject] = useState(data.subjects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<ChallengeDifficulty>('basic');
  const [objective, setObjective] = useState('');
  const [instructions, setInstructions] = useState('');
  const [examples, setExamples] = useState('');
  const [hints, setHints] = useState<string[]>([]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const id = await run(() => source.createCodingChallenge({ requestId: request({ subjectId, title, topic, difficulty, objective, instructions, examples, hints }), subjectId, title, topic, difficulty, objective, instructions, examples, hints }));
    if (id) void navigate(`/m/retos/${id}`);
  }
  return <div className="challenges-page">
    <Link to="/m/retos" className="back with-icon"><Icon name="back" size={16} /> Retos</Link>
    <header className="challenges-header"><div><p className="challenges-eyebrow"><Icon name="edit" size={16} /> Comparte un problema</p><h1>Crear reto</h1><p className="muted">Plantea el objetivo, muestra un ejemplo y deja espacio para descubrir la solución.</p></div></header>
    <form className="challenges-compose" onSubmit={(event) => void submit(event)}>
      <fieldset disabled={pending} className="challenges-surface challenges-compose__writing">
        <legend className="challenges-sr">Enunciado del reto</legend>
        <div className="challenges-section-heading"><Icon name="file" size={20} /><h2>El problema a resolver</h2></div>
        <label className="field challenges-title-field">Título<input required maxLength={160} value={title} placeholder="Un título que invite a intentarlo" onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field">Objetivo<textarea required rows={3} maxLength={2000} value={objective} placeholder="¿Qué aprenderán al resolverlo?" onChange={(e) => setObjective(e.target.value)} /></label>
        <label className="field">Instrucciones<textarea required rows={8} maxLength={20000} value={instructions} placeholder="Describe el problema, las condiciones y lo que debe hacer la solución." onChange={(e) => setInstructions(e.target.value)} /></label>
        <label className="field">Ejemplos de entrada y resultado<textarea className="practice-code-input" required rows={5} maxLength={10000} spellCheck={false} value={examples} placeholder={'Entrada: [1, 2, 3]\nResultado: 6'} onChange={(e) => setExamples(e.target.value)} /></label>
      </fieldset>
      <fieldset disabled={pending} className="challenges-compose__organization">
        <legend className="challenges-sr">Organización del reto</legend>
        <section className="challenges-surface challenges-form-section">
          <div className="challenges-section-heading"><Icon name="folder" size={20} /><h2>Organización</h2></div>
          <SubjectSelect subjects={data.subjects} value={subjectId} onChange={setSubject} />
          <label className="field">Tema<input required maxLength={240} value={topic} placeholder="Listas, recursión, consultas…" onChange={(e) => setTopic(e.target.value)} /></label>
          <label className="field">Dificultad<select value={difficulty} onChange={(e) => setDifficulty(e.target.value as ChallengeDifficulty)}>{Object.entries(levels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {!data.subjects.length && <p className="muted" role="status">Necesitas una materia para publicar el reto.</p>}
        </section>
        <section className="challenges-surface challenges-compose__guide"><Icon name="users" size={22} /><h2>Un reto para aprender juntos</h2><p>Usa ejemplos claros y explica qué condiciones debe cumplir una buena solución.</p><p>Las pistas son opcionales. Ordénalas desde una orientación general hasta una ayuda más concreta.</p></section>
      </fieldset>
      <fieldset disabled={pending} className="challenges-surface challenges-compose__hints">
        <legend className="challenges-sr">Pistas progresivas</legend>
        <div className="challenges-section-heading"><Icon name="lock" size={20} /><h2>Pistas progresivas</h2><span className="challenges-count">{hints.length} / 8</span></div>
        <p className="muted">Cada compañero decide cuándo descubrir la siguiente pista. Su progreso es privado.</p>
        {hints.length === 0 && <p className="challenges-inline-empty">Puedes publicar sin pistas o añadir hasta ocho para acompañar la práctica.</p>}
        {hints.map((hint, index) => <div className="challenges-hint-draft" key={index}>
          <label className="field">Pista {index + 1}<textarea required rows={3} maxLength={3000} value={hint} onChange={(e) => setHints(hints.map((value, at) => at === index ? e.target.value : value))} /></label>
          <button type="button" className="link-button" onClick={() => setHints(hints.filter((_, at) => at !== index))}>Quitar pista {index + 1}</button>
        </div>)}
        <button type="button" className="secondary with-icon" disabled={hints.length >= 8} onClick={() => setHints([...hints, ''])}><Icon name="plus" size={16} /> Añadir pista</button>
      </fieldset>
      <div className="challenges-compose__status"><ErrorMessage error={error} /></div>
      <div className="challenges-compose__actions form__actions"><p><Icon name="users" size={16} /> El reto se comparte con el grupo</p><Link className="button secondary" to="/m/retos">Cancelar</Link><button className="challenges-primary" disabled={pending || !subjectId}>{pending ? 'Creando…' : 'Publicar reto al grupo'}</button></div>
    </form>
  </div>;
}

export function ChallengeDetailPage() {
  const data = useSnapshot();
  const { challengeId = '' } = useParams();
  const challenge = data.codingChallenges.find((row) => row.id === challengeId);
  if (!challenge || !data.me) return <div className="challenges-page"><NotFound /></div>;
  return <ChallengeDetail key={`${data.me.id}:${challenge.id}`} challenge={challenge} data={data} />;
}
function ChallengeDetail({ challenge, data }: { challenge: CodingChallenge; data: Snapshot }) {
  const [search] = useSearchParams();
  const linkedSolution = search.get('solucion');
  const solutionAvailable = data.challengeSolutions.some((entry) => entry.id === linkedSolution && entry.challengeId === challenge.id);
  useEffect(() => {
    if (!linkedSolution || !solutionAvailable) return;
    const element = document.getElementById(`solucion-${linkedSolution}`);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView?.({ block: 'center' });
  }, [linkedSolution, solutionAvailable]);
  const source = useDataSource();
  const action = useAction();
  const hints = data.challengeHints.filter((row) => row.challengeId === challenge.id).sort((a, b) => a.number - b.number);
  const unlocked = data.challengeProgress.find((row) => row.challengeId === challenge.id)?.unlockedHints ?? 0;
  const solutions = data.challengeSolutions.filter((row) => row.challengeId === challenge.id);
  const own = solutions.find((row) => row.authorId === data.me?.id);
  const [body, setBody] = useState(own?.body ?? '');
  const [explanation, setExplanation] = useState(own?.explanation ?? '');
  const [expectedVersion, setExpectedVersion] = useState(own?.version ?? 0);
  const request = usePracticeRequest();
  const [closure, setClosure] = useState('');
  const isAuthor = challenge.authorId === data.me?.id;
  const author = data.members.find((member) => member.id === challenge.authorId);
  const groupComments = data.challengeComments.filter((comment) => comment.challengeId === challenge.id && !comment.solutionId);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (await action.run(async () => {
      await source.saveChallengeSolution({ challengeId: challenge.id, body, explanation, expectedVersion, requestId: request({ body, explanation, expectedVersion }) });
      return true;
    })) setExpectedVersion(expectedVersion + 1);
  }

  return <div className="challenges-page challenges-page--detail">
    <Link className="back with-icon" to="/m/retos"><Icon name="back" size={16} /> Retos</Link>
    <header className="challenges-header challenges-header--detail">
      <div>
        <p className="challenges-eyebrow">{data.subjects.find((subject) => subject.id === challenge.subjectId)?.name ?? 'Materia desconocida'}<span aria-hidden="true">·</span>{challenge.topic}</p>
        <h1>{challenge.title}</h1>
        <div className="challenges-byline"><Avatar member={author} size={32} /><span><strong>{isAuthor ? 'Tú' : memberName(data.members, challenge.authorId)}</strong><time dateTime={challenge.createdAt.toISOString()}>Publicado {formatTime(challenge.createdAt)}</time></span></div>
      </div>
      <div className="challenges-header__badges"><span className={`challenges-level challenges-level--${challenge.difficulty}`}>{levels[challenge.difficulty]}</span><span className={`challenges-status${challenge.closed ? ' challenges-status--closed' : ''}`}>{challenge.closed ? 'Cerrado' : 'Abierto'}</span></div>
    </header>
    <ShareToChatButton target={{ kind: 'challenge', id: challenge.id }} />
    <ErrorMessage error={action.error} />
    <div className="challenges-detail">
      <div className="challenges-detail__main">
        <article className="challenges-surface challenges-brief" aria-label="Enunciado del reto">
          <section><div className="challenges-section-heading"><span className="challenges-step">01</span><h2>Objetivo</h2></div><RichText text={challenge.objective} /></section>
          <section><div className="challenges-section-heading"><span className="challenges-step">02</span><h2>Instrucciones</h2></div><RichText text={challenge.instructions} /></section>
          <section><div className="challenges-section-heading"><span className="challenges-step">03</span><h2>Ejemplos</h2></div><pre className="practice-code" tabIndex={0} aria-label="Ejemplos de entrada y resultado"><code>{challenge.examples}</code></pre></section>
        </article>
        {challenge.closed && <section className="challenges-surface challenges-conclusion"><div className="challenges-section-heading"><Icon name="check" size={20} /><h2>Conclusión</h2></div><RichText text={challenge.closure} /><p className="challenges-private-note">El reto está cerrado. Puedes consultar el enunciado y las soluciones compartidas.</p></section>}

        <section className="challenges-surface challenges-hints" aria-labelledby="challenge-hints-heading">
          <div className="challenges-section-heading"><Icon name="lock" size={20} /><h2 id="challenge-hints-heading">Pistas</h2><span className="challenges-count">{hints.length} / {challenge.hintCount}</span></div>
          <p className="muted">Una ayuda cuando la necesitas. Descubre solo la siguiente pista para seguir pensando por tu cuenta.</p>
          {hints.map((hint) => <article className="challenges-hint" key={hint.number}><h3>Pista {hint.number}</h3><RichText text={hint.body} /></article>)}
          {!hints.length && <p className="challenges-inline-empty">{challenge.hintCount ? 'Todavía no has descubierto ninguna pista.' : 'Este reto no incluye pistas.'}</p>}
          {!isAuthor && unlocked < challenge.hintCount && <button className="secondary with-icon" disabled={action.pending} onClick={() => void action.run(() => source.unlockChallengeHint(challenge.id, unlocked))}><Icon name="plus" size={16} /> Descubrir pista {unlocked + 1} de {challenge.hintCount}</button>}
          <p className="challenges-private-note"><Icon name="lock" size={14} /> Solo tú ves cuántas pistas has descubierto.</p>
        </section>

        {!challenge.closed && <form className="challenges-surface challenges-solution-form" onSubmit={(event) => void save(event)}>
          <div className="challenges-section-heading"><Icon name="edit" size={20} /><h2>{own ? 'Tu solución' : 'Comparte tu solución'}</h2></div>
          <p className="muted">Muestra cómo lo resolviste y explica las decisiones que tomaste.</p>
          <label className="field">Solución o código<textarea className="practice-code-input" required rows={10} maxLength={60000} spellCheck={false} value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <label className="field">Explica el razonamiento y sus límites<textarea required rows={4} maxLength={12000} value={explanation} onChange={(e) => setExplanation(e.target.value)} /></label>
          <div className="challenges-solution-form__footer"><p><Icon name="users" size={15} /> Se comparte con el grupo. El código se muestra como texto.</p><button disabled={action.pending}>{action.pending ? 'Guardando…' : 'Guardar solución'}</button></div>
        </form>}

        <section className="challenges-solutions" aria-labelledby="challenge-solutions-heading">
          <div className="challenges-section-heading"><Icon name="file" size={20} /><h2 id="challenge-solutions-heading">Soluciones explicadas ({solutions.length})</h2></div>
          {solutions.length === 0 && <div className="challenges-surface challenges-inline-empty"><Icon name="file" size={24} /><h3>Aún no hay soluciones compartidas</h3><p>{challenge.closed ? 'Puedes repasar el enunciado y la conclusión de este reto.' : 'Tu forma de resolver el problema puede ayudar a otro compañero.'}</p></div>}
          {solutions.map((solution) => {
            const comments = data.challengeComments.filter((comment) => comment.solutionId === solution.id);
            return <article className="challenges-surface challenges-solution" key={solution.id} id={`solucion-${solution.id}`} tabIndex={-1} aria-labelledby={`solucion-title-${solution.id}`}>
              <header className="challenges-solution__header"><Avatar member={data.members.find((member) => member.id === solution.authorId)} size={32} /><div><h3 id={`solucion-title-${solution.id}`}>{memberName(data.members, solution.authorId)}{solution.authorId === data.me?.id && <span className="challenges-own-label">Tu solución</span>}</h3><time dateTime={solution.updatedAt.toISOString()}>{formatTime(solution.updatedAt)}</time></div><span className="challenges-count">v{solution.version}</span></header>
              <pre className="practice-code" tabIndex={0} aria-label="Código de la solución"><code>{solution.body}</code></pre>
              <ShareToChatButton target={{ kind: 'solution', id: solution.id }} />
              <h4>Razonamiento</h4><RichText text={solution.explanation} />
              {comments.length > 0 && <section className="challenges-solution__comments" aria-label="Comentarios de la solución"><h4>Comentarios</h4>{comments.map((comment) => <blockquote className="challenges-comment" key={comment.id}><header><Author members={data.members} id={comment.authorId} /><time dateTime={comment.createdAt.toISOString()}>{formatTime(comment.createdAt)}</time></header><RichText text={comment.body} /></blockquote>)}</section>}
              {!challenge.closed && <ChallengeCommentForm challengeId={challenge.id} solutionId={solution.id} />}
            </article>;
          })}
        </section>

        <section className="challenges-surface challenges-discussion"><div className="challenges-section-heading"><Icon name="chat" size={20} /><h2>Revisión colectiva</h2><span className="challenges-count">{groupComments.length}</span></div>
          {groupComments.map((comment) => <blockquote className="challenges-comment" key={comment.id}><header><Author members={data.members} id={comment.authorId} /><time dateTime={comment.createdAt.toISOString()}>{formatTime(comment.createdAt)}</time></header><RichText text={comment.body} /></blockquote>)}
          {!groupComments.length && <p className="challenges-inline-empty">Todavía no hay comentarios para el grupo.</p>}
          {!challenge.closed && <ChallengeCommentForm challengeId={challenge.id} />}
        </section>
      </div>

      <aside className="challenges-detail__side" aria-label="Tu práctica y gestión del reto">
        <section className="challenges-surface challenges-progress"><p className="challenges-eyebrow"><Icon name="lock" size={14} /> A tu ritmo</p><h2>Tu práctica</h2>
          {isAuthor ? <p className="muted">Creaste este reto y puedes consultar todas sus pistas.</p> : <>
            <div className="challenges-progress__count"><span>Pistas descubiertas</span><strong>{unlocked} <span>/ {challenge.hintCount}</span></strong></div>
            {challenge.hintCount > 0 && <progress value={Math.min(unlocked, challenge.hintCount)} max={challenge.hintCount} aria-label="Pistas descubiertas">{unlocked} de {challenge.hintCount}</progress>}
            <p className="challenges-private-note">Este progreso es privado. Cada compañero decide cuándo pedir ayuda.</p>
          </>}
          <div className="challenges-progress__solution"><Icon name={own ? 'check' : 'edit'} size={18} /><div><strong>{own ? 'Tu solución está compartida' : 'Tu solución está por compartir'}</strong><span>{own ? `Versión ${own.version} · visible para el grupo` : challenge.closed ? 'Este reto ya está cerrado.' : 'Comparte el código y tu razonamiento.'}</span></div></div>
        </section>
        <section className="challenges-surface challenges-study-note"><Icon name="book" size={22} /><h2>La explicación también cuenta</h2><p>Compara enfoques, pregunta lo que no entiendas y cuenta qué cambiarías en tu solución.</p><p>El código se lee como texto; no se ejecuta desde el reto.</p></section>
        {!challenge.closed && isAuthor && <form className="challenges-surface challenges-close-form" onSubmit={(event) => { event.preventDefault(); void action.run(() => source.closeCodingChallenge(challenge.id, closure, challenge.version)); }}>
          <h2>Cerrar el reto</h2><p className="muted">Recoge los aprendizajes del grupo antes de cerrar la participación.</p><label className="field">Conclusión y aprendizajes<textarea required rows={5} maxLength={12000} value={closure} onChange={(e) => setClosure(e.target.value)} /></label><button className="secondary" disabled={action.pending}>Cerrar con conclusión</button>
        </form>}
      </aside>
    </div>
  </div>;
}
function ChallengeCommentForm({ challengeId, solutionId }: { challengeId: string; solutionId?: string }) {
  const source = useDataSource();
  const { run, error, pending } = useAction();
  const [body, setBody] = useState('');
  const request = usePracticeRequest();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await run(async () => {
      await source.addChallengeComment({ challengeId, solutionId, body, requestId: request({ challengeId, solutionId, body }) });
      return true;
    })) { setBody(''); request.reset(); }
  }
  return <form className="challenges-comment-form" onSubmit={(event) => void submit(event)}><label className="field">{solutionId ? 'Comentar esta solución' : 'Comentario para el grupo'}<textarea required rows={3} maxLength={4000} value={body} placeholder="Comparte una idea o haz una pregunta…" onChange={(e) => setBody(e.target.value)} /></label><ErrorMessage error={error} /><div className="form__actions"><button className="secondary with-icon" disabled={pending}><Icon name="send" size={15} /> {pending ? 'Enviando…' : 'Comentar'}</button></div></form>;
}

export function CodeReviewsPage() {
  const data = useSnapshot(); const [query, setQuery] = useState(''); const [subjectId, setSubject] = useState(''); const rows = data.codeReviews.filter((row) => (!subjectId || row.subjectId === subjectId) && `${row.title} ${row.language}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return <><header className="page-header"><div><h1>Revisión de código</h1><p className="muted">Recibe observaciones por versión y explica cómo las resolviste.</p></div><Link className="button" to="/m/revision-codigo/nueva">Pedir revisión</Link></header><div className="row practice-filters"><label className="field grow">Buscar por título o lenguaje<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} /></label><SubjectSelect subjects={data.subjects} value={subjectId} onChange={setSubject} allowAll /></div>{rows.length ? <ul className="work-grid">{rows.map((row) => <li key={row.id}><Link className="work-card" to={`/m/revision-codigo/${row.id}`}><strong className="work-card__title">{row.title}</strong><span>{row.language} · v{row.currentVersion} · {row.closed ? 'Cerrada' : 'Abierta'}</span><Author members={data.members} id={row.authorId} /><span className="muted">{formatTime(row.updatedAt)}</span></Link></li>)}</ul> : <Empty icon="search" title="No hay revisiones con estos filtros">Comparte código o un enlace al repositorio y cuenta qué quieres mejorar.</Empty>}</>;
}
function CodeFields({ code, repositoryUrl, summary, change }: { code: string; repositoryUrl: string; summary: string; change(field: 'code' | 'repositoryUrl' | 'summary', value: string): void }) {
  return <><label className="field">Código pegado<textarea className="practice-code-input" rows={12} maxLength={60000} spellCheck={false} value={code} onChange={(e) => change('code', e.target.value)} /><span className="field__hint">Los comentarios por línea se anclan a este texto exacto.</span></label><label className="field">Enlace HTTPS al repositorio (opcional si pegas código)<input type="url" maxLength={2000} placeholder="https://…" value={repositoryUrl} onChange={(e) => change('repositoryUrl', e.target.value)} /></label><label className="field">Contexto y qué necesitas revisar<textarea required rows={4} maxLength={12000} value={summary} onChange={(e) => change('summary', e.target.value)} /></label><p className="muted">Pega código o añade un enlace. Cada versión conserva su texto y referencia; los enlaces externos pueden cambiar con el tiempo.</p></>;
}
export function CodeReviewCreatePage() { const data = useSnapshot(); return <CodeReviewCreateForm key={data.me?.id} data={data} />; }
function CodeReviewCreateForm({ data }: { data: Snapshot }) {
  const source = useDataSource(); const navigate = useNavigate(); const action = useAction(); const request = usePracticeRequest(); const [subjectId, setSubject] = useState(data.subjects[0]?.id ?? ''); const [title, setTitle] = useState(''); const [language, setLanguage] = useState(''); const [fields, setFields] = useState({ code: '', repositoryUrl: '', summary: '' });
  async function submit(event: FormEvent) { event.preventDefault(); if (action.pending) return; const id = await action.run(() => source.createCodeReview({ requestId: request({ subjectId, title, language, ...fields }), subjectId, title, language, ...fields })); if (id) void navigate(`/m/revision-codigo/${id}`); }
  return <><Link to="/m/revision-codigo" className="back">← Revisión de código</Link><header className="page-header"><h1>Pedir revisión</h1></header><form className="form form--wide panel" onSubmit={(event) => void submit(event)}><fieldset className="practice-fields" disabled={action.pending}><SubjectSelect subjects={data.subjects} value={subjectId} onChange={setSubject} /><label className="field">Título<input required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label><label className="field">Lenguaje<input required maxLength={80} value={language} onChange={(e) => setLanguage(e.target.value)} /></label><CodeFields {...fields} change={(field, value) => setFields({ ...fields, [field]: value })} /></fieldset><ErrorMessage error={action.error} /><button disabled={action.pending || !subjectId}>{action.pending ? 'Guardando…' : 'Compartir con el grupo'}</button></form></>;
}
export function CodeReviewDetailPage() {
  const data = useSnapshot(); const { reviewId = '' } = useParams(); const review = data.codeReviews.find((row) => row.id === reviewId); if (!review || !data.me) return <NotFound review />; return <CodeReviewDetail key={`${data.me.id}:${review.id}`} review={review} data={data} />;
}
function CodeReviewDetail({ review, data }: { review: CodeReview; data: Snapshot }) {
  const [search] = useSearchParams(); const linkedId = search.get('observacion');
  const linkedComment = data.codeReviewComments.find((entry) => entry.id === linkedId && entry.reviewId === review.id);
  const source = useDataSource(); const action = useAction(); const [selected, setSelected] = useState(linkedComment?.versionNumber ?? review.currentVersion); const [newVersion, setNewVersion] = useState(false); const versions = data.codeReviewVersions.filter((row) => row.reviewId === review.id).sort((a, b) => b.number - a.number); const version = versions.find((row) => row.number === selected); const comments = data.codeReviewComments.filter((row) => row.reviewId === review.id && row.versionNumber === selected); const own = review.authorId === data.me?.id;
  useEffect(() => { if (linkedComment) setSelected(linkedComment.versionNumber); }, [linkedId, linkedComment?.versionNumber]);
  useEffect(() => { if (!linkedComment || linkedComment.versionNumber !== selected) return; const element = document.getElementById(`observacion-${linkedComment.id}`); element?.focus({ preventScroll: true }); element?.scrollIntoView?.({ block: 'center' }); }, [linkedId, linkedComment?.versionNumber, selected]);
  return <><Link className="back" to="/m/revision-codigo">← Revisión de código</Link><header className="page-header"><div><h1>{review.title}</h1><p className="muted">{review.language} · {review.closed ? 'Revisión cerrada' : 'Revisión abierta'}</p><Author members={data.members} id={review.authorId} /></div>{own && !review.closed && <button className="button secondary" disabled={action.pending} onClick={() => void action.run(() => source.closeCodeReview(review.id, review.version))}>Cerrar revisión</button>}</header>
    <label className="field">Versión<select value={selected} onChange={(e) => setSelected(Number(e.target.value))}>{versions.map((row) => <option key={row.number} value={row.number}>Versión {row.number}{row.number === review.currentVersion ? ' · actual' : ''}</option>)}</select></label>
    {version && <><article className="panel practice-content"><h2>Versión {version.number}</h2><RichText text={version.summary} />{version.repositoryUrl && <p><a href={version.repositoryUrl} target="_blank" rel="noopener noreferrer">Abrir repositorio ↗</a></p>}{version.code && <div className="practice-code-lines" aria-label={`Código de la versión ${version.number}`}><ol>{version.code.split('\n').map((line, index) => <li key={index}><code>{line || ' '}</code></li>)}</ol></div>}</article>
      <section className="practice-content"><h2>Comentarios de esta versión ({comments.length})</h2>{comments.map((comment) => <ReviewComment key={comment.id} comment={comment} data={data} canResolve={own && !review.closed} />)}{!review.closed && <ReviewCommentForm key={selected} reviewId={review.id} version={version} />}</section></>}
    <ResourceComments target={{ kind: 'review', id: review.id }} title="Conversación general sobre el código" />
    {own && !review.closed && <section className="panel practice-content"><button className="button secondary" onClick={() => setNewVersion(!newVersion)}>{newVersion ? 'Ocultar formulario' : 'Añadir una versión'}</button>{newVersion && <CodeVersionForm review={review} previous={versions[0]} onSaved={() => { setNewVersion(false); setSelected(review.currentVersion + 1); }} />}</section>}<ErrorMessage error={action.error} /></>;
}
function CodeVersionForm({ review, previous, onSaved }: { review: CodeReview; previous?: CodeReviewVersion; onSaved(): void }) {
  const source = useDataSource(); const action = useAction(); const request = usePracticeRequest(); const [expectedVersion] = useState(review.version); const [fields, setFields] = useState({ code: previous?.code ?? '', repositoryUrl: previous?.repositoryUrl ?? '', summary: '' });
  async function submit(event: FormEvent) { event.preventDefault(); if (await action.run(async () => { await source.addCodeReviewVersion({ reviewId: review.id, expectedVersion, requestId: request({ reviewId: review.id, expectedVersion, ...fields }), ...fields }); return true; })) onSaved(); }
  return <form className="form" onSubmit={(event) => void submit(event)}><h2>Nueva versión inmutable</h2><CodeFields {...fields} change={(field, value) => setFields({ ...fields, [field]: value })} /><ErrorMessage error={action.error} /><button disabled={action.pending}>Guardar nueva versión</button></form>;
}
function ReviewCommentForm({ reviewId, version }: { reviewId: string; version: CodeReviewVersion }) {
  const source = useDataSource(); const action = useAction(); const [kind, setKind] = useState<CodeReviewCommentKind>('suggestion'); const [lineStart, setStart] = useState(0); const [lineEnd, setEnd] = useState(0); const [body, setBody] = useState(''); const request = usePracticeRequest(); const max = version.code ? version.code.split('\n').length : 0;
  async function submit(event: FormEvent) { event.preventDefault(); if (await action.run(async () => { await source.addCodeReviewComment({ reviewId, versionNumber: version.number, lineStart, lineEnd, kind, body, requestId: request({ reviewId, versionNumber: version.number, lineStart, lineEnd, kind, body }) }); return true; })) { setBody(''); request.reset(); } }
  return <form className="form panel" onSubmit={(event) => void submit(event)}><h3>Comentar versión {version.number}</h3><div className="form__grid"><label className="field">Tipo<select value={kind} onChange={(e) => setKind(e.target.value as CodeReviewCommentKind)}>{Object.entries(kinds).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="field">Desde la línea<input type="number" min={0} max={max} value={lineStart} onChange={(e) => { const n = Number(e.target.value); setStart(n); setEnd(n); }} /></label><label className="field">Hasta la línea<input type="number" min={lineStart} max={max} value={lineEnd} onChange={(e) => setEnd(Number(e.target.value))} /></label></div><p className="muted">0–0 indica un comentario general. Las líneas siguen vinculadas a esta versión.</p><label className="field">Comentario<textarea required maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} /></label><ErrorMessage error={action.error} /><button disabled={action.pending}>Añadir comentario</button></form>;
}
function ReviewComment({ comment, data, canResolve }: { comment: CodeReviewComment; data: Snapshot & PracticeSnapshot; canResolve: boolean }) {
  const source = useDataSource(); const action = useAction(); const [status, setStatus] = useState<CodeReviewResolution>(comment.status); const [resolution, setResolution] = useState(comment.resolution); const [expectedVersion, setExpected] = useState(comment.version);
  async function submit(event: FormEvent) { event.preventDefault(); const changed = comment.status !== status || comment.resolution !== resolution.trim(); if (await action.run(async () => { await source.resolveCodeReviewComment(comment.id, status, resolution, expectedVersion); return true; })) setExpected(expectedVersion + (changed ? 1 : 0)); }
  return <article className="panel practice-content" id={`observacion-${comment.id}`} tabIndex={-1} aria-label={`Observación de código: ${kinds[comment.kind]}, versión ${comment.versionNumber}`}><div className="badges"><span className="badge">{kinds[comment.kind]}</span><span className="badge">{resolutions[comment.status]}</span><span className="muted">{comment.lineStart ? `Líneas ${comment.lineStart}–${comment.lineEnd}` : 'General'} · v{comment.versionNumber}</span></div><Author members={data.members} id={comment.authorId} /><RichText text={comment.body} />{comment.resolution && <blockquote><strong>Decisión del autor</strong><RichText text={comment.resolution} /></blockquote>}{canResolve && <form className="form" onSubmit={(event) => void submit(event)}><label className="field">Estado<select value={status} onChange={(e) => setStatus(e.target.value as CodeReviewResolution)}>{Object.entries(resolutions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field">Explica la decisión<textarea required={status !== 'pending'} maxLength={4000} value={resolution} onChange={(e) => setResolution(e.target.value)} /></label><ErrorMessage error={action.error} /><button disabled={action.pending}>Guardar decisión</button></form>}<ResourceComments target={{ kind: 'review-comment', id: comment.id }} title="Respuestas a esta observación" initiallyOpen={false} /></article>;
}
