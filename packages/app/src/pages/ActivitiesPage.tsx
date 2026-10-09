import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { isValidPeriod, PERIOD_COUNT, periodLabel, WORK_KIND_LABEL } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Activity, Evidence, Member, Revision } from '../data/types';
import { Avatar } from '../components/Avatar';
import { AvatarStack } from '../components/AvatarStack';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { RevisionHistory } from '../components/RevisionHistory';
import { RichText } from '../components/RichText';
import { useAction } from '../components/useAction';
import { participantsOf } from '../lib/activities';
import {
  formatLongDay,
  formatMediumDate,
  formatTime,
  memberName,
  parseDay,
  peopleList,
  toDay,
} from '../lib/format';
import { currentPlacement, lastPeriod, rememberPeriod, termAt } from '../lib/period';
import { normalize } from '../lib/search';
import { bySubject, NO_TERM, revisionsOf } from '../lib/works';

const PERIODS = Array.from({ length: PERIOD_COUNT }, (_, i) => i + 1);

function EvidenceCard({
  evidence,
  members,
  meId,
}: {
  evidence: Evidence;
  members: Member[];
  meId: string | undefined;
}) {
  const mine = Boolean(meId && evidence.participantIds.includes(meId));
  return (
    <article className="panel evidence">
      <header className="evidence__header">
        <AvatarStack
          members={evidence.participantIds.map((id) => members.find((m) => m.id === id))}
          size={28}
          max={4}
        />
        <span className="evidence__who">
          <strong>{peopleList(evidence.participantIds, members, meId)}</strong>
          <span className="muted">
            {evidence.participantIds.length > 1 ? 'Equipo' : 'Individual'} · {formatTime(evidence.createdAt)}
          </span>
        </span>
        {mine && <span className="badge badge--resolved">Tu evidencia</span>}
      </header>
      <RichText text={evidence.content} />
    </article>
  );
}

/** Lista unida con «Tareas y Actividades»: aquí solo queda la vista por fecha de ese módulo. */
const LIST = '/m/tareas?vista=fechas';

/** La dirección antigua de la lista lleva a la lista unida, conservando los filtros. */
export function ActivitiesPage() {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.delete('mias');
  next.set('vista', 'fechas');
  return <Navigate to={`/m/tareas?${next}`} replace />;
}

