import { Fragment, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ROOM_LIMITS, roomRemainingMs, roomTimerMinutesError } from '@b20/core';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { RichText } from '../components/RichText';
import { SubjectSelect } from '../components/SubjectSelect';
import { useAction } from '../components/useAction';
import { ChatAvatar, ChatBubble, ChatButton, ChatTextArea } from '../components/messaging/Messaging';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Snapshot } from '../data/types';
import type { StudyRoom, StudyRoomEntryKind, StudyRoomMaterialKind, StudyRoomMember, StudyRoomSummary, StudyRoomTimer } from '../data/roomTypes';
import { formatClock, formatDayLabel, formatTime, memberName } from '../lib/format';
import { matches } from '../lib/search';
import '../rooms.css';

const BASE = '/m/salas';
const STATUS = { scheduled: 'Programada', active: 'En curso', completed: 'Finalizada', cancelled: 'Cancelada' };
const ENTRY_KIND = { message: 'Mensaje', question: 'Duda', conclusion: 'Conclusión' };
const activeRoom = (room: StudyRoom) => room.status === 'scheduled' || room.status === 'active';
const localDate = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

function RoomBadge({ room }: { room: StudyRoom }) {
  return <span className="badges"><span className={`badge badge--${room.status === 'completed' ? 'resolved' : 'open'}`}>{STATUS[room.status]}</span><span className="badge">{room.visibility === 'private' ? 'Privada' : 'Abierta al grupo'}</span></span>;
}

function selectedResource(data: Snapshot, params: URLSearchParams) {
  const note = params.get('nota') ? data.notes.find((item) => item.id === params.get('nota') && item.visibility === 'group' && !item.withdrawnAt) : undefined;
  const guide = params.get('guia') ? data.guides.find((item) => item.id === params.get('guia') && !item.withdrawnAt) : undefined;
  return note ? { kind: 'note' as const, id: note.id, title: note.title, subjectId: note.subjectId, topic: note.topic || note.title }
    : guide ? { kind: 'guide' as const, id: guide.id, title: guide.title, subjectId: guide.subjectId, topic: guide.title } : undefined;
}

function ResourceToRoom({ data, params }: { data: Snapshot; params: URLSearchParams }) {
  const source = useDataSource();
  const navigate = useNavigate();
  const resource = selectedResource(data, params);
  const rooms = data.studyRooms.filter((room) => activeRoom(room) && room.subjectId === resource?.subjectId && data.roomMembers.some((member) => member.roomId === room.id && member.memberId === data.me?.id && member.status === 'joined'));
  const [roomId, setRoomId] = useState('');
  const { error, pending, run } = useAction();
  if (!resource) return <section className="panel"><h2>Material no disponible para una sala</h2><p>Solo puedes compartir notas del grupo y guías accesibles. Si es una nota personal, publica primero una copia desde Notas.</p><Link to={params.get('nota') ? `/m/notas/${encodeURIComponent(params.get('nota')!)}` : '/m/guias'}>Volver al material</Link></section>;
  return <section className="panel form"><h2>Estudiar «{resource.title}»</h2><p className="muted">Añade su referencia a una sala de la misma materia o prepara una sesión nueva.</p>
    {rooms.length > 0 && <form className="form" onSubmit={(event) => { event.preventDefault(); if (roomId && !pending) void run(async () => { await source.setStudyRoomMaterial(roomId, resource.kind, resource.id, true); void navigate(`${BASE}/${roomId}`); }); }}>
      <label className="field">Sala existente<select value={roomId} onChange={(event) => setRoomId(event.target.value)}><option value="">Elige una sala</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.title}</option>)}</select></label><button disabled={!roomId || pending}>Añadir material a la sala</button>
    </form>}
    <Link className="button secondary" to={`${BASE}/nueva?${resource.kind === 'note' ? 'nota' : 'guia'}=${encodeURIComponent(resource.id)}`}>Crear sala con este material</Link>{error && <p className="error" role="alert">{error}</p>}
  </section>;
}

