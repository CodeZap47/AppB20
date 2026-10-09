import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useMatch, useNavigate, useParams } from 'react-router';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { Avatar } from '../components/Avatar';
import { ChatToolsLinks, Composer, type ComposerMode } from '../components/Composer';
import { Icon } from '../components/Icon';
import { MessageList, type MessageHandlers } from '../components/MessageList';
import { useAction } from '../components/useAction';
import type { MessageScope } from '../data/types';
import { formatListTime, memberName } from '../lib/format';
import type { ChatMessage } from '../lib/messages';
import { messagePreview } from '../lib/references';
import { matches } from '../lib/search';

const GROUP_NAME = 'Canal del salón';

/**
 * Mensajes en dos paneles: la lista de conversaciones y la conversación abierta.
 * En pantallas angostas (celular, panel lateral de la extensión) se ve un panel a la vez:
 * `/m/mensajes/directos` es la lista y las demás rutas son una conversación.
 */
export function MessagesLayout() {
  const onList = useMatch('/m/mensajes/directos');
  return (
    <div className={onList ? 'chat chat--list' : 'chat chat--thread'}>
      <ConversationList />
      <section className="chat__thread" aria-label="Conversación">
        <Outlet />
      </section>
    </div>
  );
}

function GroupAvatar({ size = 40 }: { size?: number }) {
  return (
    <span className="avatar avatar--group" style={{ width: size, height: size }} aria-hidden="true">
      <Icon name="users" size={Math.round(size * 0.55)} />
    </span>
  );
}

function ConversationRow({
  to,
  end,
  avatar,
  name,
  last,
  preview,
}: {
  to: string;
  end?: boolean;
  avatar: ReactNode;
  name: string;
  last: ChatMessage | undefined;
  preview: string;
}) {
  return (
    <li>
      <NavLink to={to} end={end} className="conv">
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
          <span className="conv__preview">{preview}</span>
        </span>
      </NavLink>
    </li>
  );
}

function ConversationList() {
  const source = useDataSource();
  const navigate = useNavigate();
  const { me, members, groupMessages, directConversations, directMessages } = useSnapshot();
  const { error, run } = useAction();
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
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
  const nothing = !showGroup && !shownDirects.length && !showPeople;

  const start = (memberId: string) => {
    const id = run(() => source.openDirectConversation(memberId));
    if (!id) return;
    setPicking(false);
    setQuery('');
    void navigate(`/m/mensajes/directos/${id}`);
  };

  return (
    <aside className="chat__list" aria-label="Conversaciones">
      <header className="chat__list-header">
        <h1>Mensajes</h1>
        <button
          type="button"
          className="icon-button"
          aria-label={picking ? 'Cerrar la lista de compañeros' : 'Nueva conversación'}
          title={picking ? 'Cerrar' : 'Nueva conversación'}
          aria-expanded={picking}
          onClick={() => {
            setPicking(!picking);
            if (!picking) searchRef.current?.focus();
          }}
        >
          <Icon name={picking ? 'close' : 'plus'} />
        </button>
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
            />
          </ul>
        )}

        {(shownDirects.length > 0 || (!query && !picking)) && (
          <>
            <h2 className="chat__list-title">Directos</h2>
            {shownDirects.length ? (
              <ul className="convs">
                {shownDirects.map((d) => (
                  <ConversationRow
                    key={d.id}
                    to={`/m/mensajes/directos/${d.id}`}
                    avatar={<Avatar member={d.other} size={40} />}
                    name={d.name}
                    last={d.last}
                    preview={previewOf(d.last, false)}
                  />
                ))}
              </ul>
            ) : (
              <p className="muted chat__list-note">
                Aún no tienes conversaciones directas.{' '}
                <button type="button" className="link-button" onClick={() => setPicking(true)}>
                  Escríbele a un compañero
                </button>
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
                  <button type="button" className="conv" onClick={() => start(m.id)}>
                    <Avatar member={m} size={40} />
                    <span className="conv__main">
                      <strong className="conv__name">{m.displayName}</strong>
                      <span className="conv__preview">Escribirle por primera vez</span>
                    </span>
                  </button>
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
function useThread(scope: MessageScope, sendNew: (text: string, replyToId?: string) => unknown) {
  const source = useDataSource();
  const { me, members } = useSnapshot();
  const { error, run } = useAction();
  const [mode, setMode] = useState<ComposerMode | undefined>();

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
  };

  const onSend = (text: string) => {
    const ok =
      run(() => {
        if (mode?.kind === 'edit') source.editMessage(scope, mode.message.id, text);
        else sendNew(text, mode?.kind === 'reply' ? mode.message.id : undefined);
        return true;
      }) ?? false;
    if (ok) setMode(undefined);
    return ok;
  };

  return { error, handlers, mode, onSend, cancel: () => setMode(undefined) };
}

export function GroupThread() {
  const source = useDataSource();
  const { me, members, groupMessages } = useSnapshot();
  const thread = useThread('group', (text, replyToId) => source.sendGroupMessage(text, replyToId));
  const count = members.filter((m) => m.status === 'active').length;

  return (
    <>
      <ThreadHeader
        avatar={<GroupAvatar />}
        title={GROUP_NAME}
        subtitle={`${count} ${count === 1 ? 'integrante' : 'integrantes'} · lo ve todo el grupo`}
      />
      <MessageList
        messages={groupMessages}
        members={members}
        meId={me?.id}
        showSenders
        scope="group"
        handlers={thread.handlers}
        empty={
          <ThreadNotice title="El canal está en silencio">
            Escribe el primer mensaje para todo el salón.
          </ThreadNotice>
        }
      />
      <Composer
        key={me?.id}
        draftKey={`${me?.id}:grupo`}
        placeholder="Escribe al grupo"
        error={thread.error}
        onSend={thread.onSend}
        mode={thread.mode}
        onCancelMode={thread.cancel}
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
  const { me, members, directConversations, directMessages } = useSnapshot();
  const thread = useThread('direct', (text, replyToId) =>
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

  return (
    <>
      <ThreadHeader
        avatar={<Avatar member={other} size={40} />}
        title={<Link to={`/perfil/${otherId}`}>{name}</Link>}
        subtitle={
          <>
            <Icon name="lock" size={13} /> Solo ustedes dos ven esta conversación
          </>
        }
        action={
          <Link to={`/perfil/${otherId}`} className="button secondary thread__action">
            Ver perfil
          </Link>
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
        empty={
          <ThreadNotice title={`Saluda a ${name}`}>
            Todavía no se han escrito. Lo que envíes aquí queda entre ustedes dos.
          </ThreadNotice>
        }
      />
      <Composer
        key={draftKey}
        draftKey={draftKey}
        placeholder={`Escribe a ${name}`}
        error={thread.error}
        onSend={thread.onSend}
        mode={thread.mode}
        onCancelMode={thread.cancel}
      />
    </>
  );
}
