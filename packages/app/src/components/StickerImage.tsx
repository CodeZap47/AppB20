import { useEffect, useRef, useState } from 'react';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Id } from '../data/types';

/** Resuelve bytes solo para imágenes visibles y revoca la URL al cambiar permisos o sesión. */
export function StickerImage({ id, size = 140, alt = 'Sticker' }: { id: Id; size?: number; alt?: string }) {
  const source = useDataSource();
  const { stickers, me } = useSnapshot();
  const sticker = stickers.find((row) => row.id === id);
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const [loaded, setLoaded] = useState<{ actor: Id; id: Id; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const actor = me?.id;
  const native = sticker?.url.startsWith('native:') || sticker?.url === '';
  const direct = sticker?.url && /^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/.test(sticker.url) ? sticker.url : undefined;

  useEffect(() => {
    if (visible || !ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    });
    observer.observe(ref.current); return () => observer.disconnect();
  }, [visible, id]);

  useEffect(() => {
    if (!native || !visible || !actor || !sticker) return;
    let active = true; let objectUrl: string | undefined;
    setFailed(false);
    void source.downloadSticker(id).then((blob) => {
      const current = source.getSnapshot();
      if (!active || current.me?.status !== 'active' || current.me.id !== actor || !current.stickers.some((row) => row.id === id && row.url === sticker.url)) return;
      objectUrl = URL.createObjectURL(blob); setLoaded({ actor, id, url: objectUrl });
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [source, id, actor, sticker?.url, visible, native]);

  const url = direct ?? (loaded && loaded.actor === actor && loaded.id === id ? loaded.url : undefined);
  if (!sticker || (!native && !direct) || failed) return <span className="sticker sticker--missing">Sticker no disponible</span>;
  if (!url) return <span ref={ref} className="sticker" style={{ width: size, height: size, display: 'inline-block' }} role="status" aria-label="Cargando sticker" />;
  return <img className="sticker" src={url} alt={alt} width={size} height={size} loading="lazy" decoding="async" draggable={false} />;
}
