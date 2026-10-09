import { periodLabel } from '@b20/core';
import { Link } from 'react-router';
import type { Id, Member, Subject, Term } from '../data/types';
import { formatDate, formatLongDay, formatMonth, formatShortMonth, parseDay } from '../lib/format';
import { previewText } from '../lib/messages';
import { groupByMonth, groupBySubject, type Post } from '../lib/posts';
import { AvatarStack } from './AvatarStack';

interface ViewProps {
  posts: Post[];
  subjects: Subject[];
  terms: Term[];
  members: Member[];
  meId?: Id;
}

/** Etiqueta del tipo: las actividades de clase llevan su propio color. */
function KindBadge({ post }: { post: Post }) {
  return (
    <span className={`badge badge--${post.type === 'activity' ? 'clase' : post.group}`}>{post.label}</span>
  );
}

const countOf = (post: Post) =>
  post.count === 0 ? `Sin ${post.noun[1]}` : `${post.count} ${post.count === 1 ? post.noun[0] : post.noun[1]}`;

const mineOf = (post: Post, meId: Id | undefined) =>
  Boolean(meId && post.people.includes(meId)) && (post.type === 'activity' ? 'Participaste' : 'Ya subiste');

/**
 * Vista por materia: tarjetas agrupadas en materia → parcial (sección 2). Es la vista que tenía
 * «Tareas y Actividades».
 */
export function PostArchive({ posts, subjects, terms, members, meId }: ViewProps) {
  return (
    <div className="archive">
      {groupBySubject(posts, subjects, terms).map(({ subject, count, groups }) => (
        <section key={subject.id} className="archive__subject">
          <header>
            <h2>{subject.name}</h2>
            <span className="muted">
              {periodLabel(subject.period)} · {count} en el archivo
            </span>
          </header>
          {groups.map((group) => (
            <div key={group.key}>
              <h3 className="label">{group.name}</h3>
              <ul className="work-grid">
                {group.posts.map((post) => {
                  const excerpt = previewText(post.text);
                  const mine = mineOf(post, meId);
                  return (
                    <li key={post.key}>
                      <Link to={post.link} className="work-card">
                        <span className="work-card__top">
                          <KindBadge post={post} />
                          {post.topic && <span className="work-card__context">{post.topic}</span>}
                        </span>
                        <strong className="work-card__title">{post.title}</strong>
                        {excerpt && <span className="work-card__excerpt">{excerpt}</span>}
                        <span className="work-card__footer">
                          {post.count > 0 && (
                            <AvatarStack members={post.people.map((id) => members.find((m) => m.id === id))} />
                          )}
                          <span className="work-card__authors">
                            {countOf(post)}
                            {mine && ` · ${mine.toLowerCase()}`}
                          </span>
                          <span className="work-card__date">
                            {post.dueDate ? 'Entrega ' : ''}
                            {(post.dueDate || post.type === 'activity') && formatDate(parseDay(post.day))}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/**
 * Vista por fecha: filas con el día a la izquierda, agrupadas por mes. Es la vista que tenía
 * «Actividades de clase». Cada publicación va en su día: la sesión, la entrega o su creación.
 */
export function PostTimeline({ posts, subjects, terms, members, meId }: ViewProps) {
  return (
    <>
      {groupByMonth(posts).map((month) => (
        <section key={month.key}>
          <h2 className="label">{formatMonth(month.date)}</h2>
          <ul className="rows">
            {month.posts.map((post) => {
              const date = parseDay(post.day);
              const mine = mineOf(post, meId);
              const place = [
                subjects.find((s) => s.id === post.subjectId)?.name ?? 'Materia desconocida',
                terms.find((t) => t.id === post.termId)?.name,
                post.topic,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <li key={post.key}>
                  <Link to={post.link} className="row-card">
                    <span className="datebox" aria-hidden="true">
                      <strong>{date.getDate()}</strong>
                      {formatShortMonth(date)}
                    </span>
                    <span className="row-card__main">
                      <span className="sr-only">
                        {post.dueDate ? 'Entrega: ' : ''}
                        {formatLongDay(date)}.{' '}
                      </span>
                      <span className="work-card__top">
                        <KindBadge post={post} />
                        {post.dueDate && <span className="work-card__context">Entrega</span>}
                      </span>
                      <strong className="row-card__title">{post.title}</strong>
                      <span className="row-card__meta">{place}</span>
                    </span>
                    <span className="row-card__side">
                      {post.count > 0 && (
                        <AvatarStack members={post.people.map((id) => members.find((m) => m.id === id))} />
                      )}
                      {countOf(post)}
                      {mine && <span className="badge badge--resolved">{mine}</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
