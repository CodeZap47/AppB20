import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { periodLabel, WORK_KIND_LABEL, workKindGroup } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Id, Member, Snapshot, Subject } from '../data/types';
import { Avatar } from '../components/Avatar';
import { AvatarStack } from '../components/AvatarStack';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { useAction } from '../components/useAction';
import { formatDate, formatDayMonth, formatMonth, parseDay } from '../lib/format';
import { previewText } from '../lib/messages';
import { matches } from '../lib/search';
import { authorsLabel, bySubject, NO_TERM } from '../lib/works';

/** Lo que cada quien ha aportado al grupo, para las tarjetas y el encabezado del perfil. */
function contributionsOf(memberId: Id, data: Snapshot) {
  const works = data.works.filter((w) => w.authorIds.includes(memberId));
  const notes = data.notes.filter((n) => n.authorId === memberId);
  const answers = data.answers.filter((a) => a.authorId === memberId);
  const helpful = answers.filter((a) => data.questions.some((q) => q.acceptedAnswerId === a.id));
  const questions = data.questions.filter((q) => q.authorId === memberId);
  const evidences = data.evidences.filter((e) => e.participantIds.includes(memberId));
  const subjectIds = new Set(
    works
      .map((w) => data.assignments.find((a) => a.id === w.assignmentId)?.subjectId)
      .filter((id): id is Id => Boolean(id)),
  );
  return { works, notes, answers, helpful, questions, evidences, subjectIds };
}

/** «Contigo y Ana», «Con Ana y Luis» o «Individual», visto por quien mira el perfil. */
function coauthorsLabel(others: Id[], members: Member[], meId?: Id): string {
  if (!others.length) return 'Individual';
  if (!meId || !others.includes(meId)) return `Con ${authorsLabel(others, members)}`;
  const rest = others.filter((id) => id !== meId);
  return rest.length ? `Contigo y ${authorsLabel(rest, members)}` : 'Contigo';
}

function roleOf(member: Member): string {
  return member.isCreator ? 'Administra la app' : 'Integrante';
}

