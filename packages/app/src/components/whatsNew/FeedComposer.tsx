import { useState } from 'react';
import { FEED_LIMITS } from '@b20/core';
import { useDataSource } from '../../data/DataContext';
import type { Member, Subject } from '../../data/types';
import { bySubject } from '../../lib/works';
import { Avatar } from '../Avatar';
import { useAction } from '../useAction';

/** «¿Qué estás pensando?»: una publicación de texto para el grupo, con materia opcional. */
export function FeedComposer({ me, subjects }: { me: Member | undefined; subjects: Subject[] }) {
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const [text, setText] = useState('');
  const [subjectId, setSubjectId] = useState('');
  // Un id por intento: si la red reintenta el envío no se publica dos veces.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const left = FEED_LIMITS.post - text.trim().length;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const ok = await run(async () => { await source.createFeedPost({ text, subjectId: subjectId || undefined, requestId }); return true; });
    if (ok) { setText(''); setSubjectId(''); setRequestId(crypto.randomUUID()); }
  };

  return (
    <form className="feed-composer panel" onSubmit={submit}>
      <div className="feed-composer__row">
        <Avatar member={me} size={40} />
        <textarea
          aria-label="Escribe una publicación para el grupo"
          placeholder="¿Qué estás pensando?"
          rows={text ? 3 : 1}
          maxLength={FEED_LIMITS.post + 50}
          value={text}
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
          <button type="submit" disabled={pending || !text.trim() || left < 0}>Publicar</button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
