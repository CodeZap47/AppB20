import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay, Popover } from 'react-aria-components';
import { useSnapshot } from '../../data/DataContext';
import { ChatAvatar } from './Messaging';
import { Icon } from '../Icon';
import './onlineMembers.css';

function useCompactPresence() {
  const [compact, setCompact] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 650px)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(max-width: 650px)');
    const update = () => setCompact(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}

/** Membership and foreground presence are separate; a person appears only once. */
export function OnlineMembers() {
  const { members, me, connection, onlineMemberIds } = useSnapshot();
  const [open, setOpen] = useState(false);
  const compact = useCompactPresence();
  const ready = connection === 'ready';
  const lastTotal = useRef<number | undefined>(undefined);
  const people = [...new Map(members.filter(member => member.status === 'active').map(member => [member.id, member])).values()];
  if (ready) lastTotal.current = people.length;
  const count = ready ? people.length : lastTotal.current;
  const ids = new Set(onlineMemberIds ?? []);
  const online = ready ? people.filter(member => ids.has(member.id)).sort((a, b) =>
    a.id === me?.id ? -1 : b.id === me?.id ? 1 : a.displayName.localeCompare(b.displayName, 'es')) : [];
  const totalLabel = count === undefined ? 'Integrantes' : `${count} ${count === 1 ? 'integrante' : 'integrantes'}`;
  const statusLabel = ready ? `${online.length} ${online.length === 1 ? 'activo' : 'activos'}` : connection === 'offline' ? 'Sin conexión' : 'Conectando…';
  const label = `${totalLabel} · ${statusLabel}`;
  const contents = <Dialog className="online-members-dialog">
    <header className="online-members-heading"><div><Heading slot="title">Integrantes activos</Heading><p>Ahora en B20</p></div>
      <Button className="online-members-close" aria-label="Cerrar integrantes activos" onPress={() => setOpen(false)}><Icon name="close" size={18} /></Button>
    </header>
    <p className="online-members-status" aria-live="polite" aria-atomic="true">{ready ? `${online.length} ${online.length === 1 ? 'persona activa' : 'personas activas'}` : statusLabel}</p>
    {!ready ? <p className="online-members-empty" role="status">{connection === 'offline' ? 'La lista se actualizará cuando recuperes la conexión.' : 'Consultando integrantes activos…'}</p>
      : online.length ? <ul className="online-members-list" aria-label="Integrantes activos ahora">{online.map(member => <li key={member.id}>
        <span className="online-members-avatar"><ChatAvatar name={member.displayName} src={member.photoUrl} /><span aria-hidden="true" /></span>
        <span className="online-members-name">{member.displayName}{member.id === me?.id && <small>Tú</small>}</span>
        <span className="online-members-person-state">Activo</span>
      </li>)}</ul> : <p className="online-members-empty" role="status">No hay integrantes activos</p>}
  </Dialog>;
  return <DialogTrigger isOpen={open} onOpenChange={setOpen}>
    <Button className="online-members-trigger" isDisabled={!ready} aria-label={`Ver integrantes activos: ${label}`}>
      <span>{totalLabel}</span><span aria-hidden="true">·</span><span className="online-members-count" aria-live="polite" aria-atomic="true"><span className={ready ? 'online-members-dot' : 'online-members-dot online-members-dot--offline'} aria-hidden="true" />{statusLabel}</span><Icon name="down" size={12} />
    </Button>
    {compact ? <ModalOverlay isDismissable className="b20-messaging online-members-overlay"><Modal className="online-members-modal">{contents}</Modal></ModalOverlay>
      : <Popover className="b20-messaging online-members-popover" placement="bottom start" offset={8}>{contents}</Popover>}
  </DialogTrigger>;
}