export function RoomsPage() {
  const data = useSnapshot();
  const [params, setParams] = useSearchParams();
  const tab = params.get('pestana') ?? 'abiertas';
  const query = params.get('buscar') ?? '';
  const subjectId = params.get('materia') ?? '';
  const status = params.get('estado') ?? '';
  const update = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next, { replace: true }); };
  const membership = (roomId: string) => data.roomMembers.find((member) => member.roomId === roomId && member.memberId === data.me?.id);
  const shown = data.studyRooms.filter((room) => tab === 'invitaciones' ? membership(room.id)?.status === 'invited' : tab === 'mis' ? membership(room.id)?.status === 'joined' : room.visibility === 'group')
    .filter((room) => (!subjectId || room.subjectId === subjectId) && (!status || room.status === status) && matches(query, room.title, room.topic))
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  return <>
    <header className="page-header"><div><h1>Salas de estudio</h1><p className="muted">Organiza una sesión, comparte materiales y estudia con tus compañeros.</p></div><Link to={`${BASE}/nueva`} className="button with-icon"><Icon name="plus" size={18} /> Nueva sala</Link></header>
    {(params.has('nota') || params.has('guia')) && <ResourceToRoom key={`${data.me?.id}:${params.get('nota')}:${params.get('guia')}`} data={data} params={params} />}
    <div className="segmented rooms-tabs" role="group" aria-label="Salas de estudio">{([['abiertas', 'Abiertas'], ['mis', 'Mis salas'], ['invitaciones', 'Invitaciones']] as const).map(([id, title]) => <button key={id} aria-pressed={tab === id} onClick={() => update('pestana', id)}>{title}</button>)}</div>
    <div className="row rooms-filters"><label className="field grow">Buscar por tema<input type="search" value={query} onChange={(event) => update('buscar', event.target.value)} /></label><SubjectSelect subjects={data.subjects} value={subjectId} onChange={(value) => update('materia', value)} allowAll /><label className="field">Estado<select value={status} onChange={(event) => update('estado', event.target.value)}><option value="">Todos</option>{Object.entries(STATUS).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label></div>
    {shown.length ? <ul className="work-grid">{shown.map((room) => <li key={room.id}><Link className="work-card" to={`${BASE}/${room.id}`}><span className="work-card__context">{data.subjects.find((subject) => subject.id === room.subjectId)?.name} · {room.topic}</span><strong className="work-card__title">{room.title}</strong><RoomBadge room={room} /><span>{formatTime(room.startsAt)} — {formatTime(room.endsAt)}</span><span className="muted">{room.participantCount}{room.capacity ? ` de ${room.capacity}` : ''} inscritos · Organiza {memberName(data.members, room.organizerId)}</span></Link></li>)}</ul> : <Empty icon="users" title={tab === 'invitaciones' ? 'No tienes invitaciones pendientes' : 'No hay salas con estos filtros'}>Puedes organizar una sesión para el tema que quieras repasar.</Empty>}
  </>;
}

export function RoomFormPage() {
  const data = useSnapshot();
  const { roomId } = useParams();
  const [params] = useSearchParams();
  const room = roomId ? data.studyRooms.find((candidate) => candidate.id === roomId) : undefined;
  if (roomId && (!room || !activeRoom(room) || !data.roomMembers.some((member) => member.roomId === roomId && member.memberId === data.me?.id && member.status === 'joined'))) return <RoomUnavailable />;
  return <RoomForm key={`${data.me?.id}:${roomId ?? params.toString()}`} data={data} room={room} params={params} />;
}

