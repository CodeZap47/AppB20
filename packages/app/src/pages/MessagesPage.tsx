import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useMatch, useNavigate, useParams } from 'react-router';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { ChatAvatar, ChatButton } from '../components/messaging/Messaging';
import { ChatToolsLinks, Composer, type ComposerMode } from '../components/Composer';
import { Icon } from '../components/Icon';
import { MessageList, type MessageHandlers } from '../components/MessageList';
import { useAction } from '../components/useAction';
import type { MessageScope } from '../data/types';
import { formatListTime, memberName } from '../lib/format';
import type { ChatMessage } from '../lib/messages';
import { messagePreview } from '../lib/references';
import { matches } from '../lib/search';
import { chatTarget, mentionedMembers, unreadMessages } from '../lib/chat';
import { ConversationMute, MessageReportsPanel, ReportMessageForm } from '../components/ChatControls';
import '../chat.css';

const GROUP_NAME = 'Canal del salón';

/**
 * Mensajes en dos paneles: la lista de conversaciones y la conversación abierta.
 * En pantallas angostas (celular, panel lateral de la extensión) se ve un panel a la vez:
 * `/m/mensajes/directos` es la lista y las demás rutas son una conversación.
 */
export function MessagesLayout() {
  const onList = useMatch('/m/mensajes/directos');
  return (
    <div className={onList ? 'b20-messaging chat chat--list' : 'b20-messaging chat chat--thread'}>
      <ConversationList />
      <section className="chat__thread" aria-label="Conversación">
        <Outlet />
      </section>
    </div>
  );
}

function GroupAvatar({ name = GROUP_NAME }: { name?: string }) {
  return <ChatAvatar name={name} size="sm" className="messaging-avatar--group" />;
}

function ConversationRow({
  to,
  end,
  avatar,
  name,
  last,
  preview,
  unread = 0,
  mentions = 0,
  muted = false,
}: {
  to: string;
  end?: boolean;
  avatar: ReactNode;
  name: string;
  last: ChatMessage | undefined;
  preview: string;
  unread?: number;
  mentions?: number;
  muted?: boolean;
}) {
  return (
    <li>
      <NavLink to={to} end={end} className="conv messaging-conversation">
        {avatar}
        <span className="conv__main">
          <span className="conv__top">
            <strong className="conv__name">{name}</strong>
            {last && (
              <time className="conv__time" dateTime={last.sentAt.toISOString()}>
                {formatListTime(last.sentAt)}
              </time>
            )}
          </span>
          <span className="conv__preview">{muted && <span aria-label="Conversación silenciada">Silenciada · </span>}{preview}</span>
        </span>
        {unread > 0 && <span className="chat-unread" aria-label={`${unread} mensajes sin leer`}>{unread}</span>}
        {mentions > 0 && <span className="chat-mentions" aria-label={`${mentions} menciones sin leer`}>@</span>}
      </NavLink>
    </li>
  );
}

