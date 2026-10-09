import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useSnapshot } from '../data/DataContext';
import type { Id } from '../data/types';
import { Icon } from './Icon';

/** Panel de stickers sobre el cuadro de texto: un paquete a la vez, y tocar uno lo envía. */
export function StickerPicker({
  onPick,
  onClose,
}: {
  onPick: (id: Id) => void;
  onClose: () => void;
}) {
  const { me, stickerPacks, stickers } = useSnapshot();
  const packs = [...stickerPacks]
    .filter((p) => stickers.some((s) => s.packId === p.id))
    .sort(
      (a, b) =>
        Number(b.ownerId === me?.id) - Number(a.ownerId === me?.id) || a.name.localeCompare(b.name),
    );
  const [packId, setPackId] = useState(packs[0]?.id ?? '');
  const ref = useRef<HTMLDivElement>(null);
  const pack = packs.find((p) => p.id === packId) ?? packs[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="sticker-picker" ref={ref} role="dialog" aria-label="Stickers">
      <header className="sticker-picker__header">
        <strong>Stickers</strong>
        <Link to="/m/mensajes/stickers" className="link-button">
          Importar o administrar
        </Link>
        <button
          type="button"
          className="icon-button"
          aria-label="Cerrar stickers"
          onClick={onClose}
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      {packs.length === 0 ? (
        <p className="sticker-picker__empty muted">
          Todavía no hay stickers.{' '}
          <Link to="/m/mensajes/stickers">Importa los tuyos de WhatsApp</Link>.
        </p>
      ) : (
        <>
          {packs.length > 1 && (
            <div className="chips chips--small chips--scroll" role="group" aria-label="Paquete">
              {packs.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="chip"
                  aria-pressed={p.id === pack?.id}
                  onClick={() => setPackId(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
          <div className="sticker-picker__grid">
            {stickers
              .filter((s) => s.packId === pack?.id)
              .map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  className="sticker-picker__item"
                  aria-label={`Enviar sticker ${i + 1} de ${pack?.name}`}
                  onClick={() => onPick(s.id)}
                >
                  <img src={s.url} alt="" width={72} height={72} loading="lazy" draggable={false} />
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
