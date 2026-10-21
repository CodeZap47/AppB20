import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  HELP_CONTACT_STATUS_LABEL,
  HELP_KIND_LABEL,
  HELP_LEVEL_LABEL,
  HELP_LIMITS,
  HELP_MODALITY_LABEL,
  HELP_POST_STATUS_LABEL,
  periodLabel,
} from '@b20/core';
import type { HelpContactRequest, HelpPost, Member, Subject } from '../data/types';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { Avatar } from '../components/Avatar';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { RichText } from '../components/RichText';
import { useAction } from '../components/useAction';
import { formatDate, formatListTime, memberName } from '../lib/format';
import { previewText } from '../lib/messages';
import { matches } from '../lib/search';
import { bySubject } from '../lib/works';

const KINDS = ['offer', 'request'] as const;
const LEVELS = ['initial', 'basics', 'advanced'] as const;
const MODALITIES = ['messages', 'video', 'in_person', 'flexible'] as const;

function HelpBack() {
  return (
    <Link to="/m/ayuda" className="back with-icon">
      <Icon name="back" size={16} /> Puedo ayudarte / necesito ayuda
    </Link>
  );
}

function MembersOnly() {
  return (
    <Empty icon="lock" title="Ayuda entre integrantes del grupo">
      Necesitas una membresía activa para ver publicaciones y coordinar ayuda.
    </Empty>
  );
}

function MissingPost() {
  return (
    <Empty icon="search" title="Esta publicación no está disponible" action={<Link to="/m/ayuda" className="button">Ver el tablón</Link>}>
      Puede que se haya retirado o que el enlace esté incompleto. Los contactos anteriores siguen en «Mis contactos».
    </Empty>
  );
}

function HelpPostBadge({ post }: { post: HelpPost }) {
  return <span className={`badge help-status help-status--${post.status}`}>{HELP_POST_STATUS_LABEL[post.status]}</span>;
}

function HelpCard({ post, subjects, members, meId }: { post: HelpPost; subjects: Subject[]; members: Member[]; meId: string }) {
  const author = members.find((member) => member.id === post.authorId);
  return (
    <li>
      <Link to={`/m/ayuda/${post.id}`} className="work-card help-card">
        <span className="work-card__top">
          <span className={`badge help-kind help-kind--${post.kind}`}>{HELP_KIND_LABEL[post.kind]}</span>
          <HelpPostBadge post={post} />
        </span>
        <span className="work-card__context">{subjects.find((subject) => subject.id === post.subjectId)?.name ?? 'Materia desconocida'} · {post.topic}</span>
        <strong className="work-card__title">{post.title}</strong>
        <span className="work-card__excerpt">{previewText(post.description)}</span>
        <span className="help-card__mode">{HELP_LEVEL_LABEL[post.level]} · {HELP_MODALITY_LABEL[post.modality]}</span>
        <span className="work-card__footer">
          <Avatar member={author} size={24} />
          <span className="work-card__authors">{post.authorId === meId ? 'Tú' : author?.displayName ?? 'Integrante del grupo'}</span>
          <span className="work-card__date">{formatListTime(post.updatedAt)}</span>
        </span>
      </Link>
    </li>
  );
}

