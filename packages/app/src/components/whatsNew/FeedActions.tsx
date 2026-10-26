import { voteError } from '@b20/core';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useDataSource } from '../../data/DataContext';
import type { Poll, Snapshot } from '../../data/types';
import type { StudyRoom } from '../../data/roomTypes';
import { closingLabel, optionList, pollView, POLL_STATUS_LABEL } from '../../lib/polls';
import type { NewsItem } from '../../lib/whatsNew';

/** Acciones breves del feed; los datos confirmados siempre provienen del snapshot. */
export function FeedActions({ item, snapshot }: { item: NewsItem; snapshot: Snapshot }) {
  const source = useDataSource();
  const sourceSession = useRef({ source, generation: 0 });
  if (sourceSession.current.source !== source) sourceSession.current = { source, generation: sourceSession.current.generation + 1 };
  if (!snapshot.me || snapshot.me.status !== 'active') return null;
  const session = `${snapshot.me.id}:${sourceSession.current.generation}`;
  if (item.kind === 'votacion' && item.target?.kind === 'poll') {
    const poll = snapshot.polls.find((row) => row.id === item.target!.id);
    return poll ? <FeedPollAction key={`${session}:${poll.id}`} poll={poll} snapshot={snapshot} /> : null;
  }
  if (['pregunta', 'resuelta', 'museo'].includes(item.kind) && item.target?.kind === 'question') {
    const question = snapshot.questions.find((row) => row.id === item.target!.id);
    return question && !question.withdrawnAt
      ? <FeedQuestionAction key={`${session}:${question.id}`} questionId={question.id} snapshot={snapshot} /> : null;
  }
  if (item.kind === 'sala' && item.resource?.kind === 'room') {
    const room = snapshot.studyRooms.find((row) => row.id === item.resource!.id);
    const membership = snapshot.roomMembers.find((row) => row.roomId === room?.id && row.memberId === snapshot.me!.id);
    return room?.visibility === 'group' && membership?.status !== 'removed'
      ? <FeedRoomAction key={`${session}:${room.id}`} room={room} snapshot={snapshot} /> : null;
  }
  return null;
}

function useFeedAction(snapshot: Snapshot) {
  const source = useDataSource();
  const locked = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const viewer = snapshot.me!.id;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    generation.current++;
    alive.current = true;
    return () => { alive.current = false; generation.current++; };
  }, [source, viewer]);
  const sameSession = () => alive.current && source.getSnapshot().me?.id === viewer;
  const run = async (action: (current: Snapshot) => Promise<void> | void, success: string, completed?: () => void) => {
    if (locked.current) return;
    const current = source.getSnapshot();
    if (current.connection !== 'ready' || current.me?.id !== viewer || current.me.status !== 'active') {
      setError('Necesitas conexión para completar esta acción.');
      return;
    }
    locked.current = true;
    const requestGeneration = generation.current;
    const currentSession = () => sameSession() && generation.current === requestGeneration;
    setPending(true); setError(''); setMessage('');
    try {
      await action(current);
      if (currentSession()) { setMessage(success); completed?.(); }
    } catch (cause) {
      if (currentSession()) setError(cause instanceof Error ? cause.message : 'No se pudo completar la acción. Tu borrador se conserva.');
    } finally {
      locked.current = false;
      if (currentSession()) setPending(false);
    }
  };
  return { source, pending, error, message, run, disabled: pending || snapshot.connection !== 'ready' };
}

function Feedback({ error, message, offline }: { error: string; message: string; offline: boolean }) {
  return <>
    {offline && <p className="feed-inline-hint">Conéctate para participar desde el feed.</p>}
    {error && <p className="feed-inline-error" role="alert">{error}</p>}
    <p className="feed-inline-status" role="status">{message}</p>
  </>;
}

/** Un único aviso al llegar el cierre; no necesita un intervalo por tarjeta. */
function usePollClock(closesAt: Date) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const remaining = closesAt.getTime() - Date.now();
    if (remaining <= 0) return;
    const timeout = window.setTimeout(() => setTick((value) => value + 1), Math.min(remaining + 20, 2_147_483_647));
    return () => window.clearTimeout(timeout);
  }, [closesAt, tick]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') setTick((value) => value + 1); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  return new Date();
}