function RoomForm({ data, room, params }: { data: Snapshot; room?: StudyRoom; params: URLSearchParams }) {
  const source = useDataSource();
  const navigate = useNavigate();
  const resource = selectedResource(data, params);
  const contact = data.helpContacts.find((candidate) => candidate.id === params.get('contacto') && candidate.status === 'accepted');
  const linked = contact ? data.helpRoomLinks.map((link) => link.contactId === contact.id ? data.studyRooms.find((candidate) => candidate.id === link.roomId && activeRoom(candidate)) : undefined).find(Boolean) : undefined;
  const [title, setTitle] = useState(room?.title ?? `Estudiar${contact?.postTopic || resource?.topic ? `: ${contact?.postTopic ?? resource?.topic}` : ''}`);
  const [subjectId, setSubjectId] = useState(room?.subjectId ?? contact?.subjectId ?? resource?.subjectId ?? data.subjects[0]?.id ?? '');
  const [topic, setTopic] = useState(room?.topic ?? contact?.postTopic ?? resource?.topic ?? '');
  const [objective, setObjective] = useState(room?.objective ?? '');
  const [startsAt, setStartsAt] = useState(localDate(room?.startsAt ?? new Date(Date.now() + 60 * 60_000)));
  const [endsAt, setEndsAt] = useState(localDate(room?.endsAt ?? new Date(Date.now() + 120 * 60_000)));
  const [capacity, setCapacity] = useState(room?.capacity?.toString() ?? '');
  const [visibility, setVisibility] = useState<'group' | 'private'>(room?.visibility ?? (contact ? 'private' : 'group'));
  const [requestId] = useState(() => crypto.randomUUID());
  const [baseVersion] = useState(room?.version);
  const { error, pending, run } = useAction();
  const badSource = Boolean((params.get('nota') || params.get('guia')) && !resource);
  const badContact = Boolean(params.get('contacto') && !contact);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (pending || badSource || badContact) return;
    const fields = { title, topic, objective, startsAt: new Date(startsAt), endsAt: new Date(endsAt), capacity: capacity ? Number(capacity) : undefined };
    const id = await run(async () => {
      if (room) { await source.updateStudyRoom(room.id, { ...fields, expectedVersion: baseVersion! }); return room.id; }
      return source.createStudyRoom({ ...fields, requestId, subjectId, visibility, helpContactId: contact?.id, sourceKind: resource?.kind, sourceId: resource?.id });
    });
    if (id) void navigate(`${BASE}/${id}`);
  };
  if (linked) return <section className="panel"><h1>Ya tienen una sesión activa</h1><Link className="button" to={`${BASE}/${linked.id}`}>Abrir sala</Link></section>;
  return <><Link to={room ? `${BASE}/${room.id}` : BASE} className="back">← Salas de estudio</Link><header className="page-header"><div><h1>{room ? 'Editar sala' : 'Nueva sala de estudio'}</h1><p className="muted">Los horarios se muestran en tu zona local. Todos los inscritos pueden organizar la sesión.</p></div></header>
    {badContact || badSource ? <section className="panel"><p role="alert">{badContact ? 'Este contacto no está aceptado o ya no está disponible.' : 'Este material no se puede compartir. Publica primero una copia si es una nota personal.'}</p><Link to={BASE}>Volver a las salas</Link></section> : <form className="form form--wide panel" onSubmit={submit} aria-busy={pending}><fieldset className="rooms-fields" disabled={pending}>
      <label className="field">Título<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={ROOM_LIMITS.title} required /></label>
      <div className="form__grid">{room || contact || resource ? <p><strong>Materia:</strong> {data.subjects.find((subject) => subject.id === subjectId)?.name}</p> : <SubjectSelect subjects={data.subjects} value={subjectId} onChange={setSubjectId} />}<label className="field">Tema<input value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={ROOM_LIMITS.topic} required /></label></div>
      <label className="field">Objetivo<textarea value={objective} onChange={(event) => setObjective(event.target.value)} maxLength={ROOM_LIMITS.objective} rows={3} required /></label>
      <div className="form__grid"><label className="field">Inicio previsto<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label><label className="field">Fin previsto<input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} min={startsAt} required /></label></div>
      <div className="form__grid"><label className="field">Cupo <span className="field__optional">opcional</span><input type="number" value={capacity} onChange={(event) => setCapacity(event.target.value)} min={room?.participantCount ?? 1} step={1} max={10_000} placeholder="Sin límite" /><span className="field__hint">Incluye al organizador y a quienes acepten la invitación.</span></label>{room ? <p>Visibilidad: {room.visibility === 'private' ? 'Privada' : 'Abierta al grupo'}</p> : <label className="field">Visibilidad<select value={visibility} onChange={(event) => setVisibility(event.target.value as 'group' | 'private')}><option value="group">Abierta al grupo</option><option value="private">Privada por invitación</option></select><span className="field__hint">Se conserva durante toda la vida de la sala.</span></label>}</div>
      {contact && <p className="field__hint">Invitaremos a {memberName(data.members, contact.senderId === data.me?.id ? contact.recipientId : contact.senderId)}. El contacto de Ayuda sigue siendo privado.</p>}{resource && <p className="field__hint">Material inicial: {resource.title}. Se enlaza su referencia, sin copiar el contenido.</p>}
    </fieldset>{error && <p className="error" role="alert">{error}</p>}<div className="form__actions"><Link to={room ? `${BASE}/${room.id}` : BASE} className="button secondary">Cancelar</Link><button disabled={pending || !subjectId}>{pending ? 'Guardando…' : room ? 'Guardar cambios' : 'Crear sala'}</button></div></form>}
  </>;
}

function RoomUnavailable() { return <Empty icon="lock" title="Esta sala no está disponible" action={<Link to={BASE} className="button">Ver salas</Link>}>Tu acceso puede haber cambiado. El contenido de una sala privada solo está disponible para sus participantes.</Empty>; }

