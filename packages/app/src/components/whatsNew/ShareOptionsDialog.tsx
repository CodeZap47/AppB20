import { useState } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { FeedResourceRef } from '@b20/core';
import { useDataSource } from '../../data/DataContext';
import { Icon } from '../Icon';
import { SharePostDialog } from '../messaging/SharePostDialog';
import { ShareFeedDialog } from './ShareFeedDialog';
import '../messaging/sharing.css';

/** El destino interno no debe preparar ni publicar un enlace externo. */
export function ShareOptionsDialog({ target, onClose }: { target: FeedResourceRef; onClose: () => void }) {
  const source = useDataSource();
  const [method, setMethod] = useState<'chat' | 'external'>();
  if (method === 'chat') return <SharePostDialog target={target} onClose={onClose} />;
  if (method === 'external') return <ShareFeedDialog target={target} onClose={onClose} />;
  return <ModalOverlay className="chat-share-overlay" isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }}>
    <Modal className="chat-share-modal"><Dialog className="chat-share-dialog" aria-label="Compartir publicación">
      <header className="chat-share-heading"><Heading slot="title">Compartir publicación</Heading><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}><Icon name="close" size={18} /></button></header>
      <div className="chat-share-destinations">
        <button type="button" className="chat-share-destination" aria-label="Enviar a chat" disabled={typeof source.resolveChatPosts !== 'function'} onClick={() => setMethod('chat')}><Icon name="chat" /><span><strong>Enviar a chat</strong><small>Revisa la tarjeta en tu borrador antes de enviarla.</small></span><Icon name="forward" size={16} /></button>
        <button type="button" className="chat-share-destination" aria-label="Compartir enlace externo" disabled={typeof source.createFeedShare !== 'function'} onClick={() => setMethod('external')}><Icon name="forward" /><span><strong>Compartir enlace externo</strong><small>Crear un enlace para WhatsApp u otras aplicaciones.</small></span><Icon name="forward" size={16} /></button>
      </div>
    </Dialog></Modal>
  </ModalOverlay>;
}
