import { NavLink, useNavigate, useParams } from 'react-router';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { Composer } from '../components/Composer';
import { MessageList } from '../components/MessageList';
import { useAction } from '../components/useAction';
import { memberName } from '../lib/format';

function Tabs() {
  return (
    <nav className="tabs" aria-label="Bandejas">
      <NavLink to="/m/mensajes" end className="tabs__link">
        Grupo
      </NavLink>
      <NavLink to="/m/mensajes/directos" className="tabs__link">
        Directos
      </NavLink>
    </nav>
  );
}

export function GroupChatPage() {
  const source = useDataSource();
  const { me, members, groupMessages } = useSnapshot();
  const { error, run } = useAction();

  return (
    <>
      <h1>Mensajes</h1>
      <Tabs />
      <p className="muted">Canal del salón: lo ven todos los compañeros del grupo.</p>
      <MessageList
        messages={groupMessages}
        members={members}
        meId={me?.id}
        empty="Todavía no hay mensajes en el canal."
      />
      {error && <p className="error">{error}</p>}
      <Composer
        placeholder="Escribe al grupo"
        onSend={(text) => run(() => (source.sendGroupMessage(text), true)) ?? false}
      />
    </>
  );
}

export function DirectInboxPage() {
  const source = useDataSource();
  const navigate = useNavigate();
  const { me, members, directConversations, directMessages } = useSnapshot();
  const { error, run } = useAction();
  const others = members.filter((m) => m.id !== me?.id && m.status === 'active');

  const lastMessage = (conversationId: string) =>
    directMessages.filter((m) => m.conversationId === conversationId).at(-1);

  return (
    <>
      <h1>Mensajes</h1>
      <Tabs />
      <p className="muted">Solo tú y la otra persona ven cada conversación.</p>

      {directConversations.length ? (
        <ul className="list">
          {directConversations.map((c) => {
            const otherId = c.participantIds.find((id) => id !== me?.id) ?? '';
            const last = lastMessage(c.id);
            return (
              <li key={c.id}>
                <NavLink to={`/m/mensajes/directos/${c.id}`} className="list__item">
                  <strong>{memberName(members, otherId)}</strong>
                  <span className="muted">{last ? last.text : 'Sin mensajes'}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">No tienes conversaciones directas.</p>
      )}

      <label className="field">
        Nueva conversación con
        <select
          value=""
          onChange={(e) => {
            const id = run(() => source.openDirectConversation(e.target.value));
            if (id) void navigate(`/m/mensajes/directos/${id}`);
          }}
        >
          <option value="" disabled>
            Elige a un compañero
          </option>
          {others.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
    </>
  );
}

export function DirectConversationPage() {
  const { conversationId = '' } = useParams();
  const source = useDataSource();
  const { me, members, directConversations, directMessages } = useSnapshot();
  const { error, run } = useAction();
  const conversation = directConversations.find((c) => c.id === conversationId);

  // Si no participas, la vista del servidor no la entrega: se trata igual que inexistente.
  if (!conversation) {
    return (
      <>
        <h1>Conversación no disponible</h1>
        <NavLink to="/m/mensajes/directos">Volver a tus conversaciones</NavLink>
      </>
    );
  }

  const otherId = conversation.participantIds.find((id) => id !== me?.id) ?? '';
  return (
    <>
      <NavLink to="/m/mensajes/directos" className="back">
        ← Directos
      </NavLink>
      <h1>{memberName(members, otherId)}</h1>
      <MessageList
        messages={directMessages.filter((m) => m.conversationId === conversation.id)}
        members={members}
        meId={me?.id}
        empty="Escribe el primer mensaje."
      />
      {error && <p className="error">{error}</p>}
      <Composer
        placeholder="Escribe un mensaje"
        onSend={(text) => run(() => (source.sendDirectMessage(conversation.id, text), true)) ?? false}
      />
    </>
  );
}