export function RoomPage() {
  const { roomId = '' } = useParams();
  const data = useSnapshot();
  const room = data.studyRooms.find((candidate) => candidate.id === roomId);
  if (!room || data.me?.status !== 'active') return <RoomUnavailable />;
  const membership = data.roomMembers.find((member) => member.roomId === roomId && member.memberId === data.me?.id);
  if (room.visibility === 'private' && membership?.status !== 'joined' && membership?.status !== 'invited') return <RoomUnavailable />;
  const joined = membership?.status === 'joined';
  return <><Link to={BASE} className="back">← Salas de estudio</Link><header className="page-header"><div><p className="eyebrow">{data.subjects.find((subject) => subject.id === room.subjectId)?.name} · {room.topic}</p><h1>{room.title}</h1><p className="muted">Organiza {memberName(data.members, room.organizerId)}</p></div><RoomBadge room={room} /></header>
    <section className="panel rooms-agenda"><p className="prewrap">{room.objective}</p><p><strong>Horario previsto:</strong> {formatTime(room.startsAt)} — {formatTime(room.endsAt)}</p><p className="muted">{room.participantCount}{room.capacity ? ` de ${room.capacity}` : ''} inscritos.{room.status === 'scheduled' && ' La sesión comienza cuando el organizador la inicia.'}</p>{joined && activeRoom(room) && <Link className="button secondary" to={`${BASE}/${room.id}/editar`}>Editar horario y detalles</Link>}</section>
    {joined ? <RoomContent key={`${data.me.id}:${room.id}:${membership.joinedAt?.getTime() ?? membership.updatedAt.getTime()}`} room={room} data={data} /> : <RoomAdmission room={room} membership={membership} />}
  </>;
}

function RoomAdmission({ room, membership }: { room: StudyRoom; membership?: StudyRoomMember }) {
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const invited = membership?.status === 'invited';
  return <section className="panel form"><h2>{invited ? 'Tienes una invitación' : 'Participa en esta sala'}</h2><p>Al inscribirte podrás consultar materiales, conversar y trabajar en el resumen.</p>{activeRoom(room) && (invited ? <div className="row"><button disabled={pending} onClick={() => void run(() => source.respondStudyRoomInvitation(room.id, true))}>Aceptar invitación</button><button className="secondary" disabled={pending} onClick={() => void run(() => source.respondStudyRoomInvitation(room.id, false))}>Rechazar invitación</button></div> : room.visibility === 'group' && membership?.status !== 'removed' ? <button disabled={pending || Boolean(room.capacity && room.participantCount >= room.capacity)} onClick={() => void run(() => source.joinStudyRoom(room.id))}>{room.capacity && room.participantCount >= room.capacity ? 'Sala sin plazas disponibles' : 'Inscribirme'}</button> : <p className="muted">Necesitas una nueva invitación del organizador para entrar.</p>)}{!activeRoom(room) && <p className="muted">La sala ya no recibe inscripciones.</p>}{error && <p className="error" role="alert">{error}</p>}</section>;
}

