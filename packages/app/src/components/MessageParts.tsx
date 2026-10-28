import { useRef, useState } from 'react';
import { Button as AriaButton, Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { Dropdown } from '@b20-ui/components/base/dropdown/dropdown';
import { Tooltip } from '@b20-ui/components/base/tooltip/tooltip';
import { Link } from 'react-router';
import { REACTIONS } from '@b20/core';
import { useSnapshot } from '../data/DataContext';
import type { Id, MessageReaction } from '../data/types';
import { peopleList } from '../lib/format';
import { resolveReference, type LinkKind, type Reference } from '../lib/references';
import { ChatPostCard } from './ChatPostCard';
import { Icon, type IconName } from './Icon';
import { StickerImage } from './StickerImage';
import { ChatButton } from './messaging/Messaging';
import { EmojiPicker } from './EmojiPicker';
export { StickerImage } from './StickerImage';

const REF_ICON: Record<LinkKind, IconName> = {
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
  if (reference.kind === 'recurso') return <ChatPostCard target={reference.target} />;
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
  const groups = [...new Set(reactions.map((reaction) => reaction.emoji))].map((emoji) => ({
    emoji,
    people: reactions.filter((r) => r.emoji === emoji).map((r) => r.memberId),
  })).filter((g) => g.people.length > 0);
  return (
    <div className="reactions">
      {groups.map((g) => {
        const who = peopleList(g.people, members, meId);
        return (
          <ChatButton
            variant="tertiary"
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
          </ChatButton>
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

/** Menú de Untitled UI: foco, flechas, Escape y portales gestionados por React Aria. */
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
  const [confirming, setConfirming] = useState<MenuAction | null>(null);
  const [pickingEmoji, setPickingEmoji] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeConfirmation = () => {
    setConfirming(null);
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  return (
    <div className={mine ? 'msg-menu msg-menu--mine' : 'msg-menu'}>
      <Dropdown.Root>
        <Tooltip title="Opciones del mensaje">
          <AriaButton ref={buttonRef} type="button" className="msg-menu__button messaging-menu-trigger" aria-label="Opciones del mensaje">
            <Icon name="more" size={18} />
          </AriaButton>
        </Tooltip>
        <Dropdown.Popover className="b20-messaging messaging-menu-popover" placement={mine ? 'bottom end' : 'bottom start'}>
          <Dropdown.Menu aria-label="Opciones del mensaje">
            {onReact && <Dropdown.Section className="messaging-menu-reactions">
              <Dropdown.SectionHeader className="messaging-menu-heading">Reaccionar</Dropdown.SectionHeader>
              {REACTIONS.map((emoji) => (
                <Dropdown.Item
                  id={`reaction:${emoji}`}
                  key={emoji}
                  label={emoji}
                  selectionIndicator="none"
                  textValue={`Reaccionar con ${emoji}`}
                  aria-label={`Reaccionar con ${emoji}${myReaction === emoji ? ', tu reacción actual' : ''}`}
                  className={`messaging-reaction-option${myReaction === emoji ? ' is-selected' : ''}`}
                  onAction={() => onReact(emoji)}
                />
              ))}
            </Dropdown.Section>}
            {onReact && <Dropdown.Item id="more-reactions" label="Más reacciones" textValue="Más reacciones" onAction={() => setPickingEmoji(true)} />}
            {onReact && actions.length > 0 && <Dropdown.Separator />}
            <Dropdown.Section aria-label="Acciones">
              {actions.map((action) => (
                <Dropdown.Item
                  id={action.label}
                  key={action.label}
                  textValue={action.label}
                  className={action.danger ? 'messaging-menu-action messaging-menu-action--danger' : 'messaging-menu-action'}
                  onAction={() => action.confirm ? setConfirming(action) : action.onSelect()}
                >
                  <span className="messaging-menu-action__label"><Icon name={action.icon} size={16} />{action.label}</span>
                </Dropdown.Item>
              ))}
            </Dropdown.Section>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown.Root>
      {pickingEmoji && onReact && <EmojiPicker open onSelect={onReact} onClose={() => { setPickingEmoji(false); requestAnimationFrame(() => buttonRef.current?.focus()); }} />}
      <ModalOverlay isOpen={Boolean(confirming)} isDismissable onOpenChange={(open) => { if (!open) closeConfirmation(); }} className="b20-messaging messaging-confirm-overlay">
        <Modal className="messaging-confirm">
          <Dialog aria-label={confirming?.label ?? 'Confirmar acción'} className="messaging-confirm__dialog">
            <span className="messaging-confirm__icon" aria-hidden="true"><Icon name="trash" size={24} /></span>
            <h3>{confirming?.label} mensaje</h3>
            <p>{confirming?.confirm}</p>
            <div className="messaging-confirm__actions">
              <ChatButton variant="secondary" onClick={closeConfirmation} autoFocus>Cancelar</ChatButton>
              <ChatButton variant="danger" onClick={() => { const action = confirming; closeConfirmation(); action?.onSelect(); }}>{confirming?.label}</ChatButton>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}
