import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';
import { canDeleteMessage, canEditMessage } from '@b20/core';
import { useSnapshot } from '../data/DataContext';
import type { Id, Member, MessageScope } from '../data/types';
import { formatClock, formatDayLabel, hueOf, memberName } from '../lib/format';
import { groupByDay, type ChatMessage } from '../lib/messages';
import { messagePreview, referencesIn, stickerOnly, stripReferences } from '../lib/references';
import { ChatAvatar, ChatBubble, ChatButton } from './messaging/Messaging';
import { Icon } from './Icon';
import { MessageMenu, ReactionBar, RefCard, StickerImage, type MenuAction } from './MessageParts';
import { MessageText } from './MessageText';
import { ResourceDownloads } from './AcademicTools';
import { chatTarget } from '../lib/chat';
import { useVisibleMessageReceipts } from '../lib/useVisibleMessageReceipts';
import { MessageInfoPanel } from './MessageInfoPanel';
import { useReadingScroll } from '../lib/useReadingScroll';

/** Lo que se puede hacer con un mensaje desde la conversación. */
export interface MessageHandlers {
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onReact: (message: ChatMessage, emoji: string) => void;
  onReport?: (message: ChatMessage) => void;
}

export function MessageList({
  messages,
  members,
  meId,
  showSenders,
  empty,
  scope,
  handlers,
  onReadThrough,
  conversationId = 'general',
  composerHidden = false,
  composerLocked = false,
  onComposerVisibilityChange,
}: {
  messages: ChatMessage[];
  members: Member[];
  meId: Id | undefined;
  /** En el canal del grupo cada mensaje ajeno lleva foto y nombre; en un 1 a 1 no hace falta. */
  showSenders: boolean;
  empty: ReactNode;
  scope: MessageScope;
  handlers: MessageHandlers;
  conversationId?: Id;
  /** Cursor de compatibilidad para los mensajes anteriores al seguimiento. */
  onReadThrough?: (messageId: Id) => void;
  composerHidden?: boolean;
  composerLocked?: boolean;
  onComposerVisibilityChange?: (hidden: boolean, focus?: boolean, history?: HTMLElement) => boolean | void;
}) {
  const { me, reactions, resourceFiles } = useSnapshot();
  const [infoId, setInfoId] = useState<Id | null>(null);
  const [flash, setFlash] = useState<Id | null>(null);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const domId = (id: Id) => `msg-${scope}-${id}`;

  // Ir al mensaje citado y resaltarlo un momento.
  const jumpTo = (id: Id) => {
    const node = document.getElementById(domId(id));
    if (node) reading.quote(node);
    setFlash(id);
    window.setTimeout(() => setFlash((current) => (current === id ? null : current)), 1600);
  };

  const renderMessage = (m: ChatMessage, mine: boolean) => {
    const now = new Date();
    const sticker = m.deletedAt ? undefined : stickerOnly(m.text);
    const refs = m.deletedAt || sticker ? [] : referencesIn(m.text);
    const text = m.deletedAt || sticker ? '' : stripReferences(m.text);
    const own = reactions.filter((r) => r.scope === scope && r.messageId === m.id);
    const replied = m.replyToId ? byId.get(m.replyToId) : undefined;
    const actions: MenuAction[] = [];
    if (!m.deletedAt) {
      if (mine) actions.push({ icon: 'info', label: 'Información del mensaje', onSelect: () => setInfoId(m.id) });
      actions.push({ icon: 'reply', label: 'Responder', onSelect: () => handlers.onReply(m) });
      if (text && typeof navigator !== 'undefined' && navigator.clipboard) {
        actions.push({
          icon: 'copy',
          label: 'Copiar texto',
          onSelect: () => void navigator.clipboard.writeText(text),
        });
      }
      if (meId && !sticker && canEditMessage(meId, m, now)) {
        actions.push({ icon: 'edit', label: 'Editar', onSelect: () => handlers.onEdit(m) });
      }
      if (meId && canDeleteMessage(meId, m, scope, Boolean(me?.isCreator))) {
        actions.push({
          icon: 'trash',
          label: 'Eliminar',
          danger: true,
          confirm: mine
            ? '¿Eliminar para todos? Se verá que había un mensaje aquí.'
            : 'Como administrador, ¿quitar este mensaje del canal para todos?',
          onSelect: () => handlers.onDelete(m),
        });
      }
      if (!mine && handlers.onReport) actions.push({ icon: 'lock', label: 'Reportar mensaje', onSelect: () => handlers.onReport?.(m) });
    }
    const deletedLabel =
      m.deletedBy && m.deletedBy !== m.senderId
        ? 'Un administrador quitó este mensaje'
        : mine
          ? 'Eliminaste este mensaje'
          : 'Se eliminó este mensaje';

    return (
      <div
        key={m.id}
        id={domId(m.id)}
        data-message-id={m.id}
        className={['msg', flash === m.id && 'msg--flash'].filter(Boolean).join(' ')}
      >
        <ChatBubble
          className={['bubble', 'messaging-bubble', sticker && 'bubble--sticker', m.deletedAt && 'bubble--deleted']
            .filter(Boolean)
            .join(' ')}
        >
          {m.replyToId && (
            <button
              type="button"
              className="quote"
              onClick={() => replied && jumpTo(replied.id)}
              disabled={!replied}
            >
              <span className="quote__name">
                {replied
                  ? replied.senderId === meId
                    ? 'Tú'
                    : memberName(members, replied.senderId)
                  : 'Mensaje'}
              </span>
              <span className="quote__text">
                {replied ? messagePreview(replied) : 'Ya no está en esta conversación'}
              </span>
            </button>
          )}
          <div className="bubble__content">
            {m.deletedAt ? (
              <p className="bubble__text bubble__deleted">
                <Icon name="trash" size={14} /> {deletedLabel}
              </p>
            ) : sticker ? (
              <StickerImage id={sticker} />
            ) : (
              <>
                {text && <MessageText text={text} />}
                {refs.length > 0 && (
                  <div className="bubble__refs">
                    {refs.map((r) => (
                      <RefCard key={`${r.kind}:${r.id}`} reference={r} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          {!m.deletedAt && <ResourceDownloads files={resourceFiles.filter((file) => file.targetKind === chatTarget(scope) && file.targetId === m.id && !file.removedAt)} />}
          <span className="bubble__time">
            {m.editedAt && !m.deletedAt && <span className="bubble__edited">editado · </span>}
            <time dateTime={m.sentAt.toISOString()}>{formatClock(m.sentAt)}</time>
          </span>
        </ChatBubble>
        {!m.deletedAt && (
          <MessageMenu
            mine={mine}
            myReaction={own.find((r) => r.memberId === meId)?.emoji}
            onReact={(emoji) => handlers.onReact(m, emoji)}
            actions={actions}
          />
        )}
        <ReactionBar reactions={own} meId={meId} onToggle={(emoji) => handlers.onReact(m, emoji)} />
      </div>
    );
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => groupByDay(messages), [messages]);
  const last = messages.at(-1);
  const reading = useReadingScroll({ root: scrollRef, spacer: spacerRef, identity: `${meId}:${scope}:${conversationId}`,
    hidden: composerHidden, locked: composerLocked, changeVisibility: onComposerVisibilityChange,
    count: messages.length, lastId: last?.id, own: Boolean(meId && last?.senderId === meId) });
  const { away, unseen } = reading;
  const infoMessage = infoId ? byId.get(infoId) : undefined;
  useVisibleMessageReceipts({ scope, conversationId, messages, root: scrollRef, enabled: !infoMessage, onLegacyRead: onReadThrough });

  return (
    <div className="thread__body">
      <div
        className="thread__scroll"
        ref={scrollRef}
        role="log"
        aria-label="Mensajes"
        tabIndex={0}
      >
        {days.length === 0 && <div className="thread__empty">{empty}</div>}
        {days.map((day) => (
          <section key={day.key} className="day">
            <h3 className="day__label">
              <span>{formatDayLabel(day.date)}</span>
            </h3>
            {day.runs.map((run) => {
              const mine = run.senderId === meId;
              const withSender = showSenders && !mine;
              return (
                <div
                  key={run.key}
                  className={mine ? 'run run--mine' : 'run'}
                  style={{ '--hue': hueOf(run.senderId) } as CSSProperties}
                >
                  {withSender && (
                    <Link
                      to={`/perfil/${run.senderId}`}
                      className="run__avatar"
                      tabIndex={-1}
                      aria-hidden="true"
                    >
                      <ChatAvatar
                        name={memberName(members, run.senderId)}
                        src={members.find((m) => m.id === run.senderId)?.photoUrl}
                        size="xs"
                      />
                    </Link>
                  )}
                  <div className="run__bubbles">
                    {withSender ? (
                      <Link to={`/perfil/${run.senderId}`} className="run__sender">
                        {memberName(members, run.senderId)}
                      </Link>
                    ) : (
                      <span className="sr-only">
                        {mine ? 'Tú' : memberName(members, run.senderId)}
                      </span>
                    )}
                    {run.messages.map((m) => renderMessage(m, mine))}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
        <div ref={spacerRef} data-reading-spacer aria-hidden="true" style={{ flex: '0 0 auto', overflowAnchor: 'none' }} />
      </div>
      {infoMessage && !infoMessage.deletedAt && <MessageInfoPanel scope={scope} message={infoMessage} onClose={() => setInfoId(null)} />}
      {(away || composerHidden) && <div className="thread__navigation" style={{ position: 'absolute', right: '1rem', bottom: '.75rem', display: 'flex', flexWrap: 'wrap', maxWidth: 'calc(100% - 2rem)', justifyContent: 'flex-end', gap: 8, alignItems: 'center', zIndex: 2 }}>
        {composerHidden && <ChatButton variant="secondary" type="button" className="thread__jump" style={{ position: 'static' }} onClick={reading.showComposer}><Icon name="edit" size={16} /><span>Escribir mensaje</span></ChatButton>}
        {away && <ChatButton variant="secondary" type="button" className="thread__jump" style={{ position: 'static' }} onClick={() => reading.latest(true)}>
          <Icon name="down" size={18} />
          {unseen > 0 ? (
            <span>{unseen === 1 ? '1 mensaje nuevo' : `${unseen} mensajes nuevos`}</span>
          ) : (
            <span className="sr-only">Ir al último mensaje</span>
          )}
        </ChatButton>}
      </div>}
    </div>
  );
}
