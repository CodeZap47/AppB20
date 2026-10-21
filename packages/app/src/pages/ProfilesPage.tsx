import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  HELP_KIND_LABEL,
  nextCelebration,
  periodLabel,
  WORK_KIND_LABEL,
  workKindGroup,
} from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Id, Member, Snapshot, Subject } from '../data/types';
import { Avatar } from '../components/Avatar';
import { AvatarStack } from '../components/AvatarStack';
import { BirthdayForm } from '../components/BirthdayForm';
import { ProfileCover, ProfileEditor, ProfilePhoto } from '../components/ProfilePresentation';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { useAction } from '../components/useAction';
import { formatDate, formatDayMonth, formatMonth, parseDay } from '../lib/format';
import { previewText } from '../lib/messages';
import { matches } from '../lib/search';
import { authorsLabel, bySubject, NO_TERM } from '../lib/works';
import { buildLeaderboard, standingSummary } from '../lib/contributions';

/** Lo que cada quien ha aportado al grupo, para las tarjetas y el encabezado del perfil. */
function contributionsOf(memberId: Id, data: Snapshot) {
  const works = data.works.filter((w) => w.authorIds.includes(memberId) && !w.withdrawnAt && w.status !== 'draft');
  const notes = data.notes.filter((n) => n.authorId === memberId && !n.withdrawnAt && n.visibility === 'group');
  const answers = data.answers.filter((a) => a.authorId === memberId && !a.withdrawnAt && data.questions.some((q) => q.id === a.questionId && !q.withdrawnAt));
  const helpful = answers.filter((a) => data.questions.some((q) => q.acceptedAnswerId === a.id));
  const questions = data.questions.filter((q) => q.authorId === memberId && !q.withdrawnAt);
  const evidences = data.evidences.filter((e) => (e.authorId === memberId || e.participantIds.includes(memberId)) && !e.withdrawnAt);
  const helpPosts = data.helpPosts.filter(
    (post) => post.authorId === memberId && post.status !== 'withdrawn',
  );
  const subjectIds = new Set(
    works
      .map((w) => data.assignments.find((a) => a.id === w.assignmentId)?.subjectId)
      .filter((id): id is Id => Boolean(id)),
  );
  return { works, notes, answers, helpful, questions, evidences, helpPosts, subjectIds };
}

/** Guías que creó, editó, a las que agregó fuentes o que revisó. */
function guidesOf(memberId: Id, data: Snapshot) {
  return data.guides.filter(
    (guide) =>
      !guide.withdrawnAt &&
      (guide.createdBy === memberId ||
        guide.updatedBy === memberId ||
        data.guideSources.some((source) => source.guideId === guide.id && source.addedBy === memberId) ||
        data.guideReviews.some((review) => review.guideId === guide.id && review.reviewerId === memberId)),
  );
}

const isTeamWork = (work: { authorIds: Id[] }) => new Set(work.authorIds).size > 1;

type FeedKind = 'trabajo' | 'nota' | 'guia' | 'pregunta' | 'respuesta' | 'ayuda' | 'actividad';
const FEED_LABEL: Record<FeedKind, string> = {
  trabajo: 'Trabajo',
  nota: 'Nota',
  guia: 'Guía',
  pregunta: 'Pregunta',
  respuesta: 'Respuesta',
  ayuda: 'Ayuda',
  actividad: 'Actividad de clase',
};

interface FeedEntry {
  key: string;
  kind: FeedKind;
  at: Date;
  title: string;
  context: string;
  href: string;
}