function RoomContent({ room, data }: { room: StudyRoom; data: Snapshot }) {
  const organizer = room.organizerId === data.me?.id;
  const source = useDataSource();
  const navigate = useNavigate();
  const { error, pending, run } = useAction();
  const [confirm, setConfirm] = useState<'completed' | 'cancelled' | 'leave' | ''>('');
  const timer = data.roomTimers.find((item) => item.roomId === room.id);
  const summary = data.roomSummaries.find((item) => item.roomId === room.id);
  return <div className="detail rooms-detail"><div className="detail__main">
    {timer && <RoomTimer room={room} timer={timer} connection={data.connection} />}
    <RoomMaterials room={room} data={data} />
    <RoomConversation room={room} data={data} />
    {summary && <RoomSummary room={room} summary={summary} data={data} />}
  </div><aside className="detail__side"><RoomPeople room={room} data={data} />
    <section className="panel form"><h2 className="label">Tu práctica personal</h2><p className="muted">Explica el tema con tus palabras. Tu práctica y tu reflexión siguen siendo privadas.</p><Link to={`/m/aprende-ensenando/nueva?sala=${encodeURIComponent(room.id)}`} className="button secondary">Practicar explicándolo</Link></section>
    <section className="panel form"><h2 className="label">Sesión</h2>{organizer && activeRoom(room) && <><p className="muted">El horario es una referencia; los cambios de estado son manuales.</p>{room.status === 'scheduled' && <button disabled={pending} onClick={() => void run(() => source.setStudyRoomStatus(room.id, 'active', room.version))}>Comenzar sesión</button>}{room.status === 'active' && <button className="secondary" disabled={pending} onClick={() => setConfirm('completed')}>Finalizar sesión</button>}<button className="secondary" disabled={pending} onClick={() => setConfirm('cancelled')}>Cancelar sala</button></>}
      {!organizer && <button className="secondary" disabled={pending} onClick={() => setConfirm('leave')}>Salir de la sala</button>}
      {confirm && <div className="rooms-confirm" role="group" aria-label="Confirmar cambio de sesión"><p>{confirm === 'leave' ? 'Se retirará el contenido de esta sala de tu pantalla. Podrás volver a inscribirte si la sala lo permite.' : confirm === 'completed' ? 'El chat quedará de consulta. Podrán seguir completando el resumen.' : 'La sala quedará de consulta y el temporizador se detendrá.'}</p><div className="row"><button disabled={pending} onClick={() => void run(async () => { if (confirm === 'leave') { await source.leaveStudyRoom(room.id); void navigate(BASE); } else await source.setStudyRoomStatus(room.id, confirm, room.version); setConfirm(''); })}>Confirmar</button><button disabled={pending} className="secondary" onClick={() => setConfirm('')}>Volver</button></div></div>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  </aside></div>;
}

function RoomPeople({ room, data }: { room: StudyRoom; data: Snapshot }) {
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const [invitee, setInvitee] = useState('');
  const [removing, setRemoving] = useState('');
  const organizer = room.organizerId === data.me?.id;
  const members = data.roomMembers.filter((member) => member.roomId === room.id && (member.status === 'joined' || member.status === 'invited'));
  const available = data.members.filter((member) => member.status === 'active' && !members.some((item) => item.memberId === member.id));
  return <section className="panel form"><h2 className="label">Participantes</h2><ul className="rooms-people">{members.map((member) => <li key={member.memberId}><span>{memberName(data.members, member.memberId)}<small className="muted">{member.memberId === room.organizerId ? 'Organiza' : member.status === 'invited' ? 'Invitación pendiente' : 'Inscrito'}</small></span>{organizer && activeRoom(room) && member.memberId !== room.organizerId && <button className="link-button" disabled={pending} onClick={() => setRemoving(member.memberId)}>Retirar</button>}</li>)}</ul>
    {removing && <div className="rooms-confirm"><p>¿Retirar el acceso de {memberName(data.members, removing)}? Necesitará otra invitación para regresar.</p><div className="row"><button disabled={pending} onClick={() => void run(async () => { await source.removeStudyRoomMember(room.id, removing); setRemoving(''); })}>Retirar acceso</button><button disabled={pending} className="secondary" onClick={() => setRemoving('')}>Conservar acceso</button></div></div>}
    {organizer && activeRoom(room) && <form className="form" onSubmit={(event) => { event.preventDefault(); if (invitee && !pending) void run(async () => { await source.inviteStudyRoomMember(room.id, invitee); setInvitee(''); }); }}><label className="field">Invitar integrante<select value={invitee} onChange={(event) => setInvitee(event.target.value)}><option value="">Elige un integrante</option>{available.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label><button disabled={pending || !invitee}>Enviar invitación</button><p className="field__hint">El acceso comienza al aceptar. Las invitaciones pendientes no reservan plaza.</p></form>}{error && <p className="error" role="alert">{error}</p>}
  </section>;
}

function RoomMaterials({ room, data }: { room: StudyRoom; data: Snapshot }) {
  const source = useDataSource();
  const [selection, setSelection] = useState('');
  const { error, pending, run } = useAction();
  const materials = data.roomMaterials.filter((material) => material.roomId === room.id);
  const options = [
    ...data.notes.filter((note) => note.subjectId === room.subjectId && note.visibility === 'group' && !note.withdrawnAt).map((note) => ({ kind: 'note' as const, id: note.id, title: note.title, version: note.version })),
    ...data.guides.filter((guide) => guide.subjectId === room.subjectId && !guide.withdrawnAt).map((guide) => ({ kind: 'guide' as const, id: guide.id, title: guide.title, version: guide.version })),
  ];
  return <section className="panel form"><h2>Materiales</h2><p className="muted">Referencias compartidas del grupo. Las notas personales necesitan una publicación explícita antes de añadirse.</p><ul className="rooms-materials">{materials.map((material) => {
    const resource = options.find((option) => option.kind === material.kind && option.id === material.sourceId);
    if (!resource) return null;
    return <li key={material.id}><div><Link to={`/m/${material.kind === 'note' ? 'notas' : 'guias'}/${encodeURIComponent(material.sourceId)}`}>{resource.title}</Link><p className="field__hint">{material.kind === 'note' ? 'Nota' : 'Guía'} · versión {material.sourceVersion}{resource.version !== material.sourceVersion ? ` · versión actual ${resource.version}` : ''}</p><Link to={`/m/aprende-ensenando/nueva?sala=${encodeURIComponent(room.id)}&${material.kind === 'note' ? 'nota' : 'guia'}=${encodeURIComponent(material.sourceId)}`}>Practicar este material</Link></div>{activeRoom(room) && <button className="link-button" disabled={pending} onClick={() => void run(() => source.setStudyRoomMaterial(room.id, material.kind, material.sourceId, false))}>Quitar</button>}</li>;
  })}</ul>{!materials.length && <p className="muted">Todavía no hay materiales.</p>}
    {activeRoom(room) && <form className="row" onSubmit={(event) => { event.preventDefault(); if (!selection || pending) return; const [kind, ...parts] = selection.split(':'); void run(async () => { await source.setStudyRoomMaterial(room.id, kind as StudyRoomMaterialKind, parts.join(':'), true); setSelection(''); }); }}><label className="field grow">Añadir nota o guía<select value={selection} onChange={(event) => setSelection(event.target.value)}><option value="">Elige un material</option>{options.filter((option) => !materials.some((material) => material.kind === option.kind && material.sourceId === option.id)).map((option) => <option key={`${option.kind}:${option.id}`} value={`${option.kind}:${option.id}`}>{option.kind === 'note' ? 'Nota' : 'Guía'} · {option.title}</option>)}</select></label><button disabled={pending || !selection}>Añadir material</button></form>}{error && <p className="error" role="alert">{error}</p>}
  </section>;
}

function RoomConversation({ room, data }: { room: StudyRoom; data: Snapshot }) {
  const source = useDataSource();
  const headingId = useId();
  const keyboardHintId = useId();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<StudyRoomEntryKind>('message');
  const requestId = useRef(crypto.randomUUID());
  const { error, pending, run } = useAction();
  const entries = data.roomEntries.filter((entry) => entry.roomId === room.id).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const writable = activeRoom(room);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!writable || !text.trim() || pending) return;
    void run(async () => {
      await source.sendStudyRoomEntry(room.id, kind, text, requestId.current);
      setText('');
      requestId.current = crypto.randomUUID();
    });
  };

  return <section className="panel b20-messaging messaging-room" aria-labelledby={headingId}>
    <header className="messaging-room__header">
      <span className="messaging-room__icon" aria-hidden="true"><Icon name="chat" size={22} /></span>
      <div className="messaging-room__heading"><h2 id={headingId}>Conversación de la sala</h2><p>Solo los participantes pueden consultar estos mensajes, dudas y conclusiones.</p></div>
      <span className={`messaging-room__status${writable ? '' : ' messaging-room__status--readonly'}`}>{writable ? `${room.participantCount} participantes` : 'Solo lectura'}</span>
    </header>
    <ol className="messaging-room__thread" aria-label="Aportes de la sala" aria-live="polite" aria-relevant="additions text" tabIndex={0}>
      {entries.map((entry, index) => {
        const mine = entry.authorId === data.me?.id;
        const author = data.members.find((member) => member.id === entry.authorId);
        const name = memberName(data.members, entry.authorId);
        const previousEntry = entries[index - 1];
        const newDay = !previousEntry || previousEntry.createdAt.toDateString() !== entry.createdAt.toDateString();
        return <Fragment key={entry.id}>
          {newDay && <li className="messaging-day"><span>{formatDayLabel(entry.createdAt)}</span></li>}
          <li className={`messaging-room__message${mine ? ' messaging-room__message--mine' : ''}`}>
            <ChatAvatar name={name} src={author?.photoUrl} size="sm" />
            <div className="messaging-room__body">
              <div className="messaging-room__meta"><strong>{mine ? 'Tú' : name}</strong><span className={`messaging-room__kind messaging-room__kind--${entry.kind}`}>{ENTRY_KIND[entry.kind]}</span><time dateTime={entry.createdAt.toISOString()} title={formatTime(entry.createdAt)}>{formatClock(entry.createdAt)}</time></div>
              <ChatBubble className="messaging-room__bubble"><RichText text={entry.text} /></ChatBubble>
            </div>
          </li>
        </Fragment>;
      })}
      {!entries.length && <li className="messaging-room__empty"><Icon name="chat" size={28} /><strong>La conversación está lista para comenzar.</strong><span>Comparte una duda o una idea con los participantes.</span></li>}
    </ol>
    {writable ? <form className="messaging-room__composer" onSubmit={submit} aria-busy={pending}>
      <div className="messaging-room__composer-fields">
        <label className="field">Tipo de aporte<select value={kind} disabled={pending} onChange={(event) => setKind(event.target.value as StudyRoomEntryKind)}>{Object.entries(ENTRY_KIND).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label className="field">Mensaje<ChatTextArea aria-label="Mensaje" value={text} disabled={pending} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }} aria-describedby={keyboardHintId} placeholder="Comparte un mensaje, una duda o una conclusión…" rows={3} maxLength={ROOM_LIMITS.entry} required /></label>
      </div>
      <div className="messaging-room__composer-footer"><span id={keyboardHintId} className="field__hint">Enter para una nueva línea · Ctrl o ⌘ + Enter para enviar</span><ChatButton type="submit" disabled={pending || !text.trim()} loading={pending}><Icon name="send" size={16} />{pending ? 'Enviando…' : 'Enviar aporte'}</ChatButton></div>
      {error && <p className="error" role="alert">{error}</p>}
    </form> : <p className="messaging-room__readonly"><Icon name="lock" size={16} />El chat quedó de consulta al {room.status === 'completed' ? 'finalizar' : 'cancelar'} la sala.</p>}
  </section>;
}

