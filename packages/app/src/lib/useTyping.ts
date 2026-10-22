import { useCallback, useEffect, useRef } from 'react';
import { useDataSource } from '../data/DataContext';
import type { MessageScope } from '../data/types';

/** At most one write per 2.5 s, stopped on idle, blur, route change or unmount. */
export function useTyping(scope: MessageScope, conversationId: string) {
  const source = useDataSource();
  const lastSent = useRef(0);
  const active = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const publish = useCallback(
    (typing: boolean) => {
      try {
        void Promise.resolve(source.setTyping(scope, conversationId, typing)).catch(() => {});
      } catch {
        /* Presence must never prevent sending or interrupt a disconnected chat. */
      }
    },
    [source, scope, conversationId],
  );
  const stop = useCallback(() => {
    clearTimeout(timer.current);
    if (active.current) publish(false);
    active.current = false;
    lastSent.current = 0;
  }, [publish]);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState !== 'visible') stop();
    };
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      stop();
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [stop]);
  return useCallback(
    (typing: boolean) => {
      if (!typing) {
        stop();
        return;
      }
      const now = Date.now();
      if (!active.current || now - lastSent.current >= 2500) {
        publish(true);
        lastSent.current = now;
      }
      active.current = true;
      clearTimeout(timer.current);
      timer.current = setTimeout(stop, 3500);
    },
    [publish, stop],
  );
}