/** Tablón público: los contactos y sus conteos solo aparecen en las pantallas privadas. */
export function HelpPage() {
  const { me, helpPosts, subjects, members } = useSnapshot();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const subjectId = params.get('materia') ?? '';
  const modality = params.get('modalidad') ?? '';
  const kind = params.get('tipo') ?? '';
  const mine = params.get('vista') === 'mias';
  const update = (changes: Record<string, string>) => setParams((previous) => {
    const next = new URLSearchParams(previous);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    return next;
  }, { replace: true });

  if (me?.status !== 'active') return <MembersOnly />;

  const shown = helpPosts
    .filter((post) => mine ? post.authorId === me.id : post.status === 'open')
    .filter((post) => (!subjectId || post.subjectId === subjectId) && (!modality || post.modality === modality) && (!kind || post.kind === kind))
    .filter((post) => matches(query, post.title, post.topic, post.description, subjects.find((subject) => subject.id === post.subjectId)?.name ?? '', memberName(members, post.authorId)))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const filtering = Boolean(query || subjectId || modality || kind);
  const createTo = `/m/ayuda/nueva${subjectId ? `?materia=${encodeURIComponent(subjectId)}` : ''}`;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Puedo ayudarte / necesito ayuda</h1>
          <p className="muted">Comparte lo que sabes o encuentra a alguien para entender un tema. Cada quien decide cómo y cuándo ayudar.</p>
        </div>
        <div className="row">
          <Link to="/m/ayuda/contactos" className="button secondary with-icon"><Icon name="lock" size={16} /> Mis contactos</Link>
          <Link to={createTo} className="button with-icon"><Icon name="plus" size={18} /> Publicar</Link>
        </div>
      </header>

      <div className="segmented help-views" role="group" aria-label="Publicaciones que quieres ver">
        <button type="button" aria-pressed={!mine} onClick={() => update({ vista: '' })}>Tablón abierto</button>
        <button type="button" aria-pressed={mine} onClick={() => update({ vista: 'mias' })}>Mis publicaciones</button>
      </div>
      <div className="help-filters" role="search" aria-label="Buscar ayuda">
        <label className="search help-filters__search">
          <Icon name="search" size={18} />
          <input type="search" aria-label="Buscar por tema, título, materia o autor" placeholder="Buscar por tema, título, materia o autor" value={query} onChange={(event) => update({ q: event.target.value })} />
        </label>
        <label className="field"><span className="field__label">Materia</span>
          <select value={subjectId} onChange={(event) => update({ materia: event.target.value })}>
            <option value="">Todas las materias</option>
            {[...subjects].sort(bySubject).map((subject) => <option key={subject.id} value={subject.id}>{subject.name} · {periodLabel(subject.period)}</option>)}
          </select>
        </label>
        <label className="field"><span className="field__label">Modalidad</span>
          <select value={modality} onChange={(event) => update({ modalidad: event.target.value })}>
            <option value="">Cualquier modalidad</option>
            {MODALITIES.map((value) => <option key={value} value={value}>{HELP_MODALITY_LABEL[value]}</option>)}
          </select>
        </label>
        <label className="field"><span className="field__label">Tipo de publicación</span>
          <select value={kind} onChange={(event) => update({ tipo: event.target.value })}>
            <option value="">Ofertas y peticiones</option>
            {KINDS.map((value) => <option key={value} value={value}>{HELP_KIND_LABEL[value]}</option>)}
          </select>
        </label>
      </div>
      <p className="results muted" aria-live="polite">
        {shown.length} {shown.length === 1 ? 'publicación' : 'publicaciones'}{mine ? ' tuyas' : ' abiertas'}{filtering && ' con estos filtros'}
        {filtering && <> · <button type="button" className="link-button" onClick={() => setParams(mine ? { vista: 'mias' } : {}, { replace: true })}>Limpiar filtros</button></>}
      </p>
      {shown.length ? (
        <ul className="work-grid">{shown.map((post) => <HelpCard key={post.id} post={post} subjects={subjects} members={members} meId={me.id} />)}</ul>
      ) : (
        <Empty icon={filtering ? 'search' : 'users'} title={filtering ? 'No hay publicaciones con estos filtros' : mine ? 'Todavía no has publicado' : 'El tablón está listo para empezar'} action={<Link to={createTo} className="button">Publicar una oferta o petición</Link>}>
          {filtering ? 'Prueba otro tema o quita algún filtro.' : 'Ofrece ayuda con un tema que conozcas o cuenta qué necesitas repasar con alguien.'}
        </Empty>
      )}
      <p className="field__hint help-board-note"><Icon name="lock" size={14} /> Las publicaciones las ve el grupo. Tus solicitudes de contacto y sus mensajes son privados.</p>
    </>
  );
}

/** Separa el formulario para reiniciarlo al cambiar entre publicaciones o creación. */
export function HelpFormPage() {
  const { postId } = useParams();
  const { me, helpPosts, subjects } = useSnapshot();
  if (me?.status !== 'active') return <MembersOnly />;
  const post = postId ? helpPosts.find((candidate) => candidate.id === postId) : undefined;
  if (postId && !post) return <MissingPost />;
  if (post && (post.authorId !== me.id || post.status === 'withdrawn')) {
    return <Empty icon="lock" title="Esta publicación no se puede editar" action={<Link to={`/m/ayuda/${post.id}`} className="button secondary">Volver a la publicación</Link>}>Solo puedes editar tus publicaciones abiertas o cerradas.</Empty>;
  }
  if (!subjects.length) return <Empty icon="folder" title="Todavía no hay materias">Cuando el grupo tenga materias podrás publicar una oferta o petición de ayuda.</Empty>;
  return <HelpForm key={post?.id ?? 'new'} post={post} subjects={subjects} />;
}

