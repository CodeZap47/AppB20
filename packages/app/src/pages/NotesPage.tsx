import { useState, type FormEvent } from 'react';
import { ExamMaterialLink } from '../components/ExamMaterialLink';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Member, Note, NoteSource, NoteVisibility, Subject } from '../data/types';
import { Avatar } from '../components/Avatar';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { SubjectSelect } from '../components/SubjectSelect';
import { RichText } from '../components/RichText';
import { ResourceDownloads, ResourceSection } from '../components/AcademicTools';
import { StructuredEditor, StructuredText } from '../components/StructuredText';
import { ContentWithdrawal } from '../components/ContentWithdrawal';
import { useAction } from '../components/useAction';
import { formatDate, formatListTime, formatTime, memberName } from '../lib/format';
import { previewText } from '../lib/messages';
import { matches } from '../lib/search';
import { bySubject } from '../lib/works';

const SOURCE_LABEL: Record<NoteSource, string> = {
  student: 'Apunte de alumno',
  teacher: 'Material del docente',
  ai: 'Generado con IA',
};

const VISIBILITY_LABEL: Record<NoteVisibility, string> = {
  group: 'Del grupo',
  personal: 'Personal',
};

/** Vistas de la lista; el valor es el que va en la URL (`?vista=`). */
const VIEWS = [
  { id: '', label: 'Todas' },
  { id: 'grupo', label: 'Del grupo' },
  { id: 'personales', label: 'Personales' },
  { id: 'mias', label: 'Mis notas' },
  { id: 'retiradas', label: 'Retiradas' },
] as const;
type View = (typeof VIEWS)[number]['id'];
const isView = (value: string | null): value is View => VIEWS.some((v) => v.id === value);

function inView(view: View, note: Note, meId?: string): boolean {
  if (view === 'retiradas') return Boolean(note.withdrawnAt);
  if (note.withdrawnAt) return false;
  switch (view) {
    case 'grupo':
      return note.visibility === 'group';
    case 'personales':
      return note.visibility === 'personal';
    case 'mias':
      return note.authorId === meId;
    default:
      return true;
  }
}

/** La sesión se guarda como `AAAA-MM-DD`; se muestra como «21 oct». */
function sessionLabel(session: string): string {
  const date = new Date(`${session}T00:00`);
  return Number.isNaN(date.getTime()) ? session : formatDate(date);
}

/** Extracto de una línea sin las marcas de títulos, listas, citas y código del editor. */
function excerptOf(body: string): string {
  return previewText(
    body
      .replace(/```[^\n]*/g, ' ')
      .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
      .replace(/`|\*\*/g, ''),
  );
}

/** Materia y tema en una línea, para tarjetas y enlaces. */
function contextOf(note: Note, subjects: Subject[]): string {
  const subject = subjects.find((s) => s.id === note.subjectId)?.name ?? 'Materia desconocida';
  return note.topic ? `${subject} · ${note.topic}` : subject;
}

function NoteBadges({ note, tags = true }: { note: Note; tags?: boolean }) {
  return (
    <span className="badges">
      <span className={`badge badge--${note.visibility}`}>{VISIBILITY_LABEL[note.visibility]}</span>
      <span className={`badge badge--${note.source}`}>{SOURCE_LABEL[note.source]}</span>
      {note.withdrawnAt && <span className="badge">Retirada</span>}
      {tags &&
        note.tags.map((t) => (
          <span key={t} className="badge">
            #{t}
          </span>
        ))}
    </span>
  );
}

