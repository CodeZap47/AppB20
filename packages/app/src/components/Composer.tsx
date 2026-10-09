import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Link, useNavigate } from 'react-router';
import { useSnapshot } from '../data/DataContext';
import type { Id } from '../data/types';
import type { ChatMessage } from '../lib/messages';
import {
  formatReference,
  LINK_KINDS,
  messagePreview,
  referencesIn,
  resolveReference,
  searchReferences,
  stripReferences,
  type LinkKind,
  type Reference,
} from '../lib/references';
import { normalize } from '../lib/search';
import { Icon, type IconName } from './Icon';
import { StickerPicker } from './StickerPicker';

/** Borradores por conversación: cambiar de chat no borra lo que estabas escribiendo. */
const drafts = new Map<string, string>();

/** En pantallas táctiles Enter agrega un salto de línea; se envía con el botón. */
function isTouch(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** Responder a un mensaje o corregir uno propio. */
export type ComposerMode =
  { kind: 'reply'; message: ChatMessage; name: string } | { kind: 'edit'; message: ChatMessage };

interface CommandOption {
  key: string;
  name: string;
  hint: string;
  icon: IconName;
  run: () => void;
}

interface RefOption {
  key: string;
  title: string;
  hint: string;
  run: () => void;
}

const LINK_ICONS: Record<LinkKind, IconName> = {
  tarea: 'folder',
  trabajo: 'upload',
  clase: 'users',
  nota: 'file',
  pregunta: 'chat',
};

/** Reconoce `/comando` o `/comando búsqueda` cuando es todo lo que hay en el cuadro. */
function parseSlash(text: string): { command: string; query: string; spaced: boolean } | undefined {
  const match = /^\/([^\s/]*)(\s([^\n]*))?$/.exec(text);
  if (!match) return undefined;
  return {
    command: normalize(match[1] ?? ''),
    query: match[3] ?? '',
    spaced: match[2] !== undefined,
  };
}

export function Composer({
  placeholder,
  onSend,
  draftKey,
  error,
  maxLength = 4000,
  mode,
  onCancelMode,
}: {
  placeholder: string;
  /** Devuelve false si no se envió, para conservar el texto. */
  onSend: (text: string) => boolean;
  /** Identifica la conversación (y a quien escribe) para guardar su borrador. */
  draftKey: string;
  error?: string | null;
  maxLength?: number;
  mode?: ComposerMode;
  onCancelMode?: () => void;
}) {
  const data = useSnapshot();
  const navigate = useNavigate();
  const menuId = useId();
  const [text, setText] = useState(() => drafts.get(draftKey) ?? '');
  const [refs, setRefs] = useState<Reference[]>([]);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [stickers, setStickers] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editing = mode?.kind === 'edit' ? mode.message : undefined;
  const remaining = maxLength - text.length;

  // El cuadro crece con el texto hasta el máximo que fija el CSS.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [text]);

  // Al editar, el cuadro toma el texto del mensaje; al salir, vuelve el borrador.
  useEffect(() => {
    if (editing) {
      setText(stripReferences(editing.text));
      setRefs(referencesIn(editing.text).filter((r) => r.kind !== 'sticker'));
    } else {
      setText(drafts.get(draftKey) ?? '');
      setRefs([]);
    }
    if (mode) inputRef.current?.focus();
  }, [editing?.id, mode?.kind, mode?.message.id]);

  const update = (value: string) => {
    setText(value);
    setDismissed(false);
    setActive(0);
    if (editing) return;
    if (value) drafts.set(draftKey, value);
    else drafts.delete(draftKey);
  };

  const compose = (body: string, references: Reference[]) =>
    [body.trim(), ...references.map((r) => formatReference(r.kind, r.id))]
      .filter(Boolean)
      .join('\n');

  const send = () => {
    const message = compose(text, refs);
    if (message && onSend(message)) {
      update('');
      setRefs([]);
    }
    inputRef.current?.focus();
  };

  const sendSticker = (id: Id) => {
    setStickers(false);
    onSend(formatReference('sticker', id));
    inputRef.current?.focus();
  };

  const addRef = (ref: Reference) => {
    setRefs((current) =>
      current.some((r) => r.kind === ref.kind && r.id === ref.id) ? current : [...current, ref],
    );
    update('');
    inputRef.current?.focus();
  };

  // Menú de «/»: primero los comandos; con un comando de referencia y un espacio, sus resultados.
  const slash = dismissed || editing ? undefined : parseSlash(text);
  const linkKind =
    slash && (Object.keys(LINK_KINDS) as LinkKind[]).find((k) => k === slash.command);
  let commandOptions: CommandOption[] = [];
  let refOptions: RefOption[] = [];
  if (slash && linkKind && slash.spaced) {
    refOptions = searchReferences(linkKind, slash.query, data).map((r) => ({
      key: `${r.kind}:${r.id}`,
      title: r.title,
      hint: [r.label, r.context].filter(Boolean).join(' · '),
      run: () => addRef({ kind: r.kind, id: r.id }),
    }));
  } else if (slash && !slash.spaced) {
    const all: CommandOption[] = [
      ...(Object.keys(LINK_KINDS) as LinkKind[]).map((kind) => ({
        key: kind,
        name: kind,
        hint: LINK_KINDS[kind].hint,
        icon: LINK_ICONS[kind],
        run: () => update(`/${kind} `),
      })),
      {
        key: 'sticker',
        name: 'sticker',
        hint: 'Enviar un sticker',
        icon: 'smile',
        run: () => {
          update('');
          setStickers(true);
        },
      },
      {
        key: 'codigo',
        name: 'codigo',
        hint: 'Bloque de código que conserva los espacios',
        icon: 'file',
        run: () => {
          update('```\n\n```');
          requestAnimationFrame(() => inputRef.current?.setSelectionRange(4, 4));
        },
      },
      ...data.chatCommands
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({
          key: `propio:${c.id}`,
          name: c.name,
          hint: c.description || 'Tu comando',
          icon: 'slash' as IconName,
          run: () => update(c.text),
        })),
      {
        key: 'comandos',
        name: 'comandos',
        hint: 'Crear o editar tus propios comandos',
        icon: 'plus',
        run: () => void navigate('/m/mensajes/comandos'),
      },
    ];
    commandOptions = all.filter((o) => o.name.startsWith(slash.command));
  }
  const options: { key: string; run: () => void }[] = refOptions.length
    ? refOptions
    : commandOptions;
  const menuOpen = Boolean(slash) && (options.length > 0 || Boolean(linkKind && slash?.spaced));
  const current = Math.min(active, Math.max(0, options.length - 1));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (menuOpen && options[current]) options[current].run();
    else send();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((current + step + options.length) % Math.max(1, options.length));
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        if (options[current]) {
          e.preventDefault();
          options[current].run();
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === 'Escape' && mode) {
      e.preventDefault();
      onCancelMode?.();
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || isTouch()) return;
    e.preventDefault();
    send();
  };

  const canSend = Boolean(text.trim() || refs.length);
  const optionId = (i: number) => `${menuId}-${i}`;

  return (
    <form className="composer" onSubmit={submit}>
      {error && (
        <p className="composer__error error" role="alert">
          {error}
        </p>
      )}

      {mode && (
        <div className="composer__mode">
          <Icon name={mode.kind === 'edit' ? 'edit' : 'reply'} size={18} />
          <span className="composer__mode-text">
            <strong>
              {mode.kind === 'edit' ? 'Editando tu mensaje' : `Respondiendo a ${mode.name}`}
            </strong>
            <span>{messagePreview(mode.message)}</span>
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Cancelar"
            onClick={onCancelMode}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      )}

      {refs.length > 0 && (
        <ul className="composer__refs" aria-label="Referencias que se enviarán">
          {refs.map((r) => {
            const resolved = resolveReference(r, data);
            return (
              <li key={`${r.kind}:${r.id}`} className="ref-chip">
                <Icon name={LINK_ICONS[r.kind as LinkKind] ?? 'file'} size={14} />
                <span>{resolved ? resolved.title : 'Referencia no disponible'}</span>
                <button
                  type="button"
                  aria-label={`Quitar ${resolved?.title ?? 'referencia'}`}
                  onClick={() => setRefs(refs.filter((x) => x !== r))}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {menuOpen && slash && (
        <div className="slash-menu" role="listbox" id={menuId} aria-label="Comandos">
          {linkKind && slash.spaced ? (
            <p className="slash-menu__title">
              {LINK_KINDS[linkKind].label}: {slash.query ? `«${slash.query}»` : 'las más recientes'}
            </p>
          ) : (
            <p className="slash-menu__title">Comandos</p>
          )}
          {refOptions.map((o, i) => (
            <button
              key={o.key}
              id={optionId(i)}
              type="button"
              role="option"
              aria-selected={i === current}
              className="slash-menu__item"
              onMouseEnter={() => setActive(i)}
              onClick={o.run}
            >
              <span className="slash-menu__body">
                <strong>{o.title}</strong>
                <span>{o.hint}</span>
              </span>
            </button>
          ))}
          {linkKind && slash.spaced && refOptions.length === 0 && (
            <p className="slash-menu__empty">Nada coincide. Prueba con otra palabra.</p>
          )}
          {commandOptions.map((o, i) => (
            <button
              key={o.key}
              id={optionId(i)}
              type="button"
              role="option"
              aria-selected={i === current}
              className="slash-menu__item"
              onMouseEnter={() => setActive(i)}
              onClick={o.run}
            >
              <span className="slash-menu__icon" aria-hidden="true">
                <Icon name={o.icon} size={18} />
              </span>
              <span className="slash-menu__body">
                <strong>/{o.name}</strong>
                <span>{o.hint}</span>
              </span>
            </button>
          ))}
          <p className="slash-menu__keys">
            ↑ ↓ para elegir · Enter o Tab para usar · Esc para cerrar
          </p>
        </div>
      )}

      {stickers && <StickerPicker onPick={sendSticker} onClose={() => setStickers(false)} />}

      <div className="composer__row">
        <button
          type="button"
          className="icon-button composer__tool"
          aria-label="Stickers"
          title="Stickers"
          aria-expanded={stickers}
          onClick={() => setStickers(!stickers)}
          disabled={Boolean(editing)}
        >
          <Icon name="smile" />
        </button>
        <button
          type="button"
          className="icon-button composer__tool"
          aria-label="Comandos y referencias"
          title="Comandos y referencias (/)"
          onClick={() => {
            update('/');
            inputRef.current?.focus();
          }}
          disabled={Boolean(editing)}
        >
          <Icon name="slash" />
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          aria-label={placeholder}
          placeholder={placeholder}
          value={text}
          onChange={(e) => update(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={maxLength}
          autoFocus={!isTouch()}
          role="combobox"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          aria-activedescendant={menuOpen && options.length ? optionId(current) : undefined}
          aria-autocomplete="list"
        />
        <button
          type="submit"
          className="composer__send"
          disabled={!canSend}
          aria-label={editing ? 'Guardar cambios' : 'Enviar mensaje'}
        >
          <Icon name={editing ? 'check' : 'send'} />
        </button>
      </div>
      <p className="composer__hint">
        <span className="composer__keys">
          / para comandos y referencias · Enter para enviar · Mayús + Enter para otra línea
        </span>
        {remaining <= 200 && (
          <span className={remaining === 0 ? 'error' : undefined} aria-live="polite">
            {remaining === 0
              ? 'Llegaste al límite de caracteres'
              : `Te quedan ${remaining} caracteres`}
          </span>
        )}
      </p>
    </form>
  );
}

/** Enlace para administrar stickers y comandos, debajo de la lista de conversaciones. */
export function ChatToolsLinks() {
  return (
    <p className="chat__tools">
      <Link to="/m/mensajes/stickers">
        <Icon name="smile" size={16} /> Stickers
      </Link>
      <Link to="/m/mensajes/comandos">
        <Icon name="slash" size={16} /> Comandos
      </Link>
    </p>
  );
}
