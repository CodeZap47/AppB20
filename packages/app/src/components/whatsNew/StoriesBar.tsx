import { Link } from 'react-router';
import type { Assignment, Birthday, Id, Member } from '../../data/types';
import { memberName } from '../../lib/format';
import type { unreadMessages } from '../../lib/whatsNew';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { dueLabel } from './shared';

interface Props {
  meId: Id | undefined;
  members: Member[];
  celebrating: Birthday[];
  messages: ReturnType<typeof unreadMessages>;
  due: { assignment: Assignment; inDays: number }[];
}

/**
 * Lo urgente en burbujas, como las historias de una red social: cumpleaños de hoy, chats con
 * mensajes nuevos y entregas próximas. Cada burbuja lleva a su módulo.
 */
export function StoriesBar({ meId, members, celebrating, messages, due }: Props) {
  const member = (id: Id) => members.find((m) => m.id === id);
  const stories = [
    ...celebrating.map((b) => (
      <Link key={`b${b.memberId}`} to={b.memberId === meId ? '/m/cumpleanos' : `/perfil/${b.memberId}`} className="story story--birthday">
        <span className="story__ring"><Avatar member={member(b.memberId)} size={52} /></span>
        <span className="story__badge" aria-hidden="true">🎂</span>
        <span className="story__label">{b.memberId === meId ? '¡Tu cumple!' : memberName(members, b.memberId)}</span>
      </Link>
    )),
    ...(messages.group > 0 ? [(
      <Link key="group" to="/m/mensajes" className="story story--unread">
        <span className="story__ring"><span className="avatar avatar--group story__icon"><Icon name="users" size={22} /></span></span>
        <span className="story__count">{messages.group}</span>
        <span className="story__label">Canal del salón</span>
      </Link>
    )] : []),
    ...messages.direct.map((d) => (
      <Link key={`d${d.conversation.id}`} to={`/m/mensajes/directos/${d.conversation.id}`} className="story story--unread">
        <span className="story__ring"><Avatar member={member(d.otherId)} size={52} /></span>
        <span className="story__count">{d.count}</span>
        <span className="story__label">{memberName(members, d.otherId)}</span>
      </Link>
    )),
    ...messages.channels.map(({ channel, count }) => (
      <Link key={`c${channel.id}`} to={`/m/mensajes/canales/${channel.id}`} className="story story--unread">
        <span className="story__ring"><span className="avatar avatar--group story__icon"><Icon name="chat" size={22} /></span></span>
        <span className="story__count">{count}</span>
        <span className="story__label">{channel.name}</span>
      </Link>
    )),
    ...due.map(({ assignment, inDays }) => (
      <Link key={`t${assignment.id}`} to={`/m/tareas/${assignment.id}`} className={inDays <= 1 ? 'story story--due story--soon' : 'story story--due'}>
        <span className="story__ring"><span className="story__due">{dueLabel(inDays)}</span></span>
        <span className="story__label">{assignment.title}</span>
      </Link>
    )),
  ];
  if (!stories.length) return null;
  return (
    <nav className="stories" aria-label="Lo urgente de hoy">
      {stories}
    </nav>
  );
}
