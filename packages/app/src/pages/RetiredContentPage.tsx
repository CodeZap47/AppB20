import { Link } from 'react-router';
import { useSnapshot } from '../data/DataContext';
import { ContentWithdrawal } from '../components/ContentWithdrawal';
import type { WithdrawableKind } from '../data/delivery2Types';
import type { Id } from '../data/types';

export function RetiredContentPage() {
  const data = useSnapshot();
  const rows: { kind: WithdrawableKind; id: Id; title: string; ownerIds: Id[]; version: number; at: Date; link: string; personal?: boolean }[] = [];
  for (const note of data.notes) if (note.withdrawnAt) rows.push({ kind: 'note', id: note.id, title: note.title, ownerIds: [note.authorId], version: note.version, at: note.withdrawnAt, link: `/m/notas/${note.id}`, personal: note.visibility === 'personal' });
  for (const guide of data.guides) if (guide.withdrawnAt) rows.push({ kind: 'guide', id: guide.id, title: guide.title, ownerIds: [guide.createdBy], version: guide.version, at: guide.withdrawnAt, link: `/m/guias/${guide.id}` });
  for (const question of data.questions) if (question.withdrawnAt) rows.push({ kind: 'question', id: question.id, title: question.title, ownerIds: [question.authorId], version: question.version ?? 1, at: question.withdrawnAt, link: `/m/preguntas/${question.id}` });
  for (const answer of data.answers) if (answer.withdrawnAt) rows.push({ kind: 'answer', id: answer.id, title: data.questions.find((question) => question.id === answer.questionId)?.title ?? 'Respuesta retirada', ownerIds: [answer.authorId], version: answer.version ?? 1, at: answer.withdrawnAt, link: `/m/preguntas/${answer.questionId}` });
  for (const work of data.works) if (work.withdrawnAt) rows.push({ kind: 'work', id: work.id, title: work.title || 'Trabajo', ownerIds: work.authorIds, version: work.version, at: work.withdrawnAt, link: `/m/tareas/${work.assignmentId}?trabajo=${work.id}` });
  for (const evidence of data.evidences) if (evidence.withdrawnAt) rows.push({ kind: 'evidence', id: evidence.id, title: data.activities.find((activity) => activity.id === evidence.activityId)?.title ?? 'Evidencia', ownerIds: [evidence.authorId], version: evidence.version ?? 1, at: evidence.withdrawnAt, link: `/m/actividades/${evidence.activityId}` });
  const permitted = rows.filter((row) => data.me && (row.ownerIds.includes(data.me.id) || data.me.isCreator && !row.personal)).sort((a, b) => b.at.getTime() - a.at.getTime());
  return <><header className="page-header"><div><h1>Contenido retirado</h1><p className="muted">Tus aportes retirados y, si administras el grupo, el contenido compartido que puedes revisar. Restaurar conserva el registro original y sus versiones.</p></div></header>
    {!permitted.length && <p className="muted">No tienes contenido retirado que puedas restaurar.</p>}
    {permitted.map((row) => <article className="panel" key={`${row.kind}:${row.id}`}><h2><Link to={row.link}>{row.title}</Link></h2><ContentWithdrawal kind={row.kind} id={row.id} version={row.version} withdrawnAt={row.at} canEdit /></article>)}
  </>;
}