/** Todo lo que la persona ha publicado o aportado, del más reciente al más antiguo. */
function profileFeed(memberId: Id, data: Snapshot): FeedEntry[] {
  const c = contributionsOf(memberId, data);
  const subjectName = (id?: Id) => data.subjects.find((s) => s.id === id)?.name;
  const context = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' · ');
  const entries: FeedEntry[] = [
    ...c.works.map((work): FeedEntry => {
      const assignment = data.assignments.find((a) => a.id === work.assignmentId);
      return {
        key: `trabajo-${work.id}`,
        kind: 'trabajo',
        at: work.createdAt,
        title: work.title || assignment?.title || 'Trabajo',
        context: context(
          assignment && WORK_KIND_LABEL[assignment.kind],
          subjectName(assignment?.subjectId),
          work.topic || assignment?.topic,
          isTeamWork(work) && 'En equipo',
        ),
        href: `/m/tareas/${work.assignmentId}?trabajo=${work.id}`,
      };
    }),
    ...c.notes.map((note): FeedEntry => ({
      key: `nota-${note.id}`,
      kind: 'nota',
      at: note.createdAt,
      title: note.title,
      context: context(subjectName(note.subjectId), note.topic),
      href: `/m/notas/${note.id}`,
    })),
    ...guidesOf(memberId, data).map((guide): FeedEntry => ({
      key: `guia-${guide.id}`,
      kind: 'guia',
      at: guide.createdAt,
      title: guide.title,
      context: context(subjectName(guide.subjectId), guide.createdBy === memberId ? 'La creó' : 'Colaboró'),
      href: `/m/guias/${guide.id}`,
    })),
    ...c.questions.map((question): FeedEntry => ({
      key: `pregunta-${question.id}`,
      kind: 'pregunta',
      at: question.createdAt,
      title: question.title,
      context: context(subjectName(question.subjectId), question.topic, question.status === 'resolved' ? 'Resuelta' : 'Abierta'),
      href: `/m/preguntas/${question.id}`,
    })),
    ...c.answers.map((answer): FeedEntry => {
      const question = data.questions.find((q) => q.id === answer.questionId);
      return {
        key: `respuesta-${answer.id}`,
        kind: 'respuesta',
        at: answer.createdAt,
        title: question?.title ?? 'Pregunta',
        context: context(
          subjectName(question?.subjectId),
          c.helpful.some((a) => a.id === answer.id) && 'Le sirvió a quien preguntó',
        ),
        href: `/m/preguntas/${answer.questionId}`,
      };
    }),
    ...c.helpPosts.map((post): FeedEntry => ({
      key: `ayuda-${post.id}`,
      kind: 'ayuda',
      at: post.createdAt,
      title: post.title,
      context: context(HELP_KIND_LABEL[post.kind], subjectName(post.subjectId), post.topic),
      href: `/m/ayuda/${post.id}`,
    })),
    ...c.evidences.map((evidence): FeedEntry => {
      const activity = data.activities.find((a) => a.id === evidence.activityId);
      return {
        key: `actividad-${evidence.id}`,
        kind: 'actividad',
        at: evidence.createdAt,
        title: activity?.title ?? 'Actividad de clase',
        context: context(subjectName(activity?.subjectId), activity?.topic),
        href: `/m/actividades/${evidence.activityId}`,
      };
    }),
  ];
  return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
}

function NoMatches({ query }: { query: string }) {
  return <p className="muted">Nada coincide con «{query}».</p>;
}

/** «Contigo y Ana», «Con Ana y Luis» o «Individual», visto por quien mira el perfil. */
function coauthorsLabel(others: Id[], members: Member[], meId?: Id): string {
  if (!others.length) return 'Individual';
  if (!meId || !others.includes(meId)) return `Con ${authorsLabel(others, members)}`;
  const rest = others.filter((id) => id !== meId);
  return rest.length ? `Contigo y ${authorsLabel(rest, members)}` : 'Contigo';
}

