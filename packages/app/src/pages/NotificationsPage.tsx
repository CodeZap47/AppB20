import { useState } from 'react';
import { Link } from 'react-router';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { formatMediumDate, formatClock } from '../lib/format';

export function NotificationsPage() {
  const data = useSnapshot(); const source = useDataSource();
  const [onlyUnread, setOnlyUnread] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const unread = data.notifications.filter((item) => !item.readAt).length;
  const rows = data.notifications.filter((item) => !onlyUnread || !item.readAt).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  async function mark(id?: string) {
    setBusy(true); setError('');
    try { if (id) await source.markNotificationRead(id); else await source.markAllNotificationsRead(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la lectura.'); }
    finally { setBusy(false); }
  }
  return <><header className="page-header"><div><h1>Mis avisos</h1><p className="muted">{unread} sin leer. Esta bandeja es privada; abrir una publicación vuelve a comprobar tus permisos.</p></div><Link to="/ajustes">Preferencias de avisos</Link></header>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="row"><label className="check"><input type="checkbox" checked={onlyUnread} onChange={(event) => setOnlyUnread(event.target.checked)} />Solo sin leer</label><button type="button" disabled={busy || !unread} onClick={() => void mark()}>Marcar todos como leídos</button></div>
    {!rows.length && <p className="muted">{onlyUnread ? 'No tienes avisos pendientes.' : 'Todavía no tienes avisos.'}</p>}
    {rows.map((item) => <article key={item.id} className="panel"><h2><Link to={item.route} onClick={() => { if (!item.readAt) void mark(item.id); }}>{item.title}</Link></h2>
      <p className="muted"><time dateTime={item.createdAt.toISOString()}>{formatMediumDate(item.createdAt)} · {formatClock(item.createdAt)}</time>{!item.readAt && ' · Sin leer'}</p>
      {!item.readAt && <button type="button" disabled={busy} onClick={() => void mark(item.id)}>Marcar como leído</button>}
    </article>)}
  </>;
}
