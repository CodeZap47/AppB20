import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { availableFeedCreateActions, FEED_LIMITS } from '@b20/core';
import { useDataSource, useSnapshot } from '../../data/DataContext';
import type { Member, Subject } from '../../data/types';
import { bySubject } from '../../lib/works';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { getModuleIcon } from '../navigation';
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
  const blocked = pending || connection !== 'ready' || me?.status !== 'active';
  const createActions = availableFeedCreateActions();

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
          disabled={blocked}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {text && (
        <div className="feed-composer__actions">
          <select aria-label="Materia" value={subjectId} disabled={blocked} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">Sin materia</option>
            {[...subjects].sort(bySubject).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span className={left < 0 ? 'feed-composer__count error' : 'feed-composer__count muted'}>{left}</span>
          <button type="submit" disabled={blocked || !text.trim() || left < 0}>Publicar</button>
        </div>
      )}
      <nav className="feed-composer__shortcuts" aria-label="Crear desde un módulo">
        <h2 className="feed-composer__shortcuts-title">Crear desde un módulo</h2>
        {createActions.map((action) => {
          const ModuleIcon = getModuleIcon(action.moduleId);
          const content = <><ModuleIcon className="feed-composer__shortcut-icon" aria-hidden="true" /><span>{action.label}</span></>;
          if (blocked) return <a key={`${action.moduleId}:${action.id}`} role="link" aria-disabled="true" tabIndex={-1}
            data-module={action.moduleId} className="feed-composer__shortcut">{content}</a>;
          return <Link key={`${action.moduleId}:${action.id}`} to={action.path}
            data-module={action.moduleId} className="feed-composer__shortcut"
            onClick={(event) => { if (lock.current) event.preventDefault(); }}
            onAuxClick={(event) => { if (lock.current) event.preventDefault(); }}>{content}</Link>;
        })}
      </nav>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
