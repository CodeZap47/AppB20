import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ExamMaterialLink } from '../components/ExamMaterialLink';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Member, Note, NoteSource, NoteVisibility, Subject } from '../data/types';
import { Avatar } from '../components/Avatar';
import { Empty } from '../components/Empty';
import { Icon, type IconName } from '../components/Icon';
import { SubjectSelect } from '../components/SubjectSelect';
import { RichText } from '../components/RichText';
import { ResourceDownloads, ResourceSection } from '../components/AcademicTools';
import { StructuredEditor, StructuredText } from '../components/StructuredText';
import { ContentWithdrawal } from '../components/ContentWithdrawal';
import { useAction } from '../components/useAction';
import { AttachmentUploader, useResourceUploadQueue } from '../components/uploads/ResourceUploader';
import { formatDate, formatListTime, formatTime, memberName } from '../lib/format';
import { previewText } from '../lib/messages';
import { matches } from '../lib/search';
import { bySubject } from '../lib/works';
import './NotesPage.css';

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

function NoteBadges({ note, tags = true }: { note: Note; tags?: boolean }) {
  return (
    <span className="badges notes-badges">
      <span className={`badge badge--${note.visibility}`}>
        <Icon name={note.visibility === 'personal' ? 'lock' : 'users'} size={12} />
        {VISIBILITY_LABEL[note.visibility]}
      </span>
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
  const subject = subjects.find((s) => s.id === note.subjectId);
  return (
    <li>
      <Link to={`/m/notas/${note.id}`} className="notes-card">
        <span className="notes-card__context">
          <span className="notes-card__icon">
            <Icon name="book" size={19} />
          </span>
          <span>
            <span className="notes-card__subject">{subject?.name ?? 'Materia desconocida'}</span>
            {note.topic && <span className="notes-card__topic">{note.topic}</span>}
          </span>
        </span>
        <strong className="notes-card__title">{note.title}</strong>
        <span className="notes-card__excerpt">
          {excerpt || 'Esta nota todavía no tiene contenido.'}
        </span>
        {note.tags.length > 0 && (
          <span className="notes-card__tags">{note.tags.map((t) => `#${t}`).join('  ')}</span>
        )}
        <span className="notes-card__classification">
          <NoteBadges note={note} tags={false} />
        </span>
        <span className="notes-card__footer">
          <Avatar member={author} size={28} />
          <span className="notes-card__author">
            {note.authorId === meId ? 'Tú' : (author?.displayName ?? 'Alguien')}
          </span>
          <time dateTime={note.updatedAt.toISOString()}>{formatListTime(note.updatedAt)}</time>
        </span>
        <span className="notes-card__edition">
          <span>
            {note.session ? `Sesión ${sessionLabel(note.session)}` : 'Sin sesión asignada'}
          </span>
          <span className={note.isFinal ? 'notes-card__final' : undefined}>
            {note.isFinal && <Icon name="check" size={13} />}
            {note.isFinal ? 'Versión final' : `Versión ${note.version}`}
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
    matches(
      query,
      n.title,
      n.topic,
      n.session ?? '',
      n.tags.join(' '),
      n.body,
      memberName(members, n.authorId),
    ),
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
    <div className="notes-page">
      <header className="notes-header">
        <div>
          <p className="notes-eyebrow">
            <Icon name="book" size={16} /> Biblioteca de apuntes
          </p>
          <h1>Notas de clase</h1>
          <p className="muted">
            Lo que aprendemos en clase, en un solo lugar. Guarda tus apuntes y comparte con el
            grupo.
          </p>
        </div>
        <div className="row">
          <Link to={newTo} className="button with-icon notes-primary">
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
          <section className="notes-filters" aria-label="Filtrar notas">
            <div role="search">
              <label className="notes-search">
                <Icon name="search" size={18} />
                <input
                  type="search"
                  placeholder="Busca por título, tema, etiqueta, autor o contenido…"
                  aria-label="Buscar notas"
                  value={query}
                  onChange={(e) => update({ q: e.target.value })}
                />
              </label>
            </div>

            <div className="notes-views" role="group" aria-label="Vista">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="notes-view"
                  aria-pressed={view === v.id}
                  onClick={() => update({ vista: v.id })}
                >
                  {v.label}{' '}
                  <span className="notes-count">
                    {beforeView.filter((n) => inView(v.id, n, me?.id)).length}
                  </span>
                </button>
              ))}
            </div>

            {subjectChips.length > 1 && (
              <div className="notes-subjects" role="group" aria-label="Materia">
                <span className="notes-filter-label">Materia</span>
                <button
                  type="button"
                  className="notes-subject"
                  aria-pressed={!subjectId}
                  onClick={() => update({ materia: '' })}
                >
                  Todas las materias
                </button>
                {subjectChips.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="notes-subject"
                    aria-pressed={subjectId === s.id}
                    onClick={() => update({ materia: s.id })}
                  >
                    {s.name} <span className="notes-count">{s.count}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <p className="notes-results" aria-live="polite">
            {shown.length} {shown.length === 1 ? 'nota' : 'notas'}{' '}
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
            <ul className="notes-grid" aria-label="Notas de clase">
              {shown.map((n) => (
                <NoteCard key={n.id} note={n} subjects={subjects} members={members} meId={me?.id} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export function NoteFormPage() {
  const { noteId } = useParams();
  return <NoteForm key={noteId ?? 'nueva'} />;
}

function NoteForm() {
  const { noteId } = useParams();
  const [params] = useSearchParams();
  const source = useDataSource();
  const navigate = useNavigate();
  const { notes, subjects, terms, assignments, activities, questions, resourceFiles } =
    useSnapshot();
  const existing = notes.find((n) => n.id === noteId);
  const { error, pending, run } = useAction();
  const queue = useResourceUploadQueue();
  const saved = useRef<{ id: string; version: number } | null>(null);
  const submitting = useRef(false);
  const active = useRef(true);
  const [contentSaved, setContentSaved] = useState(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const preset = subjects.find((s) => s.id === params.get('materia'))?.id;
  const [subjectId, setSubjectId] = useState(
    existing?.subjectId ?? preset ?? subjects[0]?.id ?? '',
  );
  const [topic, setTopic] = useState(existing?.topic ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [tags, setTags] = useState(existing?.tags.join(', ') ?? '');
  const [visibility, setVisibility] = useState<NoteVisibility>(() =>
    existing?.visibility ?? (!noteId && params.get('visibilidad') === 'grupo' ? 'group' : 'personal'),
  );
  const [noteSource, setNoteSource] = useState<NoteSource>(existing?.source ?? 'student');
  const [isFinal, setIsFinal] = useState(existing?.isFinal ?? false);
  const [termId, setTermId] = useState(existing?.termId ?? '');
  const [session, setSession] = useState(existing?.session ?? '');
  const [assignmentIds, setAssignmentIds] = useState(
    existing?.assignmentIds ??
      assignments
        .filter(
          (assignment) =>
            assignment.id === params.get('tarea') &&
            assignment.subjectId === (preset ?? subjects[0]?.id),
        )
        .map((assignment) => assignment.id),
  );
  const [activityIds, setActivityIds] = useState(existing?.activityIds ?? []);
  const [questionIds, setQuestionIds] = useState(existing?.questionIds ?? []);
  const [baseVersion] = useState(existing?.version);
  const locked = pending || queue.busy || contentSaved;
  const conflict = Boolean(existing && !contentSaved && baseVersion !== existing.version);
  const toggle = (ids: string[], id: string) =>
    ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];

  if (noteId && !existing) return <NoteMissing />;
  if (existing?.withdrawnAt)
    return (
      <p className="placeholder">
        Restaura la publicación desde <Link to={`/m/notas/${existing.id}`}>su página</Link> antes de
        editarla.
      </p>
    );
  if (!subjects.length) {
    return (
      <Empty
        icon="folder"
        title="Todavía no hay materias"
        action={
          <Link to="/m/tareas" className="button">
            Ir a tareas
          </Link>
        }
      >
        Primero crea una materia publicando un trabajo.
      </Empty>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current || queue.busy || conflict) return;
    submitting.current = true;
    try {
      await run(async () => {
        if (!saved.current) {
          const id = await source.saveNote({
            id: existing?.id,
            subjectId,
            topic,
            title,
            body,
            tags: tags.split(','),
            visibility,
            source: noteSource,
            isFinal,
            termId: termId || undefined,
            session: session || undefined,
            assignmentIds,
            activityIds,
            questionIds,
            expectedVersion: baseVersion,
          });
          if (!active.current) return;
          saved.current = { id, version: existing ? baseVersion! + 1 : 1 };
          setContentSaved(true);
        }
        const target = saved.current;
        if ((await queue.upload('note', target.id, target.version)) && active.current) {
          void navigate(`/m/notas/${target.id}`);
        }
      });
    } finally {
      submitting.current = false;
    }
  };

  const linkable = {
    assignments: assignments.filter((item) => item.subjectId === subjectId),
    activities: activities.filter((item) => item.subjectId === subjectId),
    questions: questions.filter((item) => item.subjectId === subjectId),
  };
  const linkedCount = assignmentIds.length + activityIds.length + questionIds.length;

  return (
    <div className="notes-page notes-page--compose">
      <Link to={existing ? `/m/notas/${existing.id}` : '/m/notas'} className="back with-icon">
        <Icon name="back" size={16} /> {existing ? existing.title : 'Notas de clase'}
      </Link>
      <header className="notes-header">
        <div>
          <p className="notes-eyebrow">
            <Icon name="edit" size={16} /> Tu espacio para escribir
          </p>
          <h1>{existing ? 'Editar nota' : 'Nueva nota'}</h1>
          <p className="muted">
            {existing
              ? `Al guardar se crea la versión ${existing.version + 1}; las anteriores quedan en el historial.`
              : 'Empieza en privado si quieres: luego puedes compartir una copia con el grupo.'}
          </p>
        </div>
      </header>
      <form className="notes-compose" onSubmit={submit}>
        <fieldset className="notes-compose__writing notes-surface" disabled={locked}>
          <legend className="notes-sr">Contenido del apunte</legend>
          <div className="notes-section-heading">
            <Icon name="file" size={20} />
            <h2>Tu apunte</h2>
          </div>
          <label className="field notes-title-field">
            Título
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="Dale un título a lo que aprendiste"
              required
            />
          </label>
          <StructuredEditor
            label="Contenido"
            value={body}
            onChange={setBody}
            rows={16}
            maxLength={50_000}
            files={resourceFiles.filter(
              (file) => file.targetKind === 'note' && file.targetId === existing?.id,
            )}
          />
          <label className="field">
            Etiquetas
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="derivadas, ejercicios, repaso"
            />
            <span className="field__hint">
              Sepáralas con comas. Ayudan a encontrar la nota al buscar.
            </span>
          </label>
        </fieldset>

        <fieldset className="notes-compose__settings" disabled={locked}>
          <legend className="notes-sr">Organización y publicación</legend>
          <section className="notes-surface notes-form-section">
            <div className="notes-section-heading">
              <Icon name="folder" size={19} />
              <h2>Organización</h2>
            </div>
            <SubjectSelect
              subjects={subjects}
              value={subjectId}
              onChange={(id) => {
                setSubjectId(id);
                setTermId('');
                setAssignmentIds([]);
                setActivityIds([]);
                setQuestionIds([]);
              }}
            />
            <label className="field">
              Tema
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={120}
                placeholder="¿De qué trata?"
              />
            </label>
            <label className="field">
              Parcial
              <select value={termId} onChange={(event) => setTermId(event.target.value)}>
                <option value="">Sin clasificar</option>
                {terms
                  .filter((term) => term.subjectId === subjectId)
                  .map((term) => (
                    <option key={term.id} value={term.id}>
                      {term.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              Sesión
              <input
                type="date"
                value={session}
                onChange={(event) => setSession(event.target.value)}
              />
            </label>
            <label className="field">
              Versión de la publicación
              <select
                aria-label="Versión de la publicación"
                value={isFinal ? 'final' : 'v1'}
                onChange={(event) => setIsFinal(event.target.value === 'final')}
              >
                <option value="v1">V1</option>
                <option value="final">Versión final</option>
              </select>
              <span className="field__hint">
                Se mostrará en la tarjeta. El historial de cambios se conserva.
              </span>
            </label>
          </section>
          <section className="notes-surface notes-form-section">
            <div className="notes-section-heading">
              <Icon name={visibility === 'personal' ? 'lock' : 'users'} size={19} />
              <h2>Quién la ve</h2>
            </div>
            <label className="field">
              Visibilidad
              <select
                value={visibility}
                disabled={Boolean(existing)}
                onChange={(e) => setVisibility(e.target.value as NoteVisibility)}
              >
                <option value="personal">Personal (solo tú)</option>
                <option value="group">Compartida con el grupo</option>
              </select>
            </label>
            <label className="field">
              Origen
              <select
                value={noteSource}
                onChange={(e) => setNoteSource(e.target.value as NoteSource)}
              >
                {Object.entries(SOURCE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {!existing && (
              <p className="field__hint">
                Personal significa que solo tú puedes verla. Puedes compartir una copia más
                adelante.
              </p>
            )}
            {existing?.visibility === 'personal' && (
              <p className="field__hint">
                Esta nota sigue siendo personal. Desde su página puedes publicar una copia de una
                versión concreta para el grupo.
              </p>
            )}
            {existing?.visibility === 'group' && (
              <p className="field__hint">La visibilidad no cambia después de crear la nota.</p>
            )}
          </section>

          <section className="notes-surface notes-form-section">
            <details className="notes-related-picker">
              <summary>
                Enlazar tareas, actividades y preguntas{linkedCount ? ` (${linkedCount})` : ''}
              </summary>
              <fieldset className="field">
                <legend>Tareas de esta materia</legend>
                {linkable.assignments.length ? (
                  linkable.assignments.map((item) => (
                    <label key={item.id} className="academic-choice">
                      <input
                        type="checkbox"
                        checked={assignmentIds.includes(item.id)}
                        onChange={() => setAssignmentIds(toggle(assignmentIds, item.id))}
                      />
                      {item.title}
                    </label>
                  ))
                ) : (
                  <span className="field__hint">No hay tareas en esta materia.</span>
                )}
              </fieldset>
              <fieldset className="field">
                <legend>Actividades de esta materia</legend>
                {linkable.activities.length ? (
                  linkable.activities.map((item) => (
                    <label key={item.id} className="academic-choice">
                      <input
                        type="checkbox"
                        checked={activityIds.includes(item.id)}
                        onChange={() => setActivityIds(toggle(activityIds, item.id))}
                      />
                      {item.title}
                    </label>
                  ))
                ) : (
                  <span className="field__hint">No hay actividades en esta materia.</span>
                )}
              </fieldset>
              <fieldset className="field">
                <legend>Preguntas de esta materia</legend>
                {linkable.questions.length ? (
                  linkable.questions.map((item) => (
                    <label key={item.id} className="academic-choice">
                      <input
                        type="checkbox"
                        checked={questionIds.includes(item.id)}
                        onChange={() => setQuestionIds(toggle(questionIds, item.id))}
                      />
                      {item.title}
                    </label>
                  ))
                ) : (
                  <span className="field__hint">No hay preguntas en esta materia.</span>
                )}
              </fieldset>
            </details>
          </section>
        </fieldset>
        <div className="notes-compose__attachments notes-surface">
          <AttachmentUploader
            queue={queue}
            disabled={pending || contentSaved}
            title="Archivos de la nota"
          />
        </div>
        <div className="notes-compose__status">
          {contentSaved && (
            <p className="notes-notice" role="status">
              La nota ya está guardada. Termina o retira los archivos pendientes para continuar.
            </p>
          )}
          {conflict && (
            <p className="error" role="alert">
              La nota cambió mientras la editabas. Conserva tu borrador y vuelve a abrir la edición
              antes de guardar.
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="form__actions notes-compose__actions">
          <p className="notes-save-hint">
            <Icon name={visibility === 'personal' ? 'lock' : 'users'} size={16} />
            {visibility === 'personal'
              ? 'Solo tú puedes ver esta nota'
              : 'Esta nota es visible para el grupo'}
          </p>
          <button type="button" className="secondary" onClick={() => void navigate(-1)}>
            Cancelar
          </button>
          <button
            type="submit"
            className="notes-primary"
            disabled={pending || queue.busy || conflict}
          >
            {contentSaved
              ? queue.pendingCount
                ? 'Reintentar archivos pendientes'
                : 'Continuar'
              : pending
                ? 'Guardando…'
                : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
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

function NoteStudyLink({
  to,
  icon,
  title,
  description,
}: {
  to: string;
  icon: IconName;
  title: string;
  description: string;
}) {
  return (
    <li>
      <Link to={to} className="notes-study-link" aria-label={title} aria-description={description}>
        <span className="notes-study-link__icon">
          <Icon name={icon} size={18} />
        </span>
        <span>
          <strong>{title}</strong>
          <span>{description}</span>
        </span>
        <Icon name="forward" size={14} />
      </Link>
    </li>
  );
}

export function NotePage() {
  const { noteId = '' } = useParams();
  const source = useDataSource();
  const {
    me,
    notes,
    noteComments,
    members,
    subjects,
    terms,
    assignments,
    activities,
    questions,
    noteVersions,
    resourceFiles,
  } = useSnapshot();
  const navigate = useNavigate();
  const { error, pending, run } = useAction();
  const [comment, setComment] = useState('');
  const [publishing, setPublishing] = useState(false);
  const note = notes.find((n) => n.id === noteId);

  if (!note) return <NoteMissing />;
  const comments = noteComments.filter((c) => c.noteId === note.id);
  const history = noteVersions
    .filter((version) => version.noteId === note.id)
    .sort((a, b) => b.version - a.version);
  const publications = notes.filter(
    (item) => item.publishedFromId === note.id && item.visibility === 'group',
  );
  const subject = subjects.find((s) => s.id === note.subjectId);
  const author = members.find((m) => m.id === note.authorId);
  const term = terms.find((t) => t.id === note.termId);
  const isAuthor = note.authorId === me?.id;
  const active = !note.withdrawnAt;
  const ref = encodeURIComponent(note.id);
  const hasRelated = Boolean(
    note.assignmentIds?.length || note.activityIds?.length || note.questionIds?.length,
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(async () => (await source.commentNote(note.id, comment), true))) setComment('');
  };

  return (
    <div className="notes-page notes-page--reading">
      <Link to="/m/notas" className="back with-icon">
        <Icon name="back" size={16} /> Notas de clase
      </Link>
      <header className="notes-header notes-header--document">
        <div>
          <p className="notes-eyebrow notes-document-context">
            <Link to={`/m/notas?materia=${encodeURIComponent(note.subjectId)}`}>
              {subject?.name ?? 'Materia desconocida'}
            </Link>
            {note.topic && ` · ${note.topic}`}
            {term && ` · ${term.name}`}
          </p>
          <h1>{note.title}</h1>
          <div className="notes-byline">
            <Avatar member={author} size={36} />
            <div>
              <strong>{isAuthor ? 'Tú' : memberName(members, note.authorId)}</strong>
              <span>
                Actualizada {formatTime(note.updatedAt)} ·{' '}
                {note.isFinal ? 'Versión final' : `Versión ${note.version}`}
              </span>
            </div>
            {note.session && (
              <span className="notes-session">
                <Icon name="calendar" size={15} /> Sesión {sessionLabel(note.session)}
              </span>
            )}
          </div>
          <NoteBadges note={note} />
        </div>
        {active && isAuthor && (
          <div className="row">
            <Link to={`/m/notas/${note.id}/editar`} className="button secondary with-icon">
              <Icon name="edit" size={16} /> Editar
            </Link>
          </div>
        )}
      </header>
      {error && (
        <p className="error notes-notice" role="alert">
          {error}
        </p>
      )}

      <div className="notes-detail">
        <div className="notes-detail__main">
          {note.source === 'ai' && (
            <p className="notes-notice">
              Contenido generado con IA: revísalo antes de confiar en él.
            </p>
          )}
          <article className="notes-surface notes-document" aria-label="Contenido de la nota">
            {note.body.trim() ? (
              <StructuredText text={note.body} />
            ) : (
              <p className="muted">Esta nota todavía no tiene contenido.</p>
            )}
          </article>
          <div className="notes-surface notes-attachments">
            <ResourceSection
              kind="note"
              id={note.id}
              version={note.version}
              canEdit={isAuthor && active}
              compactUpload
            />
          </div>

          <section className="notes-surface notes-comments" aria-labelledby="note-comments-heading">
            <div className="notes-section-heading">
              <Icon name="chat" size={20} />
              <h2 id="note-comments-heading">Comentarios y propuestas</h2>
              <span className="notes-count">{comments.length}</span>
            </div>
            <p className="field__hint">
              Los comentarios no cambian la nota; su autor decide si la corrige.
            </p>
            {comments.length > 0 ? (
              comments.map((c) => {
                const author = members.find((m) => m.id === c.authorId);
                return (
                  <article key={c.id} className="notes-comment">
                    <header className="notes-comment__meta">
                      <Avatar member={author} size={28} />
                      <span>
                        <strong>
                          {c.authorId === me?.id ? 'Tú' : (author?.displayName ?? 'Alguien')}
                        </strong>
                        <time dateTime={c.createdAt.toISOString()}>{formatTime(c.createdAt)}</time>
                      </span>
                    </header>
                    <RichText text={c.text} />
                  </article>
                );
              })
            ) : (
              <div className="notes-comments__empty">
                <Icon name="chat" size={24} />
                <p>Nadie ha comentado todavía.</p>
                <span>Comparte una idea o propón una corrección.</span>
              </div>
            )}
            {active && (
              <form className="notes-comment-form" onSubmit={submit}>
                <textarea
                  aria-label="Comentario"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  placeholder="Comenta o propón una corrección"
                />
                <div className="form__actions">
                  <button type="submit" className="with-icon" disabled={pending || !comment.trim()}>
                    <Icon name="send" size={16} /> {pending ? 'Enviando…' : 'Comentar'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>

        <aside className="notes-detail__side" aria-label="Herramientas de la nota">
          <section className="notes-surface notes-study">
            <p className="notes-eyebrow">Del apunte a la práctica</p>
            <h2>Estudiar con esta nota</h2>
            <ul className="notes-study-links">
              <NoteStudyLink
                to={`/m/repaso/tarjetas/nueva?nota=${ref}`}
                icon="copy"
                title="Crear tarjeta"
                description="Repasa las ideas clave."
              />
              <NoteStudyLink
                to={`/m/aprende-ensenando/nueva?nota=${ref}`}
                icon="chat"
                title="Practicar explicándolo"
                description="Aprende al ponerlo en tus palabras."
              />
              {active && (
                <NoteStudyLink
                  to={`/m/exposiciones/nueva?nota=${ref}`}
                  icon="users"
                  title="Ensayar exposición"
                  description="Prepara tu próxima presentación."
                />
              )}
              {active && note.visibility === 'group' && (
                <NoteStudyLink
                  to={`/m/salas?nota=${ref}`}
                  icon="book"
                  title="Estudiar en una sala"
                  description="Repasa con tus compañeros."
                />
              )}
              {active && (
                <li className="notes-exam-action">
                  <span className="notes-study-link__icon">
                    <Icon name="file" size={18} />
                  </span>
                  <ExamMaterialLink kind="note" id={note.id} className="" />
                  <Icon name="forward" size={14} />
                </li>
              )}
              {active && (
                <NoteStudyLink
                  to={`/ajustes?aiSource=note:${note.id}&purpose=explanation`}
                  icon="reply"
                  title="Explicar con Gemini"
                  description="Explora otra forma de entenderlo."
                />
              )}
            </ul>
            {note.visibility === 'personal' && (
              <p className="field__hint">
                Para estudiar este apunte en una sala, publica primero una copia para el grupo.
              </p>
            )}
          </section>

          {hasRelated && (
            <section className="notes-surface notes-side-section">
              <h2>Material relacionado</h2>
              <ul className="links">
                {note.assignmentIds?.map((id) => (
                  <li key={`assignment:${id}`}>
                    <Link to={`/m/tareas/${id}`}>
                      {assignments.find((item) => item.id === id)?.title ?? 'Tarea relacionada'}
                      <span className="muted">Tarea</span>
                    </Link>
                  </li>
                ))}
                {note.activityIds?.map((id) => (
                  <li key={`activity:${id}`}>
                    <Link to={`/m/actividades/${id}`}>
                      {activities.find((item) => item.id === id)?.title ?? 'Actividad relacionada'}
                      <span className="muted">Actividad</span>
                    </Link>
                  </li>
                ))}
                {note.questionIds?.map((id) => (
                  <li key={`question:${id}`}>
                    <Link to={`/m/preguntas/${id}`}>
                      {questions.find((item) => item.id === id)?.title ?? 'Pregunta relacionada'}
                      <span className="muted">Pregunta</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {note.visibility === 'personal' && isAuthor && active && (
            <section className="notes-surface notes-side-section notes-publish">
              <div className="notes-section-heading">
                <Icon name="users" size={19} />
                <h2>Compartir con el grupo</h2>
              </div>
              <p>
                Tu original y sus cambios futuros siguen siendo personales. Se compartirá una copia
                de la versión {note.version}, con sus archivos actuales.
              </p>
              {!publishing ? (
                <button type="button" className="secondary" onClick={() => setPublishing(true)}>
                  Revisar publicación
                </button>
              ) : (
                <div className="notes-publish__actions">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void run(async () => {
                        const id = await source.publishNoteVersion(note.id, note.version);
                        void navigate(`/m/notas/${id}`);
                      })
                    }
                  >
                    Publicar esta versión para el grupo
                  </button>
                  <button type="button" className="secondary" onClick={() => setPublishing(false)}>
                    Cancelar
                  </button>
                </div>
              )}
              {publications.length > 0 && (
                <ul className="links">
                  {publications.map((item) => (
                    <li key={item.id}>
                      <Link to={`/m/notas/${item.id}`}>
                        Versión personal {item.publishedFromVersion} publicada: {item.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {history.length > 0 && (
            <section className="notes-surface notes-side-section notes-history">
              <h2>Historial de la nota</h2>
              <p className="field__hint">
                Restaurar guarda una versión nueva con clasificación, contenido, vínculos y
                archivos. El historial conserva la autoría y las versiones ya compartidas.
              </p>
              {history.map((revision) => (
                <details key={revision.id} className="academic-version">
                  <summary>
                    Versión {revision.version} · {formatTime(revision.editedAt)}
                    {revision.version === note.version ? ' · Actual' : ''}
                  </summary>
                  <p className="muted">
                    {revision.editedBy
                      ? memberName(members, revision.editedBy)
                      : 'Editor anterior no registrado'}
                    {revision.restoredFromVersion
                      ? ` · Restaurada de v${revision.restoredFromVersion}`
                      : ''}
                  </p>
                  <strong>{revision.title}</strong>
                  <p className="muted">
                    {subjects.find((s) => s.id === revision.subjectId)?.name} · {revision.topic}
                    {revision.session ? ` · Sesión ${revision.session}` : ''}
                  </p>
                  <StructuredText text={revision.body} />
                  <ResourceDownloads
                    files={resourceFiles.filter((file) => revision.attachmentIds.includes(file.id))}
                  />
                  {revision.version !== note.version && isAuthor && active && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={pending}
                      onClick={() =>
                        void run(() =>
                          source.restoreNoteVersion(note.id, revision.version, note.version),
                        )
                      }
                    >
                      Restaurar esta versión completa
                    </button>
                  )}
                </details>
              ))}
            </section>
          )}
          {(note.withdrawnAt || isAuthor || (note.visibility === 'group' && me?.isCreator)) && (
            <section className="notes-surface notes-side-section notes-availability">
              <h2>Disponibilidad</h2>
              <ContentWithdrawal
                kind="note"
                id={note.id}
                version={note.version}
                withdrawnAt={note.withdrawnAt}
                canEdit={isAuthor || (note.visibility === 'group' && me?.isCreator)}
                reasonRequired={!isAuthor}
              />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
