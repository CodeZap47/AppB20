import { periodLabel, WORK_KIND_LABEL, workKindGroup } from '@b20/core';
import { Link } from 'react-router';
import type { Assignment, Id, Member, Subject, Term, Work } from '../data/types';
import { formatDate, parseDay } from '../lib/format';
import { previewText } from '../lib/messages';
import { groupAssignments, sortRecent, submittersOf } from '../lib/works';
import { AvatarStack } from './AvatarStack';

function AssignmentCard({
  assignment,
  context,
  members,
  works,
  meId,
}: {
  assignment: Assignment;
  /** Materia y parcial, cuando la tarjeta no está ya bajo ese encabezado. */
  context?: string;
  members: Member[];
  works: Work[];
  meId: Id | undefined;
}) {
  const excerpt = previewText(assignment.instructions);
  const count = works.filter((w) => w.assignmentId === assignment.id).length;
  const submitters = submittersOf(assignment.id, works);
  return (
    <Link to={`/m/tareas/${assignment.id}`} className="work-card">
      <span className="work-card__top">
        <span className={`badge badge--${workKindGroup(assignment.kind)}`}>
          {WORK_KIND_LABEL[assignment.kind]}
        </span>
        {context && <span className="work-card__context">{context}</span>}
      </span>
      <strong className="work-card__title">{assignment.title}</strong>
      {excerpt && <span className="work-card__excerpt">{excerpt}</span>}
      <span className="work-card__footer">
        {count > 0 && <AvatarStack members={submitters.map((id) => members.find((m) => m.id === id))} />}
        <span className="work-card__authors">
          {count === 0 ? 'Sin trabajos' : `${count} ${count === 1 ? 'trabajo' : 'trabajos'}`}
          {meId && submitters.includes(meId) && ' · ya subiste'}
        </span>
        {assignment.dueDate && (
          <span className="work-card__date">Entrega {formatDate(parseDay(assignment.dueDate))}</span>
        )}
      </span>
    </Link>
  );
}

/**
 * Archivo de páginas principales (tareas, actividades, exposiciones y exámenes). Agrupado es
 * materia → parcial (sección 2); `recent` es una sola lista por movimiento más reciente.
 */
export function AssignmentArchive({
  assignments,
  works,
  subjects,
  terms,
  members,
  meId,
  view = 'grouped',
}: {
  assignments: Assignment[];
  works: Work[];
  subjects: Subject[];
  terms: Term[];
  members: Member[];
  meId?: Id;
  view?: 'grouped' | 'recent';
}) {
  if (view === 'recent') {
    const contextOf = (a: Assignment) =>
      [subjects.find((s) => s.id === a.subjectId)?.name, terms.find((t) => t.id === a.termId)?.name]
        .filter(Boolean)
        .join(' · ');
    return (
      <ul className="work-grid">
        {sortRecent(assignments, works).map((a) => (
          <li key={a.id}>
            <AssignmentCard assignment={a} context={contextOf(a)} members={members} works={works} meId={meId} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="archive">
      {groupAssignments(assignments, works, subjects, terms).map(({ subject, count, groups }) => (
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
                {group.assignments.map((a) => (
                  <li key={a.id}>
                    <AssignmentCard assignment={a} members={members} works={works} meId={meId} />
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
