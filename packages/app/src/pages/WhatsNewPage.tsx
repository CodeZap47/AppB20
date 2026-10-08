import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { SubjectSelect } from '../components/SubjectSelect';
import { buildNews, NEWS_LABEL, type NewsKind } from '../lib/whatsNew';
import { formatTime, memberName } from '../lib/format';

/** Pantalla de inicio: novedades desde tu última visita (7.1). */
export function WhatsNewPage() {
  const source = useDataSource();
  const snapshot = useSnapshot();
  const { members, subjects, lastSeenAt } = snapshot;
  const [subjectId, setSubjectId] = useState('');
  const [kind, setKind] = useState<NewsKind | ''>('');
  const news = useMemo(() => buildNews(snapshot), [snapshot]);

  const filtered = news.filter(
    (n) => (!subjectId || n.subjectId === subjectId) && (!kind || n.kind === kind),
  );
  const isPending = (at: Date) => !lastSeenAt || at > lastSeenAt;
  const pendingCount = filtered.filter((n) => isPending(n.at)).length;

  return (
    <>
      <div className="row row--between">
        <h1>¿Qué me perdí?</h1>
        <button type="button" className="secondary" onClick={() => source.markSeen()} disabled={!pendingCount}>
          Marcar todo como visto
        </button>
      </div>
      <p className="muted">
        {pendingCount
          ? `Tienes ${pendingCount} ${pendingCount === 1 ? 'novedad pendiente' : 'novedades pendientes'}.`
          : 'Estás al corriente.'}
      </p>
      <div className="row">
        <SubjectSelect subjects={subjects} value={subjectId} onChange={setSubjectId} allowAll />
        <label className="field">
          Tipo
          <select value={kind} onChange={(e) => setKind(e.target.value as NewsKind | '')}>
            <option value="">Todos</option>
            {Object.entries(NEWS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {filtered.length ? (
        <ul className="list">
          {filtered.map((n) => (
            <li key={n.key}>
              <Link to={n.link} className={isPending(n.at) ? 'list__item news--pending' : 'list__item'}>
                <span>
                  <strong>{memberName(members, n.actorId)}</strong> {n.text}
                </span>
                <span className="muted">
                  {subjects.find((s) => s.id === n.subjectId)?.name ?? 'Sin materia'} ·{' '}
                  {formatTime(n.at)}
                  {isPending(n.at) ? ' · pendiente' : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No hay novedades con estos filtros.</p>
      )}
      <p>
        <Link to="/modulos">Ver todos los módulos</Link>
      </p>
    </>
  );
}
