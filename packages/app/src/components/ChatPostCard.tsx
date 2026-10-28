import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { chatPostKey, type ChatPostPreview, type ChatPostRef } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { DataSource, Snapshot } from '../data/types';
import { Icon } from './Icon';

// A cache only lasts for the current authorized snapshot, so withdrawal and account
// changes cannot leave stale card metadata rendered indefinitely.
interface PendingPreview { target: ChatPostRef; resolve(row: ChatPostPreview): void; reject(error: unknown): void }
interface PreviewCache { requests: Map<string, Promise<ChatPostPreview>>; pending: PendingPreview[]; scheduled: boolean }
const previews = new WeakMap<Snapshot, PreviewCache>();
function previewRequest(source: DataSource, data: Snapshot, target: ChatPostRef, retry: boolean) {
  let cache = previews.get(data);
  if (!cache) { cache = { requests: new Map(), pending: [], scheduled: false }; previews.set(data, cache); }
  const key = chatPostKey(target);
  if (retry) cache.requests.delete(key);
  const existing = cache.requests.get(key); if (existing) return existing;
  const current = cache;
  const request = new Promise<ChatPostPreview>((resolve, reject) => current.pending.push({ target, resolve, reject }));
  cache.requests.set(key, request);
  if (!cache.scheduled) {
    cache.scheduled = true;
    // Mounted cards share one authenticated batch, with a bounded server payload.
    void Promise.resolve().then(() => {
      const pending = current.pending.splice(0); current.scheduled = false;
      for (let start = 0; start < pending.length; start += 50) {
        const group = pending.slice(start, start + 50);
        void source.resolveChatPosts(group.map(item => item.target)).then(rows => {
          group.forEach((item, index) => item.resolve(rows[index] ?? { target: item.target, available: false }));
        }, error => group.forEach(item => item.reject(error)));
      }
    });
  }
  return request;
}
export function ChatPostCard({ target }: { target: ChatPostRef }) {
  const source = useDataSource(); const data = useSnapshot();
  const [result, setResult] = useState<{ snapshot: Snapshot; key: string; row?: ChatPostPreview; failed?: boolean }>();
  const [retry, setRetry] = useState(0); const key = chatPostKey(target);
  useEffect(() => {
    let cancelled = false;
    const request = previewRequest(source, data, target, retry > 0);
    request.then(row => { if (!cancelled) setResult({ snapshot: data, key, row }); }, () => { if (!cancelled) setResult({ snapshot: data, key, failed: true }); });
    return () => { cancelled = true; };
  }, [source, data, key, retry]);
  const current = result?.snapshot === data && result.key === key;
  const row = current ? result.row : undefined;
  if (current && result.failed) return <button type="button" className="ref-card ref-card--missing" onClick={() => setRetry(value => value + 1)}><Icon name="file" size={16} /> No se pudo cargar. Reintentar</button>;
  if (!row) return <span className="ref-card ref-card--missing" aria-busy="true"><Icon name="file" size={16} /> Cargando publicación…</span>;
  if (!row.available || !row.path) return <span className="ref-card ref-card--missing"><Icon name="lock" size={16} /> Publicación no disponible</span>;
  return <Link to={row.path} className="ref-card">
    <span className="ref-card__icon" aria-hidden="true"><Icon name="file" size={18} /></span>
    <span className="ref-card__body"><span className="ref-card__label">{row.kindLabel}</span><strong className="ref-card__title">{row.title}</strong>
      {(row.subject || row.description) && <span className="ref-card__context">{[row.subject, row.description].filter(Boolean).join(' · ')}</span>}
    </span>
  </Link>;
}
