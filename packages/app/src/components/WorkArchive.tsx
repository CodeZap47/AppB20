import { Link } from 'react-router';
import type { Id, Member, Subject, Term, Work } from '../data/types';
import { formatDate } from '../lib/format';
import { previewText } from '../lib/messages';
import { authorsLabel, groupWorks, sortRecent } from '../lib/works';
import { AvatarStack } from './AvatarStack';

function WorkCard({
  work,
  context,
  members,
  meId,
}: {
  work: Work;
  /** Materia y parcial, cuando la tarjeta no está ya bajo ese encabezado. */
  context?: string;
  members: Member[];
  meId: Id | undefined;
}) {
  const excerpt = previewText(work.assignment || work.description);
  return (
    <Link to={`/m/tareas/${work.id}`} className="work-card">
      {context && <span className="work-card__context">{context}</span>}
      <strong className="work-card__title">{work.title}</strong>
      {excerpt && <span className="work-card__excerpt">{excerpt}</span>}
      <span className="work-card__footer">
        <AvatarStack members={work.authorIds.map((id) => members.find((m) => m.id === id))} />
        <span className="work-card__authors">{authorsLabel(work.authorIds, members, meId)}</span>
        <span className="work-card__date">
          {work.version > 1 && <span className="badge">v{work.version}</span>} {formatDate(work.updatedAt)}
        </span>
      </span>
    </Link>
  );
}

/**
 * Archivo de trabajos. Agrupado es materia → parcial → trabajos (sección 2); `recent` es una
 * sola lista del más reciente al más antiguo. Se usa en «Tareas y trabajos» y en cada perfil.
 */
export function WorkArchive({
  works,
  subjects,
  terms,
  members,
  meId,
  view = 'grouped',
  empty,
}: {
  works: Work[];
  subjects: Subject[];
  terms: Term[];
  members: Member[];
  meId?: Id;
  view?: 'grouped' | 'recent';
  empty?: string;
}) {
  if (!works.length) return empty ? <p className="muted">{empty}</p> : null;

  if (view === 'recent') {
    const contextOf = (w: Work) =>
      [subjects.find((s) => s.id === w.subjectId)?.name, terms.find((t) => t.id === w.termId)?.name]
        .filter(Boolean)
        .join(' · ');
    return (
      <ul className="work-grid">
        {sortRecent(works).map((w) => (
          <li key={w.id}>
            <WorkCard work={w} context={contextOf(w)} members={members} meId={meId} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="archive">
      {groupWorks(works, subjects, terms).map(({ subject, count, groups }) => (
        <section key={subject.id} className="archive__subject">
          <header>
            <h2>{subject.name}</h2>
            <span className="muted">
              {count} {count === 1 ? 'trabajo' : 'trabajos'}
            </span>
          </header>
          {groups.map((group) => (
            <div key={group.key}>
              <h3 className="label">{group.name}</h3>
              <ul className="work-grid">
                {group.works.map((w) => (
                  <li key={w.id}>
                    <WorkCard work={w} members={members} meId={meId} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
