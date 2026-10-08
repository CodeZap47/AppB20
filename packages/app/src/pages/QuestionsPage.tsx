import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { SubjectSelect } from '../components/SubjectSelect';
import { RichText } from '../components/RichText';
import { useAction } from '../components/useAction';
import { formatTime, memberName } from '../lib/format';
import { matches, similarity } from '../lib/search';

type StatusFilter = '' | 'open' | 'resolved';

export function QuestionsPage() {
  const { questions, answers, subjects } = useSnapshot();
  const [query, setQuery] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');

  const shown = questions
    .filter((q) => !subjectId || q.subjectId === subjectId)
    .filter((q) => !status || q.status === status)
    .filter((q) => matches(query, q.title, q.topic, q.body))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <>
      <div className="row row--between">
        <h1>Preguntas y respuestas</h1>
        <Link to="/m/preguntas/nueva" className="button">
          Preguntar
        </Link>
      </div>
      <div className="row">
        <label className="field grow">
          Buscar
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <SubjectSelect subjects={subjects} value={subjectId} onChange={setSubjectId} allowAll />
        <label className="field">
          Estado
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="">Todas</option>
            <option value="open">Abiertas</option>
            <option value="resolved">Resueltas</option>
          </select>
        </label>
      </div>
      {shown.length ? (
        <ul className="list">
          {shown.map((q) => (
            <li key={q.id}>
              <Link to={`/m/preguntas/${q.id}`} className="list__item">
                <strong>{q.title}</strong>
                <span className="muted">
                  {subjects.find((s) => s.id === q.subjectId)?.name}
                  {q.topic ? ` · ${q.topic}` : ''} ·{' '}
                  {answers.filter((a) => a.questionId === q.id).length} respuestas
                </span>
                <span className="badges">
                  <span className={`badge badge--${q.status}`}>
                    {q.status === 'resolved' ? 'Resuelta' : 'Abierta'}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No hay preguntas con esos filtros.</p>
      )}
    </>
  );
}

export function AskQuestionPage() {
  const source = useDataSource();
  const navigate = useNavigate();
  const { questions, subjects } = useSnapshot();
  const { error, run } = useAction();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? '');
  const [topic, setTopic] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  if (!subjects.length) {
    return <p className="placeholder">Primero crea una materia publicando un trabajo.</p>;
  }

  // Antes de publicar, sugiere dudas parecidas que ya existen (3.7).
  const similar = questions
    .map((q) => ({ q, score: similarity(title, `${q.title} ${q.topic}`) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = run(() => source.askQuestion({ subjectId, topic, title, body }));
    if (id) void navigate(`/m/preguntas/${id}`);
  };

  return (
    <form className="form" onSubmit={submit}>
      <h1>Nueva pregunta</h1>
      <label className="field">
        Pregunta
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
      </label>
      {similar.length > 0 && (
        <div className="card-surface">
          <strong>¿Ya la preguntaron?</strong>
          <ul>
            {similar.map(({ q }) => (
              <li key={q.id}>
                <Link to={`/m/preguntas/${q.id}`}>{q.title}</Link>
                {q.status === 'resolved' ? ' (resuelta)' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="row">
        <SubjectSelect subjects={subjects} value={subjectId} onChange={setSubjectId} />
        <label className="field grow">
          Tema
          <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} />
        </label>
      </div>
      <label className="field">
        Contexto (qué intentaste, código, error; usa ``` para código)
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="mono" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit">Publicar</button>
        <button type="button" className="secondary" onClick={() => void navigate(-1)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function QuestionPage() {
  const { questionId = '' } = useParams();
  const source = useDataSource();
  const { me, questions, answers, members, subjects } = useSnapshot();
  const { error, run } = useAction();
  const [answer, setAnswer] = useState('');
  const question = questions.find((q) => q.id === questionId);

  if (!question) return <h1>Pregunta no encontrada</h1>;
  const isAuthor = question.authorId === me?.id;
  const list = answers
    .filter((a) => a.questionId === question.id)
    .sort((a, b) =>
      a.id === question.acceptedAnswerId ? -1 : b.id === question.acceptedAnswerId ? 1 : 0,
    );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (run(() => source.answerQuestion(question.id, answer))) setAnswer('');
  };

  return (
    <>
      <Link to="/m/preguntas" className="back">
        ← Preguntas
      </Link>
      <h1>{question.title}</h1>
      <p className="muted">
        {subjects.find((s) => s.id === question.subjectId)?.name}
        {question.topic ? ` · ${question.topic}` : ''} · {memberName(members, question.authorId)} ·{' '}
        {formatTime(question.createdAt)}
      </p>
      <div className="row">
        <span className={`badge badge--${question.status}`}>
          {question.status === 'resolved' ? 'Resuelta' : 'Abierta'}
        </span>
        {isAuthor && question.status === 'resolved' && (
          <button type="button" className="secondary" onClick={() => run(() => source.reopenQuestion(question.id))}>
            Reabrir
          </button>
        )}
      </div>
      {question.body && <RichText text={question.body} />}

      <h2>Respuestas ({list.length})</h2>
      <ul className="list">
        {list.map((a) => {
          const accepted = a.id === question.acceptedAnswerId;
          return (
            <li key={a.id} className={accepted ? 'list__item answer--accepted' : 'list__item'}>
              <span className="muted">
                {memberName(members, a.authorId)} · {formatTime(a.createdAt)}
                {accepted ? ' · ✓ Le ayudó a quien preguntó' : ''}
              </span>
              <RichText text={a.body} />
              {isAuthor && !accepted && (
                <div className="row">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => run(() => source.acceptAnswer(question.id, a.id))}
                  >
                    Aceptar respuesta
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <form className="form" onSubmit={submit}>
        <label className="field">
          Tu respuesta (explica el razonamiento)
          <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={5} className="mono" />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button type="submit" disabled={!answer.trim()}>
            Responder
          </button>
        </div>
      </form>
    </>
  );
}
