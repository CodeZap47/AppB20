import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Note, NoteSource, NoteVisibility } from '../data/types';
import { SubjectSelect } from '../components/SubjectSelect';
import { RichText } from '../components/RichText';
import { useAction } from '../components/useAction';
import { formatTime, memberName } from '../lib/format';
import { matches } from '../lib/search';

const SOURCE_LABEL: Record<NoteSource, string> = {
  student: 'Apunte de alumno',
  teacher: 'Material del docente',
  ai: 'Generado con IA',
};

const VISIBILITY_LABEL: Record<NoteVisibility, string> = {
  group: 'Del grupo',
  personal: 'Personal',
};

function NoteBadges({ note }: { note: Note }) {
  return (
    <span className="badges">
      <span className={`badge badge--${note.visibility}`}>{VISIBILITY_LABEL[note.visibility]}</span>
      <span className={`badge badge--${note.source}`}>{SOURCE_LABEL[note.source]}</span>
      {note.tags.map((t) => (
        <span key={t} className="badge">
          #{t}
        </span>
      ))}
    </span>
  );
}

export function NotesPage() {
  const { notes, subjects, members, me } = useSnapshot();
  const [query, setQuery] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);

  const shown = notes
    .filter((n) => !subjectId || n.subjectId === subjectId)
    .filter((n) => !onlyMine || n.authorId === me?.id)
    .filter((n) => matches(query, n.title, n.topic, n.tags.join(' '), n.body))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return (
    <>
      <div className="row row--between">
        <h1>Notas de clase</h1>
        <Link to="/m/notas/nueva" className="button">
          Nueva nota
        </Link>
      </div>
      <div className="row">
        <label className="field grow">
          Buscar
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Título, tema, etiqueta o contenido"
          />
        </label>
        <SubjectSelect subjects={subjects} value={subjectId} onChange={setSubjectId} allowAll />
      </div>
      <label className="check">
        <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
        Solo mis notas
      </label>
      {shown.length ? (
        <ul className="list">
          {shown.map((n) => (
            <li key={n.id}>
              <Link to={`/m/notas/${n.id}`} className="list__item">
                <strong>{n.title}</strong>
                <span className="muted">
                  {subjects.find((s) => s.id === n.subjectId)?.name}
                  {n.topic ? ` · ${n.topic}` : ''} · {memberName(members, n.authorId)} · v{n.version}
                </span>
                <NoteBadges note={n} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No hay notas con esos filtros.</p>
      )}
    </>
  );
}

export function NoteFormPage() {
  const { noteId } = useParams();
  const source = useDataSource();
  const navigate = useNavigate();
  const { notes, subjects } = useSnapshot();
  const existing = notes.find((n) => n.id === noteId);
  const { error, run } = useAction();
  const [subjectId, setSubjectId] = useState(existing?.subjectId ?? subjects[0]?.id ?? '');
  const [topic, setTopic] = useState(existing?.topic ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [tags, setTags] = useState(existing?.tags.join(', ') ?? '');
  const [visibility, setVisibility] = useState<NoteVisibility>(existing?.visibility ?? 'personal');
  const [noteSource, setNoteSource] = useState<NoteSource>(existing?.source ?? 'student');

  if (noteId && !existing) return <h1>Nota no encontrada</h1>;
  if (!subjects.length) {
    return <p className="placeholder">Primero crea una materia publicando un trabajo.</p>;
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = run(() =>
      source.saveNote({
        id: existing?.id,
        subjectId,
        topic,
        title,
        body,
        tags: tags.split(','),
        visibility,
        source: noteSource,
      }),
    );
    if (id) void navigate(`/m/notas/${id}`);
  };

  return (
    <form className="form" onSubmit={submit}>
      <h1>{existing ? 'Editar nota' : 'Nueva nota'}</h1>
      <div className="row">
        <SubjectSelect subjects={subjects} value={subjectId} onChange={setSubjectId} />
        <label className="field grow">
          Tema
          <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} />
        </label>
      </div>
      <label className="field">
        Título
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
      </label>
      <label className="field">
        Contenido (usa ``` para bloques de código)
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} className="mono" />
      </label>
      <label className="field">
        Etiquetas (separadas por coma)
        <input value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      <div className="row">
        <label className="field">
          Visibilidad
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as NoteVisibility)}>
            <option value="personal">Personal (solo tú)</option>
            <option value="group">Compartida con el grupo</option>
          </select>
        </label>
        <label className="field">
          Origen
          <select value={noteSource} onChange={(e) => setNoteSource(e.target.value as NoteSource)}>
            {Object.entries(SOURCE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit">Guardar</button>
        <button type="button" className="secondary" onClick={() => void navigate(-1)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function NotePage() {
  const { noteId = '' } = useParams();
  const source = useDataSource();
  const { me, notes, noteComments, members, subjects } = useSnapshot();
  const { error, run } = useAction();
  const [comment, setComment] = useState('');
  const note = notes.find((n) => n.id === noteId);

  if (!note) return <h1>Nota no encontrada</h1>;
  const comments = noteComments.filter((c) => c.noteId === note.id);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (run(() => (source.commentNote(note.id, comment), true))) setComment('');
  };

  return (
    <>
      <Link to="/m/notas" className="back">
        ← Notas
      </Link>
      <div className="row row--between">
        <h1>{note.title}</h1>
        {note.authorId === me?.id && (
          <Link to={`/m/notas/${note.id}/editar`} className="button secondary">
            Editar
          </Link>
        )}
      </div>
      <p className="muted">
        {subjects.find((s) => s.id === note.subjectId)?.name}
        {note.topic ? ` · ${note.topic}` : ''} · {memberName(members, note.authorId)} · versión{' '}
        {note.version} · {formatTime(note.updatedAt)}
      </p>
      <NoteBadges note={note} />
      {note.source === 'ai' && (
        <p className="placeholder">Contenido generado con IA: revísalo antes de confiar en él.</p>
      )}
      <RichText text={note.body} />

      <h2>Comentarios y propuestas ({comments.length})</h2>
      <p className="muted">Los comentarios no cambian la nota; su autor decide si la corrige.</p>
      <ul className="list">
        {comments.map((c) => (
          <li key={c.id} className="list__item">
            <span className="muted">
              {memberName(members, c.authorId)} · {formatTime(c.createdAt)}
            </span>
            <span className="prewrap">{c.text}</span>
          </li>
        ))}
      </ul>
      <form className="form" onSubmit={submit}>
        <textarea
          aria-label="Comentario"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          placeholder="Comenta o propón una corrección"
        />
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button type="submit" disabled={!comment.trim()}>
            Comentar
          </button>
        </div>
      </form>
    </>
  );
}
