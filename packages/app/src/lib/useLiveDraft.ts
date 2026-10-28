import { useCallback, useEffect, useRef } from 'react';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { MessageScope } from '../data/types';

/** Leading and trailing updates keep previews current without writing on every keypress. */
export function useLiveDraft(scope: MessageScope, conversationId: string) {
  const source = useDataSource();
  const { me, connection, liveDraftSharingEnabled } = useSnapshot();
  const enabled = me?.status === 'active' && connection === 'ready' && liveDraftSharingEnabled !== false;
  const last = useRef(-Infinity);
  const active = useRef(false);
  const latest = useRef('');
  const throttle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const publish = useCallback((text: string) => {
    try { void Promise.resolve(source.liveDrafts.publish(scope, conversationId, text)).catch(() => {}); }
    catch { /* Presence failure must never prevent composing or sending a message. */ }
  }, [source, scope, conversationId]);
  const stop = useCallback(() => {
    clearTimeout(throttle.current); clearTimeout(idle.current);
    throttle.current = undefined; latest.current = '';
    if (active.current) publish('');
    active.current = false; last.current = -Infinity;
  }, [publish]);

  useEffect(() => {
    if (!enabled) stop();
    const hidden = () => { if (document.visibilityState !== 'visible') stop(); };
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      stop();
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [enabled, stop]);

  return useCallback((text: string) => {
    if (!enabled || !text.trim()) { stop(); return; }
    latest.current = text;
    active.current = true;
    const elapsed = Date.now() - last.current;
    const flush = () => {
      throttle.current = undefined;
      last.current = Date.now();
      publish(latest.current);
    };
    if (elapsed >= 200) { clearTimeout(throttle.current); flush(); }
    else if (!throttle.current) throttle.current = setTimeout(flush, 200 - elapsed);
    clearTimeout(idle.current);
    idle.current = setTimeout(stop, 3500);
  }, [enabled, publish, stop]);
}
