import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  canEditWork,
  DEFAULT_WORK_KIND,
  isValidPeriod,
  isWorkKindGroup,
  PERIOD_COUNT,
  periodLabel,
  WORK_KIND_GROUPS,
  WORK_KIND_LABEL,
  workKindGroup,
  type WorkKind,
} from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Assignment, Member, Revision, Work, WorkFile } from '../data/types';
import { AssignmentArchive } from '../components/AssignmentArchive';
import { Avatar } from '../components/Avatar';
import { AvatarStack } from '../components/AvatarStack';
import { Empty } from '../components/Empty';
import { FileList } from '../components/FileList';
import { FilePicker } from '../components/FilePicker';
import { Icon } from '../components/Icon';
import { RevisionHistory } from '../components/RevisionHistory';
import { RichText } from '../components/RichText';
import { useAction } from '../components/useAction';
import {
  formatDate,
  formatLongDay,
  formatMediumDate,
  formatTime,
  memberName,
  parseDay,
  peopleList,
} from '../lib/format';
import { lastPeriod, rememberPeriod } from '../lib/period';
import {
  bySubject,
  filterAssignments,
  NO_TERM,
  revisionsOf,
  submittersOf,
  worksOf,
  type AssignmentFilters,
} from '../lib/works';

/** Opción de los selectores para crear una materia o un parcial al clasificar. */
const NEW = '__nuevo__';

const PERIODS = Array.from({ length: PERIOD_COUNT }, (_, i) => i + 1);

const uploadError = (error: unknown, file: File) =>
  error instanceof Error ? error.message : `No se pudo subir «${file.name}».`;