function RoomSummary({ room, summary, data }: { room: StudyRoom; summary: StudyRoomSummary; data: Snapshot }) {
  const source = useDataSource();
  const navigate = useNavigate();
  const [text, setText] = useState(summary.text);
  const [baseVersion, setBaseVersion] = useState(summary.version);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const { error, pending, run } = useAction();
  useEffect(() => { if (!dirty) { setText(summary.text); setBaseVersion(summary.version); } }, [summary.text, summary.version, dirty]);
  const conflict = dirty && summary.version !== baseVersion;
  return <section className="panel form"><h2>Resumen colaborativo</h2><p className="field__hint">Versión {summary.version} · {memberName(data.members, summary.updatedBy)} · {formatTime(summary.updatedAt)}</p>
    {room.status !== 'cancelled' ? <form className="form" onSubmit={(event) => { event.preventDefault(); if (!pending) void run(async () => { await source.saveStudyRoomSummary(room.id, text, baseVersion); setDirty(false); }); }}><label className="field">Resumen de la sesión<textarea rows={7} value={text} disabled={pending} maxLength={ROOM_LIMITS.summary} onChange={(event) => { setText(event.target.value); setDirty(true); setPreview(false); }} /></label>{conflict && <p className="error" role="alert">Otro participante guardó cambios. Tu borrador se conserva; copia lo que quieras mantener antes de cargar la versión guardada.</p>}{conflict && <button className="secondary" type="button" disabled={pending} onClick={() => { setText(summary.text); setBaseVersion(summary.version); setDirty(false); }}>Cargar versión guardada</button>}<div className="form__actions"><button className="secondary" disabled={pending || !dirty || conflict}>{pending ? 'Guardando…' : 'Guardar resumen'}</button></div></form> : <RichText text={summary.text || 'Sin resumen.'} />}
    {summary.publishedNoteId ? <p><Link className="button secondary" to={`/m/notas/${encodeURIComponent(summary.publishedNoteId)}`}>Abrir nota publicada</Link><span className="field__hint"> La nota y este resumen se editan por separado.</span></p> : room.status === 'completed' && room.organizerId === data.me?.id && <><button className="secondary" disabled={pending || dirty || !summary.text.trim()} onClick={() => setPreview(!preview)}>Vista previa para publicar</button>{dirty && <p className="field__hint">Guarda el resumen antes de publicarlo.</p>}{preview && <div className="rooms-preview"><h3>{room.title}</h3><RichText text={summary.text} /><p className="field__hint">Solo este resumen se publicará como una nota del grupo a tu nombre. La conversación y los participantes permanecen dentro de la sala.</p><button disabled={pending} onClick={() => void run(async () => { const id = await source.publishStudyRoomSummary(room.id, summary.version); void navigate(`/m/notas/${id}`); })}>Publicar resumen como nota</button></div>}</>}{error && <p className="error" role="alert">{error}</p>}
  </section>;
}