function ConversationList() {
  const source = useDataSource();
  const navigate = useNavigate();
  const { me, members, groupMessages, directConversations, directMessages, chatChannels, channelMessages, conversationStates, subjects } = useSnapshot();
  const { error, run } = useAction();
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelKind, setChannelKind] = useState<'subject' | 'topic' | 'project'>('topic');
  const [subjectId, setSubjectId] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const directs = useMemo(
    () =>
      directConversations
        .map((c) => {
          const otherId = c.participantIds.find((id) => id !== me?.id) ?? '';
          return {
            id: c.id,
            otherId,
            other: members.find((m) => m.id === otherId),
            name: memberName(members, otherId),
            last: directMessages.findLast((m) => m.conversationId === c.id),
          };
        })
        .sort((a, b) => (b.last?.sentAt.getTime() ?? 0) - (a.last?.sentAt.getTime() ?? 0)),
    [directConversations, directMessages, members, me?.id],
  );

  const previewOf = (last: ChatMessage | undefined, inGroup: boolean) => {
    if (!last) return 'Sin mensajes todavía';
    const who = last.senderId === me?.id ? 'Tú' : inGroup ? memberName(members, last.senderId) : '';
    return `${who ? `${who}: ` : ''}${messagePreview(last)}`;
  };

  const lastGroup = groupMessages.at(-1);
  const indicators = (scope: MessageScope, conversationId: string, messages: ChatMessage[]) => {
    const state = conversationStates.find((row) => row.scope === scope && row.conversationId === conversationId);
    const unread = unreadMessages(messages, me?.id, state?.readThroughId);
    return { unread: unread.length, mentions: unread.filter((message) => me && mentionedMembers(message.text).includes(me.id)).length, muted: state?.muted };
  };
  const shownChannels = chatChannels.filter((channel) => matches(query, channel.name, channel.kind));
  const showGroup = matches(query, GROUP_NAME, 'grupo');
  const shownDirects = directs.filter((d) => matches(query, d.name));
  const newPeople = members.filter(
    (m) =>
      m.id !== me?.id &&
      m.status === 'active' &&
      !directs.some((d) => d.otherId === m.id) &&
      matches(query, m.displayName),
  );
  const showPeople = (picking || query.trim() !== '') && newPeople.length > 0;
  const nothing = !showGroup && !shownDirects.length && !showPeople && !shownChannels.length;

  const start = async (memberId: string) => {
    const id = await run(() => source.openDirectConversation(memberId));
    if (!id) return;
    setPicking(false);
    setQuery('');
    void navigate(`/m/mensajes/directos/${id}`);
  };

  return (
    <aside className="chat__list" aria-label="Conversaciones">
      <header className="chat__list-header messaging-sidebar-heading">
        <div><p className="messaging-eyebrow">TU SALÓN</p><h1>Mensajes</h1></div>
        <ChatButton
          type="button"
          variant="tertiary" className="icon-button"
          aria-label={picking ? 'Cerrar la lista de compañeros' : 'Nueva conversación'}
          title={picking ? 'Cerrar' : 'Nueva conversación'}
          aria-expanded={picking}
          onClick={() => {
            setPicking(!picking);
            if (!picking) searchRef.current?.focus();
          }}
        >
          <Icon name={picking ? 'close' : 'plus'} />
        </ChatButton>
      </header>
      <label className="search">
        <Icon name="search" size={18} />
        <input
          ref={searchRef}
          type="search"
          placeholder="Buscar"
          aria-label="Buscar conversación o compañero"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {error && (
        <p className="error chat__list-note" role="alert">
          {error}
        </p>
      )}

      <div className="chat__list-scroll">
        {showGroup && (
          <ul className="convs">
            <ConversationRow
              to="/m/mensajes"
              end
              avatar={<GroupAvatar />}
              name={GROUP_NAME}
              last={lastGroup}
              preview={previewOf(lastGroup, true)}
              {...indicators('group', 'general', groupMessages)}
            />
          </ul>
        )}
        <div className="chat-channel-heading"><h2 className="chat__list-title">Canales</h2><ChatButton type="button" variant="tertiary" className="link-button" onClick={() => setCreatingChannel(!creatingChannel)}>{creatingChannel ? 'Cerrar' : 'Crear canal'}</ChatButton></div>
        {creatingChannel && <form className="form chat-channel-form" onSubmit={(event) => {
          event.preventDefault(); void run(async () => {
            const id = await source.createChatChannel({ name: channelName, kind: channelKind, subjectId: channelKind === 'subject' ? subjectId : undefined });
            setCreatingChannel(false); setChannelName(''); setSubjectId(''); void navigate(`/m/mensajes/canales/${id}`);
          });
        }}>
          <label className="field"><span className="field__label">Nombre del canal</span><input value={channelName} maxLength={80} required onChange={(event) => setChannelName(event.target.value)} /></label>
          <label className="field"><span className="field__label">Tipo de canal</span><select value={channelKind} onChange={(event) => setChannelKind(event.target.value as typeof channelKind)}><option value="subject">Materia</option><option value="topic">Tema</option><option value="project">Proyecto</option></select></label>
          {channelKind === 'subject' && <label className="field"><span className="field__label">Materia</span><select value={subjectId} required onChange={(event) => setSubjectId(event.target.value)}><option value="">Elige una materia</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>}
          <p className="field__hint">Todos los integrantes activos del salón pueden leer el canal.</p><ChatButton type="submit">Crear canal</ChatButton>
        </form>}
        {shownChannels.length > 0 && <ul className="convs">{shownChannels.map((channel) => {
          const messages = channelMessages.filter((message) => message.channelId === channel.id);
          const last = messages.at(-1);
          return <ConversationRow key={channel.id} to={`/m/mensajes/canales/${channel.id}`} avatar={<GroupAvatar name={channel.name} />} name={`${channel.name}${channel.archivedAt ? ' · Archivado' : ''}`} last={last} preview={previewOf(last, true)} {...indicators('channel', channel.id, messages)} />;
        })}</ul>}

        {(shownDirects.length > 0 || (!query && !picking)) && (
          <>
            <h2 className="chat__list-title">Directos</h2>
            {shownDirects.length ? (
              <ul className="convs">
                {shownDirects.map((d) => (
                  <ConversationRow
                    key={d.id}
                    to={`/m/mensajes/directos/${d.id}`}
                    avatar={<ChatAvatar name={d.name} src={d.other?.photoUrl} size="sm" />}
                    name={d.name}
                    last={d.last}
                    preview={previewOf(d.last, false)}
                    {...indicators('direct', d.id, directMessages.filter((message) => message.conversationId === d.id))}
                  />
                ))}
              </ul>
            ) : (
              <p className="muted chat__list-note">
                Aún no tienes conversaciones directas.{' '}
                <ChatButton type="button" variant="tertiary" className="link-button" onClick={() => setPicking(true)}>
                  Escríbele a un compañero
                </ChatButton>
              </p>
            )}
          </>
        )}

        {showPeople && (
          <>
            <h2 className="chat__list-title">Iniciar conversación</h2>
            <ul className="convs">
              {newPeople.map((m) => (
                <li key={m.id}>
                  <ChatButton type="button" variant="tertiary" className="conv messaging-conversation" onClick={() => start(m.id)}>
                    <ChatAvatar name={m.displayName} src={m.photoUrl} size="sm" />
                    <span className="conv__main">
                      <strong className="conv__name">{m.displayName}</strong>
                      <span className="conv__preview">Escribirle por primera vez</span>
                    </span>
                  </ChatButton>
                </li>
              ))}
            </ul>
          </>
        )}

        {picking && !query && !newPeople.length && (
          <p className="muted chat__list-note">Ya tienes una conversación con cada compañero.</p>
        )}
        {nothing && query && (
          <p className="muted chat__list-note">Sin resultados para «{query.trim()}».</p>
        )}
      </div>
      <ChatToolsLinks />
      <MessageReportsPanel />
    </aside>
  );
}

