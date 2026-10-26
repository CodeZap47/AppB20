import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { FEED_LIMITS } from '@b20/core';
import { useDataSource, useSnapshot } from '../../data/DataContext';
import type { Member, Subject } from '../../data/types';
import { bySubject } from '../../lib/works';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { useAction } from '../useAction';

/** «¿Qué estás pensando?»: una publicación de texto para el grupo, con materia opcional. */
export function FeedComposer({ me, subjects }: { me: Member | undefined; subjects: Subject[] }) {
  const source = useDataSource();
  const { connection } = useSnapshot();
  const lock = useRef(false);
  const { error, pending, run } = useAction();
  const [text, setText] = useState('');
  const [subjectId, setSubjectId] = useState('');
  // Un id por intento: si la red reintenta el envío no se publica dos veces.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const left = FEED_LIMITS.post - text.trim().length;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (lock.current || connection !== 'ready' || me?.status !== 'active' || !text.trim() || left < 0) return;
    lock.current = true;
    try {
      const ok = await run(async () => { await source.createFeedPost({ text, subjectId: subjectId || undefined, requestId }); return true; });
      if (ok) { setText(''); setSubjectId(''); setRequestId(crypto.randomUUID()); }
    } finally { lock.current = false; }
  };

  return (
    <form className="feed-composer" onSubmit={submit}>
      <div className="feed-composer__heading"><strong>Comparte con tu grupo</strong><span><Icon name="users" size={14} />B20</span></div>
      <div className="feed-composer__row">
        <Avatar member={me} size={40} />
        <textarea
          aria-label="Escribe una publicación para el grupo"
          placeholder="Comparte una idea con tu grupo…"
          rows={text ? 3 : 1}
          maxLength={FEED_LIMITS.post + 50}
          value={text}
          disabled={pending || connection !== 'ready'}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {text && (
        <div className="feed-composer__actions">
          <select aria-label="Materia" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">Sin materia</option>
            {[...subjects].sort(bySubject).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span className={left < 0 ? 'feed-composer__count error' : 'feed-composer__count muted'}>{left}</span>
          <button type="submit" disabled={pending || connection !== 'ready' || !text.trim() || left < 0}>Publicar</button>
        </div>
      )}
      <nav className="feed-composer__shortcuts" aria-label="Crear desde un módulo">
        <Link to="/m/tareas/nueva"><Icon name="calendar" size={17} />Crear tarea</Link>
        <Link to="/m/notas/nueva"><Icon name="book" size={17} />Compartir apunte</Link>
        <Link to="/m/preguntas/nueva"><Icon name="chat" size={17} />Hacer pregunta</Link>
      </nav>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