function HelpForm({ post, subjects }: { post?: HelpPost; subjects: Subject[] }) {
  const source = useDataSource();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { error, pending, run } = useAction();
  const presetSubject = subjects.find((subject) => subject.id === params.get('materia'));
  const [kind, setKind] = useState<HelpPost['kind']>(post?.kind ?? (params.get('tipo') === 'request' ? 'request' : 'offer'));
  const [subjectId, setSubjectId] = useState(post?.subjectId ?? presetSubject?.id ?? '');
  const [title, setTitle] = useState(post?.title ?? '');
  const [topic, setTopic] = useState(post?.topic ?? '');
  const [description, setDescription] = useState(post?.description ?? '');
  const [level, setLevel] = useState<HelpPost['level'] | ''>(post?.level ?? '');
  const [modality, setModality] = useState<HelpPost['modality'] | ''>(post?.modality ?? '');
  const [availability, setAvailability] = useState(post?.availability ?? '');
  const cancelTo = post ? `/m/ayuda/${post.id}` : '/m/ayuda';
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || !level || !modality) return;
    const id = await run(() => source.saveHelpPost({ id: post?.id, kind, subjectId, title: title.trim(), topic: topic.trim(), description: description.trim(), level, modality, availability: availability.trim() }));
    if (id) void navigate(`/m/ayuda/${id}`, { replace: true });
  };
  return (
    <>
      <HelpBack />
      <header className="page-header"><div><h1>{post ? 'Editar publicación' : 'Publicar una oferta o petición'}</h1><p className="muted">El grupo verá lo que escribas aquí desde el momento de publicar.</p></div></header>
      <div className="detail">
        <form className="panel form form--wide" onSubmit={submit} aria-busy={pending}>
          <fieldset className="help-fieldset" disabled={pending}>
            <section className="form__section">
              <h2>Qué quieres compartir</h2>
              {post ? <p className="help-form-kind"><span className={`badge help-kind help-kind--${post.kind}`}>{HELP_KIND_LABEL[post.kind]}</span><span className="field__hint">El tipo se conserva al editar.</span></p> : (
                <fieldset className="field"><legend className="field__label">Tipo de publicación</legend><div className="help-kind-picker">
                  {KINDS.map((value) => <label key={value} className={`help-kind-choice${kind === value ? ' help-kind-choice--selected' : ''}`}><input type="radio" name="help-kind" value={value} checked={kind === value} onChange={() => setKind(value)} /><span><strong>{HELP_KIND_LABEL[value]}</strong><span className="field__hint">{value === 'offer' ? 'Comparte un tema que conoces.' : 'Cuenta qué necesitas entender.'}</span></span></label>)}
                </div></fieldset>
              )}
              <label className="field"><span className="field__label">Título</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={HELP_LIMITS.title} placeholder={kind === 'offer' ? 'Puedo explicar ciclos y arreglos' : 'Necesito repasar normalización de bases de datos'} required autoFocus /></label>
              <label className="field"><span className="field__label">Materia</span><select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} required><option value="" disabled>Elige una materia</option>{[...subjects].sort(bySubject).map((subject) => <option key={subject.id} value={subject.id}>{subject.name} · {periodLabel(subject.period)}</option>)}</select></label>
              <label className="field"><span className="field__label">Tema</span><input value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={HELP_LIMITS.topic} placeholder="Por ejemplo: Ciclos for o Tablas de verdad" required /></label>
              <label className="field"><span className="field__label">Descripción</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={7} maxLength={HELP_LIMITS.description} placeholder={kind === 'offer' ? 'Qué puedes explicar y cómo te gustaría ayudar.' : 'Qué quieres entender y qué has intentado hasta ahora.'} required /></label>
            </section>
            <section className="form__section">
              <h2>Cómo coordinarse</h2>
              <label className="field"><span className="field__label">Nivel del contenido</span><select value={level} onChange={(event) => setLevel(event.target.value as HelpPost['level'])} required><option value="" disabled>Elige el nivel del contenido</option>{LEVELS.map((value) => <option key={value} value={value}>{HELP_LEVEL_LABEL[value]}</option>)}</select><span className="field__hint">Describe el tema que quieres trabajar, sin calificar a ninguna persona.</span></label>
              <label className="field"><span className="field__label">Modalidad</span><select value={modality} onChange={(event) => setModality(event.target.value as HelpPost['modality'])} required><option value="" disabled>Elige una modalidad</option>{MODALITIES.map((value) => <option key={value} value={value}>{HELP_MODALITY_LABEL[value]}</option>)}</select></label>
              <label className="field"><span className="field__label">Disponibilidad <span className="field__optional">opcional</span></span><textarea value={availability} onChange={(event) => setAvailability(event.target.value)} maxLength={HELP_LIMITS.availability} rows={3} placeholder="Por ejemplo: Los martes después de clase" aria-describedby="help-availability-privacy" /><span id="help-availability-privacy" className="field__hint">Si la incluyes, la verá todo el grupo. Puedes dejarla vacía y acordarla por mensaje privado después de aceptar el contacto.</span></label>
            </section>
          </fieldset>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="form__actions"><Link to={cancelTo} className="button secondary">Cancelar</Link><button type="submit" disabled={pending || !title.trim() || !subjectId || !topic.trim() || !description.trim() || !level || !modality}>{pending ? 'Guardando…' : post ? 'Guardar cambios' : 'Publicar'}</button></div>
        </form>
        <aside className="detail__side"><section className="panel"><h2 className="label">Un punto de encuentro</h2><p className="muted">Quien quiera coordinarse contigo enviará una solicitud privada. Tú decides si aceptas.</p><p className="muted">Al aceptarla tendrán acceso a su conversación privada. Podrán acordar ahí el horario y los detalles.</p><p className="field__hint">Tu publicación seguirá abierta hasta que decidas cerrarla.</p></section></aside>
      </div>
    </>
  );
}

