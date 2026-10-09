import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { REACTIONS } from '@b20/core';
import { useSnapshot } from '../data/DataContext';
import type { Id, MessageReaction } from '../data/types';
import { peopleList } from '../lib/format';
import { resolveReference, type Reference } from '../lib/references';
import { Icon, type IconName } from './Icon';

const REF_ICON: Record<Exclude<Reference['kind'], 'sticker'>, IconName> = {
  tarea: 'folder',
  trabajo: 'upload',
  clase: 'users',
  nota: 'file',
  pregunta: 'chat',
};

/** Tarjeta de una tarea, trabajo, actividad, nota o pregunta citada en un mensaje. */
export function RefCard({ reference }: { reference: Reference }) {
  const data = useSnapshot();
  if (reference.kind === 'sticker') return <StickerImage id={reference.id} size={96} />;
  const ref = resolveReference(reference, data);
  if (!ref) {
    return (
      <span className="ref-card ref-card--missing">
        <Icon name="lock" size={16} /> Esta referencia ya no está disponible.
      </span>
    );
  }
  return (
    <Link to={ref.link} className="ref-card">
      <span className="ref-card__icon" aria-hidden="true">
        <Icon name={REF_ICON[ref.kind]} size={18} />
      </span>
      <span className="ref-card__body">
        <span className="ref-card__label">{ref.label}</span>
        <strong className="ref-card__title">{ref.title}</strong>
        {ref.context && <span className="ref-card__context">{ref.context}</span>}
      </span>
    </Link>
  );
}

export function StickerImage({ id, size = 140 }: { id: Id; size?: number }) {
  const { stickers } = useSnapshot();
  const sticker = stickers.find((s) => s.id === id);
  if (!sticker) {
    return <span className="sticker sticker--missing">Sticker no disponible</span>;
  }
  return (
    <img
      className="sticker"
      src={sticker.url}
      alt="Sticker"
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

/** Reacciones agrupadas por emoji; tocar una pone o quita la tuya. */
export function ReactionBar({
  reactions,
  meId,
  onToggle,
}: {
  reactions: MessageReaction[];
  meId: Id | undefined;
  onToggle: (emoji: string) => void;
}) {
  const { members } = useSnapshot();
  if (!reactions.length) return null;
  const groups = REACTIONS.map((emoji) => ({
    emoji,
    people: reactions.filter((r) => r.emoji === emoji).map((r) => r.memberId),
  })).filter((g) => g.people.length > 0);
  return (
    <div className="reactions">
      {groups.map((g) => {
        const who = peopleList(g.people, members, meId);
        return (
          <button
            key={g.emoji}
            type="button"
            className="reaction"
            aria-pressed={Boolean(meId && g.people.includes(meId))}
            title={who}
            aria-label={`${g.emoji} ${who}`}
            onClick={() => onToggle(g.emoji)}
          >
            <span aria-hidden="true">{g.emoji}</span>
            <span className="reaction__count" aria-hidden="true">
              {g.people.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export interface MenuAction {
  icon: IconName;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** Pide confirmar en el mismo menú antes de ejecutar. */
  confirm?: string;
}

/** Menú de un mensaje: reacciones rápidas y acciones. Se cierra al tocar fuera o con Esc. */
export function MessageMenu({
  mine,
  myReaction,
  onReact,
  actions,
}: {
  mine: boolean;
  myReaction: string | undefined;
  onReact?: (emoji: string) => void;
  actions: MenuAction[];
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<MenuAction | null>(null);
  // En la mitad de abajo de la pantalla el menú abre hacia arriba para no quedar cortado.
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setConfirming(null);
  }, [open]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div
      className={['msg-menu', mine && 'msg-menu--mine', up && 'msg-menu--up']
        .filter(Boolean)
        .join(' ')}
      ref={ref}
    >
      <button
        ref={buttonRef}
        type="button"
        className="msg-menu__button"
        aria-label="Opciones del mensaje"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const top = buttonRef.current?.getBoundingClientRect().top ?? 0;
          setUp(top > window.innerHeight / 2);
          setOpen(!open);
        }}
      >
        <Icon name="more" size={18} />
      </button>
      {open && (
        <div className="msg-menu__panel" role="menu">
          {confirming ? (
            <div className="msg-menu__confirm">
              <p>{confirming.confirm}</p>
              <div className="row">
                <button type="button" className="secondary" onClick={() => setConfirming(null)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => run(confirming.onSelect)}
                  autoFocus
                >
                  {confirming.label}
                </button>
              </div>
            </div>
          ) : (
            <>
              {onReact && (
                <div className="msg-menu__reactions" role="group" aria-label="Reaccionar">
                  {REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={myReaction === emoji}
                      aria-label={`Reaccionar con ${emoji}`}
                      onClick={() => run(() => onReact(emoji))}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  className={
                    action.danger ? 'msg-menu__item msg-menu__item--danger' : 'msg-menu__item'
                  }
                  onClick={() => (action.confirm ? setConfirming(action) : run(action.onSelect))}
                >
                  <Icon name={action.icon} size={18} /> {action.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