function ThreadHeader({
  avatar,
  title,
  subtitle,
  action,
}: {
  avatar: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="thread__header">
      <Link
        to="/m/mensajes/directos"
        className="icon-button thread__back"
        aria-label="Ver todas las conversaciones"
      >
        <Icon name="back" />
      </Link>
      {avatar}
      <div className="thread__heading">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

function ThreadNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="thread__notice">
      <span className="thread__notice-icon" aria-hidden="true">
        <Icon name="chat" size={28} />
      </span>
      <h2>{title}</h2>
      <p className="muted">{children}</p>
    </div>
  );
}

/**
 * Estado de una conversación: a qué mensaje respondes o cuál editas, y las acciones de cada
 * mensaje. Enviar respeta ese modo: responde, guarda la edición o manda un mensaje nuevo.
 */
function useThread(scope: MessageScope, conversationId: string, sendNew: (text: string, replyToId?: string) => string | Promise<string>) {
  const source = useDataSource();
  const { me, members, conversationStates } = useSnapshot();
  const { error, run } = useAction();
  const readAction = useAction();
  const [mode, setMode] = useState<ComposerMode | undefined>();
  const [report, setReport] = useState<ChatMessage | null>(null);
  const [progress, setProgress] = useState<{ name: string; done: number; total: number } | null>(null);
  const [retryingAttachments, setRetryingAttachments] = useState(false);
  const upload = useRef<{ id: string; files: File[]; next: number; version: number } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    controller.current?.abort(); upload.current = null; setMode(undefined); setReport(null); setRetryingAttachments(false); setProgress(null);
  }, [scope, conversationId]);
  const lastRead = conversationStates.find((row) => row.scope === scope && row.conversationId === conversationId)?.readThroughId;
  const requestedRead = useRef<string | undefined>(undefined);
  useEffect(() => { requestedRead.current = undefined; }, [scope, conversationId]);
  const onReadThrough = useCallback((messageId: string) => {
    if (messageId === lastRead || messageId === requestedRead.current) return;
    requestedRead.current = messageId;
    void readAction.run(async () => {
      try { await source.markConversationRead(scope, conversationId, messageId); }
      catch (failure) { requestedRead.current = undefined; throw failure; }
    });
  }, [source, scope, conversationId, lastRead]);

  const handlers: MessageHandlers = {
    onReply: (message) =>
      setMode({
        kind: 'reply',
        message,
        name: message.senderId === me?.id ? 'ti' : memberName(members, message.senderId),
      }),
    onEdit: (message) => setMode({ kind: 'edit', message }),
    onDelete: (message) => {
      run(() => source.deleteMessage(scope, message.id));
      if (mode?.message.id === message.id) setMode(undefined);
    },
    onReact: (message, emoji) => run(() => source.toggleReaction(scope, message.id, emoji)),
    onReport: setReport,
  };

  const onSend = async (text: string, files: File[] = []) => {
    const ok =
      (await run(async () => {
        if (mode?.kind === 'edit') await source.editMessage(scope, mode.message.id, text);
        else {
          if (!upload.current) {
            const id = await sendNew(text || 'Archivo adjunto', mode?.kind === 'reply' ? mode.message.id : undefined);
            if (files.length) upload.current = { id, files, next: 0, version: 1 };
          }
          if (upload.current) {
            const current = new AbortController(); controller.current = current;
            try {
              const pending = upload.current;
              for (; pending.next < pending.files.length; pending.next++) {
                const file = pending.files[pending.next]!;
                setProgress({ name: file.name, done: 0, total: file.size });
                await source.attachResourceFile(chatTarget(scope), pending.id, file, pending.version, { signal: current.signal,
                  onProgress: (done, total) => setProgress({ name: file.name, done, total }) });
                pending.version++;
              }
              upload.current = null; setRetryingAttachments(false);
            } catch (failure) {
              if (current.signal.aborted) { upload.current = null; setRetryingAttachments(false); }
              else { setRetryingAttachments(true); throw failure; }
            } finally { controller.current = null; setProgress(null); }
          }
        }
        return true;
      })) ?? false;
    if (ok) setMode(undefined);
    return ok;
  };

  const extras = <>
    {progress && <p className="chat-transfer" role="status">Subiendo {progress.name}: {Math.round(progress.done / progress.total * 100)} % <ChatButton type="button" variant="tertiary" className="link-button" onClick={() => controller.current?.abort()}>Cancelar subida</ChatButton></p>}
    {retryingAttachments && <p className="chat-transfer" role="status">El mensaje ya se envió. Pulsa «Reintentar adjuntos» para continuar la misma subida sin duplicarlo.</p>}
    {report && <ReportMessageForm scope={scope} message={report} onClose={() => setReport(null)} />}
  </>;
  return { error: error ?? readAction.error, handlers, mode, onSend, onReadThrough, retryingAttachments, extras, cancel: () => setMode(undefined) };
}