/** El calendario de cumpleaños abierto en el mes y el día de la próxima celebración. */
function birthdayLink(birthday: { day: number; month: number }): string {
  const next = nextCelebration(birthday, new Date());
  const month = String(next.getMonth() + 1).padStart(2, '0');
  return `/m/cumpleanos?mes=${next.getFullYear()}-${month}&dia=${next.getDate()}`;
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
  const shown = active.filter((m) => {
    const profile = data.memberProfiles.find((entry) => entry.memberId === m.id);
    return matches(query, m.displayName, profile?.preferredName ?? '', profile?.bio ?? '', ...(profile?.interests ?? []), ...(profile?.skills ?? []));
  });

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
            placeholder="Buscar por nombre, intereses o conocimientos"
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
                      {c.helpPosts.length > 0 && (
                        <span>
                          <strong>{c.helpPosts.length}</strong>{' '}
                          {c.helpPosts.length === 1 ? 'publicación de ayuda' : 'publicaciones de ayuda'}
                        </span>
                      )}
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
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(async () => (await source.updateProfile(name.trim()), true))) onDone();
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
  { id: '', label: 'Todo' },
  { id: 'trabajos', label: 'Trabajos' },
  { id: 'notas', label: 'Notas y guías' },
  { id: 'proyectos', label: 'Proyectos' },
  { id: 'colaboracion', label: 'Colaboración' },
  { id: 'contribuciones', label: 'Contribuciones' },
] as const;
type Tab = (typeof TABS)[number]['id'];
const isTab = (value: string | null): value is Tab => TABS.some((t) => t.id === value);

