import { useEffect, useState } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { ChatPostKind, ChatPostPreview, ChatPostRef } from '@b20/core';
import { useDataSource, useSnapshot } from '../../data/DataContext';
import { Icon } from '../Icon';
import { ChatButton } from './Messaging';
import './sharing.css';

const kinds: [ChatPostKind, string][] = [
  ['assignment', 'Tareas'], ['activity', 'Actividades'], ['work', 'Trabajos'], ['evidence', 'Evidencias'],
  ['note', 'Notas'], ['question', 'Preguntas'], ['answer', 'Respuestas'], ['guide', 'Guías'], ['poll', 'Votaciones'],
  ['help', 'Ayuda'], ['spaced', 'Repaso'], ['post', 'Publicaciones'], ['challenge', 'Retos'], ['solution', 'Soluciones'],
  ['review', 'Revisiones de código'], ['review-comment', 'Observaciones'], ['opportunity', 'Oportunidades'],
  ['room', 'Salas'], ['exam', 'Exámenes'], ['ranking', 'Ranking'], ['signal-dictionary', 'Diccionarios de señales'], ['visual-project', 'Proyectos visuales'],
];
export function ChatPostPicker({ onPick, onClose }: { onPick(target: ChatPostRef): void; onClose(): void }) {
  const source = useDataSource();
  const { me, connection } = useSnapshot();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ChatPostKind>();
  const [rows, setRows] = useState<ChatPostPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true; setLoading(true); setRows([]); setError('');
    if (connection !== 'ready' || me?.status !== 'active' || typeof source.searchChatPosts !== 'function') { setLoading(false); return; }
    const timer = setTimeout(() => { void source.searchChatPosts(query, kind).then((result) => { if (current) setRows(result.filter((row) => row.available)); })
      .catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : 'No se pudieron consultar las publicaciones.'); })
      .finally(() => { if (current) setLoading(false); }); }, query ? 180 : 0);
    return () => { current = false; clearTimeout(timer); };
  }, [source, query, kind, me?.id, me?.status, connection, retry]);
  return <ModalOverlay isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} className="b20-messaging chat-share-overlay"><Modal className="chat-share-modal"><Dialog className="chat-share-dialog">
    <header className="chat-share-heading"><div><Heading slot="title">Publicaciones y materiales</Heading><p>Añade una tarjeta al mensaje sin salir del chat.</p></div><ChatButton variant="tertiary" aria-label="Cerrar publicaciones y materiales" onClick={onClose}><Icon name="close" /></ChatButton></header>
    <label className="chat-share-search"><Icon name="search" size={18} /><input autoFocus type="search" aria-label="Buscar publicación o material" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por título, materia o tema" /></label>
    <label className="chat-post-kind">Tipo de publicación<select aria-label="Tipo de publicación" value={kind ?? ''} onChange={(event) => setKind((event.target.value || undefined) as ChatPostKind | undefined)}><option value="">Todos los tipos</option>{kinds.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <div className="chat-post-results">{loading ? <p role="status">Buscando publicaciones…</p> : rows.length ? <ul>{rows.map((row) => <li key={`${row.target.kind}:${row.target.id}`}><button type="button" className="chat-post-result" onClick={() => { onPick(row.target); onClose(); }}><span>{row.kindLabel}{row.subject ? ` · ${row.subject}` : ''}</span><strong>{row.title}</strong>{row.description && <p>{row.description}</p>}<span className="chat-post-result__action">Añadir al borrador <Icon name="plus" size={14} /></span></button></li>)}</ul> : <p>No encontramos publicaciones disponibles con estos filtros.</p>}</div>
    {error && <div><p role="alert" className="error">{error}</p><ChatButton variant="secondary" disabled={loading} onClick={() => setRetry(value => value + 1)}>Reintentar búsqueda</ChatButton></div>}
  </Dialog></Modal></ModalOverlay>;
}
