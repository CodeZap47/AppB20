import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { PERIOD_COUNT, periodLabel } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Answer, Member, Question, Subject } from '../data/types';
import { Avatar } from '../components/Avatar';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { ResourceSection } from '../components/AcademicTools';
import { StructuredEditor, StructuredText } from '../components/StructuredText';
import { ContentWithdrawal } from '../components/ContentWithdrawal';
import { useAction } from '../components/useAction';
import { AttachmentUploader, useResourceUploadQueue } from '../components/uploads/ResourceUploader';
import { formatListTime, formatTime, memberName } from '../lib/format';
import { previewText } from '../lib/messages';
import { currentPlacement, lastPeriod, rememberPeriod } from '../lib/period';
import { matches, normalize, similarity } from '../lib/search';
import { bySubject } from '../lib/works';

const PERIODS = Array.from({ length: PERIOD_COUNT }, (_, i) => i + 1);

/** Filtros de estado de la lista; el valor es el que va en la URL (`?estado=`). */
const STATES = [
  { id: '', label: 'Todas' },
  { id: 'sin-respuesta', label: 'Sin respuesta' },
  { id: 'abiertas', label: 'Abiertas' },
  { id: 'resueltas', label: 'Resueltas' },
  { id: 'mias', label: 'Mis preguntas' },
  { id: 'retiradas', label: 'Retiradas' },
] as const;
type StateFilter = (typeof STATES)[number]['id'];
const isStateFilter = (value: string | null): value is StateFilter =>
  STATES.some((s) => s.id === value);

function answersOf(questionId: string, answers: Answer[]): Answer[] {
  return answers.filter((a) => a.questionId === questionId);
}

/** Última vez que alguien movió la pregunta: al hacerla o al responderla. */
function lastActivity(question: Question, answers: Answer[]): Date {
  return answersOf(question.id, answers).reduce(
    (latest, a) => (a.createdAt > latest ? a.createdAt : latest),
    question.createdAt,
  );
}

function inState(
  state: StateFilter,
  question: Question,
  answers: Answer[],
  meId?: string,
): boolean {
  if (state === 'retiradas') return Boolean(question.withdrawnAt);
  if (question.withdrawnAt) return false;
  switch (state) {
    case 'sin-respuesta':
      return question.status === 'open' && answersOf(question.id, answers).length === 0;
    case 'abiertas':
      return question.status === 'open';
    case 'resueltas':
      return question.status === 'resolved';
    case 'mias':
      return question.authorId === meId;
    default:
      return true;
  }
}

/** Orden de la lista; el valor es el que va en la URL (`?orden=`). */
const SORTS = [
  { id: '', label: 'Actividad reciente' },
  { id: 'nuevas', label: 'Más nuevas' },
  { id: 'respuestas', label: 'Más respondidas' },
] as const;
type Sort = (typeof SORTS)[number]['id'];
const isSort = (value: string | null): value is Sort => SORTS.some((s) => s.id === value);

function sorter(sort: Sort, answers: Answer[]): (a: Question, b: Question) => number {
  switch (sort) {
    case 'nuevas':
      return (a, b) => b.createdAt.getTime() - a.createdAt.getTime();
    case 'respuestas':
      return (a, b) =>
        answersOf(b.id, answers).length - answersOf(a.id, answers).length ||
        lastActivity(b, answers).getTime() - lastActivity(a, answers).getTime();
    default:
      return (a, b) => lastActivity(b, answers).getTime() - lastActivity(a, answers).getTime();
  }
}

function StatusBadge({ question, answerCount }: { question: Question; answerCount: number }) {
  if (question.status === 'resolved') {
    return <span className="badge badge--resolved">Resuelta</span>;
  }
  return answerCount ? (
    <span className="badge badge--open">Abierta</span>
  ) : (
    <span className="badge badge--unanswered">Sin respuesta</span>
  );
}

/** Materia y tema en una línea, para tarjetas y enlaces. */
function contextOf(question: Question, subjects: Subject[]): string {
  const subject = subjects.find((s) => s.id === question.subjectId)?.name ?? 'Materia desconocida';
  return question.topic ? `${subject} · ${question.topic}` : subject;
}

