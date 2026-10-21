import { Link } from 'react-router';
import type { Member, Subject } from '../../data/types';
import { formatClock, memberName } from '../../lib/format';
import { NEWS_LABEL, type NewsItem } from '../../lib/whatsNew';
import { Avatar } from '../Avatar';
import { byDay } from './shared';

interface Props {
  items: NewsItem[];
  members: Member[];
  subjects: Subject[];
  isPending: (item: NewsItem) => boolean;
}

/** La vista de siempre: una lista compacta por día, sin vista previa ni reacciones. */
export function ClassicNewsList({ items, members, subjects, isPending }: Props) {
  return byDay(items).map((group) => (
    <section key={group.label} className="news-day">
      <h2 className="label">{group.label}</h2>
      <ul className="news">
        {group.items.map((n) => {
          const subject = subjects.find((s) => s.id === n.subjectId);
          const isNew = isPending(n);
          return (
            <li key={n.key}>
              <Link to={n.link} className={isNew ? 'news-item news-item--pending' : 'news-item'}>
                <Avatar member={members.find((m) => m.id === n.actorId)} size={36} />
                <span className="news-item__body">
                  <span className="news-item__text">
                    <strong>{memberName(members, n.actorId)}</strong> {n.text}
                  </span>
                  <span className="news-item__meta">
                    <span className={`badge news-kind news-kind--${n.kind}`}>{NEWS_LABEL[n.kind]}</span>
                    <span>
                      {subject?.name ?? 'Grupo'} ·{' '}
                      <time dateTime={n.at.toISOString()}>{formatClock(n.at)}</time>
                    </span>
                  </span>
                </span>
                {isNew && <span className="news-item__dot" role="img" aria-label="Pendiente" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  ));
}