function FeedPollAction({ poll, snapshot }: { poll: Poll; snapshot: Snapshot }) {
  const action = useFeedAction(snapshot);
  const now = usePollClock(poll.closesAt);
  const view = pollView(poll, snapshot, now);
  const [choices, setChoices] = useState<number[]>(view.mine?.choices ?? []);
  const [editing, setEditing] = useState(!view.mine);
  const id = useId();
  const saved = view.mine?.choices.join(',') ?? '';
  useEffect(() => { setChoices(saved ? saved.split(',').map(Number) : []); setEditing(!saved); }, [saved]);
  const canEdit = view.canVote && editing;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async (current) => {
      const latest = current.polls.find((row) => row.id === poll.id);
      if (!latest) throw new Error('La votación ya no está disponible.');
      const currentView = pollView(latest, current);
      const error = voteError({ status: currentView.status, multiple: latest.multiple,
        allowChange: latest.allowChange, optionCount: latest.options.length,
        eligible: currentView.eligible, alreadyVoted: Boolean(currentView.mine) }, choices);
      if (error) throw new Error(error);
      await action.source.castVote(poll.id, choices);
    }, 'Tu voto se guardó.', () => setEditing(false));
  };
  return <section className="feed-inline-actions feed-inline-poll" aria-label="Participar en la votación">
    <div className="feed-inline-meta"><strong>{POLL_STATUS_LABEL[view.status]}</strong><span>{view.tally.voted} de {poll.eligibleIds.length} participantes</span><span>{closingLabel(poll, now)}</span></div>
    {view.mine && <p className="feed-inline-selection">Tu voto: <strong>{optionList(poll, view.mine.choices)}</strong></p>}
    <form onSubmit={submit}>
      <fieldset className="feed-inline-options" disabled={action.disabled || !canEdit}>
        <legend>{poll.multiple ? 'Elige una o más opciones' : 'Elige una opción'}</legend>
        {poll.options.map((option, index) => <label className={`feed-inline-option${view.mine?.choices.includes(index) ? ' feed-inline-option--mine' : ''}`} key={`${index}:${option}`}>
          <input type={poll.multiple ? 'checkbox' : 'radio'} name={id} checked={choices.includes(index)} onChange={() => setChoices((previous) => poll.multiple ? previous.includes(index) ? previous.filter((value) => value !== index) : [...previous, index] : [index])} />
          <span>{option}</span><span className="feed-inline-count">{view.tally.counts[index] ?? 0}</span>
        </label>)}
      </fieldset>
      {view.status === 'open' && <p className="feed-inline-hint">Tu voto es nominal: el grupo verá tu nombre y lo que elijas. {poll.allowChange ? 'Puedes cambiarlo hasta el cierre.' : 'No podrás cambiarlo.'}</p>}
      {view.status === 'open' && !view.eligible && <p className="feed-inline-hint">No estás entre los participantes de esta votación.</p>}
      {view.mine && !poll.allowChange && <p className="feed-inline-hint">Esta votación no permite cambiar el voto.</p>}
      <div className="feed-inline-buttons">
        {canEdit && <button type="submit" disabled={action.disabled || !choices.length}>{action.pending ? 'Guardando voto…' : view.mine ? 'Guardar mi nuevo voto' : 'Votar'}</button>}
        {view.mine && view.canVote && !editing && <button type="button" className="secondary" disabled={action.disabled} onClick={() => { setChoices(view.mine!.choices); setEditing(true); }}>Cambiar mi voto</button>}
        {view.mine && canEdit && <button type="button" className="secondary" disabled={action.pending} onClick={() => { setChoices(view.mine!.choices); setEditing(false); }}>Cancelar</button>}
      </div>
    </form>
    <Feedback error={action.error} message={action.message} offline={snapshot.connection !== 'ready'} />
  </section>;
}

