import { useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { MAX_POLL_OPTIONS, type PollStatus } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Member, Poll, PollInput, Snapshot } from '../data/types';
import { Avatar } from '../components/Avatar';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { RichText } from '../components/RichText';
import { useAction } from '../components/useAction';
import { formatTime, memberName, peopleList } from '../lib/format';
import {
  closingLabel,
  defaultClosing,
  optionList,
  POLL_STATUS_LABEL,
  pollView,
  sortPolls,
  toLocalInput,
  whenLabel,
} from '../lib/polls';

type Filter = PollStatus | 'todas';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Abiertas' },
  { id: 'closed', label: 'Cerradas' },
  { id: 'cancelled', label: 'Canceladas' },
  { id: 'todas', label: 'Todas' },
];

const votesLabel = (n: number) => `${n} ${n === 1 ? 'voto' : 'votos'}`;

function NotFound() {
  return (
    <Empty
      icon="check"
      title="No encontramos esta votación"
      action={
        <Link to="/m/votaciones" className="button">
          Ver las votaciones
        </Link>
      }
    >
      Puede que el enlace esté incompleto o que la votación ya no exista.
    </Empty>
  );
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

/** Votaciones y encuestas (3.8): nominales, con su cierre, resultado y acuerdo a la vista. */
export function PollsPage() {
  const data = useSnapshot();
  const [params, setParams] = useSearchParams();
  const now = new Date();
  const views = sortPolls(data.polls, now).map((poll) => ({
    poll,
    view: pollView(poll, data, now),
  }));
  const count = (id: Filter) =>
    views.filter(({ view }) => id === 'todas' || view.status === id).length;
  const requested = params.get('estado') as Filter | null;
  const filter: Filter = requested ?? (count('open') ? 'open' : 'todas');
  const shown = views.filter(({ view }) => filter === 'todas' || view.status === filter);
  const pendingMine = views.filter(
    ({ view }) => view.status === 'open' && view.eligible && !view.mine,
  ).length;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Votaciones</h1>
          <p className="muted">
            Consultas del grupo. Son nominales: todos ven quién votó y qué eligió, y nadie fuera del
            grupo ve los resultados.
          </p>
        </div>
        <Link to="/m/votaciones/nueva" className="button with-icon">
          <Icon name="plus" size={18} /> Nueva votación
        </Link>
      </header>

      {data.polls.length > 0 && (
        <div className="toolbar">
          <div className="segmented poll-filter" role="group" aria-label="Estado">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() =>
                  setParams(f.id === 'open' ? {} : { estado: f.id }, { replace: true })
                }
              >
                {f.label}
                <span className="chip__count"> {count(f.id)}</span>
              </button>
            ))}
          </div>
          {pendingMine > 0 && (
            <span className="badge badge--open">
              {pendingMine === 1 ? 'Te falta votar en 1' : `Te falta votar en ${pendingMine}`}
            </span>
          )}
        </div>
      )}

      {data.polls.length === 0 ? (
        <Empty
          icon="check"
          title="Todavía no hay votaciones"
          action={
            <Link to="/m/votaciones/nueva" className="button">
              Crear la primera
            </Link>
          }
        >
          Úsalas para decidir fechas, temas o acuerdos del grupo con resultados visibles para todos.
        </Empty>
      ) : shown.length === 0 ? (
        <p className="muted">
          No hay votaciones {FILTERS.find((f) => f.id === filter)?.label.toLowerCase()}.
        </p>
      ) : (
        <ul className="poll-list">
          {shown.map(({ poll, view }) => {
            const leading = view.tally.leading.map((i) => poll.options[i]).join(' y ');
            const top = view.tally.leading[0];
            return (
              <li key={poll.id}>
                <Link
                  to={`/m/votaciones/${poll.id}`}
                  className={`poll-card poll-card--${view.status}`}
                >
                  <span className="poll-card__top">
                    <span className={`badge badge--poll-${view.status}`}>
                      {POLL_STATUS_LABEL[view.status]}
                    </span>
                    {view.status === 'open' && view.eligible && !view.mine && (
                      <span className="badge badge--open">Falta tu voto</span>
                    )}
                    {view.mine && <span className="badge">Votaste</span>}
                    {view.status === 'closed' &&
                      (poll.decision ? (
                        <span className="badge badge--resolved">Acuerdo registrado</span>
                      ) : (
                        <span className="badge badge--warn">Sin acuerdo registrado</span>
                      ))}
                  </span>
                  <strong className="poll-card__title">{poll.title}</strong>
                  <span className="poll-card__meta">
                    {closingLabel(poll, now)} · {poll.multiple ? 'Varias opciones' : 'Opción única'}{' '}
                    · {view.tally.voted} de {poll.eligibleIds.length} votaron
                  </span>
                  {view.status !== 'cancelled' && (
                    <span className="poll-card__result">
                      {top === undefined
                        ? 'Sin votos todavía'
                        : `${view.status === 'closed' ? 'Resultado' : 'Va adelante'}: ${leading}${
                            view.tally.leading.length > 1 ? ' (empate)' : ''
                          } · ${votesLabel(view.tally.counts[top] ?? 0)}`}
                    </span>
                  )}
                  <ParticipationBar voted={view.tally.voted} total={poll.eligibleIds.length} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** «Falta tu voto y el de Ana y Luis.», «No votaron: Ana.» */
function pendingLabel(pending: string[], status: PollStatus, data: Snapshot): string {
  const meId = data.me?.id;
  const others = pending.filter((id) => id !== meId);
  const names = peopleList(others, data.members);
  if (status !== 'open') return `No votaron: ${peopleList(pending, data.members, meId)}.`;
  if (meId && pending.includes(meId)) {
    return others.length ? `Falta tu voto y el de ${names}.` : 'Solo falta tu voto.';
  }
  return `Faltan por votar: ${names}.`;
}

function ParticipationBar({ voted, total }: { voted: number; total: number }) {
  return (
    <span
      className="poll-meter"
      role="meter"
      aria-label="Participación"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={voted}
    >
      <span style={{ width: `${total ? (voted / total) * 100 : 0}%` }} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------

export function PollPage() {
  const data = useSnapshot();
  const { pollId } = useParams();
  const poll = data.polls.find((p) => p.id === pollId);
  if (!poll) return <NotFound />;
  return <PollDetail poll={poll} data={data} />;
}

function PollDetail({ poll, data }: { poll: Poll; data: Snapshot }) {
  const now = new Date();
  const view = pollView(poll, data, now);
  const memberOf = (id: string) => data.members.find((m) => m.id === id);
  const previous = poll.restartOf ? data.polls.find((p) => p.id === poll.restartOf) : undefined;
  const total = poll.eligibleIds.length;

  return (
    <>
      <Link to="/m/votaciones" className="back with-icon">
        <Icon name="back" size={16} /> Votaciones
      </Link>
      <header className="page-header">
        <div>
          <p className="eyebrow">
            <span className={`badge badge--poll-${view.status}`}>
              {POLL_STATUS_LABEL[view.status]}
            </span>{' '}
            {closingLabel(poll, now)}
          </p>
          <h1>{poll.title}</h1>
          <p className="muted">
            Creada por {memberName(data.members, poll.createdBy)} {whenLabel(poll.createdAt, now)}
          </p>
        </div>
        {view.isOwner && view.status === 'open' && view.votes.length === 0 && (
          <Link to={`/m/votaciones/${poll.id}/editar`} className="button secondary with-icon">
            <Icon name="edit" size={16} /> Editar
          </Link>
        )}
      </header>

      <div className="detail">
        <div className="detail__main">
          {poll.description && (
            <section className="panel">
              <RichText text={poll.description} />
            </section>
          )}
          {previous && (
            <p className="notice">
              Reinicia una votación cancelada:{' '}
              <Link to={`/m/votaciones/${previous.id}`}>{previous.title}</Link>. Sus votos no
              cuentan aquí.
            </p>
          )}
          {view.status === 'cancelled' && <CancelledPanel poll={poll} data={data} />}

          {view.status === 'open' && <VotePanel poll={poll} view={view} />}

          <section className="panel">
            <h2 className="label">
              {
                {
                  open: 'Resultados hasta ahora',
                  closed: 'Resultado de la consulta',
                  cancelled: 'Votos registrados',
                }[view.status]
              }
            </h2>
            <p className="muted poll-turnout">
              Votaron {view.tally.voted} de {total}.
              {view.status === 'cancelled' && ' Se conservan como registro; no son una decisión.'}
            </p>
            <ol className="poll-results">
              {poll.options.map((option, index) => {
                const count = view.tally.counts[index] ?? 0;
                const leading = view.tally.leading.includes(index);
                // Porcentaje de quienes votaron; con varias opciones no suman 100, así que solo se da la cuenta.
                const percent = view.tally.voted ? Math.round((count / view.tally.voted) * 100) : 0;
                return (
                  <li
                    key={option}
                    className={leading ? 'poll-result poll-result--leading' : 'poll-result'}
                  >
                    <span className="poll-result__head">
                      <span className="poll-result__option">
                        {option}
                        {view.mine?.choices.includes(index) && (
                          <span className="muted"> · tu voto</span>
                        )}
                      </span>
                      <span className="poll-result__count">
                        {votesLabel(count)}
                        {!poll.multiple && ` · ${percent}%`}
                      </span>
                    </span>
                    <span
                      className="poll-result__bar"
                      style={{ '--percent': `${percent}%` } as CSSProperties}
                    />
                    {count > 0 && (
                      <span className="poll-result__voters">
                        {view.tally.voters[index]?.map((id) => (
                          <span key={id} className="voter">
                            <Avatar member={memberOf(id)} size={20} />
                            {id === data.me?.id ? 'Tú' : memberName(data.members, id)}
                          </span>
                        ))}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
            {view.tally.pending.length > 0 && view.status !== 'cancelled' && (
              <p className="muted poll-pending">
                {pendingLabel(view.tally.pending, view.status, data)}
              </p>
            )}
          </section>

          {view.status === 'closed' && <DecisionPanel poll={poll} data={data} />}
          {view.isOwner && view.status === 'open' && (
            <CancelPanel poll={poll} hasVotes={view.votes.length > 0} />
          )}
        </div>

        <aside className="detail__side">
          <section className="panel">
            <h2 className="label">Condiciones</h2>
            <dl className="facts">
              <dt>Tipo</dt>
              <dd>{poll.multiple ? 'Varias opciones' : 'Opción única'}</dd>
              <dt>Cierre</dt>
              <dd>{formatTime(poll.closesAt, now)}</dd>
              <dt>Cambiar voto</dt>
              <dd>{poll.allowChange ? 'Sí, antes del cierre' : 'No'}</dd>
              <dt>Votos</dt>
              <dd>Con nombre</dd>
            </dl>
            <h2 className="label">Pueden votar ({total})</h2>
            <ul className="voter-list">
              {poll.eligibleIds.map((id) => {
                const vote = view.votes.find((v) => v.voterId === id);
                return (
                  <li key={id}>
                    <Avatar member={memberOf(id)} size={24} />
                    <span className="voter-list__name">
                      {id === data.me?.id ? 'Tú' : memberName(data.members, id)}
                    </span>
                    <span className="muted voter-list__state">
                      {vote
                        ? vote.changedAt
                          ? 'Cambió su voto'
                          : 'Votó'
                        : view.status === 'open'
                          ? 'Falta'
                          : 'No votó'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}

function VotePanel({ poll, view }: { poll: Poll; view: ReturnType<typeof pollView> }) {
  const source = useDataSource();
  const { error, run } = useAction();
  const [choices, setChoices] = useState<number[]>(view.mine?.choices ?? []);
  const [editing, setEditing] = useState(!view.mine);

  if (!view.eligible) {
    return (
      <p className="notice">
        No estás entre los participantes de esta votación; puedes ver el resultado.
      </p>
    );
  }
  if (view.mine && !editing) {
    return (
      <section className="panel vote-done">
        <p>
          <Icon name="check" size={18} />
          <span>
            Votaste por <strong>{optionList(poll, view.mine.choices)}</strong>.
          </span>
        </p>
        {poll.allowChange ? (
          <button type="button" className="secondary" onClick={() => setEditing(true)}>
            Cambiar mi voto
          </button>
        ) : (
          <p className="muted">Esta votación no permite cambiar el voto.</p>
        )}
      </section>
    );
  }

  const toggle = (index: number) =>
    setChoices((current) =>
      poll.multiple
        ? current.includes(index)
          ? current.filter((c) => c !== index)
          : [...current, index]
        : [index],
    );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (run(() => (source.castVote(poll.id, choices), true))) setEditing(false);
  };

  return (
    <form className="panel form vote-form" onSubmit={submit}>
      <fieldset className="field">
        <legend className="field__label">
          {poll.multiple ? 'Elige todas las que quieras' : 'Elige una opción'}
        </legend>
        <div className="vote-options">
          {poll.options.map((option, index) => (
            <label key={option} className="vote-option">
              <input
                type={poll.multiple ? 'checkbox' : 'radio'}
                name={`voto-${poll.id}`}
                checked={choices.includes(index)}
                onChange={() => toggle(index)}
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form__actions">
        <span className="muted form__note">
          Tu voto es nominal: el grupo verá tu nombre y lo que elijas.
          {poll.allowChange ? ' Puedes cambiarlo hasta el cierre.' : ' No podrás cambiarlo.'}
        </span>
        {view.mine && (
          <button type="button" className="secondary" onClick={() => setEditing(false)}>
            Cancelar
          </button>
        )}
        <button type="submit" disabled={!choices.length}>
          {view.mine ? 'Guardar mi nuevo voto' : 'Votar'}
        </button>
      </div>
    </form>
  );
}

function CancelledPanel({ poll, data }: { poll: Poll; data: Snapshot }) {
  const restarted = data.polls.find((p) => p.restartOf === poll.id);
  const isOwner = poll.createdBy === data.me?.id;
  return (
    <section className="panel panel--warn">
      <h2 className="label">Votación cancelada</h2>
      <p>{poll.cancelReason}</p>
      {restarted ? (
        <p>
          Se reinició en <Link to={`/m/votaciones/${restarted.id}`}>{restarted.title}</Link>.
        </p>
      ) : (
        isOwner && (
          <Link to={`/m/votaciones/nueva?desde=${poll.id}`} className="button">
            Reiniciar la consulta
          </Link>
        )
      )}
    </section>
  );
}

function CancelPanel({ poll, hasVotes }: { poll: Poll; hasVotes: boolean }) {
  const source = useDataSource();
  const navigate = useNavigate();
  const { error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const cancel = (restart: boolean) => {
    if (!run(() => (source.cancelPoll(poll.id, reason), true))) return;
    setOpen(false);
    if (restart) void navigate(`/m/votaciones/nueva?desde=${poll.id}`);
  };

  if (!open) {
    return (
      <p className="muted poll-owner">
        {hasVotes
          ? 'Ya tiene votos, así que sus opciones no pueden cambiar. Para cambiarlas, cancélala y reiníciala. '
          : 'La creaste tú. '}
        <button type="button" className="link-button" onClick={() => setOpen(true)}>
          Cancelar la votación
        </button>
      </p>
    );
  }

  return (
    <form className="panel form" onSubmit={(e) => e.preventDefault()}>
      <label className="field">
        <span className="field__label">Por qué la cancelas</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Por ejemplo: faltaba una opción"
          required
          autoFocus
        />
        <span className="field__hint">
          La razón queda visible para el grupo. Los votos se conservan como registro, pero no
          cuentan.
        </span>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form__actions">
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          No cancelar
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!reason.trim()}
          onClick={() => cancel(false)}
        >
          Solo cancelar
        </button>
        <button type="button" disabled={!reason.trim()} onClick={() => cancel(true)}>
          Cancelar y reiniciar
        </button>
      </div>
    </form>
  );
}

function DecisionPanel({ poll, data }: { poll: Poll; data: Snapshot }) {
  const source = useDataSource();
  const { error, run } = useAction();
  const [editing, setEditing] = useState(!poll.decision);
  const [text, setText] = useState(poll.decision);

  if (poll.decision && !editing) {
    return (
      <section className="panel decision">
        <h2 className="label">Acuerdo adoptado</h2>
        <RichText text={poll.decision} />
        <p className="muted decision__meta">
          Lo registró{' '}
          {poll.decidedBy ? memberName(data.members, poll.decidedBy) : 'alguien del grupo'}
          {poll.decidedAt ? ` ${whenLabel(poll.decidedAt)}` : ''} ·{' '}
          <button type="button" className="link-button" onClick={() => setEditing(true)}>
            Actualizar
          </button>
        </p>
      </section>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (run(() => (source.recordPollDecision(poll.id, text), true))) setEditing(false);
  };

  return (
    <form className="panel form" onSubmit={submit}>
      <label className="field">
        <span className="field__label">Acuerdo adoptado</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Qué decidió el grupo con este resultado"
          required
        />
        <span className="field__hint">
          El resultado es la consulta; el acuerdo es lo que el grupo decidió hacer. Queda tu nombre
          y la fecha.
        </span>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form__actions">
        {poll.decision && (
          <button type="button" className="secondary" onClick={() => setEditing(false)}>
            Cancelar
          </button>
        )}
        <button type="submit" disabled={!text.trim() || text.trim() === poll.decision}>
          Registrar acuerdo
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------

/** Crear, editar (sin votos) o reiniciar una votación cancelada (`?desde=`). */
export function PollFormPage() {
  const data = useSnapshot();
  const source = useDataSource();
  const navigate = useNavigate();
  const { pollId } = useParams();
  const [params] = useSearchParams();
  const { error, run } = useAction();
  const editingPoll = pollId ? data.polls.find((p) => p.id === pollId) : undefined;
  const from = data.polls.find((p) => p.id === params.get('desde'));
  const template = editingPoll ?? from;
  const active = data.members.filter((m) => m.status === 'active');

  const [title, setTitle] = useState(template?.title ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [options, setOptions] = useState<string[]>(template?.options ?? ['', '']);
  const [multiple, setMultiple] = useState(template?.multiple ?? false);
  const [allowChange, setAllowChange] = useState(template?.allowChange ?? true);
  const [closesAt, setClosesAt] = useState(
    toLocalInput(editingPoll ? editingPoll.closesAt : defaultClosing()),
  );
  const [eligibleIds, setEligibleIds] = useState<string[]>(
    template?.eligibleIds.filter((id) => active.some((m) => m.id === id)) ??
      active.map((m) => m.id),
  );

  if (pollId && !editingPoll) return <NotFound />;
  const backTo = editingPoll
    ? `/m/votaciones/${editingPoll.id}`
    : from
      ? `/m/votaciones/${from.id}`
      : '/m/votaciones';
  const everyone = eligibleIds.length === active.length;

  const setOption = (index: number, value: string) =>
    setOptions((current) => current.map((o, i) => (i === index ? value : o)));
  const toggleMember = (id: string) =>
    setEligibleIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const input: PollInput = {
      title,
      description,
      options,
      multiple,
      allowChange,
      eligibleIds,
      closesAt: new Date(closesAt),
      restartOf: from && !editingPoll ? from.id : undefined,
    };
    if (editingPoll) {
      if (run(() => (source.updatePoll(editingPoll.id, input), true))) void navigate(backTo);
      return;
    }
    const id = run(() => source.createPoll(input));
    if (id) void navigate(`/m/votaciones/${id}`);
  };

  return (
    <>
      <Link to={backTo} className="back with-icon">
        <Icon name="back" size={16} /> {editingPoll?.title ?? from?.title ?? 'Votaciones'}
      </Link>
      <header className="page-header">
        <div>
          <h1>
            {editingPoll ? 'Editar votación' : from ? 'Reiniciar la consulta' : 'Nueva votación'}
          </h1>
          <p className="muted">
            {editingPoll
              ? 'Nadie ha votado todavía, así que puedes cambiar todo.'
              : from
                ? 'Empieza de cero con los datos de la votación cancelada; ajusta lo que haga falta. Sus votos no se copian.'
                : 'Todos verán quién votó y qué eligió. Una vez que alguien vote, las opciones ya no se pueden cambiar.'}
          </p>
        </div>
      </header>

      <form className="panel form form--wide" onSubmit={submit}>
        <section className="form__section">
          <h2>La pregunta</h2>
          <label className="field">
            <span className="field__label">Pregunta</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="¿Qué día hacemos la sesión de repaso?"
              required
            />
          </label>
          <label className="field">
            <span className="field__label">
              Descripción <span className="field__optional">opcional</span>
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Contexto que ayude a decidir"
            />
          </label>
        </section>

        <section className="form__section">
          <h2>Opciones</h2>
          <ol className="option-inputs">
            {options.map((option, index) => (
              <li key={index}>
                <input
                  value={option}
                  onChange={(e) => setOption(index, e.target.value)}
                  maxLength={120}
                  aria-label={`Opción ${index + 1}`}
                  placeholder={`Opción ${index + 1}`}
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Quitar la opción ${index + 1}`}
                    onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                  >
                    <Icon name="close" size={16} />
                  </button>
                )}
              </li>
            ))}
          </ol>
          {options.length < MAX_POLL_OPTIONS && (
            <button
              type="button"
              className="secondary with-icon option-add"
              onClick={() => setOptions((current) => [...current, ''])}
            >
              <Icon name="plus" size={16} /> Agregar opción
            </button>
          )}
        </section>

        <section className="form__section">
          <h2>Reglas</h2>
          <fieldset className="field">
            <legend className="field__label">Cuántas opciones puede elegir cada quien</legend>
            <div className="chips">
              <label className="chip chip--choice">
                <input
                  type="radio"
                  name="tipo"
                  checked={!multiple}
                  onChange={() => setMultiple(false)}
                />
                Solo una
              </label>
              <label className="chip chip--choice">
                <input
                  type="radio"
                  name="tipo"
                  checked={multiple}
                  onChange={() => setMultiple(true)}
                />
                Varias
              </label>
            </div>
          </fieldset>
          <div className="form__grid">
            <label className="field">
              <span className="field__label">Cierra</span>
              <input
                type="datetime-local"
                value={closesAt}
                onChange={(e) => setClosesAt(e.target.value)}
                required
              />
              <span className="field__hint">Después de esta fecha nadie puede votar.</span>
            </label>
            <label className="check vote-change">
              <input
                type="checkbox"
                checked={allowChange}
                onChange={(e) => setAllowChange(e.target.checked)}
              />
              <span>
                Se puede cambiar el voto antes del cierre
                <span className="field__hint">Se anuncia desde ahora y no cambia después.</span>
              </span>
            </label>
          </div>
        </section>

        <section className="form__section">
          <h2>Quiénes votan</h2>
          <div className="chips" role="group" aria-label="Participantes">
            <button
              type="button"
              className="chip"
              aria-pressed={everyone}
              onClick={() => setEligibleIds(everyone ? [] : active.map((m) => m.id))}
            >
              Todo el grupo ({active.length})
            </button>
            {active.map((m: Member) => {
              const selected = eligibleIds.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  className="chip chip--person"
                  aria-pressed={selected}
                  onClick={() => toggleMember(m.id)}
                >
                  <Avatar member={m} size={22} />
                  {m.id === data.me?.id ? 'Tú' : m.displayName}
                  {selected && <Icon name="check" size={16} />}
                </button>
              );
            })}
          </div>
          <span className="field__hint">
            {eligibleIds.length} {eligibleIds.length === 1 ? 'persona puede' : 'personas pueden'}{' '}
            votar. Todo el grupo puede ver el resultado.
          </span>
        </section>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form__actions">
          <Link to={backTo} className="button secondary">
            Cancelar
          </Link>
          <button type="submit" disabled={!title.trim() || !eligibleIds.length}>
            {editingPoll ? 'Guardar cambios' : 'Publicar votación'}
          </button>
        </div>
      </form>
    </>
  );
}
