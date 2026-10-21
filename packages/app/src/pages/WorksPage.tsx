import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
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
import type { Assignment, Member, Work, WorkPublicationStatus } from '../data/types';
import { Avatar } from '../components/Avatar';
import { AvatarStack } from '../components/AvatarStack';
import { Empty } from '../components/Empty';
import { FileList } from '../components/FileList';
import { FilePicker } from '../components/FilePicker';
import { Icon } from '../components/Icon';
import { PostArchive, PostTimeline } from '../components/PostViews';
import { AcademicComments, PageHistory, ProgressControl, ResourceSection, WorkHistoryAndReview } from '../components/AcademicTools';
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
import { currentPlacement, lastPeriod, rememberPeriod, termAt } from '../lib/period';
import { buildPosts, filterPosts, type PostFilters } from '../lib/posts';
import { bySubject, NO_TERM, submittersOf, worksOf } from '../lib/works';

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
 * El módulo completo: páginas de tareas, actividades, exposiciones y exámenes, y actividades de
 * clase, en una sola lista con dos vistas (por materia o por fecha). Los filtros viven en la
 * URL para conservarlos al volver de una página.
 */
export function AssignmentsPage() {
  const { me, assignments, activities, evidences, works, workFiles, subjects, terms, members, myProgress, resourceFiles } =
    useSnapshot();
  const [params, setParams] = useSearchParams();
  const kindParam = params.get('tipo');
  const periodParam = Number(params.get('cuatri'));
  const filters: PostFilters = {
    query: params.get('q') ?? '',
    kindGroup: isWorkKindGroup(kindParam) ? kindParam : '',
    period: isValidPeriod(periodParam) ? periodParam : 0,
    subjectId: params.get('materia') ?? '',
    termId: params.get('parcial') ?? '',
    personId: params.get('autor') ?? '',
    exactKind: params.get('clase') ?? '',
    topic: params.get('tema') ?? '',
    from: params.get('desde') ?? '',
    to: params.get('hasta') ?? '',
    workStatus: params.get('estado') ?? '',
    progress: params.get('avance') ?? '',
  };
  const view = params.get('vista') === 'fechas' ? 'dates' : 'subjects';

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

  const posts = buildPosts({ assignments, works, workFiles, activities, evidences, members, myProgress, resourceFiles });
  const ctx = { subjects, terms };
  const shown = filterPosts(posts, filters, ctx);
  // Cada conteo respeta los demás filtros: así se ve cuánto hay antes de elegir.
  const beforeKind = filterPosts(posts, { ...filters, kindGroup: '' }, ctx);
  const beforeSubject = filterPosts(posts, { ...filters, subjectId: '', termId: '' }, ctx);
  // Con un cuatrimestre elegido se ven sus materias aunque estén vacías; sin él, solo las que
  // ya tienen algo, para no listar las 45 del plan.
  const subjectChips = subjects
    .filter((s) => (filters.period ? s.period === filters.period : true))
    .sort(bySubject)
    .map((s) => ({ ...s, count: beforeSubject.filter((p) => p.subjectId === s.id).length }))
    .filter((s) => filters.period || s.count > 0 || s.id === filters.subjectId);
  const inSubject = beforeSubject.filter((p) => p.subjectId === filters.subjectId);
  const termChips = filters.subjectId
    ? [
        ...terms
          .filter((t) => t.subjectId === filters.subjectId)
          .sort((a, b) => a.position - b.position)
          .map((t) => ({ id: t.id, name: t.name, count: inSubject.filter((p) => p.termId === t.id).length })),
        { id: NO_TERM, name: 'Sin parcial', count: inSubject.filter((p) => !p.termId).length },
      ].filter((t) => t.id !== NO_TERM || t.count > 0 || t.id === filters.termId)
    : [];
  const filtering = Boolean(
    filters.query ||
    filters.kindGroup ||
    filters.period ||
    filters.subjectId ||
    filters.termId ||
    filters.personId || filters.exactKind || filters.topic || filters.from || filters.to || filters.workStatus || filters.progress,
  );
  const people = members.filter((m) => m.id !== me?.id && posts.some((p) => p.people.includes(m.id)));

  // Crear desde una lista filtrada deja el formulario ya clasificado.
  const newParams = new URLSearchParams();
  if (filters.period) newParams.set('cuatri', String(filters.period));
  if (filters.subjectId) newParams.set('materia', filters.subjectId);
  if (filters.termId && filters.termId !== NO_TERM) newParams.set('parcial', filters.termId);
  const classTo = `/m/actividades/nueva${newParams.size ? `?${newParams}` : ''}`;
  if (filters.kindGroup) newParams.set('tipo', filters.kindGroup);
  const newTo = `/m/tareas/nueva${newParams.size ? `?${newParams}` : ''}`;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Tareas y Actividades</h1>
          <p className="muted">
            Lo que se entrega y lo que se hizo en clase, en un solo lugar. Cada publicación tiene su
            página, que todos pueden editar, y ahí mismo lo que subió cada quien.
          </p>
        </div>
        <div className="row">
          <Link to={classTo} className="button secondary with-icon">
            <Icon name="plus" size={18} /> Registrar actividad de clase
          </Link>
          <Link to={newTo} className="button with-icon">
            <Icon name="plus" size={18} /> Nueva tarea o actividad
          </Link>
        </div>
      </header>

      {posts.length === 0 ? (
        <Empty
          icon="folder"
          title="Todavía no hay nada publicado"
          action={
            <Link to={newTo} className="button">
              Crear la primera
            </Link>
          }
        >
          Crea la página de una tarea, actividad, exposición o examen, o registra lo que hicieron en
          clase.
        </Empty>
      ) : (
        <>
          <div className="toolbar" role="search">
            <label className="search toolbar__search">
              <Icon name="search" size={18} />
              <input
                type="search"
                placeholder="Buscar por título, tema o autor"
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
              aria-label="Con participación de"
              value={filters.personId}
              onChange={(e) => update({ autor: e.target.value })}
            >
              <option value="">De todos</option>
              {me && <option value={me.id}>Donde participé</option>}
              {people.map((m) => (
                <option key={m.id} value={m.id}>
                  Donde participó {m.displayName}
                </option>
              ))}
            </select>
            <div className="segmented" role="group" aria-label="Vista">
              <button type="button" aria-pressed={view === 'subjects'} onClick={() => update({ vista: '' })}>
                Por materia
              </button>
              <button type="button" aria-pressed={view === 'dates'} onClick={() => update({ vista: 'fechas' })}>
                Por fecha
              </button>
            </div>
          </div>

          <details className="panel academic-filters" open={Boolean(filters.exactKind || filters.topic || filters.from || filters.to || filters.workStatus || filters.progress)}>
            <summary>Más filtros</summary>
            <div className="form__grid">
              <label className="field"><span className="field__label">Tipo exacto</span><select value={filters.exactKind} onChange={(e) => update({ clase: e.target.value })}>
                <option value="">Todos los tipos</option><option value="tarea">Tarea</option><option value="actividad">Actividad</option><option value="exposicion">Exposición</option><option value="examen">Examen</option><option value="clase">Actividad de clase</option>
              </select></label>
              <label className="field"><span className="field__label">Tema</span><input value={filters.topic} onChange={(e) => update({ tema: e.target.value })} placeholder="Filtrar por tema" /></label>
              <label className="field"><span className="field__label">Desde</span><input type="date" value={filters.from} onChange={(e) => update({ desde: e.target.value })} /></label>
              <label className="field"><span className="field__label">Hasta</span><input type="date" value={filters.to} onChange={(e) => update({ hasta: e.target.value })} /></label>
              <label className="field"><span className="field__label">Estado de trabajos</span><select value={filters.workStatus} onChange={(e) => update({ estado: e.target.value })}>
                <option value="">Todos los estados</option><option value="draft">Borrador compartido</option><option value="final">Final</option><option value="reviewed">Revisado</option>
              </select></label>
              <label className="field"><span className="field__label">Mi avance</span><select value={filters.progress} onChange={(e) => update({ avance: e.target.value })}>
                <option value="">Cualquier avance</option><option value="pending">Sin empezar</option><option value="in_progress">En proceso</option><option value="done">Terminado</option>
              </select></label>
            </div>
            {filters.from && filters.to && filters.from > filters.to && <p className="error" role="alert">La fecha inicial debe ser anterior o igual a la fecha final.</p>}
            <p className="field__hint">Las fechas corresponden a la entrega o a la sesión. El estado filtra trabajos publicados; el avance solo muestra el tuyo.</p>
          </details>
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
                <span className="chip__count">{beforeKind.filter((p) => p.group === group.id).length}</span>
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
            {shown.length} {filtering ? 'con estos filtros' : 'en total'}
            {filtering && (
              <>
                {' · '}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setParams(view === 'dates' ? { vista: 'fechas' } : {}, { replace: true })}
                >
                  Limpiar filtros
                </button>
              </>
            )}
          </p>

          {shown.length === 0 ? (
            <Empty
              icon="search"
              title="Nada por aquí todavía"
              action={
                <Link to={newTo} className="button secondary">
                  Crear aquí
                </Link>
              }
            >
              Ninguna publicación coincide con la búsqueda y los filtros elegidos.
            </Empty>
          ) : view === 'dates' ? (
            <PostTimeline posts={shown} subjects={subjects} terms={terms} members={members} meId={me?.id} />
          ) : (
            <PostArchive posts={shown} subjects={subjects} terms={terms} members={members} meId={me?.id} />
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
  const [topic, setTopic] = useState(work.topic ?? '');
  const [status, setStatus] = useState<WorkPublicationStatus>(work.status === 'draft' || !work.status ? 'draft' : 'final');
  const [baseVersion] = useState(work.version);
  const changed = title.trim() !== work.title || description.trim() !== work.description || topic.trim() !== (work.topic ?? '') || status !== (work.status === 'reviewed' ? 'final' : work.status ?? 'draft');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(async () => (await source.saveWorkVersion(work.id, { title, description, topic, status }, baseVersion), true))) onDone();
  };

  return (
    <form className="form" onSubmit={submit}>
      <label className="field">
        <span className="field__label">
          Tema o título <span className="field__optional">opcional</span>
        </span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </label>
      <label className="field"><span className="field__label">Tema</span><input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} /></label>
      <label className="field"><span className="field__label">Estado del trabajo</span><select value={status} onChange={(e) => setStatus(e.target.value as WorkPublicationStatus)}>
        <option value="draft">Borrador compartido</option><option value="final">Final</option>
      </select><span className="field__hint">Una versión nueva requiere otra revisión de un compañero.</span></label>
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
function SubmissionCard({ work, members, meId, highlighted, initialErrors }: {
  work: Work; members: Member[]; meId: string | undefined; highlighted: boolean; initialErrors: string[];
}) {
  const [editing, setEditing] = useState(false);
  const canEdit = Boolean(meId && canEditWork(meId, work.authorIds));
  return <article id={`trabajo-${work.id}`} className={highlighted ? 'panel submission submission--highlighted' : 'panel submission'}>
    <header className="evidence__header">
      <AvatarStack members={work.authorIds.map((id) => members.find((m) => m.id === id))} size={28} max={4} />
      <span className="evidence__who"><strong>{peopleList(work.authorIds, members, meId)}</strong>
        <span className="muted">{work.authorIds.length > 1 ? 'Equipo' : 'Individual'} · {formatTime(work.updatedAt)} · versión {work.version}</span>
      </span>
      {canEdit && <span className="badge badge--resolved">Tu trabajo</span>}
      {canEdit && !editing && <button type="button" className="icon-button" aria-label="Editar mi trabajo" title="Editar" onClick={() => setEditing(true)}><Icon name="edit" size={18} /></button>}
    </header>
    {editing ? <EditWorkForm work={work} onDone={() => setEditing(false)} /> : <>
      {work.title && <h3 className="submission__title">{work.title}</h3>}
      {work.topic && <p className="muted">Tema: {work.topic}</p>}
      <RichText text={work.description} />
    </>}
    <ResourceSection kind="work" id={work.id} version={work.version} canEdit={canEdit} />
    {initialErrors.length > 0 && <ul className="file-picker__errors error" role="alert">{initialErrors.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
    <WorkHistoryAndReview work={work} />
    <AcademicComments kind="work" id={work.id} />
  </article>;
}

/** Página principal: lo que se pidió (editable por todos) y los trabajos de cada alumno. */
export function AssignmentPage() {
  const { assignmentId = '' } = useParams();
  const location = useLocation();
  const [params] = useSearchParams();
  const { me, assignments, activities, works, subjects, terms, members, activityLinks } =
    useSnapshot();
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
  const roster = members.filter((m) => m.status === 'active');
  const submitted = submittersOf(assignment.id, works);
  const done = roster.filter((m) => submitted.includes(m.id)).length;
  const alreadyMine = Boolean(me && submitted.includes(me.id));
  const fileErrors = (location.state as { fileErrors?: string[] } | null)?.fileErrors ?? [];
  const inSubject = { ...(subject && { cuatri: String(subject.period) }), materia: assignment.subjectId };
  // El vínculo con «Actividades de clase»: las sesiones de esta misma materia y parcial.
  const sessions = activities
    .filter((a) => a.subjectId === assignment.subjectId && a.termId === assignment.termId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const sessionsLink = `/m/tareas?${new URLSearchParams({ ...inSubject, parcial: assignment.termId ?? NO_TERM, vista: 'fechas' })}`;

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
            <PageHistory kind="assignment" id={assignment.id} version={assignment.version} />
          )}

          <section className="panel"><ResourceSection kind="assignment" id={assignment.id} version={assignment.version} canEdit={Boolean(me)} title="Recursos de la consigna" /></section>
          <h2 className="section-title">
            Trabajos de cada alumno <span className="muted">{own.length}</span>
          </h2>
          {own.map((work) => (
            <SubmissionCard
              key={work.id}
              work={work}
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
          <ProgressControl kind="assignment" id={assignment.id} />
          {activityLinks.some((link) => link.targetKind === 'assignment' && link.targetId === assignment.id && !link.removedAt) && <section className="panel"><h2 className="label">Actividades enlazadas</h2><ul className="links">{activityLinks.filter((link) => link.targetKind === 'assignment' && link.targetId === assignment.id && !link.removedAt).map((link) => <li key={link.id}><Link to={`/m/actividades/${link.activityId}`}>{activities.find((a) => a.id === link.activityId)?.title ?? 'Actividad de clase'}</Link></li>)}</ul></section>}
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

          {sessions.length > 0 && (
            <section className="panel">
              <h2 className="label">Actividades de clase de {term ? 'este parcial' : 'esta materia'}</h2>
              <ul className="links">
                {sessions.slice(0, 4).map((a) => (
                  <li key={a.id}>
                    <Link to={`/m/actividades/${a.id}`}>
                      <strong>{a.title}</strong>
                      <span className="muted">{formatDate(parseDay(a.date))}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {sessions.length > 4 && (
                <p className="panel__more">
                  <Link to={sessionsLink}>Ver las {sessions.length}</Link>
                </p>
              )}
            </section>
          )}

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
  const { members, subjects, terms, calendar } = useSnapshot();
  const { error, run } = useAction();
  const backTo = assignment ? `/m/tareas/${assignment.id}` : '/m/tareas';
  // Al crear, el formulario abre en el cuatrimestre y parcial vigentes según Ajustes.
  const current = currentPlacement(calendar);
  const currentTermOf = (subject: string, inPeriodNumber: number) =>
    inPeriodNumber === current?.period ? (termAt(terms, subject, current.term)?.id ?? '') : '';

  const firstIn = (period: number) =>
    subjects.filter((s) => s.period === period).sort(bySubject)[0]?.id ?? NEW;
  const asked = subjects.find((s) => s.id === (assignment?.subjectId ?? params.get('materia')));
  const [period, setPeriod] = useState(() => {
    const fromFilter = Number(params.get('cuatri'));
    return asked?.period ?? (isValidPeriod(fromFilter) ? fromFilter : (current?.period ?? lastPeriod()));
  });
  const [subjectId, setSubjectId] = useState(() => asked?.id ?? firstIn(period));
  const [termId, setTermId] = useState(() => {
    if (assignment) return assignment.termId ?? '';
    const askedTerm = terms.find((t) => t.id === params.get('parcial') && t.subjectId === subjectId);
    return askedTerm?.id ?? currentTermOf(subjectId, period);
  });
  /** Al cambiar de materia se conserva el mismo número de parcial. */
  const samePosition = (subject: string) =>
    termAt(terms, subject, terms.find((t) => t.id === termId)?.position)?.id ?? '';
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
  const [topic, setTopic] = useState(assignment?.topic ?? '');
  const [baseVersion] = useState(assignment?.version);

  const periodSubjects = subjects.filter((s) => s.period === period).sort(bySubject);
  const subjectTerms = terms
    .filter((t) => t.subjectId === subjectId)
    .sort((a, b) => a.position - b.position);
  const changed =
    !assignment ||
    title.trim() !== assignment.title ||
    instructions.trim() !== assignment.instructions ||
    topic.trim() !== (assignment.topic ?? '') ||
    dueDate !== (assignment.dueDate ?? '') ||
    kind !== assignment.kind ||
    subjectId !== assignment.subjectId ||
    termId !== (assignment.termId ?? '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const id = await run(async () => {
      // Si la materia o el parcial nuevos se crean pero guardar falla, quedan elegidos para
      // que un segundo intento no los duplique.
      let sid = subjectId;
      if (sid === NEW) {
        sid = await source.createSubject(newSubject, period);
        setSubjectId(sid);
        setNewSubject('');
      }
      let tid = termId;
      if (tid === NEW) {
        tid = await source.createTerm(sid, newTerm);
        setTermId(tid);
        setNewTerm('');
      }
      const input = {
        subjectId: sid,
        termId: tid || undefined,
        kind,
        title,
        instructions,
        topic,
        dueDate: dueDate || undefined,
      };
      if (!assignment) return source.createAssignment(input);
      await source.updateAssignment(assignment.id, input, baseVersion);
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
          {!assignment && current && period === current.period && (
            <p className="field__hint">
              Abre en {periodLabel(current.period)}, parcial {current.term}: el que está en curso según
              Ajustes.
            </p>
          )}
          <div className="form__grid">
            <label className="field">
              <span className="field__label">Cuatrimestre</span>
              <select
                value={period}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  const subject = firstIn(next);
                  setPeriod(next);
                  setSubjectId(subject);
                  setTermId(currentTermOf(subject, next));
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
                  setTermId(samePosition(e.target.value));
                  setSubjectId(e.target.value);
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
          <label className="field"><span className="field__label">Tema <span className="field__optional">opcional</span></span><input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} /></label>
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
  const [topic, setTopic] = useState('');
  const [status, setStatus] = useState<WorkPublicationStatus>('draft');
  const [coauthorIds, setCoauthorIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [uploadVersion, setUploadVersion] = useState(1);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const uploadController = useRef<AbortController | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ name: string; done: number; total: number } | null>(null);
  useEffect(() => () => uploadController.current?.abort(), []);
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
    if (busy) return;
    setBusy(true);
    const id = createdId ?? await run(() => source.publishWork({ assignmentId: assignment.id, title, description, coauthorIds, topic, status }));
    if (!id) { setBusy(false); return; }
    setCreatedId(id);
    setUploadErrors([]);
    const controller = new AbortController();
    uploadController.current = controller;
    let expectedVersion = uploadVersion;
    for (let index = 0; index < files.length; index++) {
      const file = files[index]!;
      try {
        setUploadProgress({ name: file.name, done: 0, total: file.size });
        await source.attachResourceFile('work', id, file, expectedVersion, { signal: controller.signal,
          onProgress: (done, total) => setUploadProgress({ name: file.name, done, total }) });
        expectedVersion++;
        setUploadVersion(expectedVersion);
      } catch (failure) {
        setUploadErrors([uploadError(failure, file)]);
        setFiles(files.slice(index));
        uploadController.current = null;
        setUploadProgress(null);
        setBusy(false);
        return;
      }
    }
    uploadController.current = null;
    setUploadProgress(null);
    void navigate(`${backTo}?trabajo=${id}`);
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

      {createdId && <p className="panel" role="status">Tu trabajo ya está publicado. Reintentar solo confirma los archivos pendientes, sin crear otro trabajo. <Link to={`${backTo}?trabajo=${createdId}`}>Abrir el trabajo</Link></p>}
      <form className="panel form form--wide" onSubmit={(e) => void submit(e)}>
        <fieldset className="academic-publish-fields" disabled={busy || Boolean(createdId)}>
        <section className="form__section">
          <h2>Tu trabajo</h2>
          <label className="field">
            <span className="field__label">
              Tema o título <span className="field__optional">opcional</span>
            </span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            <span className="field__hint">Útil si cada equipo desarrolló un tema distinto.</span>
          </label>
          <label className="field"><span className="field__label">Tema académico <span className="field__optional">opcional</span></span><input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} /></label>
          <label className="field"><span className="field__label">Estado del trabajo</span><select value={status} onChange={(e) => setStatus(e.target.value as WorkPublicationStatus)}><option value="draft">Borrador compartido</option><option value="final">Final</option></select><span className="field__hint">Ambos son visibles para el grupo. Solo otro compañero puede marcar una versión final como revisada.</span></label>
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

        </fieldset>
        {uploadProgress && <p role="status">Subiendo {uploadProgress.name}: {Math.round(uploadProgress.done / uploadProgress.total * 100)} % <button type="button" className="link-button" onClick={() => uploadController.current?.abort()}>Cancelar subida</button></p>}
        {uploadErrors.length > 0 && <ul className="error" role="alert">{uploadErrors.map((message) => <li key={message}>{message}</li>)}</ul>}
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
            {busy ? 'Subiendo archivos…' : createdId ? 'Reintentar archivos pendientes' : 'Subir trabajo'}
          </button>
        </div>
      </form>
    </>
  );
}