function FeedQuestionAction({ questionId, snapshot }: { questionId: string; snapshot: Snapshot }) {
  const action = useFeedAction(snapshot);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const id = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async (current) => {
      const question = current.questions.find((row) => row.id === questionId);
      if (!question || question.withdrawnAt) throw new Error('La pregunta ya no está disponible.');
      const answer = draft.trim();
      if (!answer || answer.length > 20_000) throw new Error('Escribe una respuesta de entre 1 y 20000 caracteres.');
      await action.source.answerQuestion(questionId, answer);
    }, 'Tu respuesta se publicó.', () => { setDraft(''); setExpanded(false); });
  };
  return <section className="feed-inline-actions feed-inline-question" aria-label="Responder desde el feed">
    {!expanded ? <button type="button" className="secondary" disabled={action.disabled} onClick={() => setExpanded(true)}>Responder pregunta</button>
      : <form className="feed-inline-reply" onSubmit={submit}>
        <label htmlFor={id}>Tu respuesta</label>
        <textarea id={id} value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} maxLength={20_000} disabled={action.disabled} autoFocus />
        <div className="feed-inline-buttons"><button type="submit" disabled={action.disabled || !draft.trim()}>{action.pending ? 'Publicando respuesta…' : 'Publicar respuesta'}</button><button type="button" className="secondary" disabled={action.pending} onClick={() => setExpanded(false)}>Cerrar editor</button></div>
      </form>}
    <Feedback error={action.error} message={action.message} offline={snapshot.connection !== 'ready'} />
  </section>;
}

function FeedRoomAction({ room, snapshot }: { room: StudyRoom; snapshot: Snapshot }) {
  const action = useFeedAction(snapshot);
  const [confirm, setConfirm] = useState(false);
  const membership = snapshot.roomMembers.find((row) => row.roomId === room.id && row.memberId === snapshot.me!.id);
  const joined = membership?.status === 'joined';
  const invited = membership?.status === 'invited';
  const open = room.status === 'scheduled' || room.status === 'active';
  const full = room.capacity !== undefined && room.participantCount >= room.capacity;
  const join = () => void action.run(async (current) => {
    const latest = current.studyRooms.find((row) => row.id === room.id);
    const own = current.roomMembers.find((row) => row.roomId === room.id && row.memberId === current.me!.id);
    if (!latest || latest.visibility !== 'group' || own?.status === 'removed') throw new Error('La sala ya no está disponible.');
    if (!['scheduled', 'active'].includes(latest.status)) throw new Error('La sala ya no recibe inscripciones.');
    if (latest.capacity !== undefined && latest.participantCount >= latest.capacity) throw new Error('La sala no tiene cupo disponible.');
    if (own?.status === 'invited') await action.source.respondStudyRoomInvitation(room.id, true);
    else await action.source.joinStudyRoom(room.id);
  }, 'Tu inscripción se confirmó.');
  const leave = () => void action.run(async (current) => {
    const latest = current.studyRooms.find((row) => row.id === room.id);
    const own = current.roomMembers.find((row) => row.roomId === room.id && row.memberId === current.me!.id);
    if (!latest || latest.visibility !== 'group' || own?.status !== 'joined') throw new Error('Ya no participas en esta sala.');
    if (latest.organizerId === current.me!.id) throw new Error('Como organizador, administra la sala desde su página.');
    await action.source.leaveStudyRoom(room.id);
  }, 'Saliste de la sala.', () => setConfirm(false));
  return <section className="feed-inline-actions feed-inline-room" aria-label="Participar en la sala de estudio">
    <div className="feed-inline-buttons">
      {joined ? <><Link to={`/m/salas/${encodeURIComponent(room.id)}`} className="button secondary">Abrir sala</Link>{room.organizerId !== snapshot.me!.id && !confirm && <button type="button" className="secondary" disabled={action.disabled} onClick={() => setConfirm(true)}>Salir de la sala</button>}</>
        : open ? <button type="button" disabled={action.disabled || full} onClick={join}>{action.pending ? 'Confirmando inscripción…' : full ? 'Sala sin plazas disponibles' : invited ? 'Aceptar invitación' : 'Inscribirme'}</button>
          : <p className="feed-inline-hint">La sala ya no recibe inscripciones.</p>}
    </div>
    {confirm && joined && <div className="feed-inline-confirm" role="group" aria-label="Confirmar salida de la sala"><p>Al salir dejarás de participar en la conversación y el resumen. Podrás volver si quedan plazas y la sala sigue abierta.</p><div className="feed-inline-buttons"><button type="button" disabled={action.disabled} onClick={leave}>Confirmar salida</button><button type="button" className="secondary" disabled={action.pending} onClick={() => setConfirm(false)}>Seguir en la sala</button></div></div>}
    <Feedback error={action.error} message={action.message} offline={snapshot.connection !== 'ready'} />
  </section>;
}