function RoomTimer({ room, timer, connection }: { room: StudyRoom; timer: StudyRoomTimer; connection: Snapshot['connection'] }) {
  const source = useDataSource();
  const [anchor, setAnchor] = useState<{ time: number; mono: number }>();
  const [, setTick] = useState(0);
  const [studyMinutes, setStudyMinutes] = useState(timer.studyMinutes.toString());
  const [breakMinutes, setBreakMinutes] = useState(timer.breakMinutes.toString());
  const { error, pending, run } = useAction();
  useEffect(() => { setStudyMinutes(timer.studyMinutes.toString()); setBreakMinutes(timer.breakMinutes.toString()); }, [timer.studyMinutes, timer.breakMinutes]);
  useEffect(() => {
    let cancelled = false;
    const sync = () => { if (document.visibilityState === 'hidden') return; void Promise.resolve().then(() => source.getStudyRoomClock(room.id)).then((clock) => { if (!cancelled) setAnchor({ time: clock.getTime(), mono: performance.now() }); }).catch(() => { if (!cancelled) setAnchor(undefined); }); };
    sync();
    window.addEventListener('focus', sync); window.addEventListener('online', sync); document.addEventListener('visibilitychange', sync);
    return () => { cancelled = true; window.removeEventListener('focus', sync); window.removeEventListener('online', sync); document.removeEventListener('visibilitychange', sync); };
  }, [source, room.id, timer.version, connection]);
  useEffect(() => { if (timer.state !== 'running') return; const interval = window.setInterval(() => setTick((value) => value + 1), 1000); return () => window.clearInterval(interval); }, [timer.state]);
  const now = anchor ? anchor.time + performance.now() - anchor.mono : undefined;
  const remaining = now !== undefined ? roomRemainingMs(timer, now) : timer.remainingMs;
  const seconds = Math.ceil(remaining / 1000);
  const control = (action: 'start' | 'pause' | 'resume' | 'reset' | 'next') => { if (!pending) void run(() => source.controlStudyRoomTimer(room.id, { action, expectedVersion: timer.version, studyMinutes: Number(studyMinutes), breakMinutes: Number(breakMinutes) })); };
  const validMinutes = !roomTimerMinutesError(Number(studyMinutes), Number(breakMinutes));
  const durationChanged = Number(studyMinutes) !== timer.studyMinutes || Number(breakMinutes) !== timer.breakMinutes;
  return <section className="panel form rooms-timer"><div className="row row--between"><h2>Temporizador compartido</h2><span className="badge">{timer.phase === 'study' ? 'Estudio' : 'Descanso'}</span></div><output className="rooms-timer__clock" aria-label="Tiempo restante" aria-live="off">{timer.state === 'running' && !anchor ? 'Sincronizando…' : `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`}</output><p className="muted" role="status">{room.status === 'scheduled' ? 'Disponible cuando el organizador comience la sesión.' : !activeRoom(room) ? 'Temporizador detenido.' : remaining === 0 ? 'Bloque terminado. Inicia la siguiente fase cuando estén listos.' : timer.state === 'running' ? 'En marcha para todos los participantes.' : timer.state === 'paused' ? 'En pausa para todos.' : 'Listo para comenzar.'}</p>
    {room.status === 'active' && <><div className="form__grid"><label className="field">Estudio (minutos)<input type="number" min={1} max={180} step={1} value={studyMinutes} disabled={pending || (timer.state === 'running' && remaining > 0)} onChange={(event) => setStudyMinutes(event.target.value)} /></label><label className="field">Descanso (minutos)<input type="number" min={1} max={180} step={1} value={breakMinutes} disabled={pending || (timer.state === 'running' && remaining > 0)} onChange={(event) => setBreakMinutes(event.target.value)} /></label></div>{durationChanged && timer.state !== 'idle' && <p className="field__hint">Reinicia el bloque para aplicar las nuevas duraciones.</p>}<div className="row rooms-timer__actions">{timer.state === 'idle' && <button disabled={pending || !validMinutes} onClick={() => control('start')}>Iniciar bloque</button>}{timer.state === 'running' && remaining > 0 && <button disabled={pending || !anchor} onClick={() => control('pause')}>Pausar</button>}{timer.state === 'paused' && remaining > 0 && <button disabled={pending || !validMinutes || durationChanged} onClick={() => control('resume')}>Continuar</button>}{remaining === 0 && <button disabled={pending || !validMinutes || durationChanged} onClick={() => control('next')}>Iniciar {timer.phase === 'study' ? 'descanso' : 'estudio'}</button>}<button className="secondary" disabled={pending || !validMinutes} onClick={() => control('reset')}>Reiniciar bloque</button></div></>}{error && <p className="error" role="alert">{error}</p>}
  </section>;
}
