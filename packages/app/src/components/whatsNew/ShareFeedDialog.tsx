import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { feedResourceKey, type FeedResourceRef, type FeedShareLink, type FeedShareRecord } from '@b20/core';
import { useDataSource, useSnapshot } from '../../data/DataContext';
import type { DataSource } from '../../data/types';
import { Icon } from '../Icon';
import './ShareFeedDialog.css';

interface Props { target: FeedResourceRef; onClose(): void }
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'No se pudo gestionar el enlace.';
const sourceIds = new WeakMap<DataSource, number>();
let nextSourceId = 0;

export function ShareFeedDialog(props: Props) {
  const source = useDataSource(); const { me } = useSnapshot();
  if (!sourceIds.has(source)) sourceIds.set(source, ++nextSourceId);
  return <ShareDialogSession key={`${sourceIds.get(source)}:${me?.id}:${feedResourceKey(props.target)}`} {...props} />;
}

function ShareDialogSession({ target, onClose }: Props) {
  const source = useDataSource();
  const snapshot = useSnapshot();
  const actor = snapshot.me?.id;
  const active = snapshot.connection === 'ready' && snapshot.me?.status === 'active';
  const supported = typeof source.createFeedShare === 'function' && typeof source.listFeedShares === 'function';
  const [records, setRecords] = useState<FeedShareRecord[]>([]);
  const [link, setLink] = useState<FeedShareLink>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const lock = useRef(false);
  const started = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const generation = useRef(0);
  const current = () => alive.current && source.getSnapshot().me?.id === actor && source.getSnapshot().me?.status === 'active';
  const load = async () => {
    if (!active || !supported) { setLoading(false); return; }
    const version = ++generation.current; setLoading(true);
    try { const result = await source.listFeedShares(target); if (current() && version === generation.current) { setRecords(result); setError(''); } }
    catch (cause) { if (current() && version === generation.current) setError(message(cause)); }
    finally { if (current() && version === generation.current) setLoading(false); }
  };
  useEffect(() => {
    alive.current = true;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    if (!started.current) { started.current = true; if (active && supported) void create(); else setLoading(false); }
    return () => { alive.current = false; generation.current++; document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
    // El padre remonta el diálogo cuando cambia el recurso o la sesión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, actor, target.kind, target.id]);
  useEffect(() => { if (panel.current && !panel.current.contains(document.activeElement)) panel.current.querySelector<HTMLButtonElement>('button')?.focus(); }, [records, link]);
  useEffect(() => { if (!active) { setLink(undefined); setRecords([]); setError(''); generation.current++; } }, [active]);
  const create = async () => {
    if (!active || !supported || lock.current) return;
    lock.current = true; setPending(true); setError(''); setStatus('');
    try {
      const result = await source.createFeedShare(target);
      if (current()) { setLink(result); setStatus(result.url.startsWith('#') ? 'Vista previa de prueba lista.' : 'Enlace creado. Ya puedes copiarlo o abrir WhatsApp.'); }
      const rows = await source.listFeedShares(target); if (current()) setRecords(rows);
    } catch (cause) { if (current()) { setError(message(cause)); try { const rows = await source.listFeedShares(target); if (current()) setRecords(rows); } catch { /* El error de la operación conserva su contexto. */ } } }
    finally { lock.current = false; if (current()) { setPending(false); setLoading(false); } }
  };
  const revoke = async (id: string) => {
    if (!active || lock.current || typeof source.revokeFeedShare !== 'function') return;
    lock.current = true; setPending(true); setError(''); setStatus('');
    try { await source.revokeFeedShare(id); if (current()) { if (link?.id === id) setLink(undefined); setRecords((rows) => rows.map((row) => row.id === id ? { ...row, active: false } : row)); setStatus('Enlace revocado.'); } }
    catch (cause) { if (current()) setError(message(cause)); }
    finally { lock.current = false; if (current()) setPending(false); }
  };
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url.startsWith('#') ? new URL(link.url, window.location.href).href : link.url); if (current()) setStatus('Enlace copiado.'); }
    catch { if (current()) setError('No se pudo copiar. Selecciona el enlace y cópialo manualmente.'); }
  };
  const keyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab') return;
    const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]') ?? [])];
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  const demo = link?.url.startsWith('#');
  return createPortal(<div className="feed-share-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="feed-share-dialog" ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={keyDown} data-resource={feedResourceKey(target)}>
      <header className="feed-share-dialog__head"><div><span className="feed-share-dialog__eyebrow">Compartir publicación</span><h2 id={titleId}>Llévala a la conversación</h2></div><button type="button" className="icon-button" aria-label="Cerrar diálogo de compartir" onClick={onClose}><Icon name="close" size={20} /></button></header>
      <p id={descriptionId} className="feed-share-dialog__intro">El enlace muestra un título y un extracto públicos. Para abrir el contenido completo se necesita una cuenta con acceso al grupo.</p>
      {!supported ? <p className="muted">Compartir enlaces todavía no está disponible.</p> : !active ? <p className="muted">Conéctate con tu cuenta activa para compartir.</p> : <>
        {link && <><article className="feed-share-preview"><div className="feed-share-preview__brand">B20 <span>Campus</span></div><div className="feed-share-preview__content"><span>{link.preview.kindLabel}{link.preview.subject ? ` · ${link.preview.subject}` : ''}</span><h3>{link.preview.title}</h3><p>{link.preview.description || 'Contenido compartido con el grupo.'}</p></div></article>
          {demo && <p className="feed-share-dialog__notice" role="note">Modo de prueba: esta vista previa abre el contenido local. No crea un enlace público ni una vista previa real de WhatsApp.</p>}
          <label className="feed-share-dialog__url">Enlace para compartir<input readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} /></label>
          <div className="feed-share-dialog__actions"><button type="button" className="secondary" onClick={() => void copy()}><Icon name="copy" size={16} />Copiar enlace</button>{!demo && <a className="feed-share-dialog__whatsapp" href={`https://wa.me/?text=${encodeURIComponent(`${link.preview.title}\n${link.url}`)}`} target="_blank" rel="noopener noreferrer">Compartir por WhatsApp<Icon name="forward" size={16} /></a>}</div>
        </>}
        {!link && (pending ? <p role="status">Preparando enlace y vista previa…</p> : <button type="button" className="feed-share-dialog__create" disabled={loading} onClick={() => void create()}>Crear enlace con vista previa</button>)}
        {status && <p className="feed-share-dialog__status" role="status">{status}</p>}
        {error && <div className="feed-share-dialog__error"><p className="error" role="alert">{error}</p><button type="button" className="link-button" disabled={pending} onClick={() => void load()}>Revisar enlaces y reintentar</button></div>}
        <section className="feed-share-dialog__existing" aria-label="Enlaces existentes"><h3>Enlaces de esta publicación</h3>{loading ? <p className="muted" role="status">Consultando enlaces…</p> : records.length ? <ul>{records.map((row) => <li key={row.id}><div><strong>{row.active ? 'Enlace activo' : 'Enlace revocado'}</strong><time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString('es-MX')}</time></div>{row.active && row.canRevoke && <button type="button" className="link-button" disabled={pending} onClick={() => void revoke(row.id)}>Revocar enlace</button>}</li>)}</ul> : <p className="muted">Aún no hay enlaces creados.</p>}</section>
        <p className="feed-share-dialog__fine">Puedes revocar un enlace para impedir nuevas aperturas. Las vistas previas que otras aplicaciones ya guardaron pueden permanecer en su caché.</p>
      </>}
    </div>
  </div>, document.body);
}