export function ChannelThread() {
  const { channelId = '' } = useParams();
  const source = useDataSource();
  const { me, members, chatChannels, channelMessages, subjects } = useSnapshot();
  const { error, pending, run } = useAction();
  const thread = useThread('channel', channelId, (text, replyToId) => source.sendChannelMessage(channelId, text, replyToId));
  const channel = chatChannels.find((row) => row.id === channelId);
  const messages = useMemo(() => channelMessages.filter((message) => message.channelId === channelId), [channelMessages, channelId]);
  if (!channel) return <ThreadNotice title="Canal no disponible">No existe o no tienes acceso. <Link to="/m/mensajes/directos">Volver a las conversaciones</Link></ThreadNotice>;
  const label = channel.kind === 'subject' ? subjects.find((subject) => subject.id === channel.subjectId)?.name ?? 'Materia' : channel.kind === 'project' ? 'Proyecto' : 'Tema';
  const canArchive = me?.id === channel.createdBy || me?.isCreator;
  return <>
    <ThreadHeader avatar={<GroupAvatar name={channel.name} />} title={channel.name} subtitle={`${label} · lo ve todo el grupo${channel.archivedAt ? ' · Archivado' : ''}`} action={<div className="chat-thread-controls">
      <ConversationMute scope="channel" conversationId={channel.id} />
      {canArchive && <ChatButton type="button" variant="secondary" className="button secondary" disabled={pending} onClick={() => void run(() => source.setChatChannelArchived(channel.id, !channel.archivedAt))}>{channel.archivedAt ? 'Reabrir canal' : 'Archivar canal'}</ChatButton>}
    </div>} />
    <MessageList key={channel.id} messages={messages} members={members} meId={me?.id} showSenders scope="channel" handlers={thread.handlers} onReadThrough={thread.onReadThrough}
      empty={<ThreadNotice title="El canal está en silencio">Comparte el primer mensaje sobre {channel.name}.</ThreadNotice>} />
    {error && <p className="error" role="alert">{error}</p>}
    {thread.extras}
    {channel.archivedAt && <p className="chat-transfer">Canal archivado. Puedes consultar el historial y descargar sus adjuntos.</p>}
    <Composer key={`${me?.id}:canal:${channel.id}`} draftKey={`${me?.id}:canal:${channel.id}`} placeholder={`Escribe en ${channel.name}`} error={thread.error} onSend={thread.onSend} mode={thread.mode} onCancelMode={thread.cancel}
      attachments retryingAttachments={thread.retryingAttachments} disabled={Boolean(channel.archivedAt)} mentionMemberIds={members.filter((member) => member.status === 'active').map((member) => member.id)} />
  </>;
}

