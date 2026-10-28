import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { RelatedVisualProjects } from '../components/RelatedVisualProjects';
import { currentTerm, WORK_KIND_LABEL } from '@b20/core';
import { useSnapshot } from '../data/DataContext';
import type { Assignment, Note } from '../data/types';
import { Icon } from '../components/Icon';
import { calendarDays, dayKey, isCalendarDay } from '../lib/dueCalendar';
import { formatDate, parseDay } from '../lib/format';
import { previewText } from '../lib/messages';
import { matches } from '../lib/search';
import '../design/academic.css';

const monthLabel = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' });
const fullDay = new Intl.DateTimeFormat('es-MX', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

export function AssignmentCalendarPage() {
  const data = useSnapshot();
  const [params, setParams] = useSearchParams();
  const today = dayKey(new Date());
  const requested = params.get('mes') ?? '';
  const month = isCalendarDay(`${requested}-01`) ? requested : today.slice(0, 7);
  const selected = isCalendarDay(params.get('dia') ?? '')
    ? params.get('dia')!
    : month === today.slice(0, 7)
      ? today
      : `${month}-01`;
  const subjectId = params.get('materia') ?? '';
  const assignments = data.assignments.filter(
    (entry) => !subjectId || entry.subjectId === subjectId,
  );
  const days = calendarDays(month);
  const events = new Map<string, Assignment[]>();
  for (const assignment of assignments)
    if (isCalendarDay(assignment.dueDate))
      events.set(assignment.dueDate, [...(events.get(assignment.dueDate) ?? []), assignment]);
  const patch = (values: Record<string, string>) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(values))
        if (value) next.set(key, value);
        else next.delete(key);
      return next;
    });
  const move = (direction: number) => {
    const date = parseDay(`${month}-01`);
    date.setMonth(date.getMonth() + direction);
    const next = dayKey(date).slice(0, 7);
    if (isCalendarDay(`${next}-01`)) patch({ mes: next, dia: `${next}-01` });
  };
  const dueToday = events.get(selected) ?? [];
  const unscheduled = assignments.filter((assignment) => !isCalendarDay(assignment.dueDate));
  const monthTotal = assignments.filter(
    (assignment) => isCalendarDay(assignment.dueDate) && assignment.dueDate.startsWith(month),
  ).length;
  return (
    <>
      <header className="page-header academic-header">
        <div>
          <h1>Un día a la vez.</h1>
          <p className="muted">Tus entregas, justo donde deben estar.</p>
        </div>
        <Link to="/m/tareas/nueva" className="button with-icon">
          <Icon name="plus" size={17} /> Nueva tarea
        </Link>
      </header>
      <div className="academic-topline">
        <div className="academic-view-links">
          <Link to="/m/calendario" aria-current="page">
            Calendario
          </Link>
          <Link to="/m/materias">Por materia</Link>
        </div>
        <label className="academic-filter">
          Materia
          <select
            aria-label="Filtrar calendario por materia"
            value={subjectId}
            onChange={(event) => patch({ materia: event.target.value })}
          >
            <option value="">Todas las materias</option>
            {data.subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="academic-calendar-layout">
        <section className="calendar-board" aria-label="Calendario de entregas">
          <div className="calendar-board__toolbar">
            <div>
              <h2>{monthLabel.format(parseDay(`${month}-01`))}</h2>
              <p className="muted">
                {monthTotal} {monthTotal === 1 ? 'entrega programada' : 'entregas programadas'}
              </p>
            </div>
            <div className="row">
              <button
                type="button"
                className="secondary"
                aria-label="Mes anterior"
                onClick={() => move(-1)}
              >
                <Icon name="back" size={17} />
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => patch({ mes: today.slice(0, 7), dia: today })}
              >
                Hoy
              </button>
              <button
                type="button"
                className="secondary"
                aria-label="Mes siguiente"
                onClick={() => move(1)}
              >
                <Icon name="forward" size={17} />
              </button>
            </div>
          </div>
          <table className="calendar-month">
            <caption className="academic-sr">
              Entregas de {monthLabel.format(parseDay(`${month}-01`))}. Selecciona un día para ver
              el detalle.
            </caption>
            <thead>
              <tr>
                {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => (
                  <th scope="col" key={day}>
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: days.length / 7 }, (_, week) => (
                <tr key={week}>
                  {days.slice(week * 7, week * 7 + 7).map((day) => (
                    <td
                      key={day}
                      data-outside={!day.startsWith(month)}
                      data-selected={day === selected}
                      data-today={day === today}
                    >
                      <button
                        type="button"
                        className="calendar-day"
                        aria-pressed={day === selected}
                        aria-current={day === today ? 'date' : undefined}
                        aria-label={`${fullDay.format(parseDay(day))}, ${(events.get(day) ?? []).length} entregas`}
                        onClick={() =>
                          patch({
                            dia: day,
                            ...(day.startsWith(month) ? {} : { mes: day.slice(0, 7) }),
                          })
                        }
                      >
                        {Number(day.slice(-2))}
                      </button>
                      <div className="calendar-events">
                        {(events.get(day) ?? []).slice(0, 2).map((assignment) => (
                          <Link
                            key={assignment.id}
                            to={`/m/tareas/${assignment.id}`}
                            className="calendar-event"
                            title={assignment.title}
                          >
                            {assignment.title}
                          </Link>
                        ))}
                        {(events.get(day)?.length ?? 0) > 2 && (
                          <button className="calendar-more" onClick={() => patch({ dia: day })}>
                            +{events.get(day)!.length - 2} más
                          </button>
                        )}
                      </div>
                      {(events.get(day)?.length ?? 0) > 0 && (
                        <span className="calendar-dot" aria-hidden="true" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <aside className="calendar-agenda">
          <h2>{fullDay.format(parseDay(selected))}</h2>
          <p className="muted">
            {dueToday.length ? 'Esto se entrega este día.' : 'Un poco de espacio para avanzar.'}
          </p>
          {dueToday.length ? (
            <ul className="agenda-list">
              {dueToday.map((assignment) => (
                <li key={assignment.id}>
                  <span className="academic-subject-label">
                    {data.subjects.find((subject) => subject.id === assignment.subjectId)?.name}
                  </span>
                  <Link to={`/m/tareas/${assignment.id}`}>
                    {assignment.title}
                    <Icon name="forward" size={16} />
                  </Link>
                  <span className="muted">{WORK_KIND_LABEL[assignment.kind]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="agenda-empty">
              <Icon name="calendar" size={34} />
              <p>No hay entregas programadas.</p>
              <Link to="/m/materias">Explorar tus materias</Link>
            </div>
          )}
          {unscheduled.length > 0 && (
            <details className="calendar-unscheduled">
              <summary>
                Sin fecha de entrega <span>{unscheduled.length}</span>
              </summary>
              <ul>
                {unscheduled.map((assignment) => (
                  <li key={assignment.id}>
                    <Link to={`/m/tareas/${assignment.id}`}>{assignment.title}</Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </aside>
      </div>
    </>
  );
}

function NoteReference({ note, linked = false }: { note: Note; linked?: boolean }) {
  const { members } = useSnapshot();
  return (
    <Link to={`/m/notas/${note.id}`} className="subject-note">
      <Icon name="file" size={19} />
      <span>
        <strong>{note.title}</strong>
        <small>
          {members.find((member) => member.id === note.authorId)?.displayName ?? 'Integrante'}
          {linked ? ' · Referencia de esta tarea' : ''}
        </small>
      </span>
      <Icon name="forward" size={15} />
    </Link>
  );
}

export function SubjectsPage() {
  const data = useSnapshot();
  const navigate = useNavigate();
  const { subjectId } = useParams();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const defaultPeriod = currentTerm(data.calendar, dayKey(new Date()))?.period ?? 1;
  const selectedSubject = data.subjects.find((subject) => subject.id === subjectId);
  const requestedPeriod = Number(params.get('cuatri'));
  const period =
    requestedPeriod >= 1 && requestedPeriod <= 9
      ? requestedPeriod
      : (selectedSubject?.period ?? defaultPeriod);
  const subjects = data.subjects
    .filter((subject) => subject.period === period)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const subject = selectedSubject ?? (subjectId ? undefined : subjects[0]);
  const [tab, setTab] = useState<'entregas' | 'apuntes'>('entregas');
  const allAssignments = data.assignments.filter(
    (assignment) => assignment.subjectId === subject?.id,
  );
  const assignments = allAssignments
    .filter((assignment) =>
      matches(query, assignment.title, assignment.topic ?? '', assignment.instructions),
    )
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const groupNotes = data.notes.filter(
    (note) => note.subjectId === subject?.id && note.visibility === 'group' && !note.withdrawnAt,
  );
  const notes = groupNotes.filter((note) => matches(query, note.title, note.topic, note.body));
  return (
    <>
      <header className="page-header academic-header">
        <div>
          <h1>Lo que aprendemos, juntos.</h1>
          <p className="muted">Tareas y apuntes del grupo, conectados por materia.</p>
        </div>
        <Link to="/m/calendario" className="button secondary with-icon">
          <Icon name="calendar" size={17} /> Ver calendario
        </Link>
      </header>
      <div className="academic-topline">
        <div className="academic-view-links">
          <Link to="/m/calendario">Calendario</Link>
          <Link to="/m/materias" aria-current="page">
            Por materia
          </Link>
        </div>
        <label className="academic-filter">
          Cuatrimestre
          <select
            aria-label="Cuatrimestre de materias"
            value={period}
            onChange={(event) => void navigate(`/m/materias?cuatri=${event.target.value}`)}
          >
            {Array.from({ length: 9 }, (_, index) => (
              <option key={index + 1} value={index + 1}>
                {index + 1}º cuatrimestre
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="subject-workspace">
        <nav className="subject-directory" aria-label="Materias del cuatrimestre">
          <h2>Tus materias</h2>
          {subjects.length ? (
            subjects.map((entry, index) => (
              <Link
                key={entry.id}
                to={`/m/materias/${entry.id}?cuatri=${period}`}
                className="subject-directory__item"
                aria-current={entry.id === subject?.id ? 'page' : undefined}
              >
                <span className="subject-directory__symbol" data-tone={index % 4}>
                  <Icon name="book" size={21} />
                </span>
                <span>
                  <strong>{entry.name}</strong>
                  <small>
                    {
                      data.assignments.filter((assignment) => assignment.subjectId === entry.id)
                        .length
                    }{' '}
                    consignas
                  </small>
                </span>
                <Icon name="forward" size={15} />
              </Link>
            ))
          ) : (
            <p className="muted">Todavía no hay materias en este cuatrimestre.</p>
          )}
        </nav>
        <section className="subject-content">
          {!subject ? (
            <div className="agenda-empty">
              <h2>
                {subjectId ? 'Esta materia no está disponible' : 'Aquí empieza tu próximo tema'}
              </h2>
              <p className="muted">Selecciona otro cuatrimestre para consultar sus materias.</p>
            </div>
          ) : (
            <>
              <header className="subject-content__header">
                <div>
                  <h2>{subject.name}</h2>
                  <p className="muted">
                    {subject.period}º cuatrimestre · {allAssignments.length} consignas ·{' '}
                    {groupNotes.length} apuntes compartidos
                  </p>
                </div>
                <Link to={`/m/tareas/nueva?materia=${subject.id}`} className="button secondary">
                  Nueva tarea
                </Link>
              </header>
              <div className="subject-content__tools">
                <div
                  className="academic-view-links"
                  role="group"
                  aria-label="Contenido de la materia"
                >
                  <button
                    type="button"
                    aria-pressed={tab === 'entregas'}
                    onClick={() => setTab('entregas')}
                  >
                    Entregas
                  </button>
                  <button
                    type="button"
                    aria-pressed={tab === 'apuntes'}
                    onClick={() => setTab('apuntes')}
                  >
                    Apuntes del grupo
                  </button>
                </div>
                <label className="search">
                  <Icon name="search" size={17} />
                  <input
                    type="search"
                    aria-label="Buscar en la materia"
                    placeholder="Encuentra un tema…"
                    value={query}
                    onChange={(event) =>
                      setParams(
                        (old) => {
                          const next = new URLSearchParams(old);
                          if (event.target.value) next.set('q', event.target.value);
                          else next.delete('q');
                          return next;
                        },
                        { replace: true },
                      )
                    }
                  />
                </label>
              </div>
              {tab === 'entregas' ? (
                assignments.length ? (
                  <ul className="subject-assignments">
                    {assignments.map((assignment) => {
                      const references = groupNotes.filter((note) =>
                        note.assignmentIds?.includes(assignment.id),
                      );
                      return (
                        <li key={assignment.id}>
                          <div className="subject-assignment__date">
                            {isCalendarDay(assignment.dueDate) ? (
                              <>
                                <strong>{Number(assignment.dueDate.slice(-2))}</strong>
                                <span>
                                  {new Intl.DateTimeFormat('es-MX', { month: 'short' }).format(
                                    parseDay(assignment.dueDate),
                                  )}
                                </span>
                              </>
                            ) : (
                              <Icon name="calendar" size={24} />
                            )}
                          </div>
                          <div className="subject-assignment__body">
                            <div className="subject-assignment__meta">
                              <span>{WORK_KIND_LABEL[assignment.kind]}</span>
                              <span>
                                {assignment.dueDate
                                  ? `Entrega ${formatDate(parseDay(assignment.dueDate))}`
                                  : 'Sin fecha de entrega'}
                              </span>
                            </div>
                            <Link
                              to={`/m/tareas/${assignment.id}`}
                              className="subject-assignment__title"
                            >
                              {assignment.title}
                              <Icon name="forward" size={17} />
                            </Link>
                            <p className="muted">
                              {previewText(assignment.instructions).slice(0, 150)}
                            </p>
                            {references.length > 0 ? (
                              <div className="subject-assignment__references">
                                {references.map((note) => (
                                  <NoteReference key={note.id} note={note} linked />
                                ))}
                              </div>
                            ) : (
                              <p className="subject-assignment__no-notes">
                                Aún no hay apuntes vinculados a esta tarea.{' '}
                                <Link
                                  to={`/m/notas/nueva?materia=${subject.id}&tarea=${assignment.id}`}
                                >
                                  Compartir un apunte
                                </Link>
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="agenda-empty">
                    <Icon name="file" size={32} />
                    <h3>
                      {query ? 'No encontramos coincidencias' : 'Todavía no hay entregas aquí'}
                    </h3>
                    <p className="muted">
                      {query
                        ? 'Prueba con otro tema o título.'
                        : 'Cuando el grupo registre una tarea, aparecerá en esta materia.'}
                    </p>
                  </div>
                )
              ) : notes.length ? (
                <div className="subject-notes">
                  {notes.map((note) => (
                    <NoteReference key={note.id} note={note} />
                  ))}
                </div>
              ) : (
                <div className="agenda-empty">
                  <h3>{query ? 'No encontramos ese apunte' : 'El primer apunte puede ser tuyo'}</h3>
                  <p className="muted">Los apuntes personales se quedan en tu espacio privado.</p>
                  <Link to={`/m/notas/nueva?materia=${subject.id}`}>Compartir un apunte</Link>
                </div>
              )}
            </>
          )}
        </section>
      </div>
      {subject && <RelatedVisualProjects subjectId={subject.id} />}
    </>
  );
}
