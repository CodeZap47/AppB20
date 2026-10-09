import {
  useEffect,
  useLayoutEffect,
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
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { MessageMenu, ReactionBar, RefCard, StickerImage, type MenuAction } from './MessageParts';
import { MessageText } from './MessageText';

/** Lo que se puede hacer con un mensaje desde la conversación. */
export interface MessageHandlers {
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onReact: (message: ChatMessage, emoji: string) => void;
}

/** Distancia al final (px) dentro de la cual se considera que sigues leyendo lo último. */
const NEAR_BOTTOM = 80;

export function MessageList({
  messages,
  members,
  meId,
  showSenders,
  empty,
  scope,
  handlers,
}: {
  messages: ChatMessage[];
  members: Member[];
  meId: Id | undefined;
  /** En el canal del grupo cada mensaje ajeno lleva foto y nombre; en un 1 a 1 no hace falta. */
  showSenders: boolean;
  empty: ReactNode;
  scope: MessageScope;
  handlers: MessageHandlers;
}) {
  const { me, reactions } = useSnapshot();
  const [flash, setFlash] = useState<Id | null>(null);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const domId = (id: Id) => `msg-${scope}-${id}`;

  // Ir al mensaje citado y resaltarlo un momento.
  const jumpTo = (id: Id) => {
    document.getElementById(domId(id))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        className={['msg', flash === m.id && 'msg--flash'].filter(Boolean).join(' ')}
      >
        <div
          className={['bubble', sticker && 'bubble--sticker', m.deletedAt && 'bubble--deleted']
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
          <span className="bubble__time">
            {m.editedAt && !m.deletedAt && <span className="bubble__edited">editado · </span>}
            <time dateTime={m.sentAt.toISOString()}>{formatClock(m.sentAt)}</time>
          </span>
        </div>
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
  const atBottom = useRef(true);
  const seenCount = useRef(messages.length);
  const [away, setAway] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const days = useMemo(() => groupByDay(messages), [messages]);
  const last = messages.at(-1);

  const toBottom = (smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    if (smooth && el.scrollTo) void el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight;
  };

  // Al llegar mensajes: baja solo si ya estabas al final o si lo escribiste tú; si estás
  // leyendo algo anterior, no te mueve y avisa cuántos hay nuevos.
  useLayoutEffect(() => {
    const added = messages.length - seenCount.current;
    seenCount.current = messages.length;
    if (added <= 0 || atBottom.current || last?.senderId === meId) {
      toBottom();
      setUnseen(0);
    } else {
      setUnseen((n) => n + added);
    }
  }, [messages.length, last?.id]);

  // Si cambia el alto disponible (crece el cuadro de texto, aparece el teclado), sigue al final.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
    atBottom.current = near;
    setAway(!near);
    if (near) setUnseen(0);
  };

  return (
    <div className="thread__body">
      <div
        className="thread__scroll"
        ref={scrollRef}
        onScroll={onScroll}
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
                      <Avatar member={members.find((m) => m.id === run.senderId)} size={32} />
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
      </div>
      {away && (
        <button type="button" className="thread__jump" onClick={() => toBottom(true)}>
          <Icon name="down" size={18} />
          {unseen > 0 ? (
            <span>{unseen === 1 ? '1 mensaje nuevo' : `${unseen} mensajes nuevos`}</span>
          ) : (
            <span className="sr-only">Ir al último mensaje</span>
          )}
        </button>
      )}
    </div>
  );
}
