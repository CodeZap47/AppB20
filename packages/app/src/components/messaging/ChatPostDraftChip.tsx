import { useEffect, useState } from 'react';
import type { ChatPostPreview, ChatPostRef } from '@b20/core';
import { useDataSource, useSnapshot } from '../../data/DataContext';
import { Icon } from '../Icon';

export function ChatPostDraftChip({ target, onRemove }: { target: ChatPostRef; onRemove(): void }) {
  const source = useDataSource();
  const snapshot = useSnapshot();
  const [result, setResult] = useState<{ snapshot: typeof snapshot; row?: ChatPostPreview; failed?: boolean }>();
  useEffect(() => {
    let active = true;
    if (typeof source.resolveChatPosts !== 'function' || snapshot.me?.status !== 'active') { setResult({ snapshot, failed: true }); return; }
    void source.resolveChatPosts([target]).then((rows) => { if (active) setResult({ snapshot, row: rows[0] ?? { target, available: false } }); }).catch(() => { if (active) setResult({ snapshot, failed: true }); });
    return () => { active = false; };
  }, [source, snapshot, target.kind, target.id]);
  const preview = result?.snapshot === snapshot ? result.row : undefined;
  const title = preview?.available ? preview.title || 'Publicación' : preview ? 'Publicación no disponible' : result?.snapshot === snapshot && result.failed ? 'No se pudo consultar la publicación' : 'Consultando publicación…';
  return <li className="ref-chip chat-post-draft-chip"><Icon name="file" size={16} /><span>{preview?.available && <small>{[preview.kindLabel, preview.subject].filter(Boolean).join(' · ')}</small>}<strong>{title}</strong></span><button type="button" aria-label={`Quitar ${title}`} onClick={onRemove}><Icon name="close" size={14} /></button></li>;
}