export function HelpPostPage() {
  const { postId = '' } = useParams();
  const source = useDataSource();
  const { me, helpPosts, helpContacts, members, subjects } = useSnapshot();
  const { error, pending, run } = useAction();
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');

  if (me?.status !== 'active') return <MembersOnly />;
  const post = helpPosts.find((candidate) => candidate.id === postId);
  if (!post || (post.status === 'withdrawn' && post.authorId !== me.id)) return <MissingPost />;
  const isAuthor = post.authorId === me.id;
  const author = members.find((member) => member.id === post.authorId);
  const subject = subjects.find((candidate) => candidate.id === post.subjectId);
  const existing = helpContacts.find((request) => request.postId === post.id && request.senderId === me.id);
  const canRequest = !isAuthor && post.status === 'open' && author?.status === 'active' && !existing;
  const canWithdraw = post.status !== 'withdrawn' && (isAuthor || me.isCreator);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const id = await run(() => source.sendHelpContact(post.id, message.trim()));
    if (id) { setAsking(false); setMessage(''); setNotice('Solicitud enviada. Puedes ver su estado en «Mis contactos».'); }
  };
  const changeStatus = async () => {
    if (pending) return;
    const next = post.status === 'open' ? 'closed' : 'open';
    const succeeded = await run(async () => { await source.setHelpPostStatus(post.id, next); return true; });
    if (succeeded) setNotice(next === 'closed' ? 'Publicación cerrada. Los contactos pendientes se cerraron; las conversaciones aceptadas siguen disponibles.' : 'Publicación abierta de nuevo.');
  };
  const withdraw = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const succeeded = await run(async () => { await source.withdrawHelpPost(post.id, reason.trim()); return true; });
    if (succeeded) { setWithdrawing(false); setNotice('La publicación fue retirada. El historial de contactos se conserva en privado.'); }
  };
  return (
    <>
      <HelpBack />
      <header className="page-header"><div><p className="eyebrow"><Link to={`/m/ayuda?materia=${encodeURIComponent(post.subjectId)}`}>{subject?.name ?? 'Materia desconocida'}</Link> · {post.topic}</p><h1>{post.title}</h1><div className="badges help-detail-badges"><span className={`badge help-kind help-kind--${post.kind}`}>{HELP_KIND_LABEL[post.kind]}</span><HelpPostBadge post={post} /></div></div><div className="row"><Link to="/m/ayuda/contactos" className="button secondary">Mis contactos</Link>{isAuthor && post.status !== 'withdrawn' && <Link to={`/m/ayuda/${post.id}/editar`} className="button secondary with-icon"><Icon name="edit" size={16} /> Editar</Link>}</div></header>
      {notice && <p className="help-notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="detail">
        <div className="detail__main">
          <section className="panel help-description"><header className="help-author"><Avatar member={author} size={36} /><div><Link to={`/perfil/${post.authorId}`}>{isAuthor ? 'Tú' : author?.displayName ?? 'Integrante del grupo'}</Link><span className="muted">Publicado el {formatDate(post.createdAt)}</span></div></header><RichText text={post.description} /></section>
          {post.status === 'withdrawn' && <section className="panel"><h2 className="label">Publicación retirada</h2><p className="muted">Solo tú puedes consultar esta publicación. Sus contactos anteriores siguen en «Mis contactos». No se puede volver a publicar.</p>{post.withdrawalReason && <p className="prewrap help-withdrawal-reason"><strong>Motivo de la retirada:</strong> {post.withdrawalReason}</p>}</section>}
          {existing && <section className="panel help-contact-summary"><h2 className="label">Tu solicitud de contacto</h2><p><span className={`badge help-status help-status--${existing.status}`}>{HELP_CONTACT_STATUS_LABEL[existing.status]}</span></p><p className="muted">{existing.status === 'pending' ? 'La otra persona decidirá si acepta. La solicitud solo la ven ustedes dos.' : existing.status === 'accepted' ? 'Ya pueden coordinar el horario y los detalles por mensaje privado.' : 'Esta solicitud quedó en el historial. Puedes revisar sus detalles en «Mis contactos».'}</p><div className="row">{existing.conversationId && <Link to={`/m/mensajes/directos/${existing.conversationId}`} className="button with-icon"><Icon name="chat" size={16} /> Abrir conversación</Link>}<Link to="/m/ayuda/contactos?pestana=enviados" className="button secondary">Ver mis contactos</Link></div></section>}
          {canRequest && (asking ? <form className="panel form" onSubmit={send} aria-busy={pending}><h2>Solicitar contacto</h2><p className="field__hint">Solo tú y {author.displayName} verán esta solicitud. Al aceptarla podrán abrir su conversación privada.</p><label className="field"><span className="field__label">Mensaje inicial <span className="field__optional">opcional</span></span><textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={HELP_LIMITS.message} rows={4} disabled={pending} autoFocus /></label><div className="form__actions"><button type="button" className="secondary" disabled={pending} onClick={() => setAsking(false)}>Cancelar</button><button type="submit" disabled={pending}>{pending ? 'Enviando…' : 'Enviar solicitud'}</button></div></form> : <section className="panel"><h2>{post.kind === 'offer' ? '¿Te serviría esta ayuda?' : '¿Puedes ayudar con este tema?'}</h2><p className="muted">Envía una solicitud privada para que puedan coordinarse.</p><button type="button" className="with-icon" disabled={pending} onClick={() => { setAsking(true); setNotice(''); }}><Icon name="send" size={16} />{post.kind === 'offer' ? 'Pedir ayuda' : 'Ofrecer ayuda'}</button></section>)}
          {!isAuthor && !existing && post.status === 'closed' && <p className="muted">La publicación está cerrada y ya no recibe solicitudes de contacto.</p>}
          {!isAuthor && !existing && author?.status !== 'active' && <p className="muted">Su autor ya no es un integrante activo. No es posible solicitar contacto.</p>}
          {isAuthor && post.status !== 'withdrawn' && <section className="panel"><h2 className="label">Administrar tu publicación</h2><p className="muted">{post.status === 'open' ? 'La publicación sigue abierta aunque aceptes contactos. Ciérrala cuando ya no quieras recibir nuevas solicitudes; las pendientes también se cerrarán.' : 'Puedes volver a abrirla para recibir nuevas solicitudes de otras personas. Los contactos anteriores conservan su estado.'}</p><div className="row"><button type="button" className="secondary" disabled={pending} onClick={changeStatus}>{pending ? 'Guardando…' : post.status === 'open' ? 'Cerrar publicación' : 'Reabrir publicación'}</button><Link to="/m/ayuda/contactos" className="button secondary">Revisar mis contactos</Link></div></section>}
          {canWithdraw && (withdrawing ? <form className="panel form" onSubmit={withdraw} aria-busy={pending}><h2>Retirar publicación</h2><p className="muted">Dejará de aparecer para el grupo y no se podrá reabrir. Los contactos pendientes se cerrarán y el historial privado se conservará.</p><label className="field"><span className="field__label">Motivo de la retirada {isAuthor && <span className="field__optional">opcional</span>}</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={HELP_LIMITS.reason} rows={3} required={!isAuthor} disabled={pending} /><span className="field__hint">{isAuthor ? 'El motivo quedará guardado junto a tu publicación.' : 'Como administrador, debes indicar un motivo. El autor podrá consultarlo.'}</span></label><div className="form__actions"><button type="button" className="secondary" disabled={pending} onClick={() => setWithdrawing(false)}>Cancelar</button><button type="submit" disabled={pending || (!isAuthor && !reason.trim())}>{pending ? 'Retirando…' : 'Confirmar retirada'}</button></div></form> : <div><button type="button" className="link-button" disabled={pending} onClick={() => setWithdrawing(true)}>{isAuthor ? 'Retirar mi publicación' : 'Retirar publicación como administrador'}</button></div>)}
        </div>
        <aside className="detail__side"><section className="panel"><h2 className="label">Para coordinarse</h2><dl className="facts"><dt>Nivel del contenido</dt><dd>{HELP_LEVEL_LABEL[post.level]}</dd><dt>Modalidad</dt><dd>{HELP_MODALITY_LABEL[post.modality]}</dd><dt>Disponibilidad</dt><dd className="prewrap">{post.availability || 'Acordar en privado'}</dd><dt>Actualizada</dt><dd>{formatDate(post.updatedAt)}</dd></dl><p className="field__hint">El nivel describe el contenido. La disponibilidad solo se muestra si el autor decidió compartirla.</p></section><section className="panel"><h2 className="label">Contacto privado</h2><p className="muted">Solo las dos personas ven su solicitud. Al aceptar podrán abrir su chat; no se enviará ningún mensaje automáticamente.</p></section></aside>
      </div>
    </>
  );
}