/** Dudas parecidas por título y tema; las de la misma materia pesan un poco más. */
function similarQuestions(
  text: string,
  subjectId: string,
  questions: Question[],
  excludeId?: string,
): Question[] {
  return questions
    .filter((q) => q.id !== excludeId)
    .map((q) => ({ q, score: similarity(text, `${q.title} ${q.topic}`) }))
    .filter((x) => x.score > 0)
    .map((x) => ({ ...x, score: x.score + (x.q.subjectId === subjectId ? 0.5 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.q);
}

/**
 * Recuadro de respuestas de la tarjeta: el número y el estado en texto, no solo en color.
 * Sin respuestas se marca en ámbar; resuelta, en verde con una palomita.
 */
function AnswerStat({ count, resolved }: { count: number; resolved: boolean }) {
  const tone = resolved ? 'resolved' : count ? 'open' : 'unanswered';
  return (
    <span className={`qa-stat qa-stat--${tone}`}>
      <span className="qa-stat__count">
        {resolved && <Icon name="check" size={16} />}
        {count}
      </span>
      <span className="qa-stat__label">
        {resolved ? 'resuelta' : count ? (count === 1 ? 'respuesta' : 'respuestas') : 'sin respuesta'}
      </span>
    </span>
  );
}

/** Contenido de la tarjeta; lo comparten la lista y la vista previa del formulario. */
function QuestionCardBody({
  title,
  context,
  excerpt,
  author,
  authorLabel,
  count,
  resolved,
  withdrawn,
  when,
}: {
  title: string;
  context: string;
  excerpt: string;
  author?: Member;
  authorLabel: string;
  count: number;
  resolved: boolean;
  withdrawn?: boolean;
  when: string;
}) {
  return (
    <>
      <AnswerStat count={count} resolved={resolved} />
      <span className="qa-card__body">
        <span className="work-card__top">
          {withdrawn && <span className="badge">Retirada</span>}
          <span className="work-card__context">{context}</span>
        </span>
        <strong className="work-card__title">{title}</strong>
        {excerpt && <span className="work-card__excerpt">{excerpt}</span>}
        <span className="work-card__footer">
          <Avatar member={author} size={24} />
          <span className="work-card__authors">{authorLabel}</span>
          <span className="work-card__date">{when}</span>
        </span>
      </span>
    </>
  );
}

function QuestionCard({
  question,
  answers,
  subjects,
  members,
  meId,
}: {
  question: Question;
  answers: Answer[];
  subjects: Subject[];
  members: Member[];
  meId?: string;
}) {
  const author = members.find((m) => m.id === question.authorId);
  return (
    <li>
      <Link to={`/m/preguntas/${question.id}`} className="work-card qa-card">
        <QuestionCardBody
          title={question.title}
          context={contextOf(question, subjects)}
          excerpt={previewText(question.body)}
          author={author}
          authorLabel={question.authorId === meId ? 'Tú' : (author?.displayName ?? 'Alguien')}
          count={answersOf(question.id, answers).length}
          resolved={question.status === 'resolved'}
          withdrawn={Boolean(question.withdrawnAt)}
          when={formatListTime(lastActivity(question, answers))}
        />
      </Link>
    </li>
  );
}

/** Dudas sin respuesta de otras personas, las que más tiempo llevan esperando primero. */
function NeedsHelp({ questions, answers, subjects, meId, onShowAll }: {
  questions: Question[];
  answers: Answer[];
  subjects: Subject[];
  meId?: string;
  onShowAll: () => void;
}) {
  const waiting = questions
    .filter((q) => !q.withdrawnAt && q.status === 'open' && q.authorId !== meId)
    .filter((q) => answersOf(q.id, answers).length === 0)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (!waiting.length) return null;
  return (
    <section className="qa-help" aria-labelledby="qa-help-title">
      <header className="qa-help__header">
        <h2 id="qa-help-title">Puedes ayudar</h2>
        <span className="muted">
          {waiting.length === 1 ? 'Una duda sigue' : `${waiting.length} dudas siguen`} sin respuesta
        </span>
        {waiting.length > 3 && (
          <button type="button" className="link-button" onClick={onShowAll}>
            Ver todas
          </button>
        )}
      </header>
      <ul className="qa-help__list">
        {waiting.slice(0, 3).map((q) => (
          <li key={q.id}>
            <Link to={`/m/preguntas/${q.id}`}>
              <strong>{q.title}</strong>
              <span className="muted">
                {contextOf(q, subjects)} · {formatListTime(q.createdAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Lista de dudas del grupo con búsqueda y filtros en la URL. */
export function QuestionsPage() {
  const { me, questions, answers, subjects, members } = useSnapshot();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const stateParam = params.get('estado');
  const state: StateFilter = isStateFilter(stateParam) ? stateParam : '';
  const subjectId = params.get('materia') ?? '';
  const sortParam = params.get('orden');
  const sort: Sort = isSort(sortParam) ? sortParam : '';

  const update = (changes: Record<string, string>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );

  const byQuery = questions.filter((q) =>
    matches(
      query,
      q.title,
      q.topic,
      q.body,
      contextOf(q, subjects),
      memberName(members, q.authorId),
    ),
  );
  // Cada conteo respeta los demás filtros: así se ve cuánto hay antes de elegir.
  const beforeState = byQuery.filter((q) => !subjectId || q.subjectId === subjectId);
  const beforeSubject = byQuery.filter((q) => inState(state, q, answers, me?.id));
  const shown = beforeState
    .filter((q) => inState(state, q, answers, me?.id))
    .sort(sorter(sort, answers));
  const subjectChips = subjects
    .filter((s) => questions.some((q) => q.subjectId === s.id))
    .sort(bySubject)
    .map((s) => ({ ...s, count: beforeSubject.filter((q) => q.subjectId === s.id).length }));
  const filtering = Boolean(query || state || subjectId);
  const askTo = `/m/preguntas/nueva${subjectId ? `?materia=${encodeURIComponent(subjectId)}` : ''}`;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Preguntas y respuestas</h1>
          <p className="muted">
            Dudas de clase, de tareas o de código. Antes de preguntar, busca: quizá alguien ya la
            resolvió.
          </p>
        </div>
        <div className="row">
          <Link to={askTo} className="button with-icon">
            <Icon name="plus" size={18} /> Hacer una pregunta
          </Link>
        </div>
      </header>

      {questions.length === 0 ? (
        <Empty
          icon="chat"
          title="Todavía no hay preguntas"
          action={
            <Link to={askTo} className="button">
              Hacer la primera
            </Link>
          }
        >
          Cuando alguien tenga una duda de una materia, aquí la verá todo el grupo para ayudar.
        </Empty>
      ) : (
        <>
          <div className="toolbar" role="search">
            <label className="search toolbar__search">
              <Icon name="search" size={18} />
              <input
                type="search"
                placeholder="Buscar por pregunta, tema, materia o autor"
                aria-label="Buscar preguntas"
                value={query}
                onChange={(e) => update({ q: e.target.value })}
              />
            </label>
            <select
              aria-label="Ordenar preguntas"
              value={sort}
              onChange={(e) => update({ orden: e.target.value })}
            >
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {!filtering && (
            <NeedsHelp
              questions={questions}
              answers={answers}
              subjects={subjects}
              meId={me?.id}
              onShowAll={() => update({ estado: 'sin-respuesta' })}
            />
          )}

          <div className="chips chips--scroll" role="group" aria-label="Estado">
            {STATES.map((s) => (
              <button
                key={s.id}
                type="button"
                className="chip"
                aria-pressed={state === s.id}
                onClick={() => update({ estado: s.id })}
              >
                {s.label}{' '}
                <span className="chip__count">
                  {beforeState.filter((q) => inState(s.id, q, answers, me?.id)).length}
                </span>
              </button>
            ))}
          </div>

          {subjectChips.length > 1 && (
            <div className="chips chips--small chips--scroll" role="group" aria-label="Materia">
              <button
                type="button"
                className="chip"
                aria-pressed={!subjectId}
                onClick={() => update({ materia: '' })}
              >
                Todas las materias
              </button>
              {subjectChips.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="chip"
                  aria-pressed={subjectId === s.id}
                  onClick={() => update({ materia: s.id })}
                >
                  {s.name} <span className="chip__count">{s.count}</span>
                </button>
              ))}
            </div>
          )}

          <p className="results muted" aria-live="polite">
            {shown.length} {shown.length === 1 ? 'pregunta' : 'preguntas'}{' '}
            {filtering ? 'con estos filtros' : 'en total'}
            {filtering && (
              <>
                {' · '}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setParams({}, { replace: true })}
                >
                  Limpiar filtros
                </button>
              </>
            )}
          </p>

          {shown.length === 0 ? (
            <Empty
              icon="search"
              title={
                state === 'sin-respuesta'
                  ? 'Todas tienen al menos una respuesta'
                  : 'No hay preguntas así'
              }
              action={
                <Link to={askTo} className="button secondary">
                  Hacer una pregunta
                </Link>
              }
            >
              {state === 'sin-respuesta'
                ? 'Revisa las abiertas: quizá alguna todavía necesita una mejor explicación.'
                : 'Prueba con otras palabras o quita algún filtro. Si nadie la ha hecho, pregúntala tú.'}
            </Empty>
          ) : (
            <ul className="work-grid qa-grid">
              {shown.map((q) => (
                <QuestionCard
                  key={q.id}
                  question={q}
                  answers={answers}
                  subjects={subjects}
                  members={members}
                  meId={me?.id}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

/** Formulario para preguntar, con sugerencias de dudas que ya existen (3.7). */
export function AskQuestionPage() {
  const source = useDataSource();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { me, questions, answers, subjects, calendar } = useSnapshot();
  const { error, pending, run } = useAction();
  const queue = useResourceUploadQueue();
  const saved = useRef<{ id: string; version: number } | null>(null);
  const submitting = useRef(false);
  const active = useRef(true);
  const [contentSaved, setContentSaved] = useState(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const locked = pending || queue.busy || contentSaved;
  const preset = subjects.find((s) => s.id === params.get('materia'));
  const [period, setPeriod] = useState(
    () => preset?.period ?? currentPlacement(calendar)?.period ?? lastPeriod(),
  );
  const periodSubjects = subjects.filter((s) => s.period === period).sort(bySubject);
  const [subjectId, setSubjectId] = useState(() => preset?.id ?? periodSubjects[0]?.id ?? '');
  const [topic, setTopic] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  if (!subjects.length) {
    return (
      <Empty icon="folder" title="Todavía no hay materias">
        Las preguntas se ordenan por materia. Cuando el grupo tenga materias podrás preguntar aquí.
      </Empty>
    );
  }

  const similar = similarQuestions(title, subjectId, questions);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current || queue.busy) return;
    submitting.current = true;
    try {
      await run(async () => {
        if (!saved.current) {
          const id = await source.askQuestion({ subjectId, topic: topic.trim(), title: title.trim(), body: body.trim() });
          if (!active.current) return;
          saved.current = { id, version: 1 };
          setContentSaved(true);
        }
        const target = saved.current;
        if (await queue.upload('question', target.id, target.version) && active.current) {
          rememberPeriod(period);
          void navigate(`/m/preguntas/${target.id}`, { replace: true });
        }
      });
    } finally { submitting.current = false; }
  };

  return (
    <>
      <Link to="/m/preguntas" className="back with-icon">
        <Icon name="back" size={16} /> Preguntas y respuestas
      </Link>
      <header className="page-header">
        <div>
          <h1>Hacer una pregunta</h1>
          <p className="muted">
            La verá todo el grupo. Entre más contexto des, mejor te pueden ayudar.
          </p>
        </div>
      </header>

      <div className="detail">
        <form className="panel form form--wide" onSubmit={submit}>
          <fieldset className="upload-form-fields" disabled={locked}>
          <section className="form__section">
            <h2>Tu pregunta</h2>
            <label className="field">
              <span className="field__label">Pregunta</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Por ejemplo: ¿Por qué mi ciclo for no termina?"
                maxLength={200}
                required
                autoFocus
              />
              <span className="field__hint">Escríbela como pregunta, en una línea.</span>
            </label>
            {similar.length > 0 && (
              <div className="qa-similar" aria-live="polite">
                <p className="qa-similar__title">
                  <Icon name="search" size={16} /> ¿Ya la preguntaron? Revisa antes de publicar:
                </p>
                <ul className="links">
                  {similar.map((q) => {
                    const count = answersOf(q.id, answers).length;
                    return (
                      <li key={q.id}>
                        <Link to={`/m/preguntas/${q.id}`}>
                          <strong>{q.title}</strong>
                          <span className="muted">
                            {q.status === 'resolved' ? 'Resuelta' : count ? 'Abierta' : 'Sin respuesta'} ·{' '}
                            {count} {count === 1 ? 'respuesta' : 'respuestas'} · {contextOf(q, subjects)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>

          <section className="form__section">
            <h2>De qué materia</h2>
            <div className="form__grid">
              <label className="field">
                <span className="field__label">Cuatrimestre</span>
                <select
                  value={period}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setPeriod(next);
                    setSubjectId(
                      subjects.filter((s) => s.period === next).sort(bySubject)[0]?.id ?? '',
                    );
                  }}
                >
                  {PERIODS.map((n) => (
                    <option key={n} value={n}>
                      {periodLabel(n)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Materia</span>
                <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required>
                  {periodSubjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span className="field__label">
                Tema <span className="field__optional">opcional</span>
              </span>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Por ejemplo: Ciclos, Tablas de verdad, Normalización"
                maxLength={120}
              />
            </label>
          </section>

          <section className="form__section">
            <h2>Contexto</h2>
            <StructuredEditor label="Qué intentaste (opcional)" value={body} onChange={setBody} rows={8} />
            <p className="field__hint">Qué esperabas, qué pasó y el error exacto.</p>
          </section>

          </fieldset>
          <AttachmentUploader queue={queue} disabled={pending || contentSaved} title="Archivos de la pregunta" />
          {contentSaved && <p className="field__hint">La pregunta ya está publicada. Termina o retira los archivos pendientes para continuar.</p>}

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="form__actions">
            <Link to="/m/preguntas" className="button secondary">
              Cancelar
            </Link>
            <button type="submit" disabled={pending || queue.busy || !title.trim() || !subjectId}>
              {contentSaved ? queue.pendingCount ? 'Reintentar archivos pendientes' : 'Continuar' : 'Publicar pregunta'}
            </button>
          </div>
        </form>

        <aside className="detail__side">
          <section className="panel">
            <h2 className="label">Así la verá el grupo</h2>
            <div className="work-card qa-card qa-card--preview" aria-hidden="true">
              <QuestionCardBody
                title={title.trim() || 'Tu pregunta aparecerá aquí'}
                context={
                  (subjects.find((s) => s.id === subjectId)?.name ?? 'Materia') +
                  (topic.trim() ? ` · ${topic.trim()}` : '')
                }
                excerpt={previewText(body)}
                author={me}
                authorLabel="Tú"
                count={0}
                resolved={false}
                when="ahora"
              />
            </div>
          </section>
          <section className="panel">
            <h2 className="label">Para que te respondan rápido</h2>
            <ul className="qa-tips">
              <li>Busca primero en la lista; quizá ya está resuelta.</li>
              <li>Una duda por pregunta, con un título que la resuma.</li>
              <li>Pega el código y el mensaje de error completos, no una foto.</li>
              <li>Cuenta qué ya intentaste y qué esperabas que pasara.</li>
              <li>Cuando una respuesta te sirva, márcala para que otros la encuentren.</li>
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}

function AnswerCard({
  answer,
  members,
  meId,
  accepted,
  onAccept,
}: {
  answer: Answer;
  members: Member[];
  meId?: string;
  accepted: boolean;
  onAccept?: () => void;
}) {
  const data = useSnapshot();
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const author = members.find((m) => m.id === answer.authorId);
  const useful = data.answerUsefulness.filter((item) => item.answerId === answer.id);
  const mine = useful.some((item) => item.memberId === meId);
  const canMark = meId && answer.authorId !== meId && !answer.withdrawnAt;
  return (
    <article className={accepted ? 'panel qa-answer answer--accepted' : 'panel qa-answer'}>
      <header className="qa-answer__meta">
        <Avatar member={author} size={28} />
        <span className="qa-answer__who">
          <strong>{answer.authorId === meId ? 'Tú' : (author?.displayName ?? 'Alguien')}</strong>
          <span className="muted"> · {formatTime(answer.createdAt)}</span>
        </span>
        {accepted && (
          <span className="qa-answer__accepted">
            <Icon name="check" size={16} /> Le ayudó a quien preguntó
          </span>
        )}
      </header>
      <StructuredText text={answer.body} />
      <ContentWithdrawal kind="answer" id={answer.id} version={answer.version ?? 1} withdrawnAt={answer.withdrawnAt}
        canEdit={answer.authorId === meId || data.me?.isCreator} reasonRequired={answer.authorId !== meId} />
      <ResourceSection kind="answer" id={answer.id} version={answer.version ?? 1} canEdit={answer.authorId === meId && !answer.withdrawnAt} title="Archivos de esta respuesta" />
      {accepted && (
        <p className="field__hint">
          Que le haya servido no la hace infalible: revisa el razonamiento.
        </p>
      )}
      <footer className="qa-answer__actions">
        <span className="qa-answer__useful">
          {useful.length
            ? `Útil para ${useful.length} ${useful.length === 1 ? 'compañero' : 'compañeros'}`
            : 'Nadie la ha marcado como útil'}
        </span>
        {canMark && (
          <button type="button" className="secondary" aria-pressed={mine} disabled={pending} onClick={() => void run(() => source.toggleAnswerUsefulness(answer.id))}>
            {mine ? 'Quitar mi señal de utilidad' : 'Esta explicación es útil'}
          </button>
        )}
        {onAccept && !answer.withdrawnAt && (
          <button type="button" className="secondary with-icon" onClick={onAccept}>
            <Icon name="check" size={16} /> Me ayudó esta respuesta
          </button>
        )}
      </footer>
      {error && <p className="error" role="alert">{error}</p>}
      <QuestionClarifications questionId={answer.questionId} answerId={answer.id} />
    </article>
  );
}

/** Página de una pregunta: el planteamiento, las respuestas y el formulario para responder. */
export function QuestionPage() {
  const { questionId } = useParams();
  return <QuestionDetail key={questionId} />;
}

function QuestionDetail() {
  const { questionId = '' } = useParams();
  const source = useDataSource();
  const { me, questions, answers, members, subjects, notes, museumEntries, answerUsefulness } = useSnapshot();
  const { error, pending, run } = useAction();
  const [answer, setAnswer] = useState('');
  const queue = useResourceUploadQueue();
  const saved = useRef<{ id: string; version: number } | null>(null);
  const submitting = useRef(false);
  const active = useRef(true);
  const [contentSaved, setContentSaved] = useState(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const question = questions.find((q) => q.id === questionId);

  if (!question) {
    return (
      <Empty
        icon="search"
        title="Esta pregunta ya no existe"
        action={
          <Link to="/m/preguntas" className="button">
            Ver todas las preguntas
          </Link>
        }
      >
        Puede que el enlace esté incompleto.
      </Empty>
    );
  }

  const subject = subjects.find((s) => s.id === question.subjectId);
  const isAuthor = question.authorId === me?.id;
  const author = members.find((m) => m.id === question.authorId);
  const list = answersOf(question.id, answers).sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const usefulCount = (answerId: string) =>
    answerUsefulness.filter((item) => item.answerId === answerId).length;
  const accepted = list.find((a) => a.id === question.acceptedAnswerId);
  // Después de la aceptada, las que más compañeros encontraron útiles; a igual señal, la más antigua.
  const rest = list
    .filter((a) => a !== accepted)
    .sort((a, b) => usefulCount(b.id) - usefulCount(a.id));
  const usefulTotal = list.reduce((total, a) => total + usefulCount(a.id), 0);
  const open = !question.withdrawnAt && question.status === 'open';
  const similar = similarQuestions(
    `${question.title} ${question.topic}`,
    question.subjectId,
    questions,
    question.id,
  );
  const topic = normalize(question.topic);
  const related = notes
    .filter((n) => n.subjectId === question.subjectId)
    .sort(
      (a, b) =>
        Number(Boolean(topic) && normalize(b.topic) === topic) -
          Number(Boolean(topic) && normalize(a.topic) === topic) ||
        b.updatedAt.getTime() - a.updatedAt.getTime(),
    )
    .slice(0, 4);
  const inSubject = `/m/preguntas?materia=${encodeURIComponent(question.subjectId)}`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current || queue.busy) return;
    submitting.current = true;
    try {
      await run(async () => {
        if (!saved.current) {
          const id = await source.answerQuestion(question.id, answer.trim());
          if (!active.current) return;
          saved.current = { id, version: 1 };
          setContentSaved(true);
        }
        const target = saved.current;
        if (await queue.upload('answer', target.id, target.version) && active.current) {
          queue.reset();
          saved.current = null;
          setContentSaved(false);
          setAnswer('');
        }
      });
    } finally { submitting.current = false; }
  };

  // El enrutador usa el hash de la URL, así que el salto al formulario se hace a mano.
  const goToReply = () => {
    const form = document.getElementById('responder');
    form?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form?.querySelector('textarea')?.focus({ preventScroll: true });
  };

  return (
    <>
      <Link to="/m/preguntas" className="back with-icon">
        <Icon name="back" size={16} /> Preguntas y respuestas
      </Link>
      {museumEntries.some((entry) => entry.questionId === question.id) && (
        <p className="qa-notice">
          <Icon name="folder" size={18} />
          <span>
            Esta pregunta pertenece al <Link to="/m/museo-bugs">Museo de bugs</Link>. Consulta allí
            la ficha corregida y su historial; este hilo conserva el enunciado original y la
            discusión.
          </span>
        </p>
      )}
      <header className="page-header">
        <div>
          <p className="eyebrow">
            {subject && (
              <>
                {periodLabel(subject.period)}
                {' · '}
              </>
            )}
            <Link to={inSubject}>{subject?.name ?? 'Materia desconocida'}</Link>
            {question.topic && ` · ${question.topic}`}
          </p>
          <h1>{question.title}</h1>
          <p className="qa-byline">
            <StatusBadge question={question} answerCount={list.length} />
            <span className="qa-byline__author">
              <Avatar member={author} size={22} />
              <span className="muted">
                {isAuthor ? 'Preguntaste' : `Preguntó ${author?.displayName ?? 'alguien'}`} ·{' '}
                {formatTime(question.createdAt)}
              </span>
            </span>
          </p>
        </div>
      </header>
      <ContentWithdrawal kind="question" id={question.id} version={question.version ?? 1} withdrawnAt={question.withdrawnAt}
        canEdit={isAuthor || me?.isCreator} reasonRequired={!isAuthor} />

      <div className="detail">
        <div className="detail__main">
          <section className="panel qa-question">
            {question.body ? (
              <StructuredText text={question.body} />
            ) : (
              <p className="muted">Sin más contexto que la pregunta.</p>
            )}
            <ResourceSection kind="question" id={question.id} version={question.version ?? 1} canEdit={isAuthor && !question.withdrawnAt} title="Archivos de la pregunta" />
            <QuestionClarifications questionId={question.id} />
          </section>

          <h2 className="section-title">
            Respuestas <span className="muted">{list.length}</span>
          </h2>
          {accepted && <AnswerCard answer={accepted} members={members} meId={me?.id} accepted />}
          {rest.map((a) => (
            <AnswerCard
              key={a.id}
              answer={a}
              members={members}
              meId={me?.id}
              accepted={false}
              onAccept={
                isAuthor && !question.withdrawnAt ? () => run(() => source.acceptAnswer(question.id, a.id)) : undefined
              }
            />
          ))}
          {list.length === 0 && (
            <Empty icon="chat" title="Nadie ha respondido todavía">
              {isAuthor
                ? 'Cuando alguien responda la verás aquí. Si encuentras la solución, compártela tú.'
                : '¿Sabes cómo resolverla? Tu explicación también le sirve al resto del grupo.'}
            </Empty>
          )}
          {!question.withdrawnAt && <form id="responder" className="panel form qa-reply" onSubmit={submit}>
            <fieldset className="upload-form-fields" disabled={pending || queue.busy || contentSaved}>
            <StructuredEditor label={isAuthor ? 'Agregar algo o responder' : 'Tu respuesta'} value={answer} onChange={setAnswer} rows={5} />
            <p className="field__hint">Explica el razonamiento, no solo el resultado. Las aclaraciones se escriben junto a la pregunta o respuesta correspondiente.</p>
            </fieldset>
            <AttachmentUploader queue={queue} disabled={pending || contentSaved} title="Archivos de la respuesta" />
            {contentSaved && <p className="field__hint">La respuesta ya está publicada. Termina o retira los archivos pendientes para continuar.</p>}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="form__actions">
              <button type="submit" className="with-icon" disabled={pending || queue.busy || !answer.trim()}>
                <Icon name="send" size={16} /> {contentSaved ? queue.pendingCount ? 'Reintentar archivos pendientes' : 'Continuar' : 'Responder'}
              </button>
            </div>
          </form>}
        </div>

        <aside className="detail__side">
          <section className="panel qa-status">
            <h2 className="label">Estado de la pregunta</h2>
            <dl className="facts">
              <dt>Estado</dt>
              <dd>
                {question.withdrawnAt ? (
                  <span className="badge">Retirada</span>
                ) : (
                  <StatusBadge question={question} answerCount={list.length} />
                )}
              </dd>
              <dt>Respuestas</dt>
              <dd>{list.length}</dd>
              <dt>Señales de utilidad</dt>
              <dd>{usefulTotal}</dd>
              <dt>Última actividad</dt>
              <dd>{formatListTime(lastActivity(question, answers))}</dd>
            </dl>
            {isAuthor && open && list.length > 0 && (
              <p className="field__hint">
                Cuando una respuesta te sirva, márcala con «Me ayudó esta respuesta»: la pregunta
                queda resuelta y la respuesta aparece primero.
              </p>
            )}
            {open && !isAuthor && (
              <button type="button" className="with-icon qa-status__action" onClick={goToReply}>
                <Icon name="reply" size={16} /> Escribir una respuesta
              </button>
            )}
            {isAuthor && !question.withdrawnAt && question.status === 'resolved' && (
              <button
                type="button"
                className="secondary qa-status__action"
                onClick={() => run(() => source.reopenQuestion(question.id))}
              >
                Reabrir pregunta
              </button>
            )}
          </section>

          <QuestionReferences question={question} />

          <section className="panel">
            <h2 className="label">Preguntas parecidas</h2>
            {similar.length ? (
              <ul className="links">
                {similar.map((q) => (
                  <li key={q.id}>
                    <Link to={`/m/preguntas/${q.id}`}>
                      <strong>{q.title}</strong>
                      <span className="muted">
                        {q.status === 'resolved' ? 'Resuelta' : 'Abierta'} ·{' '}
                        {answersOf(q.id, answers).length} resp.
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No hay otras parecidas.</p>
            )}
            <p className="panel__more">
              <Link to={inSubject}>Más de {subject?.name ?? 'esta materia'}</Link>
            </p>
          </section>

          {related.length > 0 && (
            <section className="panel">
              <h2 className="label">Notas de esta materia</h2>
              <ul className="links">
                {related.map((n) => (
                  <li key={n.id}>
                    <Link to={`/m/notas/${n.id}`}>
                      <strong>{n.title}</strong>
                      {n.topic && <span className="muted">{n.topic}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

/** Hilos separados de las respuestas: nunca cuentan como solución ni como respuesta aceptada. */
function QuestionClarifications({ questionId, answerId }: { questionId: string; answerId?: string }) {
  const { questionComments, members, me, questions, answers } = useSnapshot();
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const [text, setText] = useState('');
  const comments = questionComments.filter((item) => item.questionId === questionId && item.answerId === answerId);
  const withdrawn = Boolean(questions.find((question) => question.id === questionId)?.withdrawnAt || (answerId && answers.find((answer) => answer.id === answerId)?.withdrawnAt));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await run(async () => { await source.commentQuestion(questionId, text, answerId); return true; })) setText('');
  };
  return <details className="academic-comments">
    <summary>Aclaraciones ({comments.length})</summary>
    <p className="field__hint">Pide contexto o comenta esta {answerId ? 'respuesta' : 'pregunta'}. Las aclaraciones quedan separadas de las soluciones.</p>
    {comments.map((comment) => <article className="academic-comment" key={comment.id}><p className="muted">{memberName(members, comment.authorId)} · {formatTime(comment.createdAt)}</p><StructuredText text={comment.text} /></article>)}
    {me && !withdrawn && <form className="form" onSubmit={(event) => void submit(event)}><label className="field"><span className="field__label">Pedir una aclaración</span><textarea aria-label={answerId ? 'Aclaración sobre esta respuesta' : 'Aclaración sobre la pregunta'} value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} rows={3} required /></label><button type="submit" disabled={pending || !text.trim()}>Publicar aclaración</button></form>}
    {error && <p className="error" role="alert">{error}</p>}
  </details>;
}

function QuestionReferences({ question }: { question: Question }) {
  const { notes, guides, questionLinks, me } = useSnapshot();
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [noteIds, setNoteIds] = useState<string[]>([]);
  const [guideIds, setGuideIds] = useState<string[]>([]);
  const links = questionLinks.filter((link) => link.questionId === question.id);
  const toggle = (ids: string[], id: string) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
  const start = () => {
    setNoteIds(links.filter((link) => link.targetKind === 'note').map((link) => link.targetId));
    setGuideIds(links.filter((link) => link.targetKind === 'guide').map((link) => link.targetId));
    setEditing(true);
  };
  return <section className="panel"><h2 className="label">Notas y guías relacionadas</h2>
    {links.length ? <ul className="links">{links.map((link) => <li key={link.id}><Link to={link.targetKind === 'note' ? `/m/notas/${link.targetId}` : `/m/guias/${link.targetId}`}>{link.targetKind === 'note' ? notes.find((note) => note.id === link.targetId)?.title ?? 'Nota compartida' : guides.find((guide) => guide.id === link.targetId)?.title ?? 'Guía de estudio'}</Link></li>)}</ul> : <p className="muted">Todavía no hay notas ni guías enlazadas.</p>}
    {me && !question.withdrawnAt && !editing && <button type="button" className="secondary" onClick={start}>Enlazar material que amplíe la explicación</button>}
    {editing && <form className="form" onSubmit={(event) => { event.preventDefault(); void run(async () => { await source.saveQuestionLinks(question.id, noteIds, guideIds); setEditing(false); }); }}>
      <fieldset className="field"><legend>Notas compartidas de esta materia</legend>{notes.filter((note) => note.visibility === 'group' && note.subjectId === question.subjectId).map((note) => <label className="academic-choice" key={note.id}><input type="checkbox" checked={noteIds.includes(note.id)} onChange={() => setNoteIds(toggle(noteIds, note.id))} />{note.title}</label>)}</fieldset>
      <fieldset className="field"><legend>Guías de esta materia</legend>{guides.filter((guide) => guide.subjectId === question.subjectId).map((guide) => <label className="academic-choice" key={guide.id}><input type="checkbox" checked={guideIds.includes(guide.id)} onChange={() => setGuideIds(toggle(guideIds, guide.id))} />{guide.title}</label>)}</fieldset>
      <div className="row"><button type="submit" disabled={pending}>Guardar material relacionado</button><button type="button" className="secondary" disabled={pending} onClick={() => setEditing(false)}>Cancelar</button></div>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
