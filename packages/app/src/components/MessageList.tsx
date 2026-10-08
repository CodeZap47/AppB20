import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Id, Member } from '../data/types';
import { formatClock, formatDayLabel, hueOf, memberName } from '../lib/format';
import { groupByDay, type ChatMessage } from '../lib/messages';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { MessageText } from './MessageText';

/** Distancia al final (px) dentro de la cual se considera que sigues leyendo lo último. */
const NEAR_BOTTOM = 80;

export function MessageList({
  messages,
  members,
  meId,
  showSenders,
  empty,
}: {
  messages: ChatMessage[];
  members: Member[];
  meId: Id | undefined;
  /** En el canal del grupo cada mensaje ajeno lleva foto y nombre; en un 1 a 1 no hace falta. */
  showSenders: boolean;
  empty: ReactNode;
}) {
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
                    <Link to={`/perfil/${run.senderId}`} className="run__avatar" tabIndex={-1} aria-hidden="true">
                      <Avatar member={members.find((m) => m.id === run.senderId)} size={32} />
                    </Link>
                  )}
                  <div className="run__bubbles">
                    {withSender ? (
                      <Link to={`/perfil/${run.senderId}`} className="run__sender">
                        {memberName(members, run.senderId)}
                      </Link>
                    ) : (
                      <span className="sr-only">{mine ? 'Tú' : memberName(members, run.senderId)}</span>
                    )}
                    {run.messages.map((m) => (
                      <div key={m.id} className="bubble">
                        <div className="bubble__content">
                          <MessageText text={m.text} />
                        </div>
                        <time className="bubble__time" dateTime={m.sentAt.toISOString()}>
                          {formatClock(m.sentAt)}
                        </time>
                      </div>
                    ))}
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