function HelpContactCard({ request, me, members, subjects, posts }: { request: HelpContactRequest; me: Member; members: Member[]; subjects: Subject[]; posts: HelpPost[] }) {
  const source = useDataSource();
  const roomData = useSnapshot();
  const activeRoom = roomData.helpRoomLinks?.filter((link) => link.contactId === request.id)
    .map((link) => roomData.studyRooms.find((room) => room.id === link.roomId && (room.status === 'scheduled' || room.status === 'active'))).find(Boolean);
  const { error, pending, run } = useAction();
  const received = request.recipientId === me.id;
  const otherId = received ? request.senderId : request.recipientId;
  const other = members.find((member) => member.id === otherId);
  const post = posts.find((candidate) => candidate.id === request.postId);
  const available = post && (post.status !== 'withdrawn' || post.authorId === me.id);
  const canAccept = other?.status === 'active' && post?.status === 'open';
  const actOnContact = (action: () => unknown | Promise<unknown>) => {
    if (!pending) void run(action);
  };
  return (
    <li className="panel help-contact" aria-busy={pending}>
      <header className="help-contact__header"><div className="help-author"><Avatar member={other} size={32} /><div><Link to={`/perfil/${otherId}`}>{other?.displayName ?? 'Integrante del grupo'}</Link><span className="muted">{received ? 'Te envió una solicitud' : 'Le enviaste una solicitud'} · {formatDate(request.createdAt)}</span></div></div><span className={`badge help-status help-status--${request.status}`}>{HELP_CONTACT_STATUS_LABEL[request.status]}</span></header>
      <div className="help-contact__context"><span className={`badge help-kind help-kind--${request.postKind}`}>{HELP_KIND_LABEL[request.postKind]}</span><h2>{available ? <Link to={`/m/ayuda/${request.postId}`}>{request.postTitle}</Link> : request.postTitle}</h2><p className="muted">{subjects.find((subject) => subject.id === request.subjectId)?.name ?? 'Materia desconocida'} · {request.postTopic}</p>{!available && <p className="field__hint">La publicación fue retirada. Conservas aquí el contexto del contacto.</p>}</div>
      {request.message && <div className="help-contact__message"><p className="label">Mensaje inicial privado</p><p className="prewrap">{request.message}</p></div>}
      {request.status === 'pending' && received && !canAccept && <p className="field__hint">{other?.status !== 'active' ? 'La persona ya no es un integrante activo. No es posible aceptar esta solicitud.' : 'La publicación ya no recibe contactos. No es posible aceptar esta solicitud.'}</p>}
      {request.status === 'closed' && <p className="field__hint">Este contacto está cerrado. Su historial se conserva en privado.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="help-contact__actions row">
        {activeRoom ? <Link to={`/m/salas/${encodeURIComponent(activeRoom.id)}`} className="button secondary">Abrir sala de estudio</Link> : request.status === 'accepted' && other?.status === 'active' && <Link to={`/m/salas/nueva?contacto=${encodeURIComponent(request.id)}`} className="button secondary">Organizar sesión</Link>}
        {request.conversationId && <Link to={`/m/mensajes/directos/${request.conversationId}`} className="button with-icon"><Icon name="chat" size={16} /> Abrir conversación</Link>}
        {request.status === 'pending' && (received ? <><button type="button" disabled={pending || !canAccept} onClick={() => actOnContact(() => source.respondHelpContact(request.id, 'accepted'))}>Aceptar contacto</button><button type="button" className="secondary" disabled={pending} onClick={() => actOnContact(() => source.respondHelpContact(request.id, 'rejected'))}>Rechazar</button></> : <button type="button" className="secondary" disabled={pending} onClick={() => actOnContact(() => source.cancelHelpContact(request.id))}>Cancelar solicitud</button>)}
        {request.status === 'accepted' && <button type="button" className="secondary" disabled={pending} onClick={() => actOnContact(() => source.closeHelpContact(request.id))}>Cerrar contacto</button>}
        {pending && <span className="field__hint" role="status">Guardando…</span>}
      </div>
    </li>
  );
}

export function HelpContactsPage() {
  const { me, helpContacts, helpPosts, members, subjects } = useSnapshot();
  const [params, setParams] = useSearchParams();
  if (me?.status !== 'active') return <MembersOnly />;
  const sent = params.get('pestana') === 'enviados';
  // Defensa de presentación adicional a las vistas privadas de cada fuente de datos.
  const mine = helpContacts.filter((request) => request.recipientId === me.id || request.senderId === me.id);
  const received = mine.filter((request) => request.recipientId === me.id);
  const outgoing = mine.filter((request) => request.senderId === me.id);
  const shown = [...(sent ? outgoing : received)].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return (
    <>
      <HelpBack />
      <header className="page-header"><div><h1>Mis contactos de ayuda</h1><p className="muted">Tus solicitudes para coordinar ayuda, visibles solo para las dos personas involucradas.</p></div></header>
      <div className="segmented help-views" role="group" aria-label="Solicitudes de contacto"><button type="button" aria-pressed={!sent} onClick={() => setParams({}, { replace: true })}>Recibidos <span className="chip__count">{received.length}</span></button><button type="button" aria-pressed={sent} onClick={() => setParams({ pestana: 'enviados' }, { replace: true })}>Enviados <span className="chip__count">{outgoing.length}</span></button></div>
      {shown.length ? <ul className="help-contact-list">{shown.map((request) => <HelpContactCard key={request.id} request={request} me={me} members={members} subjects={subjects} posts={helpPosts} />)}</ul> : <Empty icon="lock" title={sent ? 'Todavía no has enviado solicitudes' : 'No tienes solicitudes recibidas'} action={<Link to="/m/ayuda" className="button secondary">Explorar el tablón</Link>}>{sent ? 'Abre una publicación y pide u ofrece ayuda para ponerte en contacto.' : 'Cuando alguien quiera coordinarse contigo, podrás aceptar o rechazar su solicitud aquí.'}</Empty>}
    </>
  );
}
