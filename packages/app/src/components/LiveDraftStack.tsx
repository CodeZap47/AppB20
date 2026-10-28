import { useCallback, useEffect, useId, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { EMPTY_LIVE_DRAFTS } from '../data/liveDraftTypes';
import type { MessageScope } from '../data/types';
import { TypingIndicator } from './TypingIndicator';
import { useAction } from './useAction';
import './LiveDraftStack.css';

export function LiveDraftStack({ scope, conversationId }: { scope: MessageScope; conversationId: string }) {
  const source = useDataSource();
  const { me, members, blockedMembers, liveDraftSharingEnabled, connection } = useSnapshot();
  const [expanded, setExpanded] = useState(false);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const { error, pending, run } = useAction();
  const listId = useId();
  const subscribe = useCallback((listener: () => void) => source.liveDrafts?.subscribe(scope, conversationId, listener) ?? (() => {}), [source, scope, conversationId]);
  const getSnapshot = useCallback(() => source.liveDrafts?.getSnapshot(scope, conversationId) ?? EMPTY_LIVE_DRAFTS, [source, scope, conversationId]);
  const drafts = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_LIVE_DRAFTS);
  useEffect(() => { setExpanded(false); setOpened(new Set()); }, [scope, conversationId]);
  const seen = new Set<string>();
  const people = drafts.filter((row) => {
    if (row.memberId === me?.id || seen.has(row.memberId) || blockedMembers.some((block) => block.memberId === row.memberId)
      || !members.some((member) => member.id === row.memberId && member.status === 'active')) return false;
    seen.add(row.memberId); return true;
  });
  const enabled = liveDraftSharingEnabled !== false;
  if (me?.status !== 'active') return null;
  return <section className="live-drafts" aria-label="Escritura en tiempo real">
    <div className="live-drafts__notice">
      <span className={`live-drafts__signal${enabled ? ' is-active' : ''}`} aria-hidden="true" />
      <span>{enabled ? 'Los demás ven tu texto mientras escribes' : 'Tu texto se comparte al enviarlo'}</span>
      <button type="button" role="switch" aria-label="Compartir mi escritura en tiempo real" aria-checked={enabled}
        disabled={pending || connection !== 'ready'} onClick={() => { void run(() => source.setLiveDraftSharing(!enabled)); }}>
        {pending ? 'Guardando…' : enabled ? 'Desactivar' : 'Activar'}
      </button>
    </div>
    {error && <p className="live-drafts__error" role="alert">{error}</p>}
    <span className="live-drafts__sr-only" role="status" aria-live="polite" aria-atomic="true">
      {people.length > 0 ? `${people.length} ${people.length === 1 ? 'persona está escribiendo' : 'personas están escribiendo'}` : ''}
    </span>
    {people.length > 0 && <div id={listId} className={`live-drafts__stack${expanded ? ' is-expanded' : ''}`}>
      {(expanded ? people : people.slice(0, 3)).map((draft, index) => {
        const name = members.find((member) => member.id === draft.memberId)!.displayName;
        const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
        const isOpen = opened.has(draft.memberId);
        const textId = `${listId}-${draft.memberId}`;
        return <article className={`live-drafts__card${isOpen ? ' is-open' : ''}`} key={draft.memberId} style={{ '--draft-index': index } as CSSProperties} aria-label={`${name} está escribiendo`}>
          <div className="live-drafts__avatar" aria-hidden="true">{initials}</div>
          <div className="live-drafts__body"><div className="live-drafts__author"><strong>{name}</strong><span>escribiendo<span aria-hidden="true">…</span></span></div>
            <p id={textId} dir="auto">{draft.text}</p>
            {(draft.text.length > 100 || draft.text.includes('\n')) && <button type="button" className="live-drafts__read" aria-expanded={isOpen} aria-controls={textId} onClick={() => setOpened((current) => {
              const next = new Set(current); if (next.has(draft.memberId)) next.delete(draft.memberId); else next.add(draft.memberId); return next;
            })}>{isOpen ? 'Mostrar menos texto' : 'Leer borrador completo'}</button>}
          </div>
        </article>;
      })}
    </div>}
    {people.length > 3 && <button type="button" className="live-drafts__expand" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)}>
      {expanded ? 'Mostrar menos' : `Ver ${people.length - 3} más escribiendo`}
    </button>}
    <TypingIndicator scope={scope} conversationId={conversationId} excludeMemberIds={people.map((row) => row.memberId)} />
  </section>;
}
