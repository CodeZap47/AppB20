import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { PERIOD_COUNT, periodLabel } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Answer, Member, Question, Subject } from '../data/types';
import { Avatar } from '../components/Avatar';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { RichText } from '../components/RichText';
import { useAction } from '../components/useAction';
import { formatDate, formatListTime, formatTime, memberName } from '../lib/format';
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
  const count = answersOf(question.id, answers).length;
  const excerpt = previewText(question.body);
  const author = members.find((m) => m.id === question.authorId);
  return (
    <li>
      <Link to={`/m/preguntas/${question.id}`} className="work-card">
        <span className="work-card__top">
          <StatusBadge question={question} answerCount={count} />
          <span className="work-card__context">{contextOf(question, subjects)}</span>
        </span>
        <strong className="work-card__title">{question.title}</strong>
        {excerpt && <span className="work-card__excerpt">{excerpt}</span>}
        <span className="work-card__footer">
          <Avatar member={author} size={24} />
          <span className="work-card__authors">
            {question.authorId === meId ? 'Tú' : (author?.displayName ?? 'Alguien')}
          </span>
          <span className="qa-count">
            <Icon name="chat" size={14} />
            {count}
            <span className="sr-only"> {count === 1 ? 'respuesta' : 'respuestas'}</span>
          </span>
          <span className="work-card__date">{formatListTime(lastActivity(question, answers))}</span>
        </span>
      </Link>
    </li>
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
    .sort((a, b) => lastActivity(b, answers).getTime() - lastActivity(a, answers).getTime());
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
          </div>

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
            <ul className="work-grid">
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
  const { questions, subjects, calendar } = useSnapshot();
  const { error, run } = useAction();
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = run(() =>
      source.askQuestion({
        subjectId,
        topic: topic.trim(),
        title: title.trim(),
        body: body.trim(),
      }),
    );
    if (id) {
      rememberPeriod(period);
      void navigate(`/m/preguntas/${id}`, { replace: true });
    }
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
                  {similar.map((q) => (
                    <li key={q.id}>
                      <Link to={`/m/preguntas/${q.id}`}>
                        <strong>{q.title}</strong>
                        <span className="muted">
                          {q.status === 'resolved' ? 'Resuelta' : 'Abierta'} ·{' '}
                          {contextOf(q, subjects)}
                        </span>
                      </Link>
                    </li>
                  ))}
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
            <label className="field">
              <span className="field__label">
                Qué intentaste <span className="field__optional">opcional</span>
              </span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                className="mono"
              />
              <span className="field__hint">
                Qué esperabas, qué pasó y el error exacto. Para pegar código, enciérralo entre
                líneas con ```.
              </span>
            </label>
          </section>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="form__actions">
            <Link to="/m/preguntas" className="button secondary">
              Cancelar
            </Link>
            <button type="submit" disabled={!title.trim() || !subjectId}>
              Publicar pregunta
            </button>
          </div>
        </form>

        <aside className="detail__side">
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
  const author = members.find((m) => m.id === answer.authorId);
  return (
    <article className={accepted ? 'panel qa-answer answer--accepted' : 'panel qa-answer'}>
      {accepted && (
        <p className="qa-answer__accepted">
          <Icon name="check" size={16} /> Le ayudó a quien preguntó
        </p>
      )}
      <header className="qa-answer__meta">
        <Avatar member={author} size={28} />
        <span>
          <strong>{answer.authorId === meId ? 'Tú' : (author?.displayName ?? 'Alguien')}</strong>
          <span className="muted"> · {formatTime(answer.createdAt)}</span>
        </span>
      </header>
      <RichText text={answer.body} />
      {accepted && (
        <p className="field__hint">
          Que le haya servido no la hace infalible: revisa el razonamiento.
        </p>
      )}
      {onAccept && (
        <div className="form__actions">
          <button type="button" className="secondary with-icon" onClick={onAccept}>
            <Icon name="check" size={16} /> Me ayudó esta respuesta
          </button>
        </div>
      )}
    </article>
  );
}

/** Página de una pregunta: el planteamiento, las respuestas y el formulario para responder. */
export function QuestionPage() {
  const { questionId = '' } = useParams();
  const source = useDataSource();
  const { me, questions, answers, members, subjects, notes } = useSnapshot();
  const { error, run } = useAction();
  const [answer, setAnswer] = useState('');
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
  const accepted = list.find((a) => a.id === question.acceptedAnswerId);
  const rest = list.filter((a) => a !== accepted);
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (run(() => source.answerQuestion(question.id, answer.trim()))) setAnswer('');
  };

  return (
    <>
      <Link to="/m/preguntas" className="back with-icon">
        <Icon name="back" size={16} /> Preguntas y respuestas
      </Link>
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
          <p className="muted">
            <StatusBadge question={question} answerCount={list.length} />{' '}
            {isAuthor ? 'Preguntaste' : `Preguntó ${memberName(members, question.authorId)}`},{' '}
            {formatTime(question.createdAt)}
          </p>
        </div>
        {isAuthor && question.status === 'resolved' && (
          <div className="row">
            <button
              type="button"
              className="secondary"
              onClick={() => run(() => source.reopenQuestion(question.id))}
            >
              Reabrir pregunta
            </button>
          </div>
        )}
      </header>

      <div className="detail">
        <div className="detail__main">
          <section className="panel">
            <header className="qa-answer__meta">
              <Avatar member={author} size={28} />
              <span>
                <strong>{isAuthor ? 'Tú' : (author?.displayName ?? 'Alguien')}</strong>
                <span className="muted"> · {formatDate(question.createdAt)}</span>
              </span>
            </header>
            {question.body ? (
              <RichText text={question.body} />
            ) : (
              <p className="muted">Sin más contexto que la pregunta.</p>
            )}
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
                isAuthor ? () => run(() => source.acceptAnswer(question.id, a.id)) : undefined
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
          {isAuthor && question.status === 'open' && list.length > 0 && (
            <p className="field__hint">
              Cuando una respuesta te sirva, márcala con «Me ayudó esta respuesta»: la pregunta
              queda resuelta y la respuesta aparece primero.
            </p>
          )}

          <form className="panel form qa-reply" onSubmit={submit}>
            <label className="field">
              <span className="field__label">
                {isAuthor ? 'Agregar algo o responder' : 'Tu respuesta'}
              </span>
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={5}
                className="mono"
              />
              <span className="field__hint">
                Explica el razonamiento, no solo el resultado. Para código usa ```.
              </span>
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="form__actions">
              <button type="submit" className="with-icon" disabled={!answer.trim()}>
                <Icon name="send" size={16} /> Responder
              </button>
            </div>
          </form>
        </div>

        <aside className="detail__side">
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
