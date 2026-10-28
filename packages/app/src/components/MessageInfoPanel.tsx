import { useCallback, useSyncExternalStore } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { EMPTY_RECEIPT_INFO, type MessageReceipt } from '../data/messageReceiptTypes';
import type { MessageScope } from '../data/types';
import type { ChatMessage } from '../lib/messages';
import { memberName } from '../lib/format';
import { messagePreview } from '../lib/references';
import { ChatAvatar, ChatButton } from './messaging/Messaging';
import { Icon } from './Icon';
import './messaging/messageInfo.css';

const dateTime = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'medium' });
function When({ value }: { value: Date }) { return <time dateTime={value.toISOString()}>{dateTime.format(value)}</time>; }

export function MessageInfoPanel({ scope, message, onClose }: { scope: MessageScope; message: ChatMessage; onClose(): void }) {
  const source = useDataSource(); const { me, members } = useSnapshot();
  const subscribe = useCallback((listener: () => void) => source.messageReceipts?.subscribe(scope, message.id, listener) ?? (() => {}), [source, scope, message.id]);
  const getSnapshot = useCallback(() => source.messageReceipts?.getSnapshot(scope, message.id) ?? EMPTY_RECEIPT_INFO, [source, scope, message.id]);
  const info = useSyncExternalStore(subscribe, getSnapshot);
  if (!me || message.senderId !== me.id) return null;
  const groups: { title: string; icon: 'check' | 'send' | 'users'; rows: readonly MessageReceipt[]; kind: 'read' | 'delivered' | 'pending' }[] = [
    { title: 'Leído', icon: 'check', kind: 'read', rows: info.receipts.filter(row => row.readAt) },
    { title: 'Entregado', icon: 'send', kind: 'delivered', rows: info.receipts.filter(row => row.deliveredAt && !row.readAt) },
    { title: 'Pendiente de entrega', icon: 'users', kind: 'pending', rows: info.tracked ? info.receipts.filter(row => !row.deliveredAt && !row.readAt) : [] },
  ];
  return <ModalOverlay isOpen isDismissable onOpenChange={open => { if (!open) onClose(); }} className="b20-messaging message-info-overlay">
    <Modal className="message-info-modal"><Dialog className="message-info-panel">
      <header className="message-info-heading"><div><Heading slot="title">Información del mensaje</Heading><p>La hora se muestra en tu zona horaria.</p></div><ChatButton variant="tertiary" onClick={onClose} aria-label="Cerrar información del mensaje"><Icon name="close" /></ChatButton></header>
      <div className="message-info-preview"><p>{messagePreview(message)}</p><span>Enviado <When value={message.sentAt} /></span></div>
      <div className="message-info-content" aria-live="polite">
        {info.loading ? <p role="status">Consultando información…</p> : info.unavailable ? <p role="status">La información de este mensaje ya no está disponible.</p> : <>
          {!info.tracked && <p className="message-info-history"><strong>Sin registro anterior</strong><span>Este mensaje es anterior al seguimiento. Solo se muestran las nuevas confirmaciones disponibles.</span></p>}
          {groups.map(group => <section className={`message-info-group message-info-group--${group.kind}`} key={group.kind} aria-label={group.title}><h3><Icon name={group.icon} size={17} />{group.title}<span>{group.rows.length}</span></h3>
            {group.rows.length ? <ul>{group.rows.map(row => {
              const member = members.find(person => person.id === row.recipientId);
              const person = <><ChatAvatar name={memberName(members, row.recipientId)} src={member?.photoUrl} size="xs" /><span className="message-info-person"><strong>{memberName(members, row.recipientId)}</strong><span>{row.readAt ? <When value={row.readAt} /> : row.deliveredAt ? <When value={row.deliveredAt} /> : 'Aún no se confirma la recepción'}</span></span></>;
              return <li key={row.recipientId}>{row.readAt ? <details><summary>{person}<Icon name="down" size={14} /></summary><p>Entregado {row.deliveredAt ? <When value={row.deliveredAt} /> : 'Sin registro anterior'}</p></details> : <div className="message-info-recipient">{person}</div>}</li>;
            })}</ul> : <p className="message-info-empty">{group.kind === 'pending' && !info.tracked ? 'No hay datos anteriores de entrega.' : 'Sin destinatarios en este estado.'}</p>}
          </section>)}
        </>}
      </div>
    </Dialog></Modal>
  </ModalOverlay>;
}
