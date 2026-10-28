import { useEffect, useId, useRef, useState } from 'react';
import { feedResourceKey, type FeedResourceRef, type FeedThread } from '@b20/core';
import { useDataSource, useSnapshot } from '../../data/DataContext';
import { feedThreadCommentCount } from '../../data/feedInteractionTypes';
import type { DataSource } from '../../data/types';
import { formatClock, memberName } from '../../lib/format';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { ShareToChatButton } from '../messaging/SharePostDialog';
import './ResourceComments.css';

interface Props { target: FeedResourceRef; title?: string; autoFocus?: boolean; initiallyOpen?: boolean; share?: boolean }
const sourceIds = new WeakMap<DataSource, number>();
let nextSourceId = 0;
function sourceKey(source: DataSource) { if (!sourceIds.has(source)) sourceIds.set(source, ++nextSourceId); return sourceIds.get(source); }
const message = (error: unknown) => error instanceof Error ? error.message : 'No se pudo actualizar la conversación.';

/** Una conversación del recurso, compartida por el feed y su página de origen. */
export function ResourceComments(props: Props) {
  const source = useDataSource();
  const snapshot = useSnapshot();
  return <Thread key={`${sourceKey(source)}:${snapshot.me?.id}:${feedResourceKey(props.target)}`} {...props} />;
}

