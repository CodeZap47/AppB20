import { useEffect, useRef, useState } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { useNavigate } from 'react-router';
import type { ChatPostPreview, ChatPostRef } from '@b20/core';
import { useDataSource, useSnapshot } from '../../data/DataContext';
import { matches } from '../../lib/search';
import { ChatAvatar, ChatButton } from './Messaging';
import { Icon } from '../Icon';
import './sharing.css';

export interface ChatPostShareIntent { id: string; memberId: string; target: ChatPostRef; }
export function ShareToChatButton({ target, label = 'Enviar a chat', className = '' }: {
  target: ChatPostRef; label?: string; className?: string;
}) {
  const { me, connection } = useSnapshot();
  const [open, setOpen] = useState<string>();
  useEffect(() => setOpen(undefined), [me?.id]);
  return <><button type="button" className={`chat-share-button ${className}`} disabled={connection !== 'ready' || me?.status !== 'active'} onClick={() => setOpen(me?.id)}><Icon name="forward" size={16} />{label}</button>
    {open && open === me?.id && <SharePostDialog target={target} onClose={() => setOpen(undefined)} />}</>;
}

/** Internal sharing resolves private app metadata, without creating public preview links. */
export function SharePostDialog({ target, onClose }: { target: ChatPostRef; onClose(): void }) {
  const source = useDataSource();
  const snapshot = useSnapshot();
  const { me, members, subjects, chatChannels, directConversations, blockedMembers } = snapshot;
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<ChatPostPreview>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const working = useRef(false);
  const alive = useRef(true);
  const actorId = me?.id;
  const enabled = snapshot.connection === 'ready' && me?.status === 'active';
  useEffect(() => {
    alive.current = true;
    let current = true; setLoading(true); setPreview(undefined); setError('');
    if (typeof source.resolveChatPosts !== 'function') { setLoading(false); setError('Actualiza la aplicación para compartir publicaciones.'); return; }
    void source.resolveChatPosts([target]).then((rows) => {
      if (current) setPreview(rows[0]);
    }).catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : 'No se pudo consultar la publicación.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; alive.current = false; };
  }, [source, target.kind, target.id, actorId, retry]);
  const ready = enabled && !loading && preview?.available === true;
  const choose = async (path: string, memberId?: string) => {
    if (!ready || !actorId || working.current) return;
    working.current = true; setPending(true); setError('');
    try {
      if (memberId) {
        const id = await source.openDirectConversation(memberId);
        path = `/m/mensajes/directos/${id}`;
      }
      if (!alive.current || source.getSnapshot().me?.id !== actorId || source.getSnapshot().me?.status !== 'active') return;
      const intent: ChatPostShareIntent = { id: crypto.randomUUID(), memberId: actorId, target };
      onClose();
      void navigate(path, { state: { chatPostShare: intent } });
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'No se pudo abrir la conversación.'); }
    finally { working.current = false; if (alive.current) setPending(false); }
  };
  const activeOthers = members.filter((member) => member.id !== actorId && member.status === 'active' && !blockedMembers.some((row) => row.memberId === member.id));
  const directs = directConversations.flatMap((conversation) => {
    const other = activeOthers.find((member) => conversation.participantIds.includes(member.id));
    return other ? [{ id: conversation.id, other }] : [];
  });
  const people = activeOthers.filter((member) => !directs.some((chat) => chat.other.id === member.id) && matches(query, member.displayName));
  const destinations = [
    { id: 'general', label: 'Canal del salón', hint: 'Todo el salón', path: '/m/mensajes', name: 'Canal Salón' },
    ...chatChannels.filter((channel) => !channel.archivedAt).map((channel) => ({ id: `channel:${channel.id}`, label: channel.name, hint: ['Canal', subjects.find(subject => subject.id === channel.subjectId)?.name].filter(Boolean).join(' · '), path: `/m/mensajes/canales/${channel.id}`, name: channel.name })),
    ...directs.map((chat) => ({ id: `direct:${chat.id}`, label: chat.other.displayName, hint: 'Mensaje directo', path: `/m/mensajes/directos/${chat.id}`, name: chat.other.displayName })),
  ].filter((row) => matches(query, row.label, row.hint));
  return <ModalOverlay isOpen isDismissable={!pending} onOpenChange={(open) => { if (!open && !pending) onClose(); }} className="b20-messaging chat-share-overlay">
    <Modal className="chat-share-modal"><Dialog className="chat-share-dialog">
      <header className="chat-share-heading"><div><Heading slot="title">Enviar publicación a un chat</Heading><p>Elige dónde revisarla antes de enviarla.</p></div><ChatButton variant="tertiary" aria-label="Cerrar envío a chat" disabled={pending} onClick={onClose}><Icon name="close" /></ChatButton></header>
      {loading ? <p role="status">Consultando publicación…</p> : preview?.available ? <article className="chat-share-preview"><span>{preview.kindLabel}{preview.subject ? ` · ${preview.subject}` : ''}</span><strong>{preview.title}</strong>{preview.description && <p>{preview.description}</p>}</article> : <p className="chat-share-unavailable" role="status">Publicación no disponible para compartir. Comprueba su visibilidad en el módulo de origen.</p>}
      <label className="chat-share-search"><Icon name="search" size={18} /><input autoFocus type="search" aria-label="Buscar chat o compañero" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar conversación o compañero" /></label>
      <div className="chat-share-destinations"><h3>Conversaciones</h3><ul>{destinations.map((row) => <li key={row.id}><ChatButton variant="tertiary" className="chat-share-destination" aria-label={`Compartir en ${row.label}`} disabled={!ready || pending} onClick={() => void choose(row.path)}><ChatAvatar name={row.name} /><span><strong>{row.label}</strong><small>{row.hint}</small></span><Icon name="forward" size={16} /></ChatButton></li>)}</ul>
        {people.length > 0 && <><h3>Iniciar un mensaje directo</h3><ul>{people.map((person) => <li key={person.id}><ChatButton variant="tertiary" className="chat-share-destination" aria-label={`Iniciar chat con ${person.displayName}`} disabled={!ready || pending} onClick={() => void choose('', person.id)}><ChatAvatar name={person.displayName} src={person.photoUrl} /><span><strong>{person.displayName}</strong><small>Nuevo mensaje directo</small></span><Icon name="forward" size={16} /></ChatButton></li>)}</ul></>}
        {!destinations.length && !people.length && <p>No hay conversaciones o compañeros con ese nombre.</p>}
      </div>
      {pending && <p role="status">Abriendo conversación…</p>}{error && <div><p role="alert" className="error">{error}</p>{!preview?.available && <ChatButton variant="secondary" disabled={loading || pending} onClick={() => setRetry(value => value + 1)}>Reintentar consulta</ChatButton>}</div>}
      <p className="chat-share-note">La tarjeta se añadirá a tu borrador. Compartir respeta los permisos de la publicación.</p>
    </Dialog></Modal>
  </ModalOverlay>;
}
