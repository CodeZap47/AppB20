import { useState, type FormEvent } from 'react';
import { ExamMaterialLink } from '../components/ExamMaterialLink';
import { Link, useNavigate, useParams } from 'react-router';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Note, NoteSource, NoteVisibility } from '../data/types';
import { SubjectSelect } from '../components/SubjectSelect';
import { RichText } from '../components/RichText';
import { ResourceDownloads, ResourceSection } from '../components/AcademicTools';
import { StructuredEditor, StructuredText } from '../components/StructuredText';
import { ContentWithdrawal } from '../components/ContentWithdrawal';
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
  const [withdrawn, setWithdrawn] = useState(false);

  const shown = notes
    .filter((note) => withdrawn ? Boolean(note.withdrawnAt) : !note.withdrawnAt)
    .filter((n) => !subjectId || n.subjectId === subjectId)
    .filter((n) => !onlyMine || n.authorId === me?.id)
    .filter((n) => matches(query, n.title, n.topic, n.session ?? '', n.tags.join(' '), n.body))
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
      <label className="check"><input type="checkbox" checked={withdrawn} onChange={(event) => setWithdrawn(event.target.checked)} />Ver publicaciones retiradas que puedo recuperar</label>
      {shown.length ? (
        <ul className="list">
          {shown.map((n) => (
            <li key={n.id}>
              <Link to={`/m/notas/${n.id}`} className="list__item">
                <strong>{n.title}</strong>
                <span className="muted">
                  {subjects.find((s) => s.id === n.subjectId)?.name}
                  {n.topic ? ` · ${n.topic}` : ''} · {memberName(members, n.authorId)} · v{n.version}
                  {n.session ? ` · Sesión ${n.session}` : ''}
                </span>
                <NoteBadges note={n} />
                {n.withdrawnAt && <span className="badge">Retirada</span>}
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
  const { notes, subjects, terms, assignments, activities, questions, resourceFiles } = useSnapshot();
  const existing = notes.find((n) => n.id === noteId);
  const { error, pending, run } = useAction();
  const [subjectId, setSubjectId] = useState(existing?.subjectId ?? subjects[0]?.id ?? '');
  const [topic, setTopic] = useState(existing?.topic ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [tags, setTags] = useState(existing?.tags.join(', ') ?? '');
  const [visibility, setVisibility] = useState<NoteVisibility>(existing?.visibility ?? 'personal');
  const [noteSource, setNoteSource] = useState<NoteSource>(existing?.source ?? 'student');
  const [termId, setTermId] = useState(existing?.termId ?? '');
  const [session, setSession] = useState(existing?.session ?? '');
  const [assignmentIds, setAssignmentIds] = useState(existing?.assignmentIds ?? []);
  const [activityIds, setActivityIds] = useState(existing?.activityIds ?? []);
  const [questionIds, setQuestionIds] = useState(existing?.questionIds ?? []);
  const [baseVersion] = useState(existing?.version);
  const toggle = (ids: string[], id: string) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];

  if (noteId && !existing) return <h1>Nota no encontrada</h1>;
  if (existing?.withdrawnAt) return <p className="placeholder">Restaura la publicación desde <Link to={`/m/notas/${existing.id}`}>su página</Link> antes de editarla.</p>;
  if (!subjects.length) {
    return <p className="placeholder">Primero crea una materia publicando un trabajo.</p>;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const id = await run(() =>
      source.saveNote({
        id: existing?.id,
        subjectId,
        topic,
        title,
        body,
        tags: tags.split(','),
        visibility,
        source: noteSource,
        termId: termId || undefined,
        session: session || undefined,
        assignmentIds,
        activityIds,
        questionIds,
        expectedVersion: baseVersion,
      }),
    );
    if (id) void navigate(`/m/notas/${id}`);
  };

  return (
    <form className="form" onSubmit={submit}>
      <h1>{existing ? 'Editar nota' : 'Nueva nota'}</h1>
      <div className="row">
        <SubjectSelect subjects={subjects} value={subjectId} onChange={(id) => { setSubjectId(id); setTermId(''); setAssignmentIds([]); setActivityIds([]); setQuestionIds([]); }} />
        <label className="field grow">
          Tema
          <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} />
        </label>
      </div>
      <div className="row">
        <label className="field grow">Parcial
          <select value={termId} onChange={(event) => setTermId(event.target.value)}><option value="">Sin clasificar</option>{terms.filter((term) => term.subjectId === subjectId).map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}</select>
        </label>
        <label className="field grow">Sesión
          <input type="date" value={session} onChange={(event) => setSession(event.target.value)} />
        </label>
      </div>
      <label className="field">
        Título
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
      </label>
      <StructuredEditor label="Contenido" value={body} onChange={setBody} rows={12} maxLength={50_000}
        files={resourceFiles.filter((file) => file.targetKind === 'note' && file.targetId === existing?.id)} />
      <label className="field">
        Etiquetas (separadas por coma)
        <input value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      <div className="row">
        <label className="field">
          Visibilidad
          <select value={visibility} disabled={Boolean(existing)} onChange={(e) => setVisibility(e.target.value as NoteVisibility)}>
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
      {existing?.visibility === 'personal' && <p className="field__hint">Esta nota sigue siendo personal. Desde su página puedes publicar una copia de una versión concreta para el grupo.</p>}
      <details>
        <summary>Enlazar tareas, actividades y preguntas</summary>
        <fieldset className="field"><legend>Tareas de esta materia</legend>{assignments.filter((item) => item.subjectId === subjectId).map((item) => <label key={item.id} className="academic-choice"><input type="checkbox" checked={assignmentIds.includes(item.id)} onChange={() => setAssignmentIds(toggle(assignmentIds, item.id))} />{item.title}</label>)}</fieldset>
        <fieldset className="field"><legend>Actividades de esta materia</legend>{activities.filter((item) => item.subjectId === subjectId).map((item) => <label key={item.id} className="academic-choice"><input type="checkbox" checked={activityIds.includes(item.id)} onChange={() => setActivityIds(toggle(activityIds, item.id))} />{item.title}</label>)}</fieldset>
        <fieldset className="field"><legend>Preguntas de esta materia</legend>{questions.filter((item) => item.subjectId === subjectId).map((item) => <label key={item.id} className="academic-choice"><input type="checkbox" checked={questionIds.includes(item.id)} onChange={() => setQuestionIds(toggle(questionIds, item.id))} />{item.title}</label>)}</fieldset>
      </details>
      {existing && baseVersion !== existing.version && <p className="error" role="alert">La nota cambió mientras la editabas. Conserva tu borrador y vuelve a abrir la edición antes de guardar.</p>}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" disabled={pending || Boolean(existing && baseVersion !== existing.version)}>Guardar</button>
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
  const { me, notes, noteComments, members, subjects, terms, assignments, activities, questions, noteVersions, resourceFiles } = useSnapshot();
  const navigate = useNavigate();
  const { error, pending, run } = useAction();
  const [comment, setComment] = useState('');
  const [publishing, setPublishing] = useState(false);
  const note = notes.find((n) => n.id === noteId);

  if (!note) return <h1>Nota no encontrada</h1>;
  const comments = noteComments.filter((c) => c.noteId === note.id);
  const history = noteVersions.filter((version) => version.noteId === note.id).sort((a, b) => b.version - a.version);
  const publications = notes.filter((item) => item.publishedFromId === note.id && item.visibility === 'group');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(async () => (await source.commentNote(note.id, comment), true))) setComment('');
  };

  return (
    <>
      <Link to="/m/notas" className="back">
        ← Notas
      </Link>
      <div className="row row--between">
        <h1>{note.title}</h1>
        <div className="row">
        {!note.withdrawnAt && <ExamMaterialLink kind="note" id={note.id} />}
        <Link to={`/m/repaso/tarjetas/nueva?nota=${encodeURIComponent(note.id)}`} className="button secondary">
          Crear tarjeta
        </Link>
        <Link to={`/m/aprende-ensenando/nueva?nota=${encodeURIComponent(note.id)}`} className="button secondary">
          Practicar explicándolo
        </Link>
        {!note.withdrawnAt && <Link to={`/m/exposiciones/nueva?nota=${encodeURIComponent(note.id)}`} className="button secondary">
          Ensayar exposición
        </Link>}
        {!note.withdrawnAt && note.visibility === 'group' && <Link to={`/m/salas?nota=${encodeURIComponent(note.id)}`} className="button secondary">Estudiar en una sala</Link>}
        {note.authorId === me?.id && !note.withdrawnAt && (
          <Link to={`/m/notas/${note.id}/editar`} className="button secondary">
            Editar
          </Link>
        )}
        </div>
      </div>
      <p className="muted">
        {subjects.find((s) => s.id === note.subjectId)?.name}
        {note.topic ? ` · ${note.topic}` : ''} · {memberName(members, note.authorId)} · versión{' '}
        {note.version} · {formatTime(note.updatedAt)}
      </p>
      <NoteBadges note={note} />
      {note.visibility === 'personal' && <p className="field__hint">Para estudiar este apunte en una sala, publica primero una copia para el grupo.</p>}
      <ContentWithdrawal kind="note" id={note.id} version={note.version} withdrawnAt={note.withdrawnAt}
        canEdit={note.authorId === me?.id || (note.visibility === 'group' && me?.isCreator)} reasonRequired={note.authorId !== me?.id} />
      {(note.termId || note.session) && <p className="muted">{terms.find((term) => term.id === note.termId)?.name ?? 'Sin parcial'}{note.session ? ` · Sesión ${note.session}` : ''}</p>}
      {note.source === 'ai' && (
        <p className="placeholder">Contenido generado con IA: revísalo antes de confiar en él.</p>
      )}
      <StructuredText text={note.body} />
      <ResourceSection kind="note" id={note.id} version={note.version} canEdit={note.authorId === me?.id && !note.withdrawnAt} />
      {Boolean(note.assignmentIds?.length || note.activityIds?.length || note.questionIds?.length) && <section className="panel"><h2 className="label">Material relacionado</h2><ul className="links">
        {note.assignmentIds?.map((id) => <li key={`assignment:${id}`}><Link to={`/m/tareas/${id}`}>{assignments.find((item) => item.id === id)?.title ?? 'Tarea relacionada'}</Link></li>)}
        {note.activityIds?.map((id) => <li key={`activity:${id}`}><Link to={`/m/actividades/${id}`}>{activities.find((item) => item.id === id)?.title ?? 'Actividad relacionada'}</Link></li>)}
        {note.questionIds?.map((id) => <li key={`question:${id}`}><Link to={`/m/preguntas/${id}`}>{questions.find((item) => item.id === id)?.title ?? 'Pregunta relacionada'}</Link></li>)}
      </ul></section>}
      {note.visibility === 'personal' && note.authorId === me?.id && !note.withdrawnAt && <section className="panel">
        <h2 className="label">Publicar una versión para el grupo</h2>
        <p>Tu original y sus cambios futuros siguen siendo personales. Se compartirá una copia de la versión {note.version}, con sus archivos actuales.</p>
        {!publishing ? <button type="button" className="secondary" onClick={() => setPublishing(true)}>Revisar publicación</button> : <div className="row"><button type="button" disabled={pending} onClick={() => void run(async () => { const id = await source.publishNoteVersion(note.id, note.version); void navigate(`/m/notas/${id}`); })}>Publicar esta versión para el grupo</button><button type="button" className="secondary" onClick={() => setPublishing(false)}>Cancelar</button></div>}
        {publications.length > 0 && <ul className="links">{publications.map((item) => <li key={item.id}><Link to={`/m/notas/${item.id}`}>Versión personal {item.publishedFromVersion} publicada: {item.title}</Link></li>)}</ul>}
      </section>}
      {history.length > 0 && <section className="panel academic-history"><h2 className="label">Historial de la nota</h2>
        <p className="field__hint">Restaurar guarda una versión nueva con clasificación, contenido, vínculos y archivos. El historial conserva la autoría y las versiones ya compartidas.</p>
        {history.map((revision) => <details key={revision.id} className="academic-version">
          <summary>Versión {revision.version} · {formatTime(revision.editedAt)}{revision.version === note.version ? ' · Actual' : ''}</summary>
          <p className="muted">{revision.editedBy ? memberName(members, revision.editedBy) : 'Editor anterior no registrado'}{revision.restoredFromVersion ? ` · Restaurada de v${revision.restoredFromVersion}` : ''}</p>
          <strong>{revision.title}</strong><p className="muted">{subjects.find((subject) => subject.id === revision.subjectId)?.name} · {revision.topic}{revision.session ? ` · Sesión ${revision.session}` : ''}</p>
          <StructuredText text={revision.body} />
          <ResourceDownloads files={resourceFiles.filter((file) => revision.attachmentIds.includes(file.id))} />
          {revision.version !== note.version && note.authorId === me?.id && !note.withdrawnAt && <button type="button" className="secondary" disabled={pending} onClick={() => void run(() => source.restoreNoteVersion(note.id, revision.version, note.version))}>Restaurar esta versión completa</button>}
        </details>)}
      </section>}

      <h2>Comentarios y propuestas ({comments.length})</h2>
      <p className="muted">Los comentarios no cambian la nota; su autor decide si la corrige.</p>
      <ul className="list">
        {comments.map((c) => (
          <li key={c.id} className="list__item">
            <span className="muted">
              {memberName(members, c.authorId)} · {formatTime(c.createdAt)}
            </span>
            <RichText text={c.text} />
          </li>
        ))}
      </ul>
      {!note.withdrawnAt && <form className="form" onSubmit={submit}>
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
      </form>}
    </>
  );
}