/** Línea de tiempo con todo lo que ha publicado o aportado, agrupada por mes. */
function AllTab({ member, query }: { member: Member; query: string }) {
  const data = useSnapshot();
  const isMe = member.id === data.me?.id;
  const feed = profileFeed(member.id, data);
  const shown = feed.filter((entry) => matches(query, entry.title, entry.context, FEED_LABEL[entry.kind]));

  if (feed.length === 0) {
    return (
      <Empty
        icon="folder"
        title={isMe ? 'Todavía no publicas nada' : 'Todavía no publica nada'}
        action={
          isMe && (
            <Link to="/m/tareas" className="button">
              Ir a Tareas y Actividades
            </Link>
          )
        }
      >
        {isMe
          ? 'Tus trabajos, notas, guías, preguntas, respuestas y publicaciones de ayuda aparecerán aquí en el orden en que los subas.'
          : 'Aquí aparecerá todo lo que comparta con el grupo, en el orden en que lo suba.'}
      </Empty>
    );
  }
  if (shown.length === 0) return <NoMatches query={query} />;

  const months: { label: string; entries: FeedEntry[] }[] = [];
  for (const entry of shown) {
    const label = formatMonth(entry.at);
    const last = months[months.length - 1];
    if (last?.label === label) last.entries.push(entry);
    else months.push({ label, entries: [entry] });
  }

  return (
    <div className="feed">
      {months.map((month) => (
        <section key={month.label} className="feed__month">
          <h2 className="label">{month.label}</h2>
          <ul className="feed__list">
            {month.entries.map((entry) => (
              <li key={entry.key} className="feed__item">
                <Link to={entry.href} className="work-card">
                  <span className="work-card__top">
                    <span className={`badge feed__kind feed__kind--${entry.kind}`}>
                      {FEED_LABEL[entry.kind]}
                    </span>
                    {entry.context && <span className="work-card__context">{entry.context}</span>}
                  </span>
                  <strong className="work-card__title">{entry.title}</strong>
                  <span className="work-card__footer">
                    <span className="work-card__date">{formatDate(entry.at)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Trabajos del alumno con la organización del archivo: materia → parcial → trabajo. */
function WorksTab({
  member,
  subjectId,
  query,
  onSubject,
}: {
  member: Member;
  subjectId: string;
  query: string;
  onSubject: (id: string) => void;
}) {
  const data = useSnapshot();
  const { me, members, assignments, workFiles, subjects, terms } = data;
  const [termFilter, setTermFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [topicFilter, setTopicFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const { works } = contributionsOf(member.id, data);
  const isMe = member.id === me?.id;
  const rows = works
    .map((work) => ({ work, assignment: assignments.find((a) => a.id === work.assignmentId) }))
    .filter(({ work, assignment }) => (!termFilter || assignment?.termId === termFilter)
      && (!typeFilter || assignment?.kind === typeFilter)
      && matches(topicFilter, work.topic ?? '', assignment?.topic ?? '', work.title)
      && matches(query, work.title, work.topic ?? '', assignment?.title ?? '', assignment?.topic ?? '')
      && (!fromDate || work.createdAt >= parseDay(fromDate)))
    .sort((a, b) => b.work.updatedAt.getTime() - a.work.updatedAt.getTime());
  const bySubjectId = (id: string) => rows.filter((r) => r.assignment?.subjectId === id);
  const subjectList = subjects.filter((s) => bySubjectId(s.id).length > 0).sort(bySubject);
  const shownSubjects = subjectList.filter((s) => !subjectId || s.id === subjectId);

  if (works.length === 0) {
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
      <div className="toolbar">
        <label className="field"><span className="field__label">Parcial</span><select value={termFilter} onChange={(event) => setTermFilter(event.target.value)}><option value="">Todos</option>{terms.filter((term) => !subjectId || term.subjectId === subjectId).map((term) => <option key={term.id} value={term.id}>{subjects.find((subject) => subject.id === term.subjectId)?.name} · {term.name}</option>)}</select></label>
        <label className="field"><span className="field__label">Tipo</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">Todos</option>{Object.entries(WORK_KIND_LABEL).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
        <label className="field"><span className="field__label">Tema o título</span><input value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)} /></label>
        <label className="field"><span className="field__label">Publicado desde</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        {isMe && <Link to="/m/tareas" className="button secondary">Publicar un trabajo</Link>}
      </div>
      {!shownSubjects.length && <p className="muted">No hay trabajos con estos filtros.</p>}
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

function NotesTab({ member, query }: { member: Member; query: string }) {
  const data = useSnapshot();
  const { me, subjects } = data;
  const { notes } = contributionsOf(member.id, data);
  const isMe = member.id === me?.id;
  const subjectName = (id: Id) => subjects.find((s) => s.id === id)?.name ?? '';
  const allGuides = guidesOf(member.id, data);
  const sorted = notes
    .filter((n) => matches(query, n.title, n.topic, subjectName(n.subjectId)))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const guides = allGuides.filter((guide) => matches(query, guide.title, subjectName(guide.subjectId), ...guide.topics));

  if (notes.length === 0 && allGuides.length === 0) {
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
  if (sorted.length === 0 && guides.length === 0) return <NoMatches query={query} />;

  return (
    <><h2>Notas compartidas</h2>{sorted.length === 0 && <p className="muted">{query ? 'Ninguna nota coincide.' : 'Sin notas compartidas todavía.'}</p>}<ul className="work-grid">
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
    </ul><h2>Guías en las que colaboró</h2>{guides.length ? <ul className="work-grid">{guides.map((guide) => <li key={guide.id}><Link className="work-card" to={`/m/guias/${guide.id}`}><strong>{guide.title}</strong><span className="muted">Versión {guide.version} · {subjects.find((subject) => subject.id === guide.subjectId)?.name}</span></Link></li>)}</ul> : <p className="muted">Sin guías compartidas todavía.</p>}</>
  );
}

/** Respuestas, preguntas, publicaciones de ayuda y actividades de clase en las que participó. */
function CollaborationTab({ member, query }: { member: Member; query: string }) {
  const data = useSnapshot();
  const { me, questions, activities, subjects } = data;
  const { answers, helpful, evidences, helpPosts } = contributionsOf(member.id, data);
  const allAsked = contributionsOf(member.id, data).questions;
  const isMe = member.id === me?.id;
  const subjectName = (id: Id) =>
    subjects.find((s: Subject) => s.id === id)?.name ?? 'Materia desconocida';
  const allAnswered = [...new Set(answers.map((a) => a.questionId))]
    .map((id) => questions.find((q) => q.id === id))
    .filter((q) => q !== undefined);
  const allSessions = [...new Set(evidences.map((e) => e.activityId))]
    .map((id) => activities.find((a) => a.id === id))
    .filter((a) => a !== undefined)
    .sort((a, b) => b.date.localeCompare(a.date));
  const answered = allAnswered.filter((q) => matches(query, q.title, q.topic, subjectName(q.subjectId)));
  const asked = allAsked.filter((q) => matches(query, q.title, q.topic, subjectName(q.subjectId)));
  const sessions = allSessions.filter((a) => matches(query, a.title, a.topic, subjectName(a.subjectId)));
  const sortedHelpPosts = helpPosts
    .filter((post) => matches(query, post.title, post.topic, subjectName(post.subjectId)))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  if (!allAnswered.length && !allAsked.length && !allSessions.length && !helpPosts.length) {
    return (
      <Empty icon="chat" title="Sin colaboraciones todavía">
        {isMe
          ? 'Cuando publiques ayuda, respondas una duda o registres tu evidencia de una actividad de clase, aparecerá aquí.'
          : 'Aquí aparecerán sus publicaciones de ayuda, sus respuestas, sus preguntas y las actividades de clase en las que participó.'}
      </Empty>
    );
  }
  if (!answered.length && !asked.length && !sessions.length && !sortedHelpPosts.length) {
    return <NoMatches query={query} />;
  }

  return (
    <div className="collab">
      {sortedHelpPosts.length > 0 && (
        <section className="panel">
          <h2 className="label">Puedo ayudarte / necesito ayuda</h2>
          <ul className="links">
            {sortedHelpPosts.map((post) => (
              <li key={post.id}>
                <Link to={`/m/ayuda/${post.id}`}>
                  <strong>{post.title}</strong>
                  <span className="muted">
                    {HELP_KIND_LABEL[post.kind]} · {subjectName(post.subjectId)} · {post.topic} ·{' '}
                    {post.status === 'open' ? 'Abierta' : 'Cerrada'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
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

function ProjectsTab({ member, query }: { member: Member; query: string }) {
  const data = useSnapshot();
  const all = contributionsOf(member.id, data).works.filter(isTeamWork);
  const projects = all.filter((work) => matches(query, work.title, work.topic ?? '', data.assignments.find((assignment) => assignment.id === work.assignmentId)?.title ?? '', authorsLabel(work.authorIds, data.members)));
  return <section><h2>Trabajos de equipo</h2><p className="muted">Referencias al mismo trabajo compartido con sus autores. Las versiones y los archivos se consultan en el registro original.</p>
    {projects.length ? <ul className="work-grid">{projects.map((work) => <li key={work.id}><Link className="work-card" to={`/m/tareas/${work.assignmentId}?trabajo=${work.id}`}><strong>{work.title || data.assignments.find((assignment) => assignment.id === work.assignmentId)?.title}</strong><span>{authorsLabel(work.authorIds, data.members)}</span><span className="muted">Versión {work.version} · {formatDate(work.updatedAt)}</span></Link></li>)}</ul> : all.length ? <NoMatches query={query} /> : <p className="muted">Todavía no ha compartido trabajos de equipo.</p>}
  </section>;
}

function ContributionsTab({ member }: { member: Member }) {
  const data = useSnapshot();
  const standing = buildLeaderboard(data, {}).find((entry) => entry.memberId === member.id);
  return <section className="panel"><h2>Contribuciones al grupo</h2><p>{standing?.points ?? 0} puntos{standing?.rank ? ` · lugar ${standing.rank}` : ''}</p><p className="muted">{standing && standingSummary(standing, 5) || 'Todavía no hay aportes reconocidos.'}</p><Link to={`/m/leaderboard/${member.id}?periodo=todo`}>Ver cada aporte y las reglas de puntuación</Link></section>;
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
  const [editingPresentation, setEditingPresentation] = useState(false);
  const [params, setParams] = useSearchParams();
  const member = members.find((m) => m.id === memberId);
  const profile = data.memberProfiles.find((entry) => entry.memberId === memberId);
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K lleva al buscador del perfil, como indica el atajo junto al campo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  /** Cambia solo los parámetros indicados; un valor vacío quita el parámetro. */
  const patchParams = (changes: Record<string, string>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  const tabParam = params.get('pestana');
  const subjectId = params.get('materia') ?? '';
  // Los enlaces antiguos con solo `?materia=` siguen abriendo los trabajos de esa materia.
  const tab: Tab = isTab(tabParam) ? tabParam : subjectId ? 'trabajos' : '';
  const query = params.get('q') ?? '';
  const setTab = (next: Tab) => patchParams({ pestana: next, materia: '' });
  const isMe = member.id === me?.id;
  // `?cumple=editar` abre la captura directo, para llegar desde el calendario de cumpleaños.
  const editingBirthday = isMe && params.get('cumple') === 'editar';
  const setEditingBirthday = (open: boolean) => patchParams({ cumple: open ? 'editar' : '' });
  const birthday = birthdays.find((b) => b.memberId === member.id);
  const c = contributionsOf(member.id, data);
  const memberSubjects = subjects.filter((s) => c.subjectIds.has(s.id)).sort(bySubject);
  const counts: Record<Tab, number> = {
    '': profileFeed(member.id, data).length,
    trabajos: c.works.length,
    notas: c.notes.length + guidesOf(member.id, data).length,
    proyectos: c.works.filter(isTeamWork).length,
    contribuciones: buildLeaderboard(data, {}).find((entry) => entry.memberId === member.id)?.points ?? 0,
    colaboracion:
      new Set(c.answers.map((a) => a.questionId)).size +
      c.questions.length +
      new Set(c.evidences.map((e) => e.activityId)).size +
      c.helpPosts.length,
  };

  const message = async () => {
    const id = await run(() => source.openDirectConversation(member.id));
    if (id) void navigate(`/m/mensajes/directos/${id}`);
  };

  return (
    <>
      <header className="profile-hero">
        <nav className="profile-crumbs" aria-label="Ruta">
          <Link to="/" className="profile-crumbs__home" aria-label="Inicio">
            <Icon name="home" size={20} />
          </Link>
          <Icon name="forward" size={14} />
          <Link to="/m/perfiles">Perfiles</Link>
          <Icon name="forward" size={14} />
          <span aria-current="page">{profile?.preferredName || member.displayName}</span>
        </nav>
        <ProfileCover cover={profile?.cover} />
        <div className="profile-hero__photo">
          <ProfilePhoto member={member} profile={profile} size={120} />
          {member.isCreator && (
            <span className="profile-verified" role="img" aria-label="Administra la app">
              <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">
                <path
                  fill="currentColor"
                  d="M12 1.5l2.6 1.9 3.2-.1 1 3 2.6 1.9-1 3.1 1 3.1-2.6 1.9-1 3-3.2-.1L12 22.5l-2.6-1.9-3.2.1-1-3-2.6-1.9 1-3.1-1-3.1 2.6-1.9 1-3 3.2.1z"
                />
                <path d="M7.8 12.3l2.8 2.8 5.6-5.8" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          )}
        </div>
        <div className="profile-hero__body">
          {editing ? (
            <EditName current={member.displayName} onDone={() => setEditing(false)} />
          ) : (
            <>
              <h1>
                {profile?.preferredName || member.displayName}
                {isMe && <span className="muted"> (tú)</span>}
              </h1>
              {profile?.preferredName && <p className="profile-hero__alias">{member.displayName}</p>}
              <p className="muted profile-hero__meta">
                {member.isCreator && <span className="badge badge--admin">Administra la app</span>}{' '}
                En el grupo desde {formatMonth(member.joinedAt).toLowerCase()}
              </p>
            </>
          )}
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
                <>
                  <button
                    type="button"
                    className="secondary with-icon"
                    onClick={() => setEditing(true)}
                  >
                    <Icon name="edit" size={16} /> Editar nombre
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setEditingPresentation(true)}
                  >
                    Editar presentación y foto
                  </button>
                </>
              ) : (
                <button type="button" className="with-icon" onClick={message}>
                  <Icon name="send" size={16} /> Enviar mensaje
                </button>
              )}
            </div>
          )}
          <label className="search profile-search" role="search">
            <Icon name="search" size={18} />
            <input
              ref={searchRef}
              type="search"
              placeholder={isMe ? 'Buscar en tus publicaciones' : 'Buscar en sus publicaciones'}
              aria-label="Buscar en el perfil"
              value={query}
              onChange={(e) => patchParams({ q: e.target.value })}
            />
            <kbd aria-hidden="true">⌘K</kbd>
          </label>
        </div>
      </header>
      <hr className="profile-divider" />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {editingPresentation && isMe && <ProfileEditor member={member} profile={profile} onDone={() => setEditingPresentation(false)} />}
      {profile && <section className="panel">
        <h2>Presentación</h2>
        {profile.bio && <p style={{ whiteSpace: 'pre-wrap' }}>{profile.bio}</p>}
        <dl className="facts">
          {profile.interests.length > 0 && <><dt>Intereses</dt><dd>{profile.interests.join(', ')}</dd></>}
          {profile.learningGoals && <><dt>Objetivos de aprendizaje</dt><dd>{profile.learningGoals}</dd></>}
          {profile.skills.length > 0 && <><dt>Puede explicar</dt><dd>{profile.skills.join(', ')}</dd></>}
          {profile.helpTopics.length > 0 && <><dt>Busca apoyo en</dt><dd>{profile.helpTopics.join(', ')}</dd></>}
          {profile.subjectIds.length > 0 && <><dt>Materias que cursa</dt><dd>{profile.subjectIds.map((id) => subjects.find((subject) => subject.id === id)?.name).filter(Boolean).join(', ')}</dd></>}
        </dl>
        {profile.portfolioLinks.length > 0 && <><h3>Portafolio</h3><ul className="links">{profile.portfolioLinks.map((url) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>)}</ul></>}
      </section>}

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
          {tab === '' && <AllTab member={member} query={query} />}
          {tab === 'trabajos' && (
            <WorksTab
              member={member}
              subjectId={subjectId}
              query={query}
              onSubject={(id) => patchParams({ pestana: 'trabajos', materia: id })}
            />
          )}
          {tab === 'notas' && <NotesTab member={member} query={query} />}
          {tab === 'proyectos' && <ProjectsTab member={member} query={query} />}
          {tab === 'colaboracion' && <CollaborationTab member={member} query={query} />}
          {tab === 'contribuciones' && <ContributionsTab member={member} />}
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
                  <Link to={birthdayLink(birthday)}>
                    {formatDayMonth(birthday.day, birthday.month)}
                  </Link>
                ) : (
                  <span className="muted">{isMe ? 'Sin agregar' : 'No lo compartió'}</span>
                )}
              </dd>
            </dl>
            {isMe &&
              (editingBirthday ? (
                <BirthdayForm onDone={() => setEditingBirthday(false)} />
              ) : (
                <button
                  type="button"
                  className="secondary with-icon bday-edit"
                  onClick={() => setEditingBirthday(true)}
                >
                  <Icon name={birthday ? 'edit' : 'cake'} size={16} />{' '}
                  {birthday ? 'Cambiar cumpleaños' : 'Agregar cumpleaños'}
                </button>
              ))}
          </section>
          {memberSubjects.length > 0 && (
            <section className="panel">
              <h2 className="label">Materias con trabajos</h2>
              <ul className="links">
                {memberSubjects.map((s) => (
                  <li key={s.id}>
                    <Link to={{ search: `?pestana=trabajos&materia=${encodeURIComponent(s.id)}` }} replace>
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
