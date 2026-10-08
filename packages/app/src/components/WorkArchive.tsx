import { Link } from 'react-router';
import type { Member, Subject, Term, Work } from '../data/types';
import { formatDate, memberName } from '../lib/format';

/**
 * Archivo organizado como materia → parcial → trabajos (sección 2). Se usa en
 * «Tareas y trabajos» y en el perfil de cada alumno.
 */
export function WorkArchive({
  works,
  subjects,
  terms,
  members,
  empty,
}: {
  works: Work[];
  subjects: Subject[];
  terms: Term[];
  members: Member[];
  empty: string;
}) {
  const withWorks = subjects.filter((s) => works.some((w) => w.subjectId === s.id));
  if (!withWorks.length) return <p className="muted">{empty}</p>;

  return (
    <div className="archive">
      {withWorks.map((subject) => {
        const subjectWorks = works.filter((w) => w.subjectId === subject.id);
        const groups = [
          ...terms
            .filter((t) => t.subjectId === subject.id)
            .sort((a, b) => a.position - b.position)
            .map((t) => ({ key: t.id, name: t.name, items: subjectWorks.filter((w) => w.termId === t.id) })),
          { key: 'none', name: 'Sin parcial', items: subjectWorks.filter((w) => !w.termId) },
        ].filter((g) => g.items.length);

        return (
          <section key={subject.id}>
            <h2>{subject.name}</h2>
            {groups.map((g) => (
              <div key={g.key}>
                <h3>{g.name}</h3>
                <ul className="list">
                  {g.items.map((w) => (
                    <li key={w.id} className="list__item">
                      <strong>{w.title}</strong>
                      {w.assignment && <span>Consigna: {w.assignment}</span>}
                      {w.description && <span className="muted">{w.description}</span>}
                      <span className="muted">
                        {w.authorIds.map((id, i) => (
                          <span key={id}>
                            {i > 0 && ', '}
                            <Link to={`/perfil/${id}`}>{memberName(members, id)}</Link>
                          </span>
                        ))}{' '}
                        · v{w.version} · {formatDate(w.updatedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