function EvidenceForm({ activityId, onDone }: { activityId: string; onDone: () => void }) {
  const source = useDataSource();
  const { me, members } = useSnapshot();
  const { error, run } = useAction();
  const [content, setContent] = useState('');
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const others = members.filter((m) => m.id !== me?.id && m.status === 'active');
  const toggle = (id: string) =>
    setParticipantIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (run(() => source.addEvidence(activityId, content, participantIds))) onDone();
  };

  return (
    <form className="panel form" onSubmit={submit}>
      <label className="field">
        <span className="field__label">Qué hizo tu equipo</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={7}
          maxLength={20_000}
          placeholder="Cómo lo resolvieron, qué resultó y qué se les complicó"
          required
          autoFocus
        />
        <span className="field__hint">
          Para pegar código, enciérralo entre líneas con ```. Pide permiso antes de compartir imágenes o
          datos de compañeros.
        </span>
      </label>
      {others.length > 0 && (
        <fieldset className="field">
          <legend className="field__label">Con quién trabajaste</legend>
          <div className="chips" role="group" aria-label="Integrantes del equipo">
            {others.map((m) => {
              const selected = participantIds.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  className="chip chip--person"
                  aria-pressed={selected}
                  onClick={() => toggle(m.id)}
                >
                  <Avatar member={m} size={22} />
                  {m.displayName}
                  {selected && <Icon name="check" size={16} />}
                </button>
              );
            })}
          </div>
          <span className="field__hint">Tú ya cuentas. Tu evidencia no reemplaza la de otro equipo.</span>
        </fieldset>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form__actions">
        <button type="button" className="secondary" onClick={onDone}>
          Cancelar
        </button>
        <button type="submit" disabled={!content.trim()}>
          Agregar evidencia
        </button>
      </div>
    </form>
  );
}

export function ActivityPage() {
  const { activityId = '' } = useParams();
  const source = useDataSource();
  const { me, activities, assignments, evidences, members, subjects, terms, notes, revisions } = useSnapshot();
  const { error, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const activity = activities.find((a) => a.id === activityId);

  if (!activity) {
    return (
      <Empty
        icon="folder"
        title="Actividad no encontrada"
        action={
          <Link to={LIST} className="button">
            Ver las actividades
          </Link>
        }
      >
        Puede que el enlace esté incompleto o que la actividad ya no exista.
      </Empty>
    );
  }

  const subject = subjects.find((s) => s.id === activity.subjectId);
  const own = evidences
    .filter((e) => e.activityId === activity.id)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const participantIds = participantsOf(activity.id, evidences);
  // Notas del grupo sobre la misma materia y tema, para repasar lo visto en la sesión.
  const related = activity.topic
    ? notes
        .filter((n) => n.subjectId === activity.subjectId && normalize(n.topic) === normalize(activity.topic))
        .slice(0, 4)
    : [];
  const inSubject = { ...(subject && { cuatri: String(subject.period) }), materia: activity.subjectId };
  const history = revisionsOf('activity', activity.id, revisions);
  const term = terms.find((t) => t.id === activity.termId);
  // El vínculo con «Tareas y Actividades»: lo que se entrega en esta misma materia y parcial.
  const sameTerm = assignments
    .filter((a) => a.subjectId === activity.subjectId && a.termId === activity.termId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const tasksLink = `/m/tareas?${new URLSearchParams({ ...inSubject, parcial: activity.termId ?? NO_TERM })}`;

  // Restaurar es editar con el texto de antes: crea una versión nueva y no borra ninguna.
  const restore = (revision: Revision) =>
    run(() =>
      source.updateActivity(activity.id, {
        subjectId: activity.subjectId,
        topic: activity.topic,
        date: activity.date,
        title: revision.title,
        objective: revision.summary,
        instructions: revision.body,
      }),
    );

  return (
    <>
      <Link to={LIST} className="back with-icon">
        <Icon name="back" size={16} /> Tareas y Actividades
      </Link>
      <header className="page-header">
        <div>
          <p className="eyebrow">
            {subject && (
              <>
                <Link to={`/m/tareas?vista=fechas&cuatri=${subject.period}`}>{periodLabel(subject.period)}</Link>
                {' · '}
              </>
            )}
            <Link to={`/m/tareas?${new URLSearchParams({ ...inSubject, vista: 'fechas' })}`}>
              {subject?.name ?? 'Materia desconocida'}
            </Link>
            {' · '}
            <Link
              to={`/m/tareas?${new URLSearchParams({ ...inSubject, parcial: activity.termId ?? NO_TERM, vista: 'fechas' })}`}
            >
              {term?.name ?? 'Sin parcial'}
            </Link>
          </p>
          <h1>{activity.title}</h1>
          <p className="muted">
            {formatLongDay(parseDay(activity.date))}
            {activity.topic && ` · ${activity.topic}`}
          </p>
        </div>
        <div className="row">
          <Link to={`/m/actividades/${activity.id}/editar`} className="button secondary with-icon">
            <Icon name="edit" size={16} /> Editar página
          </Link>
          {!adding && (
            <button type="button" className="with-icon" onClick={() => setAdding(true)}>
              <Icon name="plus" size={18} /> Agregar evidencia
            </button>
          )}
        </div>
      </header>

      <div className="detail">
        <div className="detail__main">
          {activity.objective && (
            <section className="panel">
              <h2 className="label">Objetivo</h2>
              <RichText text={activity.objective} />
            </section>
          )}
          <section className="panel">
            <h2 className="label">Instrucciones</h2>
            {activity.instructions ? (
              <RichText text={activity.instructions} />
            ) : (
              <p className="muted">
                Nadie ha escrito las instrucciones. Usa «Editar página» para agregarlas: cualquiera del
                grupo puede hacerlo.
              </p>
            )}
            <p className="wiki-footer">
              <Icon name="users" size={16} />
              <span>
                Página del grupo · versión {activity.version} · última edición de{' '}
                {memberName(members, activity.updatedBy)}, {formatTime(activity.updatedAt)}
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
            <RevisionHistory
              revisions={history}
              members={members}
              summaryLabel="Objetivo"
              onRestore={restore}
              error={error}
            />
          )}

          <h2 className="section-title">
            Evidencias <span className="muted">{own.length}</span>
          </h2>
          {adding && <EvidenceForm activityId={activity.id} onDone={() => setAdding(false)} />}
          {own.map((evidence) => (
            <EvidenceCard key={evidence.id} evidence={evidence} members={members} meId={me?.id} />
          ))}
          {own.length === 0 && !adding && (
            <Empty
              icon="chat"
              title="Todavía no hay evidencias"
              action={
                <button type="button" onClick={() => setAdding(true)}>
                  Agregar la primera
                </button>
              }
            >
              Sube lo que hizo tu equipo: código, observaciones o resultados.
            </Empty>
          )}
        </div>

        <aside className="detail__side">
          <section className="panel">
            <h2 className="label">Detalles</h2>
            <dl className="facts">
              <dt>Fecha</dt>
              <dd>{formatMediumDate(parseDay(activity.date))}</dd>
              {activity.topic && (
                <>
                  <dt>Tema</dt>
                  <dd>{activity.topic}</dd>
                </>
              )}
              <dt>Registró</dt>
              <dd>{memberName(members, activity.createdBy)}</dd>
            </dl>
          </section>

          {participantIds.length > 0 && (
            <section className="panel">
              <h2 className="label">Participantes ({participantIds.length})</h2>
              <ul className="people">
                {participantIds.map((id) => {
                  const member = members.find((m) => m.id === id);
                  return (
                    <li key={id}>
                      <Link to={`/perfil/${id}`}>
                        <Avatar member={member} size={32} />
                        <span>
                          {member?.displayName ?? 'Miembro desconocido'}
                          {id === me?.id && <span className="muted"> (tú)</span>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {sameTerm.length > 0 && (
            <section className="panel">
              <h2 className="label">Tareas de {term ? `este parcial` : 'esta materia'}</h2>
              <ul className="links">
                {sameTerm.slice(0, 4).map((a) => (
                  <li key={a.id}>
                    <Link to={`/m/tareas/${a.id}`}>
                      <strong>{a.title}</strong>
                      <span className="muted">{WORK_KIND_LABEL[a.kind]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {sameTerm.length > 4 && (
                <p className="panel__more">
                  <Link to={tasksLink}>Ver las {sameTerm.length}</Link>
                </p>
              )}
            </section>
          )}

          {related.length > 0 && (
            <section className="panel">
              <h2 className="label">Notas del mismo tema</h2>
              <ul className="links">
                {related.map((note) => (
                  <li key={note.id}>
                    <Link to={`/m/notas/${note.id}`}>
                      <strong>{note.title}</strong>
                      <span className="muted">{memberName(members, note.authorId)}</span>
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

/** Registrar una actividad o editar su página (cualquier integrante, como en un wiki). */
export function ActivityFormPage() {
  const { activityId } = useParams();
  const { activities } = useSnapshot();
  const activity = activities.find((a) => a.id === activityId);

  if (activityId && !activity) {
    return (
      <Empty
        icon="folder"
        title="Actividad no encontrada"
        action={
          <Link to={LIST} className="button">
            Ver las actividades
          </Link>
        }
      >
        Puede que el enlace esté incompleto o que la actividad ya no exista.
      </Empty>
    );
  }
  return <ActivityForm key={activity?.id ?? 'nueva'} activity={activity} />;
}

function ActivityForm({ activity }: { activity: Activity | undefined }) {
  const source = useDataSource();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { subjects, terms, members, calendar } = useSnapshot();
  const { error, run } = useAction();
  const backTo = activity ? `/m/actividades/${activity.id}` : LIST;
  // Al registrar, el formulario abre en el cuatrimestre y parcial vigentes según Ajustes.
  const current = currentPlacement(calendar);

  const inPeriod = (period: number) => subjects.filter((s) => s.period === period).sort(bySubject);
  const asked = subjects.find((s) => s.id === (activity?.subjectId ?? params.get('materia')));
  const [period, setPeriod] = useState(() => {
    const fromFilter = Number(params.get('cuatri'));
    return asked?.period ?? (isValidPeriod(fromFilter) ? fromFilter : (current?.period ?? lastPeriod()));
  });
  const [subjectId, setSubjectId] = useState(() => asked?.id ?? inPeriod(period)[0]?.id ?? '');
  const currentTermOf = (subject: string, inPeriodNumber: number) =>
    inPeriodNumber === current?.period ? (termAt(terms, subject, current.term)?.id ?? '') : '';
  const [termId, setTermId] = useState(() => {
    if (activity) return activity.termId ?? '';
    const askedTerm = terms.find((t) => t.id === params.get('parcial') && t.subjectId === subjectId);
    return askedTerm?.id ?? currentTermOf(subjectId, period);
  });
  const subjectTerms = terms.filter((t) => t.subjectId === subjectId).sort((a, b) => a.position - b.position);
  /** Al cambiar de materia se conserva el mismo número de parcial. */
  const samePosition = (subject: string) =>
    termAt(terms, subject, terms.find((t) => t.id === termId)?.position)?.id ?? '';
  const [date, setDate] = useState(() => activity?.date ?? toDay(new Date()));
  const [title, setTitle] = useState(activity?.title ?? '');
  const [topic, setTopic] = useState(activity?.topic ?? '');
  const [objective, setObjective] = useState(activity?.objective ?? '');
  const [instructions, setInstructions] = useState(activity?.instructions ?? '');
  const changed =
    !activity ||
    subjectId !== activity.subjectId ||
    termId !== (activity.termId ?? '') ||
    date !== activity.date ||
    title.trim() !== activity.title ||
    topic.trim() !== activity.topic ||
    objective.trim() !== activity.objective ||
    instructions.trim() !== activity.instructions;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const input = { subjectId, termId: termId || undefined, topic, date, title, objective, instructions };
    const id = run(() => {
      if (!activity) return source.createActivity(input);
      source.updateActivity(activity.id, input);
      return activity.id;
    });
    if (!id) return;
    rememberPeriod(period);
    void navigate(`/m/actividades/${id}`);
  };

  return (
    <>
      <Link to={backTo} className="back with-icon">
        <Icon name="back" size={16} /> {activity ? activity.title : 'Tareas y Actividades'}
      </Link>
      <header className="page-header">
        <div>
          <h1>{activity ? 'Editar página' : 'Registrar actividad de clase'}</h1>
          <p className="muted">
            {activity
              ? `Es la página de todo el grupo. Tu cambio se guardará como versión ${activity.version + 1} a tu nombre y las anteriores quedan en el historial.`
              : 'Deja lo que se hizo en la sesión. Después cualquiera podrá corregir la página y cada equipo agregará su evidencia.'}
          </p>
        </div>
      </header>

      <form className="panel form form--wide" onSubmit={submit}>
        <section className="form__section">
          <h2>Cuándo y en qué materia</h2>
          {!activity && current && period === current.period && (
            <p className="field__hint">
              Abre en {periodLabel(current.period)}, parcial {current.term}: el que está en curso según
              Ajustes.
            </p>
          )}
          <div className="form__grid">
            <label className="field">
              <span className="field__label">Fecha de la sesión</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label className="field">
              <span className="field__label">Cuatrimestre</span>
              <select
                value={period}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  const subject = inPeriod(next)[0]?.id ?? '';
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
                required
              >
                {inPeriod(period).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
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
              </select>
            </label>
          </div>
        </section>

        <section className="form__section">
          <h2>La actividad</h2>
          <label className="field">
            <span className="field__label">Título</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="Por ejemplo: Práctica de ciclos en equipos"
              required
            />
          </label>
          <label className="field">
            <span className="field__label">
              Tema <span className="field__optional">opcional</span>
            </span>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} />
            <span className="field__hint">Si coincide con el tema de una nota, quedarán enlazadas.</span>
          </label>
          <label className="field">
            <span className="field__label">
              Objetivo <span className="field__optional">opcional</span>
            </span>
            <textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={2} />
          </label>
          <label className="field">
            <span className="field__label">
              Instrucciones <span className="field__optional">opcional</span>
            </span>
            <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={5} />
            <span className="field__hint">
              Lo que pidió el docente. Para pegar código, enciérralo entre líneas con ```.
            </span>
          </label>
        </section>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form__actions">
          {activity && (
            <span className="muted form__note">
              Última edición de {memberName(members, activity.updatedBy)}, {formatTime(activity.updatedAt)}
            </span>
          )}
          <Link to={backTo} className="button secondary">
            Cancelar
          </Link>
          <button type="submit" disabled={!changed}>
            {activity ? 'Guardar versión nueva' : 'Registrar'}
          </button>
        </div>
      </form>
    </>
  );
}
