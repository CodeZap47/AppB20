import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { normalizeReaction } from '@b20/core';
import { emojiCatalog } from '../lib/emojiCatalog';
import { ChatButton } from './messaging/Messaging';
import './EmojiPicker.css';

const categories: Record<string, string> = {
  'Smileys & Emotion': 'Caras y emociones', 'People & Body': 'Personas y cuerpo',
  'Animals & Nature': 'Animales y naturaleza', 'Food & Drink': 'Comida y bebida',
  'Travel & Places': 'Viajes y lugares', Activities: 'Actividades', Objects: 'Objetos',
  Symbols: 'Símbolos', Flags: 'Banderas', Component: 'Componentes',
};
const RECENTS_KEY = 'b20:reaction-emojis:v1';
const normalize = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(normalizeReaction(item))).slice(0, 24) : [];
  } catch { return []; }
}

/** The full catalog is bundled locally, including Spanish search annotations. */
export function EmojiPicker({ open, onClose, onSelect }: {
  open: boolean; onClose: () => void; onSelect: (emoji: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [tone, setTone] = useState('0');
  const [limit, setLimit] = useState(96);
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState(readRecent);
  const [native, setNative] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => {
    const search = normalize(query.trim());
    return emojiCatalog.filter((entry) =>
      (!category || (category === 'recent' ? recents.includes(entry.emoji) : entry.category === category)) &&
      (category === 'recent' || tone === 'all' || (tone === '0' ? entry.tones.length === 0 : entry.tones.includes(Number(tone)))) &&
      (!search || normalize(`${entry.label} ${entry.keywords} ${entry.emoji}`).includes(search)),
    ).sort((a, b) => category === 'recent' ? recents.indexOf(a.emoji) - recents.indexOf(b.emoji) : 0);
  }, [query, category, tone, recents]);
  const shown = entries.slice(0, limit);
  const reset = () => { setLimit(96); setActive(0); };
  const select = (emoji: string) => {
    const canonical = normalizeReaction(emoji);
    if (!canonical) return;
    const recent = [canonical, ...recents.filter((item) => item !== canonical)].slice(0, 24);
    setRecents(recent);
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(recent)); } catch { /* Optional UI preference. */ }
    onSelect(canonical);
    onClose();
  };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = Number((event.target as HTMLElement).dataset.emojiIndex);
    if (!Number.isInteger(current)) return;
    const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 }[event.key];
    let next = delta === undefined ? undefined : Math.min(Math.max(0, current + delta), shown.length - 1);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = shown.length - 1;
    if (next === undefined) return;
    event.preventDefault(); setActive(next);
    grid.current?.querySelector<HTMLButtonElement>(`[data-emoji-index="${next}"]`)?.focus();
  };
  return <ModalOverlay isOpen={open} onOpenChange={(value) => { if (!value) onClose(); }} isDismissable className="b20-messaging emoji-overlay">
    <Modal className="emoji-modal">
      <Dialog aria-label="Todas las reacciones" className="emoji-picker">
        <header><div><h3>Elige una reacción</h3><p>Busca un emoji o usa el teclado de tu dispositivo.</p></div><ChatButton variant="tertiary" aria-label="Cerrar selector de reacciones" onClick={onClose}>×</ChatButton></header>
        <input autoFocus type="search" aria-label="Buscar emoji" placeholder="Buscar: alegría, corazón, pizza…" value={query} onChange={(event) => { setQuery(event.target.value); reset(); }} />
        <div className="emoji-picker__filters">
          <select aria-label="Categoría de emojis" value={category} onChange={(event) => { setCategory(event.target.value); reset(); }}>
            <option value="">Todas las categorías</option><option value="recent">Recientes</option>
            {Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select aria-label="Tono de piel" value={tone} onChange={(event) => { setTone(event.target.value); reset(); }}>
            <option value="0">Sin variante de tono</option><option value="all">Todos los tonos</option>
            {['Claro', 'Claro medio', 'Medio', 'Oscuro medio', 'Oscuro'].map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
          </select>
        </div>
        <div className="emoji-picker__scroll">
          <div ref={grid} className="emoji-picker__grid" role="group" aria-label="Emojis disponibles" onKeyDown={move}>
            {shown.map((entry, index) => <button type="button" key={entry.emoji} aria-label={entry.label} title={entry.label} data-emoji-index={index} tabIndex={index === active ? 0 : -1} onFocus={() => setActive(index)} onClick={() => select(entry.emoji)}>{entry.emoji}</button>)}
          </div>
          {!entries.length && <p className="emoji-picker__empty">{category === 'recent' ? 'Aquí aparecerán las reacciones que uses.' : 'No encontramos emojis. Prueba otra palabra o categoría.'}</p>}
          {limit < entries.length && <ChatButton variant="secondary" onClick={() => setLimit((count) => count + 96)}>Mostrar más emojis</ChatButton>}
        </div>
        <form className="emoji-picker__native" onSubmit={(event) => { event.preventDefault(); select(native); }}>
          <label htmlFor="native-reaction">Desde tu teclado emoji</label>
          <div><input id="native-reaction" aria-label="Emoji del teclado" placeholder="Pega o escribe un emoji" value={native} onChange={(event) => setNative(event.target.value)} /><ChatButton type="submit" disabled={!normalizeReaction(native)}>Usar</ChatButton></div>
          {native && !normalizeReaction(native) && <small role="status">Introduce un solo emoji completo.</small>}
        </form>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}