function NoteCard({
  note,
  subjects,
  members,
  meId,
}: {
  note: Note;
  subjects: Subject[];
  members: Member[];
  meId?: string;
}) {
  const excerpt = excerptOf(note.body);
  const author = members.find((m) => m.id === note.authorId);
  return (
    <li>
      <Link to={`/m/notas/${note.id}`} className="work-card">
        <span className="work-card__top">
          <NoteBadges note={note} tags={false} />
          <span className="work-card__context">{contextOf(note, subjects)}</span>
        </span>
        <strong className="work-card__title">{note.title}</strong>
        {excerpt && <span className="work-card__excerpt">{excerpt}</span>}
        {note.tags.length > 0 && (
          <span className="note-card__tags">{note.tags.map((t) => `#${t}`).join(' ')}</span>
        )}
        <span className="work-card__footer">
          <Avatar member={author} size={24} />
          <span className="work-card__authors">
            {note.authorId === meId ? 'Tú' : (author?.displayName ?? 'Alguien')}
          </span>
          {note.session && <span className="work-card__date">Sesión {sessionLabel(note.session)}</span>}
          <span className="work-card__date">
            v{note.version} · {formatListTime(note.updatedAt)}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Notas del grupo y personales con búsqueda y filtros en la URL. */
export function NotesPage() {
  const { notes, subjects, members, me } = useSnapshot();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const viewParam = params.get('vista');
  const view: View = isView(viewParam) ? viewParam : '';
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

  const byQuery = notes.filter((n) =>
    matches(query, n.title, n.topic, n.session ?? '', n.tags.join(' '), n.body, memberName(members, n.authorId)),
  );
  // Cada conteo respeta los demás filtros: así se ve cuánto hay antes de elegir.
  const beforeView = byQuery.filter((n) => !subjectId || n.subjectId === subjectId);
  const beforeSubject = byQuery.filter((n) => inView(view, n, me?.id));
  const shown = beforeView
    .filter((n) => inView(view, n, me?.id))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const subjectChips = subjects
    .filter((s) => notes.some((n) => n.subjectId === s.id))
    .sort(bySubject)
    .map((s) => ({ ...s, count: beforeSubject.filter((n) => n.subjectId === s.id).length }));
  const filtering = Boolean(query || view || subjectId);
  const newTo = `/m/notas/nueva${subjectId ? `?materia=${encodeURIComponent(subjectId)}` : ''}`;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Notas de clase</h1>
          <p className="muted">
            Apuntes de cada sesión, personales o compartidos con el grupo. Úsalos para repasar,
            crear tarjetas o preparar un examen.
          </p>
        </div>
        <div className="row">
          <Link to={newTo} className="button with-icon">
            <Icon name="plus" size={18} /> Nueva nota
          </Link>
        </div>
      </header>

      {notes.length === 0 ? (
        <Empty
          icon="file"
          title="Todavía no hay notas"
          action={
            <Link to={newTo} className="button">
              Escribir la primera
            </Link>
          }
        >
          Guarda lo que se vio en clase. Puedes empezar en privado y compartir una copia con el
          grupo cuando esté lista.
        </Empty>
      ) : (
        <>
          <div className="toolbar" role="search">
            <label className="search toolbar__search">
              <Icon name="search" size={18} />
              <input
                type="search"
                placeholder="Buscar por título, tema, etiqueta, autor o contenido"
                aria-label="Buscar notas"
                value={query}
                onChange={(e) => update({ q: e.target.value })}
              />
            </label>
          </div>

          <div className="chips chips--scroll" role="group" aria-label="Vista">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                className="chip"
                aria-pressed={view === v.id}
                onClick={() => update({ vista: v.id })}
              >
                {v.label}{' '}
                <span className="chip__count">{beforeView.filter((n) => inView(v.id, n, me?.id)).length}</span>
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
            {shown.length} {shown.length === 1 ? 'nota' : 'notas'} {filtering ? 'con estos filtros' : 'en total'}
            {filtering && (
              <>
                {' · '}
                <button type="button" className="link-button" onClick={() => setParams({}, { replace: true })}>
                  Limpiar filtros
                </button>
              </>
            )}
          </p>

          {shown.length === 0 ? (
            <Empty
              icon="search"
              title={view === 'retiradas' ? 'No hay notas retiradas' : 'No hay notas así'}
              action={
                <Link to={newTo} className="button secondary">
                  Nueva nota
                </Link>
              }
            >
              {view === 'retiradas'
                ? 'Aquí aparecen las publicaciones retiradas que todavía puedes recuperar.'
                : 'Prueba con otras palabras o quita algún filtro.'}
            </Empty>
          ) : (
            <ul className="work-grid">
              {shown.map((n) => (
                <NoteCard key={n.id} note={n} subjects={subjects} members={members} meId={me?.id} />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

export function NoteFormPage() {
  const { noteId } = useParams();
  const [params] = useSearchParams();
  const source = useDataSource();
  const navigate = useNavigate();
  const { notes, subjects, terms, assignments, activities, questions, resourceFiles } = useSnapshot();
  const existing = notes.find((n) => n.id === noteId);
  const { error, pending, run } = useAction();
  const preset = subjects.find((s) => s.id === params.get('materia'))?.id;
  const [subjectId, setSubjectId] = useState(existing?.subjectId ?? preset ?? subjects[0]?.id ?? '');
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

  if (noteId && !existing) return <NoteMissing />;
  if (existing?.withdrawnAt) return <p className="placeholder">Restaura la publicación desde <Link to={`/m/notas/${existing.id}`}>su página</Link> antes de editarla.</p>;
  if (!subjects.length) {
    return (
      <Empty icon="folder" title="Todavía no hay materias" action={<Link to="/m/tareas" className="button">Ir a tareas</Link>}>
        Primero crea una materia publicando un trabajo.
      </Empty>
    );
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

  const linkable = {
    assignments: assignments.filter((item) => item.subjectId === subjectId),
    activities: activities.filter((item) => item.subjectId === subjectId),
    questions: questions.filter((item) => item.subjectId === subjectId),
  };
  const linkedCount = assignmentIds.length + activityIds.length + questionIds.length;

  return (
    <>
      <Link to={existing ? `/m/notas/${existing.id}` : '/m/notas'} className="back with-icon">
        <Icon name="back" size={16} /> {existing ? existing.title : 'Notas de clase'}
      </Link>
      <header className="page-header">
        <div>
          <h1>{existing ? 'Editar nota' : 'Nueva nota'}</h1>
          <p className="muted">
            {existing
              ? `Al guardar se crea la versión ${existing.version + 1}; las anteriores quedan en el historial.`
              : 'Empieza en privado si quieres: luego puedes compartir una copia con el grupo.'}
          </p>
        </div>
      </header>
      <form className="form panel form--wide" onSubmit={submit}>
        <section className="form__section">
          <h2>Clasificación</h2>
          <div className="form__grid">
            <SubjectSelect subjects={subjects} value={subjectId} onChange={(id) => { setSubjectId(id); setTermId(''); setAssignmentIds([]); setActivityIds([]); setQuestionIds([]); }} />
            <label className="field">
              Tema
              <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} />
            </label>
            <label className="field">Parcial
              <select value={termId} onChange={(event) => setTermId(event.target.value)}><option value="">Sin clasificar</option>{terms.filter((term) => term.subjectId === subjectId).map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}</select>
            </label>
            <label className="field">Sesión
              <input type="date" value={session} onChange={(event) => setSession(event.target.value)} />
            </label>
          </div>
        </section>

        <section className="form__section">
          <h2>Apunte</h2>
          <label className="field">
            Título
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
          </label>
          <StructuredEditor label="Contenido" value={body} onChange={setBody} rows={12} maxLength={50_000}
            files={resourceFiles.filter((file) => file.targetKind === 'note' && file.targetId === existing?.id)} />
          <label className="field">
            Etiquetas
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="derivadas, ejercicios, repaso" />
            <span className="field__hint">Sepáralas con comas. Ayudan a encontrar la nota al buscar.</span>
          </label>
        </section>

        <section className="form__section">
          <h2>Quién la ve</h2>
          <div className="form__grid">
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
          {existing?.visibility === 'group' && <p className="field__hint">La visibilidad no cambia después de crear la nota.</p>}
        </section>

        <section className="form__section">
          <details>
            <summary>Enlazar tareas, actividades y preguntas{linkedCount ? ` (${linkedCount})` : ''}</summary>
            <fieldset className="field"><legend>Tareas de esta materia</legend>{linkable.assignments.length ? linkable.assignments.map((item) => <label key={item.id} className="academic-choice"><input type="checkbox" checked={assignmentIds.includes(item.id)} onChange={() => setAssignmentIds(toggle(assignmentIds, item.id))} />{item.title}</label>) : <span className="field__hint">No hay tareas en esta materia.</span>}</fieldset>
            <fieldset className="field"><legend>Actividades de esta materia</legend>{linkable.activities.length ? linkable.activities.map((item) => <label key={item.id} className="academic-choice"><input type="checkbox" checked={activityIds.includes(item.id)} onChange={() => setActivityIds(toggle(activityIds, item.id))} />{item.title}</label>) : <span className="field__hint">No hay actividades en esta materia.</span>}</fieldset>
            <fieldset className="field"><legend>Preguntas de esta materia</legend>{linkable.questions.length ? linkable.questions.map((item) => <label key={item.id} className="academic-choice"><input type="checkbox" checked={questionIds.includes(item.id)} onChange={() => setQuestionIds(toggle(questionIds, item.id))} />{item.title}</label>) : <span className="field__hint">No hay preguntas en esta materia.</span>}</fieldset>
          </details>
        </section>

        {existing && baseVersion !== existing.version && <p className="error" role="alert">La nota cambió mientras la editabas. Conserva tu borrador y vuelve a abrir la edición antes de guardar.</p>}
        {error && <p className="error">{error}</p>}
        <div className="form__actions">
          <button type="button" className="secondary" onClick={() => void navigate(-1)}>
            Cancelar
          </button>
          <button type="submit" disabled={pending || Boolean(existing && baseVersion !== existing.version)}>Guardar</button>
        </div>
      </form>
    </>
  );
}

function NoteMissing() {
  return (
    <Empty
      icon="search"
      title="Nota no encontrada"
      action={
        <Link to="/m/notas" className="button">
          Ver todas las notas
        </Link>
      }
    >
      Puede que el enlace esté incompleto o que la nota sea personal de otra persona.
    </Empty>
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

  if (!note) return <NoteMissing />;
  const comments = noteComments.filter((c) => c.noteId === note.id);
  const history = noteVersions.filter((version) => version.noteId === note.id).sort((a, b) => b.version - a.version);
  const publications = notes.filter((item) => item.publishedFromId === note.id && item.visibility === 'group');
  const subject = subjects.find((s) => s.id === note.subjectId);
  const term = terms.find((t) => t.id === note.termId);
  const isAuthor = note.authorId === me?.id;
  const active = !note.withdrawnAt;
  const ref = encodeURIComponent(note.id);
  const hasRelated = Boolean(note.assignmentIds?.length || note.activityIds?.length || note.questionIds?.length);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(async () => (await source.commentNote(note.id, comment), true))) setComment('');
  };

  return (
    <>
      <Link to="/m/notas" className="back with-icon">
        <Icon name="back" size={16} /> Notas de clase
      </Link>
      <header className="page-header">
        <div>
          <p className="eyebrow">
            <Link to={`/m/notas?materia=${encodeURIComponent(note.subjectId)}`}>{subject?.name ?? 'Materia desconocida'}</Link>
            {note.topic && ` · ${note.topic}`}
            {term && ` · ${term.name}`}
            {note.session && ` · Sesión ${sessionLabel(note.session)}`}
          </p>
          <h1>{note.title}</h1>
          <p className="muted">
            {isAuthor ? 'Escribiste' : `Escribió ${memberName(members, note.authorId)}`} · versión {note.version} ·{' '}
            {formatTime(note.updatedAt)}
          </p>
          <NoteBadges note={note} />
        </div>
        {active && (
          <div className="row">
            <Link className="button secondary" to={`/ajustes?aiSource=note:${note.id}&purpose=explanation`}>Explicar con Gemini</Link>
            {isAuthor && (
              <Link to={`/m/notas/${note.id}/editar`} className="button with-icon">
                <Icon name="edit" size={16} /> Editar
              </Link>
            )}
          </div>
        )}
      </header>
      <ContentWithdrawal kind="note" id={note.id} version={note.version} withdrawnAt={note.withdrawnAt}
        canEdit={isAuthor || (note.visibility === 'group' && me?.isCreator)} reasonRequired={!isAuthor} />

      <div className="detail">
        <div className="detail__main">
          {note.source === 'ai' && (
            <p className="placeholder">Contenido generado con IA: revísalo antes de confiar en él.</p>
          )}
          <section className="panel">
            {note.body.trim() ? <StructuredText text={note.body} /> : <p className="muted">Esta nota todavía no tiene contenido.</p>}
            <ResourceSection kind="note" id={note.id} version={note.version} canEdit={isAuthor && active} />
          </section>

          <h2 className="section-title">
            Comentarios y propuestas <span className="muted">{comments.length}</span>
          </h2>
          <p className="field__hint">Los comentarios no cambian la nota; su autor decide si la corrige.</p>
          {comments.length > 0 ? (
            comments.map((c) => {
              const author = members.find((m) => m.id === c.authorId);
              return (
                <article key={c.id} className="panel qa-answer">
                  <header className="qa-answer__meta">
                    <Avatar member={author} size={28} />
                    <span>
                      <strong>{c.authorId === me?.id ? 'Tú' : (author?.displayName ?? 'Alguien')}</strong>
                      <span className="muted"> · {formatTime(c.createdAt)}</span>
                    </span>
                  </header>
                  <RichText text={c.text} />
                </article>
              );
            })
          ) : (
            <p className="muted">Nadie ha comentado todavía.</p>
          )}
          {active && <form className="panel form" onSubmit={submit}>
            <textarea
              aria-label="Comentario"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="Comenta o propón una corrección"
            />
            {error && <p className="error">{error}</p>}
            <div className="form__actions">
              <button type="submit" className="with-icon" disabled={!comment.trim()}>
                <Icon name="send" size={16} /> Comentar
              </button>
            </div>
          </form>}
        </div>

        <aside className="detail__side">
          <section className="panel">
            <h2 className="label">Estudiar con esta nota</h2>
            <ul className="links">
              <li><Link to={`/m/repaso/tarjetas/nueva?nota=${ref}`}>Crear tarjeta</Link></li>
              <li><Link to={`/m/aprende-ensenando/nueva?nota=${ref}`}>Practicar explicándolo</Link></li>
              {active && <li><Link to={`/m/exposiciones/nueva?nota=${ref}`}>Ensayar exposición</Link></li>}
              {active && note.visibility === 'group' && <li><Link to={`/m/salas?nota=${ref}`}>Estudiar en una sala</Link></li>}
              {active && <li><ExamMaterialLink kind="note" id={note.id} className="" /></li>}
            </ul>
            {note.visibility === 'personal' && <p className="field__hint">Para estudiar este apunte en una sala, publica primero una copia para el grupo.</p>}
          </section>

          {hasRelated && <section className="panel"><h2 className="label">Material relacionado</h2><ul className="links">
            {note.assignmentIds?.map((id) => <li key={`assignment:${id}`}><Link to={`/m/tareas/${id}`}>{assignments.find((item) => item.id === id)?.title ?? 'Tarea relacionada'}<span className="muted">Tarea</span></Link></li>)}
            {note.activityIds?.map((id) => <li key={`activity:${id}`}><Link to={`/m/actividades/${id}`}>{activities.find((item) => item.id === id)?.title ?? 'Actividad relacionada'}<span className="muted">Actividad</span></Link></li>)}
            {note.questionIds?.map((id) => <li key={`question:${id}`}><Link to={`/m/preguntas/${id}`}>{questions.find((item) => item.id === id)?.title ?? 'Pregunta relacionada'}<span className="muted">Pregunta</span></Link></li>)}
          </ul></section>}

          {note.visibility === 'personal' && isAuthor && active && <section className="panel">
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
              <strong>{revision.title}</strong><p className="muted">{subjects.find((s) => s.id === revision.subjectId)?.name} · {revision.topic}{revision.session ? ` · Sesión ${revision.session}` : ''}</p>
              <StructuredText text={revision.body} />
              <ResourceDownloads files={resourceFiles.filter((file) => revision.attachmentIds.includes(file.id))} />
              {revision.version !== note.version && isAuthor && active && <button type="button" className="secondary" disabled={pending} onClick={() => void run(() => source.restoreNoteVersion(note.id, revision.version, note.version))}>Restaurar esta versión completa</button>}
            </details>)}
          </section>}
        </aside>
      </div>
    </>
  );
}
