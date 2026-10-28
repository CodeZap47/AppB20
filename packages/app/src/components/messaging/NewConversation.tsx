import { useRef, useState, type FormEvent } from 'react';
import { Dialog, Heading, Menu, MenuItem, MenuTrigger, Modal, ModalOverlay, Popover } from 'react-aria-components';
import { useNavigate } from 'react-router';
import { useDataSource, useSnapshot } from '../../data/DataContext';
import { matches } from '../../lib/search';
import { Icon } from '../Icon';
import { useAction } from '../useAction';
import { ChatAvatar, ChatButton } from './Messaging';

type Mode = 'direct' | 'channel';

/** A small action menu keeps conversation creation separate from the current inbox. */
export function NewConversation({ mode, onModeChange }: { mode: Mode | null; onModeChange: (mode: Mode | null) => void }) {
  const trigger = useRef<HTMLSpanElement>(null);
  const close = () => {
    onModeChange(null);
    // The menu item that opened the dialog is removed with its popover.
    requestAnimationFrame(() => trigger.current?.querySelector('button')?.focus());
  };
  return <span className="messaging-create-control" ref={trigger}>
    <MenuTrigger>
      <ChatButton variant="tertiary" className="icon-button messaging-new-trigger" aria-label="Nueva conversación" title="Nueva conversación"><Icon name="plus" /></ChatButton>
      <Popover className="b20-messaging messaging-new-popover" placement="bottom end" offset={8}>
        <Menu aria-label="Nueva conversación" className="messaging-new-menu" onAction={(key) => onModeChange(key as Mode)}>
          <MenuItem id="direct" textValue="Mensaje directo" className="messaging-new-option"><Icon name="chat" /><span><strong>Mensaje directo</strong><small>Habla con un compañero</small></span><Icon name="forward" size={16} /></MenuItem>
          <MenuItem id="channel" textValue="Crear canal" className="messaging-new-option"><Icon name="users" /><span><strong>Crear canal</strong><small>Un espacio para todo el salón</small></span><Icon name="forward" size={16} /></MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
    {mode && <ConversationDialog key={mode} mode={mode} onClose={close} />}
  </span>;
}

function ConversationDialog({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const source = useDataSource();
  const navigate = useNavigate();
  const { me, members, directConversations, subjects } = useSnapshot();
  const { error, pending, run } = useAction();
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'subject' | 'topic' | 'project'>('topic');
  const [subjectId, setSubjectId] = useState('');
  const working = useRef(false);
  const people = members.filter((member) => member.status === 'active' && member.id !== me?.id && matches(query, member.displayName))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));
  const openDirect = async (memberId: string) => {
    if (working.current) return;
    working.current = true;
    try {
      const existing = directConversations.find((conversation) => conversation.participantIds.includes(memberId));
      const id = existing?.id ?? await run(() => source.openDirectConversation(memberId));
      if (!id) return;
      onClose();
      void navigate(`/m/mensajes/directos/${id}`);
    } finally { working.current = false; }
  };
  const createChannel = async (event: FormEvent) => {
    event.preventDefault();
    if (working.current || !name.trim() || (kind === 'subject' && !subjectId)) return;
    working.current = true;
    try {
      const id = await run(() => source.createChatChannel({ name: name.trim(), kind, subjectId: kind === 'subject' ? subjectId : undefined }));
      if (!id) return;
      onClose();
      void navigate(`/m/mensajes/canales/${id}`);
    } finally { working.current = false; }
  };
  return <ModalOverlay isOpen isDismissable={!pending} onOpenChange={(open) => { if (!open && !pending) onClose(); }} className="b20-messaging messaging-creation-overlay">
    <Modal className="messaging-creation-modal">
      <Dialog className="messaging-creation-dialog">
        <header className="messaging-creation-heading">
          <span className="messaging-creation-icon"><Icon name={mode === 'direct' ? 'chat' : 'users'} size={24} /></span>
          <ChatButton variant="tertiary" className="icon-button" aria-label="Cerrar" disabled={pending} onClick={onClose}><Icon name="close" /></ChatButton>
        </header>
        <Heading slot="title">{mode === 'direct' ? 'Nuevo mensaje' : 'Crear un canal'}</Heading>
        <p className="messaging-creation-description">{mode === 'direct' ? 'Elige a un compañero para empezar o retomar una conversación.' : 'Organiza una materia, un tema o un proyecto con el salón.'}</p>
        {mode === 'direct' ? <>
          <label className="messaging-people-search"><Icon name="search" size={18} /><input autoFocus type="search" aria-label="Buscar compañero" placeholder="Buscar por nombre" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <ul className="messaging-people" aria-label="Compañeros">
            {people.map((member) => <li key={member.id}><ChatButton variant="tertiary" disabled={pending} className="messaging-person" onClick={() => void openDirect(member.id)}>
              <ChatAvatar name={member.displayName} src={member.photoUrl} /><span><strong>{member.displayName}</strong><small>{directConversations.some((conversation) => conversation.participantIds.includes(member.id)) ? 'Continuar conversación' : 'Iniciar conversación'}</small></span><Icon name="forward" size={18} />
            </ChatButton></li>)}
          </ul>
          {!people.length && <p className="messaging-people-empty">{query ? `Sin compañeros con el nombre «${query.trim()}».` : 'Todavía no hay compañeros disponibles.'}</p>}
        </> : <form className="messaging-channel-fields" onSubmit={(event) => void createChannel(event)}>
          <label className="field"><span className="field__label">Nombre del canal</span><input autoFocus required maxLength={80} placeholder="Por ejemplo: Proyecto final" value={name} disabled={pending} onChange={(event) => setName(event.target.value)} /></label>
          <label className="field"><span className="field__label">Tipo de canal</span><select value={kind} disabled={pending} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="topic">Tema</option><option value="subject">Materia</option><option value="project">Proyecto</option></select></label>
          {kind === 'subject' && <label className="field"><span className="field__label">Materia</span><select value={subjectId} required disabled={pending} onChange={(event) => setSubjectId(event.target.value)}><option value="">Elige una materia</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>}
          <p className="messaging-visibility"><Icon name="users" size={16} />Todos los integrantes activos del salón podrán leerlo.</p>
          {error && <p role="alert" className="error">{error}</p>}
          <footer className="messaging-creation-actions"><ChatButton variant="secondary" disabled={pending} onClick={onClose}>Cancelar</ChatButton><ChatButton type="submit" loading={pending} disabled={!name.trim() || (kind === 'subject' && !subjectId)}>Crear canal</ChatButton></footer>
        </form>}
        {mode === 'direct' && error && <p role="alert" className="error">{error}</p>}
      </Dialog>
    </Modal>
  </ModalOverlay>;
}