function Thread({ target, title = 'Comentarios', autoFocus = false, initiallyOpen = true, share = true }: Props) {
  const source = useDataSource();
  const snapshot = useSnapshot();
  const actor = snapshot.me?.id;
  const active = snapshot.connection === 'ready' && snapshot.me?.status === 'active';
  const available = typeof source.readFeedThread === 'function';
  const [open, setOpen] = useState(initiallyOpen);
  const [thread, setThread] = useState<FeedThread>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const lock = useRef(false);
  const request = useRef<{text: string; id: string} | undefined>(undefined);
  const wantFocus = useRef(autoFocus && initiallyOpen);
  const regionId = useId();
  const current = () => alive.current && source.getSnapshot().me?.id === actor && source.getSnapshot().me?.status === 'active';
  const load = async () => {
    if (!available || !active || lock.current) return;
    const version = ++generation.current;
    setLoading(true);
    try {
      const next = await source.readFeedThread(target);
      if (current() && version === generation.current) { setThread(next); setError(''); }
    } catch (cause) { if (current() && version === generation.current) { setThread(undefined); setError(message(cause)); } }
    finally { if (current() && version === generation.current) setLoading(false); }
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => {
    if (!active) { generation.current++; setThread(undefined); setLoading(false); return; }
    if (!open || !available) return;
    const timer = setTimeout(() => void load(), thread ? 150 : 0);
    return () => clearTimeout(timer);
    // Snapshot changes refresh only conversations which the reader has opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, open, available]);
  useEffect(() => {
    if (!open || !available || !active) return;
    const refresh = () => { if (document.visibilityState !== 'hidden') void load(); };
    const localChange = (event: Event) => {
      const detail = (event as CustomEvent<{source: DataSource; actor?: string; target: string}>).detail;
      if (detail?.source === source && detail.actor === actor && detail.target === feedResourceKey(target)) refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('b20-feed-thread-change', localChange);
    const timer = setInterval(refresh, 30_000);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('b20-feed-thread-change', localChange); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, available, active, source, actor, target.kind, target.id]);
  useEffect(() => {
    if (open && thread && wantFocus.current && thread.canComment) { input.current?.focus(); wantFocus.current = false; }
  }, [open, thread]);
  const mutate = async (action: () => Promise<FeedThread> | FeedThread, clearDraft = false) => {
    if (lock.current || !active) return;
    lock.current = true; generation.current++; setPending(true); setError('');
    try {
      const next = await action();
      if (current()) { setThread(next); if (clearDraft) { setText(''); request.current = undefined; input.current?.focus(); } window.dispatchEvent(new CustomEvent('b20-feed-thread-change', { detail: { source, actor, target: feedResourceKey(target) } })); }
    } catch (cause) { if (current()) setError(message(cause)); }
    finally { lock.current = false; if (current()) { setPending(false); setLoading(false); } }
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!thread?.canComment || !text.trim() || typeof source.addFeedThreadComment !== 'function') return;
    if (request.current?.text !== text) request.current = {text, id: crypto.randomUUID()};
    void mutate(() => source.addFeedThreadComment(target, text, request.current!.id), true);
  };
  const count = thread?.comments.length ?? feedThreadCommentCount(target, snapshot);
  const comments = thread?.comments ?? [];
  const shown = expanded ? comments : comments.slice(-3);
  return <section className={`resource-comments${initiallyOpen ? '' : ' resource-comments--feed'}`} aria-label={title}>
    {share && <ShareToChatButton target={target} />}
    {!initiallyOpen && <button className="resource-comments__toggle" type="button" aria-expanded={open} aria-controls={regionId}
      disabled={!available || !active} title={!available ? 'Esta conversación todavía no está disponible.' : undefined}
      onClick={() => { wantFocus.current = true; setOpen(!open); }}><Icon name="chat" size={16} />Comentar{count !== undefined && <span>{count}</span>}</button>}
    {open && <div id={regionId} className="resource-comments__body">
      <header className="resource-comments__head"><h2>{title}</h2>{count !== undefined && <span>{count}</span>}</header>
      {!available ? <p className="muted">La conversación todavía no está disponible.</p> : !active ? <p className="muted">Conéctate con tu cuenta activa para ver la conversación.</p> : <>
        {loading && !thread && <p role="status" className="muted">Cargando comentarios…</p>}
        {comments.length > 3 && <button type="button" className="link-button" onClick={() => setExpanded(!expanded)}>{expanded ? 'Ver menos comentarios' : `Ver los ${comments.length} comentarios`}</button>}
        {shown.length > 0 ? <ul className="resource-comments__list">{shown.map((comment) => <li key={comment.id}>
          <Avatar member={snapshot.members.find((row) => row.id === comment.authorId)} size={30} />
          <div className="resource-comments__bubble"><div className="resource-comments__by"><strong>{memberName(snapshot.members, comment.authorId)}</strong><time dateTime={comment.createdAt}>{formatClock(new Date(comment.createdAt))}</time></div><p>{comment.text}</p></div>
          {comment.canDelete && <button type="button" className="icon-button" aria-label="Eliminar comentario" disabled={pending || !active}
            onClick={() => { if (typeof source.deleteFeedThreadComment === 'function' && confirm('¿Eliminar este comentario?')) void mutate(() => source.deleteFeedThreadComment(target, comment.id)); }}><Icon name="trash" size={14} /></button>}
        </li>)}</ul> : thread && <p className="resource-comments__empty">Todavía no hay comentarios. Abre la conversación con una pregunta o una idea.</p>}
        {thread?.canComment ? <form className="resource-comments__form" onSubmit={submit}>
          <label htmlFor={`${regionId}-input`}>Escribe un comentario</label>
          <textarea aria-label="Escribe un comentario" ref={input} id={`${regionId}-input`} rows={2} maxLength={thread.maxLength} placeholder="Comparte una idea o pregunta…" value={text} disabled={pending || !active} onChange={(event) => setText(event.target.value)} />
          <div className="resource-comments__submit"><span className="muted">{text.length}/{thread.maxLength}</span><button type="submit" disabled={pending || !active || !text.trim()}>{pending ? 'Publicando…' : 'Comentar'}</button></div>
        </form> : thread && <p className="resource-comments__readonly">{thread.reason || 'Esta conversación está cerrada.'}</p>}
        {error && <div className="resource-comments__error"><p className="error" role="alert">{error}</p>{!pending && <button type="button" className="link-button" onClick={() => void load()}>Reintentar</button>}</div>}
      </>}
    </div>}
  </section>;
}
