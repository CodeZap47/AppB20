import { Link } from 'react-router';
import type { Assignment, Birthday, Id, Member, Subject } from '../../data/types';
import { memberName, peopleList } from '../../lib/format';
import type { unreadMessages } from '../../lib/whatsNew';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { dueLabel } from './shared';

interface Props {
  meId: Id | undefined;
  members: Member[];
  subjects: Subject[];
  celebrating: Birthday[];
  messages: ReturnType<typeof unreadMessages>;
  due: { assignment: Assignment; inDays: number }[];
}

/** Cumpleaños, mensajes nuevos y entregas de la semana; la comparten las dos vistas. */
export function NewsSidebar({ meId, members, subjects, celebrating, messages, due }: Props) {
  return (
    <aside className="detail__side">
      {celebrating.length > 0 && (
        <section className="panel news-birthday">
          <span className="news-birthday__emoji" aria-hidden="true">
            🎂
          </span>
          <p>
            Hoy {celebrating.length === 1 ? 'cumple' : 'cumplen'}{' '}
            <strong>{peopleList(celebrating.map((b) => b.memberId), members, meId)}</strong>.{' '}
            {celebrating.length === 1 && celebrating[0]!.memberId !== meId ? (
              <Link to={`/perfil/${celebrating[0]!.memberId}`}>Ver perfil</Link>
            ) : (
              <Link to="/m/cumpleanos">Ver cumpleaños</Link>
            )}
          </p>
        </section>
      )}

      <section className="panel">
        <h2 className="label">Mensajes nuevos</h2>
        <p className="muted">Solo tus conversaciones. No se muestra el contenido de los mensajes.</p>
        {messages.group === 0 && messages.direct.length === 0 && messages.channels.length === 0 ? (
          <p className="muted">No tienes mensajes nuevos.</p>
        ) : (
          <ul className="links">
            {messages.group > 0 && (
              <li>
                <Link to="/m/mensajes" className="news-link">
                  <span className="avatar avatar--group news-link__icon" aria-hidden="true">
                    <Icon name="users" size={16} />
                  </span>
                  <span className="news-link__text">Canal del salón</span>
                  <span className="news-count">{messages.group}</span>
                </Link>
              </li>
            )}
            {messages.direct.map((d) => (
              <li key={d.conversation.id}>
                <Link to={`/m/mensajes/directos/${d.conversation.id}`} className="news-link">
                  <Avatar member={members.find((m) => m.id === d.otherId)} size={28} />
                  <span className="news-link__text">{memberName(members, d.otherId)}</span>
                  <span className="news-count">{d.count}</span>
                </Link>
              </li>
            ))}
            {messages.channels.map(({ channel, count }) => (
              <li key={channel.id}>
                <Link to={`/m/mensajes/canales/${channel.id}`} className="news-link">
                  <Icon name="chat" size={18} />
                  <span className="news-link__text">{channel.name}</span>
                  <span className="news-count">{count}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2 className="label">Entregas de esta semana</h2>
        {due.length === 0 ? (
          <p className="muted">Nada que entregar en los próximos 7 días.</p>
        ) : (
          <ul className="links">
            {due.map(({ assignment, inDays }) => (
              <li key={assignment.id}>
                <Link to={`/m/tareas/${assignment.id}`} className="news-link">
                  <span className="news-link__text">
                    <strong>{assignment.title}</strong>
                    <span className="muted">{subjects.find((s) => s.id === assignment.subjectId)?.name}</span>
                  </span>
                  <span className={inDays <= 1 ? 'news-due news-due--soon' : 'news-due'}>{dueLabel(inDays)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link to="/modulos" className="news-modules">
        Ver todos los módulos
      </Link>
    </aside>
  );
}