export function GroupThread() {
  const source = useDataSource();
  const { me, members, groupMessages } = useSnapshot();
  const thread = useThread('group', 'general', (text, replyToId) => source.sendGroupMessage(text, replyToId));
  const count = members.filter((m) => m.status === 'active').length;

  return (
    <>
      <ThreadHeader
        avatar={<GroupAvatar />}
        title={GROUP_NAME}
        subtitle={`${count} ${count === 1 ? 'integrante' : 'integrantes'} · lo ve todo el grupo`}
        action={<ConversationMute scope="group" conversationId="general" />}
      />
      <MessageList
        messages={groupMessages}
        members={members}
        meId={me?.id}
        showSenders
        scope="group"
        handlers={thread.handlers}
        onReadThrough={thread.onReadThrough}
        empty={
          <ThreadNotice title="El canal está en silencio">
            Escribe el primer mensaje para todo el salón.
          </ThreadNotice>
        }
      />
      {thread.extras}
      <Composer
        key={me?.id}
        draftKey={`${me?.id}:grupo`}
        placeholder="Escribe al grupo"
        error={thread.error}
        onSend={thread.onSend}
        mode={thread.mode}
        onCancelMode={thread.cancel}
        attachments
        retryingAttachments={thread.retryingAttachments}
        mentionMemberIds={members.filter((member) => member.status === 'active').map((member) => member.id)}
      />
    </>
  );
}

