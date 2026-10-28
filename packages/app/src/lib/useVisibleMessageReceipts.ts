import { useEffect, useRef, type RefObject } from 'react';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Id, MessageScope } from '../data/types';
import type { ChatMessage } from './messages';

/** A tall message is readable when half the available viewport is exposed. */
export function bubbleIsReadable(bubble: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right' | 'height' | 'width'>, viewport: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right' | 'height'>): boolean {
  const height = Math.max(0, Math.min(bubble.bottom, viewport.bottom, window.innerHeight) - Math.max(bubble.top, viewport.top, 0));
  const width = Math.max(0, Math.min(bubble.right, viewport.right, window.innerWidth) - Math.max(bubble.left, viewport.left, 0));
  return viewport.height > 0 && height > 0 && bubble.height > 0 && bubble.width > 0 && width >= Math.min(bubble.width / 2, 80) && height >= Math.min(bubble.height / 2, viewport.height / 2);
}

/** Read receipts describe a continuous second of visibility, independently for each bubble. */
export function useVisibleMessageReceipts({ scope, conversationId, messages, root, enabled = true, onLegacyRead }: {
  scope: MessageScope; conversationId: Id; messages: ChatMessage[]; root: RefObject<HTMLDivElement | null>; enabled?: boolean;
  onLegacyRead?: (id: Id) => void;
}) {
  const source = useDataSource();
  const { me, connection } = useSnapshot();
  const latest = useRef({ messages, onLegacyRead }); latest.current = { messages, onLegacyRead };
  const ids = messages.filter(row => !row.deletedAt && row.senderId !== me?.id).map(row => row.id).join(',');
  useEffect(() => {
    const container = root.current; const receipts = source.messageReceipts;
    if (!enabled || !container || !receipts || connection !== 'ready' || !me || me.status !== 'active') return;
    let disposed = false; let flushing = false;
    const timers = new Map<Id, ReturnType<typeof setTimeout>>();
    const confirmed = new Set<Id>(); const ready = new Set<Id>();
    // IDs are data, never selector fragments; this also supports WebViews without CSS.escape.
    const bubbles = new Map([...container.querySelectorAll<HTMLElement>('[data-message-id]')].map(node => [node.dataset.messageId, node.querySelector<HTMLElement>('.bubble')]));
    const active = () => !disposed && document.visibilityState === 'visible' && document.hasFocus();
    const readable = (id: Id) => {
      const node = bubbles.get(id);
      return !!node && active() && bubbleIsReadable(node.getBoundingClientRect(), container.getBoundingClientRect());
    };
    const flush = async () => {
      if (flushing || disposed) return;
      const batch = [...ready].filter(readable); ready.clear();
      if (!batch.length) return;
      flushing = true;
      const previous = source.getSnapshot().messageReceipts ?? [];
      const legacy = batch.filter(id => !previous.some(row => row.scope === scope && row.messageId === id && row.tracked !== false));
      try {
        await receipts.markSeen(scope, conversationId, batch);
        if (disposed) return;
        for (const id of batch) confirmed.add(id);
        // This compatibility cursor never supplies the evidence for modern receipts.
        const lastLegacy = latest.current.messages.findLast(row => legacy.includes(row.id));
        if (lastLegacy) latest.current.onLegacyRead?.(lastLegacy.id);
      } catch { /* A later scroll, focus, or reconnect retries the visible messages. */ }
      finally { flushing = false; if (!disposed && ready.size) void flush(); }
    };
    const check = () => {
      for (const id of ids ? ids.split(',') : []) {
        const own = source.getSnapshot().messageReceipts?.find(row => row.scope === scope && row.messageId === id);
        if (confirmed.has(id) || own?.readAt || !readable(id)) {
          const timer = timers.get(id); if (timer) clearTimeout(timer); timers.delete(id); ready.delete(id); continue;
        }
        if (!timers.has(id)) timers.set(id, setTimeout(() => {
          timers.delete(id);
          if (readable(id)) { ready.add(id); queueMicrotask(() => void flush()); }
        }, 1000));
      }
    };
    container.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check); window.addEventListener('focus', check); window.addEventListener('blur', check);
    document.addEventListener('visibilitychange', check);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : undefined;
    observer?.observe(container); container.querySelectorAll('.bubble').forEach(node => observer?.observe(node));
    check();
    return () => {
      disposed = true; for (const timer of timers.values()) clearTimeout(timer); timers.clear(); ready.clear(); observer?.disconnect();
      container.removeEventListener('scroll', check); window.removeEventListener('resize', check); window.removeEventListener('focus', check); window.removeEventListener('blur', check); document.removeEventListener('visibilitychange', check);
    };
  }, [source, scope, conversationId, ids, root, enabled, connection, me?.id, me?.status]);
}