/** Tipo de trabajo: tarea o actividad, exposición o examen. */
function KindPicker({ value, onChange }: { value: WorkKind; onChange: (kind: WorkKind) => void }) {
  const name = useId();
  return (
    <fieldset className="field">
      <legend className="field__label">Tipo</legend>
      <div className="kinds">
        {WORK_KIND_GROUPS.map((group) => (
          <div key={group.id}>
            <span className="field__hint">{group.label}</span>
            <div className="chips">
              {group.kinds.map((kind) => (
                <label key={kind} className="chip chip--choice">
                  <input
                    type="radio"
                    className="sr-only"
                    name={name}
                    value={kind}
                    checked={value === kind}
                    onChange={() => onChange(kind)}
                  />
                  {WORK_KIND_LABEL[kind]}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Archivo del grupo: las páginas principales de tareas, actividades, exposiciones y exámenes.
 * Los filtros viven en la URL para conservarlos al volver de una página.
 */
export function AssignmentsPage() {
  const { me, assignments, works, workFiles, subjects, terms, members } = useSnapshot();
  const [params, setParams] = useSearchParams();
  const kindParam = params.get('tipo');
  const periodParam = Number(params.get('cuatri'));
  const filters: AssignmentFilters = {
    query: params.get('q') ?? '',
    kindGroup: isWorkKindGroup(kindParam) ? kindParam : '',
    period: isValidPeriod(periodParam) ? periodParam : 0,
    subjectId: params.get('materia') ?? '',
    termId: params.get('parcial') ?? '',
    authorId: params.get('autor') ?? '',
  };
  const view = params.get('vista') === 'recientes' ? 'recent' : 'grouped';

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

  const ctx = { subjects, terms, members, works, files: workFiles };
  const shown = filterAssignments(assignments, filters, ctx);
  // Cada conteo respeta los demás filtros: así se ve cuánto hay antes de elegir.
  const beforeKind = filterAssignments(assignments, { ...filters, kindGroup: '' }, ctx);
  const beforeSubject = filterAssignments(assignments, { ...filters, subjectId: '', termId: '' }, ctx);
  // Con un cuatrimestre elegido se ven sus materias aunque estén vacías; sin él, solo las que
  // ya tienen algo, para no listar las 45 del plan.
  const subjectChips = subjects
    .filter((s) => (filters.period ? s.period === filters.period : true))
    .sort(bySubject)
    .map((s) => ({ ...s, count: beforeSubject.filter((a) => a.subjectId === s.id).length }))
    .filter((s) => filters.period || s.count > 0 || s.id === filters.subjectId);
  const inSubject = beforeSubject.filter((a) => a.subjectId === filters.subjectId);
  const termChips = filters.subjectId
    ? [
        ...terms
          .filter((t) => t.subjectId === filters.subjectId)
          .sort((a, b) => a.position - b.position)
          .map((t) => ({ id: t.id, name: t.name, count: inSubject.filter((a) => a.termId === t.id).length })),
        { id: NO_TERM, name: 'Sin parcial', count: inSubject.filter((a) => !a.termId).length },
      ].filter((t) => t.id !== NO_TERM || t.count > 0 || t.id === filters.termId)
    : [];
  const filtering = Boolean(
    filters.query ||
    filters.kindGroup ||
    filters.period ||
    filters.subjectId ||
    filters.termId ||
    filters.authorId,
  );
  const authors = members.filter((m) => m.id !== me?.id && works.some((w) => w.authorIds.includes(m.id)));

  // Crear desde un archivo filtrado deja el formulario ya clasificado.
  const newParams = new URLSearchParams();
  if (filters.kindGroup) newParams.set('tipo', filters.kindGroup);
  if (filters.period) newParams.set('cuatri', String(filters.period));
  if (filters.subjectId) newParams.set('materia', filters.subjectId);
  if (filters.termId && filters.termId !== NO_TERM) newParams.set('parcial', filters.termId);
  const newTo = `/m/tareas/nueva${newParams.size ? `?${newParams}` : ''}`;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Tareas y Actividades</h1>
          <p className="muted">
            Cada tarea, actividad, exposición o examen tiene su página, que todos pueden editar, y ahí
            mismo los trabajos que subió cada quien.
          </p>
        </div>
        <Link to={newTo} className="button with-icon">
          <Icon name="plus" size={18} /> Nueva tarea o actividad
        </Link>
      </header>

      {assignments.length === 0 ? (
        <Empty
          icon="folder"
          title="El archivo está vacío"
          action={
            <Link to={newTo} className="button">
              Crear la primera
            </Link>
          }
        >
          Crea la página de una tarea, actividad, exposición o examen para que cada quien suba su
          trabajo.
        </Empty>
      ) : (
        <>
          <div className="toolbar" role="search">
            <label className="search toolbar__search">
              <Icon name="search" size={18} />
              <input
                type="search"
                placeholder="Buscar por título, instrucciones o autor"
                aria-label="Buscar tareas y actividades"
                value={filters.query}
                onChange={(e) => update({ q: e.target.value })}
              />
            </label>
            <select
              aria-label="Cuatrimestre"
              value={filters.period || ''}
              onChange={(e) => update({ cuatri: e.target.value, materia: '', parcial: '' })}
            >
              <option value="">Todos los cuatrimestres</option>
              {PERIODS.map((period) => (
                <option key={period} value={period}>
                  {periodLabel(period)}
                </option>
              ))}
            </select>
            <select
              aria-label="Con trabajos de"
              value={filters.authorId}
              onChange={(e) => update({ autor: e.target.value })}
            >
              <option value="">Trabajos de todos</option>
              {me && <option value={me.id}>Donde ya subí</option>}
              {authors.map((m) => (
                <option key={m.id} value={m.id}>
                  Con trabajos de {m.displayName}
                </option>
              ))}
            </select>
            <div className="segmented" role="group" aria-label="Orden del archivo">
              <button type="button" aria-pressed={view === 'grouped'} onClick={() => update({ vista: '' })}>
                Por materia
              </button>
              <button
                type="button"
                aria-pressed={view === 'recent'}
                onClick={() => update({ vista: 'recientes' })}
              >
                Recientes
              </button>
            </div>
          </div>

          <div className="chips chips--scroll" role="group" aria-label="Tipo">
            <button
              type="button"
              className="chip"
              aria-pressed={!filters.kindGroup}
              onClick={() => update({ tipo: '' })}
            >
              Todo <span className="chip__count">{beforeKind.length}</span>
            </button>
            {WORK_KIND_GROUPS.map((group) => (
              <button
                key={group.id}
                type="button"
                className="chip"
                aria-pressed={filters.kindGroup === group.id}
                onClick={() => update({ tipo: group.id })}
              >
                {group.label}{' '}
                <span className="chip__count">
                  {beforeKind.filter((a) => workKindGroup(a.kind) === group.id).length}
                </span>
              </button>
            ))}
          </div>

          <div className="chips chips--small chips--scroll" role="group" aria-label="Materia">
            <button
              type="button"
              className="chip"
              aria-pressed={!filters.subjectId}
              onClick={() => update({ materia: '', parcial: '' })}
            >
              Todas las materias
            </button>
            {subjectChips.map((s) => (
              <button
                key={s.id}
                type="button"
                className="chip"
                aria-pressed={filters.subjectId === s.id}
                onClick={() => update({ materia: s.id, parcial: '' })}
              >
                {s.name} <span className="chip__count">{s.count}</span>
              </button>
            ))}
          </div>

          {termChips.length > 0 && (
            <div className="chips chips--small chips--scroll" role="group" aria-label="Parcial">
              <button
                type="button"
                className="chip"
                aria-pressed={!filters.termId}
                onClick={() => update({ parcial: '' })}
              >
                Todos los parciales
              </button>
              {termChips.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="chip"
                  aria-pressed={filters.termId === t.id}
                  onClick={() => update({ parcial: t.id })}
                >
                  {t.name} <span className="chip__count">{t.count}</span>
                </button>
              ))}
            </div>
          )}

          <p className="results muted" aria-live="polite">
            {shown.length} {filtering ? 'con estos filtros' : 'en el archivo'}
            {filtering && (
              <>
                {' · '}
                <button type="button" className="link-button" onClick={() => setParams({}, { replace: true })}>
                  Limpiar filtros
                </button>
              </>
            )}
          </p>

          {shown.length ? (
            <AssignmentArchive
              assignments={shown}
              works={works}
              subjects={subjects}
              terms={terms}
              members={members}
              meId={me?.id}
              view={view}
            />
          ) : (
            <Empty
              icon="search"
              title="Nada por aquí todavía"
              action={
                <Link to={newTo} className="button secondary">
                  Crear aquí
                </Link>
              }
            >
              Ninguna tarea o actividad coincide con la búsqueda y los filtros elegidos.
            </Empty>
          )}
        </>
      )}
    </>
  );
}

function EditWorkForm({ work, onDone }: { work: Work; onDone: () => void }) {
  const source = useDataSource();
  const { error, run } = useAction();
  const [title, setTitle] = useState(work.title);
  const [description, setDescription] = useState(work.description);
  const changed = title.trim() !== work.title || description.trim() !== work.description;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (run(() => (source.updateWork(work.id, title, description), true))) onDone();
  };

  return (
    <form className="form" onSubmit={submit}>
      <label className="field">
        <span className="field__label">
          Tema o título <span className="field__optional">opcional</span>
        </span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </label>
      <label className="field">
        <span className="field__label">Descripción</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} autoFocus />
        <span className="field__hint">Para pegar código, enciérralo entre líneas con ```.</span>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form__actions">
        <span className="muted form__note">Se guardará como versión {work.version + 1}.</span>
        <button type="button" className="secondary" onClick={onDone}>
          Cancelar
        </button>
        <button type="submit" disabled={!changed}>
          Guardar cambios
        </button>
      </div>
    </form>
  );
}

/** El trabajo de un alumno o equipo dentro de la página de la tarea. Solo sus autores lo cambian. */
function SubmissionCard({
  work,
  files,
  members,
  meId,
  highlighted,
  initialErrors,
}: {
  work: Work;
  files: WorkFile[];
  members: Member[];
  meId: string | undefined;
  highlighted: boolean;
  /** Archivos que no pudieron subirse al publicarlo. */
  initialErrors: string[];
}) {
  const source = useDataSource();
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState(initialErrors);
  const canEdit = Boolean(meId && canEditWork(meId, work.authorIds));

  const upload = async (list: File[]) => {
    setUploading(true);
    const failed: string[] = [];
    for (const file of list) {
      try {
        await source.attachWorkFile(work.id, file);
      } catch (error) {
        failed.push(uploadError(error, file));
      }
    }
    setErrors(failed);
    setUploading(false);
  };

  const removeFile = (fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    if (!file || !window.confirm(`¿Quitar «${file.name}» de tu trabajo?`)) return;
    try {
      source.removeWorkFile(fileId);
      setErrors([]);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'No se pudo quitar el archivo.']);
    }
  };

  return (
    <article
      id={`trabajo-${work.id}`}
      className={highlighted ? 'panel submission submission--highlighted' : 'panel submission'}
    >
      <header className="evidence__header">
        <AvatarStack
          members={work.authorIds.map((id) => members.find((m) => m.id === id))}
          size={28}
          max={4}
        />
        <span className="evidence__who">
          <strong>{peopleList(work.authorIds, members, meId)}</strong>
          <span className="muted">
            {work.authorIds.length > 1 ? 'Equipo' : 'Individual'} · {formatTime(work.updatedAt)}
            {work.version > 1 && ` · versión ${work.version}`}
          </span>
        </span>
        {canEdit && <span className="badge badge--resolved">Tu trabajo</span>}
        {canEdit && !editing && (
          <button
            type="button"
            className="icon-button"
            aria-label="Editar mi trabajo"
            title="Editar"
            onClick={() => setEditing(true)}
          >
            <Icon name="edit" size={18} />
          </button>
        )}
      </header>
      {editing ? (
        <EditWorkForm work={work} onDone={() => setEditing(false)} />
      ) : (
        <>
          {work.title && <h3 className="submission__title">{work.title}</h3>}
          {work.description ? (
            <RichText text={work.description} />
          ) : (
            files.length === 0 && <p className="muted">Sin descripción ni archivos todavía.</p>
          )}
        </>
      )}
      <FileList
        items={files.map((f) => ({
          key: f.id,
          name: f.name,
          size: f.size,
          url: f.url,
          detail: `${memberName(members, f.uploadedBy)} · ${formatDate(f.createdAt)}`,
        }))}
        onRemove={canEdit ? removeFile : undefined}
      />
      {canEdit && <FilePicker onFiles={(list) => void upload(list)} busy={uploading} />}
      {errors.length > 0 && (
        <ul className="file-picker__errors error" role="alert">
          {errors.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** Página principal: lo que se pidió (editable por todos) y los trabajos de cada alumno. */
export function AssignmentPage() {
  const { assignmentId = '' } = useParams();
  const source = useDataSource();
  const location = useLocation();
  const [params] = useSearchParams();
  const { me, assignments, works, workFiles, revisions, subjects, terms, members } = useSnapshot();
  const { error, run } = useAction();
  const [showHistory, setShowHistory] = useState(false);
  const highlighted = params.get('trabajo') ?? '';

  // Al llegar desde «Subir mi trabajo» o desde la lista de alumnos, lleva al trabajo indicado.
  useEffect(() => {
    if (highlighted) document.getElementById(`trabajo-${highlighted}`)?.scrollIntoView?.({ block: 'center' });
  }, [highlighted]);

  const assignment = assignments.find((a) => a.id === assignmentId);
  if (!assignment) {
    return (
      <Empty
        icon="folder"
        title="No encontramos esta página"
        action={
          <Link to="/m/tareas" className="button">
            Ver el archivo
          </Link>
        }
      >
        Puede que el enlace esté incompleto o que la tarea ya no exista.
      </Empty>
    );
  }

  const subject = subjects.find((s) => s.id === assignment.subjectId);
  const term = terms.find((t) => t.id === assignment.termId);
  const own = worksOf(assignment.id, works);
  const history = revisionsOf('assignment', assignment.id, revisions);
  const roster = members.filter((m) => m.status === 'active');
  const submitted = submittersOf(assignment.id, works);
  const done = roster.filter((m) => submitted.includes(m.id)).length;
  const alreadyMine = Boolean(me && submitted.includes(me.id));
  const fileErrors = (location.state as { fileErrors?: string[] } | null)?.fileErrors ?? [];
  const inSubject = { ...(subject && { cuatri: String(subject.period) }), materia: assignment.subjectId };

  // Restaurar es editar con el texto de antes: crea una versión nueva y no borra ninguna.
  const restore = (revision: Revision) =>
    run(() =>
      source.updateAssignment(assignment.id, {
        subjectId: assignment.subjectId,
        termId: assignment.termId,
        kind: assignment.kind,
        dueDate: assignment.dueDate,
        title: revision.title,
        instructions: revision.body,
      }),
    );

  return (
    <>
      <Link to="/m/tareas" className="back with-icon">
        <Icon name="back" size={16} /> Tareas y Actividades
      </Link>
      <header className="page-header">
        <div>
          <p className="eyebrow">
            {subject && (
              <>
                <Link to={`/m/tareas?cuatri=${subject.period}`}>{periodLabel(subject.period)}</Link>
                {' · '}
              </>
            )}
            <Link to={`/m/tareas?${new URLSearchParams(inSubject)}`}>
              {subject?.name ?? 'Materia desconocida'}
            </Link>
            {' · '}
            <Link to={`/m/tareas?${new URLSearchParams({ ...inSubject, parcial: assignment.termId ?? NO_TERM })}`}>
              {term?.name ?? 'Sin parcial'}
            </Link>
          </p>
          <h1>{assignment.title}</h1>
          <p className="muted">
            <span className={`badge badge--${workKindGroup(assignment.kind)}`}>
              {WORK_KIND_LABEL[assignment.kind]}
            </span>{' '}
            {assignment.dueDate
              ? `Entrega: ${formatLongDay(parseDay(assignment.dueDate))}`
              : 'Sin fecha de entrega'}
          </p>
        </div>
        <div className="row">
          <Link to={`/m/tareas/${assignment.id}/editar`} className="button secondary with-icon">
            <Icon name="edit" size={16} /> Editar página
          </Link>
          <Link to={`/m/tareas/${assignment.id}/subir`} className="button with-icon">
            <Icon name="upload" size={18} /> {alreadyMine ? 'Subir otro trabajo' : 'Subir mi trabajo'}
          </Link>
        </div>
      </header>

      <div className="detail">
        <div className="detail__main">
          <section className="panel">
            <h2 className="label">Lo que se pidió</h2>
            {assignment.instructions ? (
              <RichText text={assignment.instructions} />
            ) : (
              <p className="muted">
                Nadie ha escrito las instrucciones. Usa «Editar página» para agregarlas: cualquiera del
                grupo puede hacerlo.
              </p>
            )}
            <p className="wiki-footer">
              <Icon name="users" size={16} />
              <span>
                Página del grupo · versión {assignment.version} · última edición de{' '}
                {memberName(members, assignment.updatedBy)}, {formatTime(assignment.updatedAt)}
              </span>
              <button
                type="button"
                className="link-button"
                aria-expanded={showHistory}
                onClick={() => setShowHistory(!showHistory)}
              >
                {showHistory ? 'Ocultar historial' : 'Ver historial'}
              </button>
            </p>
          </section>
          {showHistory && (
            <RevisionHistory revisions={history} members={members} onRestore={restore} error={error} />
          )}

          <h2 className="section-title">
            Trabajos de cada alumno <span className="muted">{own.length}</span>
          </h2>
          {own.map((work) => (
            <SubmissionCard
              key={work.id}
              work={work}
              files={workFiles.filter((f) => f.workId === work.id)}
              members={members}
              meId={me?.id}
              highlighted={work.id === highlighted}
              initialErrors={work.id === highlighted ? fileErrors : []}
            />
          ))}
          {own.length === 0 && (
            <Empty
              icon="upload"
              title="Todavía nadie sube su trabajo"
              action={
                <Link to={`/m/tareas/${assignment.id}/subir`} className="button">
                  Subir el primero
                </Link>
              }
            >
              Aquí aparecerá lo que suba cada alumno o equipo, cada uno por separado.
            </Empty>
          )}
        </div>

        <aside className="detail__side">
          <section className="panel">
            <h2 className="label">
              Quién ya subió ({done} de {roster.length})
            </h2>
            <ul className="people roster">
              {roster.map((member) => {
                const work = own.find((w) => w.authorIds.includes(member.id));
                const name = (
                  <>
                    <Avatar member={member} size={28} />
                    <span className="roster__name">
                      {member.displayName}
                      {member.id === me?.id && <span className="muted"> (tú)</span>}
                    </span>
                  </>
                );
                return (
                  <li key={member.id}>
                    {work ? (
                      <Link to={{ search: `?trabajo=${work.id}` }} replace>
                        {name}
                        <span className="roster__done">
                          <Icon name="check" size={16} />
                          <span className="sr-only">Ya subió su trabajo</span>
                        </span>
                      </Link>
                    ) : (
                      <span className="roster__pending">
                        {name}
                        <span className="muted">Falta</span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="panel">
            <h2 className="label">Detalles</h2>
            <dl className="facts">
              <dt>Tipo</dt>
              <dd>{WORK_KIND_LABEL[assignment.kind]}</dd>
              {assignment.dueDate && (
                <>
                  <dt>Entrega</dt>
                  <dd>{formatMediumDate(parseDay(assignment.dueDate))}</dd>
                </>
              )}
              <dt>Creó la página</dt>
              <dd>{memberName(members, assignment.createdBy)}</dd>
              <dt>Creada</dt>
              <dd>{formatMediumDate(assignment.createdAt)}</dd>
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}

/** Crear una página principal o editarla (cualquier integrante, como en un wiki). */
export function AssignmentFormPage() {
  const { assignmentId } = useParams();
  const { assignments } = useSnapshot();
  const assignment = assignments.find((a) => a.id === assignmentId);

  if (assignmentId && !assignment) {
    return (
      <Empty
        icon="folder"
        title="No encontramos esta página"
        action={
          <Link to="/m/tareas" className="button">
            Ver el archivo
          </Link>
        }
      >
        Puede que el enlace esté incompleto o que la tarea ya no exista.
      </Empty>
    );
  }
  return <AssignmentForm key={assignment?.id ?? 'nueva'} assignment={assignment} />;
}

function AssignmentForm({ assignment }: { assignment: Assignment | undefined }) {
  const source = useDataSource();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { members, subjects, terms } = useSnapshot();
  const { error, run } = useAction();
  const backTo = assignment ? `/m/tareas/${assignment.id}` : '/m/tareas';

  const firstIn = (period: number) =>
    subjects.filter((s) => s.period === period).sort(bySubject)[0]?.id ?? NEW;
  const asked = subjects.find((s) => s.id === (assignment?.subjectId ?? params.get('materia')));
  const [period, setPeriod] = useState(() => {
    const fromFilter = Number(params.get('cuatri'));
    return asked?.period ?? (isValidPeriod(fromFilter) ? fromFilter : lastPeriod());
  });
  const [subjectId, setSubjectId] = useState(() => asked?.id ?? firstIn(period));
  const [termId, setTermId] = useState(
    () =>
      assignment?.termId ??
      terms.find((t) => t.id === params.get('parcial') && t.subjectId === subjectId)?.id ??
      '',
  );
  const [kind, setKind] = useState<WorkKind>(
    () =>
      assignment?.kind ??
      WORK_KIND_GROUPS.find((g) => g.id === params.get('tipo'))?.kinds[0] ??
      DEFAULT_WORK_KIND,
  );
  const [newSubject, setNewSubject] = useState('');
  const [newTerm, setNewTerm] = useState('');
  const [title, setTitle] = useState(assignment?.title ?? '');
  const [dueDate, setDueDate] = useState(assignment?.dueDate ?? '');
  const [instructions, setInstructions] = useState(assignment?.instructions ?? '');

  const periodSubjects = subjects.filter((s) => s.period === period).sort(bySubject);
  const subjectTerms = terms
    .filter((t) => t.subjectId === subjectId)
    .sort((a, b) => a.position - b.position);
  const changed =
    !assignment ||
    title.trim() !== assignment.title ||
    instructions.trim() !== assignment.instructions ||
    dueDate !== (assignment.dueDate ?? '') ||
    kind !== assignment.kind ||
    subjectId !== assignment.subjectId ||
    termId !== (assignment.termId ?? '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = run(() => {
      // Si la materia o el parcial nuevos se crean pero guardar falla, quedan elegidos para
      // que un segundo intento no los duplique.
      let sid = subjectId;
      if (sid === NEW) {
        sid = source.createSubject(newSubject, period);
        setSubjectId(sid);
        setNewSubject('');
      }
      let tid = termId;
      if (tid === NEW) {
        tid = source.createTerm(sid, newTerm);
        setTermId(tid);
        setNewTerm('');
      }
      const input = {
        subjectId: sid,
        termId: tid || undefined,
        kind,
        title,
        instructions,
        dueDate: dueDate || undefined,
      };
      if (!assignment) return source.createAssignment(input);
      source.updateAssignment(assignment.id, input);
      return assignment.id;
    });
    if (!id) return;
    rememberPeriod(period);
    void navigate(`/m/tareas/${id}`);
  };

  return (
    <>
      <Link to={backTo} className="back with-icon">
        <Icon name="back" size={16} /> {assignment ? assignment.title : 'Tareas y Actividades'}
      </Link>
      <header className="page-header">
        <div>
          <h1>{assignment ? 'Editar página' : 'Nueva tarea o actividad'}</h1>
          <p className="muted">
            {assignment
              ? `Es la página de todo el grupo. Tu cambio se guardará como versión ${assignment.version + 1} a tu nombre y las anteriores quedan en el historial.`
              : 'Escribe lo que se pidió. Después cualquiera del grupo podrá corregir la página y cada quien subirá su trabajo.'}
          </p>
        </div>
      </header>

      <form className="panel form form--wide" onSubmit={submit}>
        <section className="form__section">
          <h2>Qué es</h2>
          <KindPicker value={kind} onChange={setKind} />
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
                  setSubjectId(firstIn(next));
                  setTermId('');
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
              <select
                value={subjectId}
                onChange={(e) => {
                  setSubjectId(e.target.value);
                  setTermId('');
                }}
              >
                {periodSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value={NEW}>Nueva materia…</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Parcial</span>
              <select value={termId} onChange={(e) => setTermId(e.target.value)}>
                <option value="">Sin parcial</option>
                {subjectTerms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                <option value={NEW}>Otro parcial o unidad…</option>
              </select>
            </label>
            {subjectId === NEW && (
              <label className="field">
                <span className="field__label">Nombre de la materia</span>
                <input
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  maxLength={120}
                  required
                  autoFocus
                />
              </label>
            )}
            {termId === NEW && (
              <label className="field">
                <span className="field__label">Nombre del parcial o unidad</span>
                <input
                  value={newTerm}
                  onChange={(e) => setNewTerm(e.target.value)}
                  placeholder="Por ejemplo: Extraordinario"
                  maxLength={120}
                  required
                  autoFocus
                />
              </label>
            )}
          </div>
        </section>

        <section className="form__section">
          <h2>Lo que se pidió</h2>
          <div className="form__grid">
            <label className="field">
              <span className="field__label">Título</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
            </label>
            <label className="field">
              <span className="field__label">
                Fecha de entrega <span className="field__optional">opcional</span>
              </span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span className="field__label">Instrucciones</span>
            <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={10} />
            <span className="field__hint">
              Lo que pidió el docente, criterios y recursos. Para pegar código, enciérralo entre líneas
              con ```.
            </span>
          </label>
        </section>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form__actions">
          {assignment && (
            <span className="muted form__note">
              Última edición de {memberName(members, assignment.updatedBy)}, {formatTime(assignment.updatedAt)}
            </span>
          )}
          <Link to={backTo} className="button secondary">
            Cancelar
          </Link>
          <button type="submit" disabled={!changed}>
            {assignment ? 'Guardar versión nueva' : 'Crear página'}
          </button>
        </div>
      </form>
    </>
  );
}

/** Subir el trabajo propio o del equipo a una página principal. */
export function SubmitWorkPage() {
  const { assignmentId = '' } = useParams();
  const source = useDataSource();
  const navigate = useNavigate();
  const { me, assignments, members } = useSnapshot();
  const { error, run } = useAction();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coauthorIds, setCoauthorIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const assignment = assignments.find((a) => a.id === assignmentId);

  if (!assignment) {
    return (
      <Empty
        icon="folder"
        title="No encontramos esta página"
        action={
          <Link to="/m/tareas" className="button">
            Ver el archivo
          </Link>
        }
      >
        Puede que el enlace esté incompleto o que la tarea ya no exista.
      </Empty>
    );
  }

  const backTo = `/m/tareas/${assignment.id}`;
  const others = members.filter((m) => m.id !== me?.id && m.status === 'active');
  const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;
  const addFiles = (list: File[]) =>
    setFiles((current) => [
      ...current,
      ...list.filter((f) => !current.some((c) => fileKey(c) === fileKey(f))),
    ]);
  const toggleCoauthor = (id: string) =>
    setCoauthorIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const empty = !title.trim() && !description.trim() && files.length === 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const id = run(() =>
      source.publishWork({ assignmentId: assignment.id, title, description, coauthorIds }),
    );
    if (!id) return;
    // El trabajo ya existe: lo que no se pueda subir se avisa en su tarjeta, sin repetir el alta.
    setBusy(true);
    const fileErrors: string[] = [];
    for (const file of files) {
      try {
        await source.attachWorkFile(id, file);
      } catch (failure) {
        fileErrors.push(uploadError(failure, file));
      }
    }
    void navigate(`${backTo}?trabajo=${id}`, { state: fileErrors.length ? { fileErrors } : null });
  };

  return (
    <>
      <Link to={backTo} className="back with-icon">
        <Icon name="back" size={16} /> {assignment.title}
      </Link>
      <header className="page-header">
        <div>
          <p className="eyebrow">{WORK_KIND_LABEL[assignment.kind]}</p>
          <h1>Subir mi trabajo</h1>
          <p className="muted">
            Quedará en la página de «{assignment.title}» junto a los de los demás, y en tu perfil. No
            reemplaza el trabajo de nadie.
          </p>
        </div>
      </header>

      <form className="panel form form--wide" onSubmit={(e) => void submit(e)}>
        <section className="form__section">
          <h2>Tu trabajo</h2>
          <label className="field">
            <span className="field__label">
              Tema o título <span className="field__optional">opcional</span>
            </span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            <span className="field__hint">Útil si cada equipo desarrolló un tema distinto.</span>
          </label>
          <label className="field">
            <span className="field__label">Descripción</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} />
            <span className="field__hint">
              De qué trata y cómo lo resolviste. Para pegar código, enciérralo entre líneas con ```.
            </span>
          </label>
        </section>

        <section className="form__section">
          <h2>
            Archivos <span className="field__optional">opcional</span>
          </h2>
          <FilePicker onFiles={addFiles} disabled={busy} />
          <FileList
            items={files.map((f) => ({ key: fileKey(f), name: f.name, size: f.size }))}
            onRemove={busy ? undefined : (key) => setFiles((list) => list.filter((f) => fileKey(f) !== key))}
          />
        </section>

        {others.length > 0 && (
          <section className="form__section">
            <h2>Con quién lo hiciste</h2>
            <p className="field__hint">
              Elige a tu equipo. El trabajo será uno solo y aparecerá a nombre de todos.
            </p>
            <div className="chips" role="group" aria-label="Coautores">
              {others.map((m) => {
                const selected = coauthorIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="chip chip--person"
                    aria-pressed={selected}
                    onClick={() => toggleCoauthor(m.id)}
                  >
                    <Avatar member={m} size={22} />
                    {m.displayName}
                    {selected && <Icon name="check" size={16} />}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form__actions">
          {empty && <span className="muted form__note">Escribe una descripción o adjunta un archivo.</span>}
          <Link to={backTo} className="button secondary">
            Cancelar
          </Link>
          <button type="submit" disabled={busy || empty}>
            {busy ? 'Subiendo archivos…' : 'Subir trabajo'}
          </button>
        </div>
      </form>
    </>
  );
}