/** Directorio del grupo: buscar a alguien y entrar a su perfil. */
export function ProfilesPage() {
  const data = useSnapshot();
  const { me, members, birthdays } = data;
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const active = members
    .filter((m) => m.status === 'active')
    .sort(
      (a, b) =>
        Number(b.id === me?.id) - Number(a.id === me?.id) ||
        a.displayName.localeCompare(b.displayName, 'es'),
    );
  const shown = active.filter((m) => matches(query, m.displayName));

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Perfiles</h1>
          <p className="muted">
            Los {active.length} integrantes del grupo. En cada perfil están sus trabajos por materia
            y parcial, y lo que ha aportado.
          </p>
        </div>
        {me && (
          <div className="row">
            <Link to={`/perfil/${me.id}`} className="button secondary with-icon">
              <Avatar member={me} size={22} /> Mi perfil
            </Link>
          </div>
        )}
      </header>

      <div className="toolbar" role="search">
        <label className="search toolbar__search">
          <Icon name="search" size={18} />
          <input
            type="search"
            placeholder="Buscar por nombre"
            aria-label="Buscar integrantes"
            value={query}
            onChange={(e) =>
              setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })
            }
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <Empty icon="users" title="Nadie con ese nombre">
          Revisa cómo lo escribiste. Solo aparecen quienes ya entraron al grupo.
        </Empty>
      ) : (
        <ul className="people-grid">
          {shown.map((m) => {
            const c = contributionsOf(m.id, data);
            const birthday = birthdays.find((b) => b.memberId === m.id);
            return (
              <li key={m.id}>
                <Link to={`/perfil/${m.id}`} className="person-card">
                  <Avatar member={m} size={56} />
                  <span className="person-card__body">
                    <strong className="person-card__name">
                      {m.displayName}
                      {m.id === me?.id && <span className="muted"> (tú)</span>}
                    </strong>
                    <span className="person-card__meta">
                      {m.isCreator && <span className="badge badge--admin">Administra</span>}
                      {birthday && (
                        <span>Cumple el {formatDayMonth(birthday.day, birthday.month)}</span>
                      )}
                    </span>
                    <span className="person-card__stats">
                      <span>
                        <strong>{c.works.length}</strong>{' '}
                        {c.works.length === 1 ? 'trabajo' : 'trabajos'}
                      </span>
                      <span>
                        <strong>{c.notes.length}</strong> {c.notes.length === 1 ? 'nota' : 'notas'}
                      </span>
                      <span>
                        <strong>{c.answers.length}</strong>{' '}
                        {c.answers.length === 1 ? 'respuesta' : 'respuestas'}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function EditName({ current, onDone }: { current: string; onDone: () => void }) {
  const source = useDataSource();
  const [name, setName] = useState(current);
  const { error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (run(() => (source.updateProfile(name.trim()), true))) onDone();
  };
  return (
    <form className="profile-edit" onSubmit={submit}>
      <label className="field">
        <span className="field__label">Nombre que verá el grupo</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
          autoFocus
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form__actions">
        <button type="button" className="secondary" onClick={onDone}>
          Cancelar
        </button>
        <button type="submit" disabled={!name.trim() || name.trim() === current}>
          Guardar
        </button>
      </div>
    </form>
  );
}

const TABS = [
  { id: '', label: 'Trabajos' },
  { id: 'notas', label: 'Notas' },
  { id: 'colaboracion', label: 'Colaboración' },
] as const;
type Tab = (typeof TABS)[number]['id'];
const isTab = (value: string | null): value is Tab => TABS.some((t) => t.id === value);

/** Trabajos del alumno con la organización del archivo: materia → parcial → trabajo. */
function WorksTab({
  member,
  subjectId,
  onSubject,
}: {
  member: Member;
  subjectId: string;
  onSubject: (id: string) => void;
}) {
  const data = useSnapshot();
  const { me, members, assignments, workFiles, subjects, terms } = data;
  const { works } = contributionsOf(member.id, data);
  const isMe = member.id === me?.id;
  const rows = works
    .map((work) => ({ work, assignment: assignments.find((a) => a.id === work.assignmentId) }))
    .sort((a, b) => b.work.updatedAt.getTime() - a.work.updatedAt.getTime());
  const bySubjectId = (id: string) => rows.filter((r) => r.assignment?.subjectId === id);
  const subjectList = subjects.filter((s) => bySubjectId(s.id).length > 0).sort(bySubject);
  const shownSubjects = subjectList.filter((s) => !subjectId || s.id === subjectId);

  if (rows.length === 0) {
    return (
      <Empty
        icon="folder"
        title={isMe ? 'Todavía no subes trabajos' : 'Todavía no sube trabajos'}
        action={
          isMe && (
            <Link to="/m/tareas" className="button">
              Ir a Tareas y Actividades
            </Link>
          )
        }
      >
        {isMe
          ? 'Cuando subas tu trabajo en la página de una tarea, aparecerá aquí ordenado por materia y parcial.'
          : 'Sus trabajos aparecerán aquí, ordenados por materia y parcial, en cuanto suba alguno.'}
      </Empty>
    );
  }

  return (
    <>
      {subjectList.length > 1 && (
        <div className="chips chips--small chips--scroll" role="group" aria-label="Materia">
          <button
            type="button"
            className="chip"
            aria-pressed={!subjectId}
            onClick={() => onSubject('')}
          >
            Todas las materias <span className="chip__count">{rows.length}</span>
          </button>
          {subjectList.map((s) => (
            <button
              key={s.id}
              type="button"
              className="chip"
              aria-pressed={subjectId === s.id}
              onClick={() => onSubject(s.id)}
            >
              {s.name} <span className="chip__count">{bySubjectId(s.id).length}</span>
            </button>
          ))}
        </div>
      )}
      {shownSubjects.map((subject) => {
        const inSubject = bySubjectId(subject.id);
        const groups = [
          ...terms
            .filter((t) => t.subjectId === subject.id)
            .sort((a, b) => a.position - b.position)
            .map((t) => ({
              key: t.id,
              name: t.name,
              rows: inSubject.filter((r) => r.assignment?.termId === t.id),
            })),
          {
            key: NO_TERM,
            name: 'Sin clasificar',
            rows: inSubject.filter((r) => !r.assignment?.termId),
          },
        ].filter((g) => g.rows.length > 0);
        return (
          <section key={subject.id} className="archive__subject">
            <header>
              <h2>{subject.name}</h2>
              <span className="muted">
                {periodLabel(subject.period)} · {inSubject.length}{' '}
                {inSubject.length === 1 ? 'trabajo' : 'trabajos'}
              </span>
            </header>
            {groups.map((group) => (
              <div key={group.key}>
                <h3 className="label">{group.name}</h3>
                <ul className="work-grid">
                  {group.rows.map(({ work, assignment }) => {
                    const files = workFiles.filter((f) => f.workId === work.id).length;
                    const others = work.authorIds.filter((id) => id !== member.id);
                    const excerpt = previewText(work.description);
                    return (
                      <li key={work.id}>
                        <Link
                          to={`/m/tareas/${work.assignmentId}?trabajo=${work.id}`}
                          className="work-card"
                        >
                          <span className="work-card__top">
                            {assignment && (
                              <span className={`badge badge--${workKindGroup(assignment.kind)}`}>
                                {WORK_KIND_LABEL[assignment.kind]}
                              </span>
                            )}
                            {work.version > 1 && (
                              <span className="work-card__context">Versión {work.version}</span>
                            )}
                          </span>
                          <strong className="work-card__title">
                            {assignment?.title ?? 'Tarea desconocida'}
                          </strong>
                          {(work.title || excerpt) && (
                            <span className="work-card__excerpt">{work.title || excerpt}</span>
                          )}
                          <span className="work-card__footer">
                            {others.length > 0 && (
                              <AvatarStack
                                members={others.map((id) => members.find((m) => m.id === id))}
                              />
                            )}
                            <span className="work-card__authors">
                              {coauthorsLabel(others, members, me?.id)}
                              {files > 0 && ` · ${files} ${files === 1 ? 'archivo' : 'archivos'}`}
                            </span>
                            <span className="work-card__date">{formatDate(work.updatedAt)}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
    </>
  );
}

function NotesTab({ member }: { member: Member }) {
  const data = useSnapshot();
  const { me, subjects } = data;
  const { notes } = contributionsOf(member.id, data);
  const isMe = member.id === me?.id;
  const sorted = [...notes].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  if (sorted.length === 0) {
    return (
      <Empty
        icon="file"
        title={isMe ? 'Todavía no escribes notas' : 'No ha compartido notas'}
        action={
          isMe && (
            <Link to="/m/notas/nueva" className="button">
              Escribir una nota
            </Link>
          )
        }
      >
        {isMe
          ? 'Tus apuntes de clase aparecerán aquí.'
          : 'Aquí aparecerán los apuntes que comparta con el grupo.'}
      </Empty>
    );
  }

  return (
    <ul className="work-grid">
      {sorted.map((n) => {
        const excerpt = previewText(n.body);
        return (
          <li key={n.id}>
            <Link to={`/m/notas/${n.id}`} className="work-card">
              <span className="work-card__top">
                {n.visibility === 'personal' && (
                  <span className="badge badge--personal">Solo tú</span>
                )}
                <span className="work-card__context">
                  {[subjects.find((s) => s.id === n.subjectId)?.name, n.topic]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <strong className="work-card__title">{n.title}</strong>
              {excerpt && <span className="work-card__excerpt">{excerpt}</span>}
              <span className="work-card__footer">
                <span className="work-card__authors">
                  {n.version > 1 ? `Versión ${n.version}` : ''}
                </span>
                <span className="work-card__date">{formatDate(n.updatedAt)}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Respuestas, preguntas y actividades de clase en las que participó. */
function CollaborationTab({ member }: { member: Member }) {
  const data = useSnapshot();
  const { me, questions, activities, subjects } = data;
  const { answers, helpful, evidences } = contributionsOf(member.id, data);
  const asked = contributionsOf(member.id, data).questions;
  const isMe = member.id === me?.id;
  const subjectName = (id: Id) =>
    subjects.find((s: Subject) => s.id === id)?.name ?? 'Materia desconocida';
  const answered = [...new Set(answers.map((a) => a.questionId))]
    .map((id) => questions.find((q) => q.id === id))
    .filter((q) => q !== undefined);
  const sessions = [...new Set(evidences.map((e) => e.activityId))]
    .map((id) => activities.find((a) => a.id === id))
    .filter((a) => a !== undefined)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!answered.length && !asked.length && !sessions.length) {
    return (
      <Empty icon="chat" title="Sin colaboraciones todavía">
        {isMe
          ? 'Cuando respondas una duda o registres tu evidencia de una actividad de clase, aparecerá aquí.'
          : 'Aquí aparecerán sus respuestas, sus preguntas y las actividades de clase en las que participó.'}
      </Empty>
    );
  }

  return (
    <div className="collab">
      {answered.length > 0 && (
        <section className="panel">
          <h2 className="label">
            Respondió {answered.length} {answered.length === 1 ? 'duda' : 'dudas'}
            {helpful.length > 0 &&
              ` · ${helpful.length} le ${helpful.length === 1 ? 'sirvió' : 'sirvieron'} a quien preguntó`}
          </h2>
          <ul className="links">
            {answered.map((q) => (
              <li key={q.id}>
                <Link to={`/m/preguntas/${q.id}`}>
                  <strong>{q.title}</strong>
                  <span className="muted">
                    {subjectName(q.subjectId)}
                    {helpful.some((a) => a.id === q.acceptedAnswerId) && ' · Su respuesta le ayudó'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {asked.length > 0 && (
        <section className="panel">
          <h2 className="label">Preguntó</h2>
          <ul className="links">
            {asked.map((q) => (
              <li key={q.id}>
                <Link to={`/m/preguntas/${q.id}`}>
                  <strong>{q.title}</strong>
                  <span className="muted">
                    {subjectName(q.subjectId)} · {q.status === 'resolved' ? 'Resuelta' : 'Abierta'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {sessions.length > 0 && (
        <section className="panel">
          <h2 className="label">Actividades de clase en las que participó</h2>
          <ul className="links">
            {sessions.map((a) => (
              <li key={a.id}>
                <Link to={`/m/actividades/${a.id}`}>
                  <strong>{a.title}</strong>
                  <span className="muted">
                    {subjectName(a.subjectId)} · {formatDate(parseDay(a.date))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Perfil de un integrante: quién es, su archivo de trabajos y lo que ha aportado (3.9). */
export function ProfilePage() {
  const { memberId = '' } = useParams();
  const source = useDataSource();
  const navigate = useNavigate();
  const data = useSnapshot();
  const { me, members, birthdays, subjects } = data;
  const { error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [params, setParams] = useSearchParams();
  const member = members.find((m) => m.id === memberId);

  if (!member) {
    return (
      <Empty
        icon="users"
        title="Este perfil no existe"
        action={
          <Link to="/m/perfiles" className="button">
            Ver integrantes
          </Link>
        }
      >
        Puede que el enlace esté incompleto o que la persona ya no forme parte del grupo.
      </Empty>
    );
  }

  const tabParam = params.get('pestana');
  const tab: Tab = isTab(tabParam) ? tabParam : '';
  const subjectId = params.get('materia') ?? '';
  const setTab = (next: Tab) => setParams(next ? { pestana: next } : {}, { replace: true });
  const isMe = member.id === me?.id;
  const birthday = birthdays.find((b) => b.memberId === member.id);
  const c = contributionsOf(member.id, data);
  const memberSubjects = subjects.filter((s) => c.subjectIds.has(s.id)).sort(bySubject);
  const counts: Record<Tab, number> = {
    '': c.works.length,
    notas: c.notes.length,
    colaboracion:
      new Set(c.answers.map((a) => a.questionId)).size +
      c.questions.length +
      new Set(c.evidences.map((e) => e.activityId)).size,
  };

  const message = () => {
    const id = run(() => source.openDirectConversation(member.id));
    if (id) void navigate(`/m/mensajes/directos/${id}`);
  };

  return (
    <>
      <Link to="/m/perfiles" className="back with-icon">
        <Icon name="back" size={16} /> Perfiles
      </Link>

      <header className="profile-hero">
        <Avatar member={member} size={88} />
        <div className="profile-hero__body">
          {editing ? (
            <EditName current={member.displayName} onDone={() => setEditing(false)} />
          ) : (
            <>
              <h1>
                {member.displayName}
                {isMe && <span className="muted"> (tú)</span>}
              </h1>
              <p className="muted">
                {member.isCreator && <span className="badge badge--admin">Administra la app</span>}{' '}
                En el grupo desde {formatMonth(member.joinedAt).toLowerCase()}
              </p>
            </>
          )}
        </div>
        <dl className="profile-stats">
          <div>
            <dt>Trabajos</dt>
            <dd>{c.works.length}</dd>
          </div>
          <div>
            <dt>Materias</dt>
            <dd>{c.subjectIds.size}</dd>
          </div>
          <div>
            <dt>Notas</dt>
            <dd>{c.notes.length}</dd>
          </div>
          <div>
            <dt>Respuestas útiles</dt>
            <dd>{c.helpful.length}</dd>
          </div>
        </dl>
        {!editing && (
          <div className="row profile-hero__actions">
            {isMe ? (
              <button
                type="button"
                className="secondary with-icon"
                onClick={() => setEditing(true)}
              >
                <Icon name="edit" size={16} /> Editar nombre
              </button>
            ) : (
              <button type="button" className="with-icon" onClick={message}>
                <Icon name="send" size={16} /> Enviar mensaje
              </button>
            )}
          </div>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="detail">
        <div className="detail__main">
          <div className="segmented profile-tabs" role="group" aria-label="Sección del perfil">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                {t.label} <span className="chip__count">{counts[t.id]}</span>
              </button>
            ))}
          </div>
          {tab === '' && (
            <WorksTab
              member={member}
              subjectId={subjectId}
              onSubject={(id) => setParams(id ? { materia: id } : {}, { replace: true })}
            />
          )}
          {tab === 'notas' && <NotesTab member={member} />}
          {tab === 'colaboracion' && <CollaborationTab member={member} />}
        </div>

        <aside className="detail__side">
          <section className="panel">
            <h2 className="label">Datos</h2>
            <dl className="facts">
              <dt>Rol</dt>
              <dd>{roleOf(member)}</dd>
              <dt>Cumpleaños</dt>
              <dd>
                {birthday ? (
                  <Link to="/m/cumpleanos">{formatDayMonth(birthday.day, birthday.month)}</Link>
                ) : isMe ? (
                  <Link to="/m/cumpleanos">Compartir</Link>
                ) : (
                  <span className="muted">No lo compartió</span>
                )}
              </dd>
            </dl>
          </section>
          {memberSubjects.length > 0 && (
            <section className="panel">
              <h2 className="label">Materias con trabajos</h2>
              <ul className="links">
                {memberSubjects.map((s) => (
                  <li key={s.id}>
                    <Link to={{ search: `?materia=${encodeURIComponent(s.id)}` }} replace>
                      <strong>{s.name}</strong>
                      <span className="muted">{periodLabel(s.period)}</span>
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