/** Panel derecho cuando estás en la lista sin abrir ninguna conversación (solo pantallas anchas). */
export function ThreadPlaceholder() {
  return (
    <ThreadNotice title="Elige una conversación">
      Abre una de la lista o entra al <Link to="/m/mensajes">canal del salón</Link>.
    </ThreadNotice>
  );
}

export function DirectThread() {
  const { conversationId = '' } = useParams();
  const source = useDataSource();
  const { me, members, directConversations, directMessages, blockedMembers } = useSnapshot();
  const { error, pending, run } = useAction();
  const thread = useThread('direct', conversationId, (text, replyToId) =>
    source.sendDirectMessage(conversationId, text, replyToId),
  );
  const conversation = directConversations.find((c) => c.id === conversationId);
  const messages = useMemo(
    () => directMessages.filter((m) => m.conversationId === conversationId),
    [directMessages, conversationId],
  );

  // Si no participas, la vista del servidor no la entrega: se trata igual que inexistente.
  if (!conversation) {
    return (
      <ThreadNotice title="Conversación no disponible">
        No existe o no participas en ella.{' '}
        <Link to="/m/mensajes/directos">Volver a tus conversaciones</Link>
      </ThreadNotice>
    );
  }

  const otherId = conversation.participantIds.find((id) => id !== me?.id) ?? '';
  const other = members.find((m) => m.id === otherId);
  const name = memberName(members, otherId);
  const draftKey = `${me?.id}:${conversation.id}`;
  const blocked = blockedMembers.some((row) => row.memberId === otherId);

  return (
    <>
      <ThreadHeader
        avatar={<ChatAvatar name={name} src={other?.photoUrl} size="sm" />}
        title={<Link to={`/perfil/${otherId}`}>{name}</Link>}
        subtitle={
          <>
            <Icon name="lock" size={13} /> Solo ustedes dos ven esta conversación
          </>
        }
        action={
          <div className="chat-thread-controls">
            <ConversationMute scope="direct" conversationId={conversation.id} />
            <ChatButton type="button" variant="secondary" className="button secondary" disabled={pending} aria-pressed={blocked} onClick={() => void run(() => source.setMemberBlocked(otherId, !blocked))}>{blocked ? 'Desbloquear' : 'Bloquear'}</ChatButton>
          </div>
        }
      />
      <MessageList
        key={conversation.id}
        messages={messages}
        members={members}
        meId={me?.id}
        showSenders={false}
        scope="direct"
        handlers={thread.handlers}
        onReadThrough={thread.onReadThrough}
        empty={
          <ThreadNotice title={`Saluda a ${name}`}>
            Todavía no se han escrito. Lo que envíes aquí queda entre ustedes dos.
          </ThreadNotice>
        }
      />
      {error && <p role="alert" className="error">{error}</p>}
      {blocked && <p className="chat-transfer">Bloqueaste a este compañero. El historial se conserva; desbloquéalo para volver a enviar mensajes.</p>}
      {thread.extras}
      <Composer
        key={draftKey}
        draftKey={draftKey}
        placeholder={`Escribe a ${name}`}
        error={thread.error}
        onSend={thread.onSend}
        mode={thread.mode}
        onCancelMode={thread.cancel}
        attachments
        retryingAttachments={thread.retryingAttachments}
        disabled={blocked}
        mentionMemberIds={conversation.participantIds}
      />
    </>
  );
}
