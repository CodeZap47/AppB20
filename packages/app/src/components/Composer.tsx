import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useSnapshot } from '../data/DataContext';
import { fileSizeError, type ChatPostRef, type ChatResourceKind } from '@b20/core';
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
  postReference,
  type LinkKind,
  type Reference,
} from '../lib/references';
import { normalize } from '../lib/search';
import { mentionToken } from '../lib/chat';
import { Icon, type IconName } from './Icon';
import { StickerPicker } from './StickerPicker';
import { ChatButton, ChatTextArea } from './messaging/Messaging';
import { FilePicker } from './FilePicker';
import { UploadFileList, type UploadFileItem } from './uploads/UploadFileList';
import './uploads/consumers.css';
import { ChatResourceCreatePanel } from './messaging/ChatResourceCreatePanel';
import { rememberCommandConversation } from '../lib/commandNavigation';
import { memberName } from '../lib/format';
import { confirmChatDraft, consumeChatShareIntent, getChatDraft, rememberChatSend, saveChatDraft, subscribeChatDraft } from '../lib/chatDrafts';
import type { ChatPostShareIntent } from './messaging/SharePostDialog';
import { ChatPostPicker } from './messaging/ChatPostPicker';
import { ChatPostDraftChip } from './messaging/ChatPostDraftChip';
import { useReadingComposer } from './messaging/ReadingComposerDock';

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
  attachments = false,
  mentionMemberIds,
  disabled = false,
  retryingAttachments = false,
  uploadItems = [],
  onCancelAttachments,
  onDiscardAttachments,
  onTyping,
  onLiveDraftChange,
}: {
  placeholder: string;
  /** Resuelve `true` si se envió; si no, el texto se queda en el campo. */
  onSend: (text: string, files?: File[]) => Promise<boolean>;
  /** Identifica la conversación (y a quien escribe) para guardar su borrador. */
  draftKey: string;
  error?: string | null;
  maxLength?: number;
  mode?: ComposerMode;
  onCancelMode?: () => void;
  attachments?: boolean;
  /** En directos solo se pueden mencionar sus participantes. */
  mentionMemberIds?: Id[];
  disabled?: boolean;
  retryingAttachments?: boolean;
  uploadItems?: UploadFileItem[];
  onCancelAttachments?: () => void;
  onDiscardAttachments?: () => Promise<boolean>;
  onTyping?: (typing: boolean) => void;
  onLiveDraftChange?: (text: string) => void;
}) {
  const data = useSnapshot();
  const navigate = useNavigate();
  const location = useLocation();
  const reading = useReadingComposer();
  const readingRef = useRef(reading);
  readingRef.current = reading;
  const menuId = useId();
  const [text, setText] = useState(() => getChatDraft(draftKey).text);
  const [refs, setRefs] = useState<Reference[]>(() => getChatDraft(draftKey).refs);
  const [creating, setCreating] = useState<{ kind: ChatResourceKind; title: string }>();
  const [commandNotice, setCommandNotice] = useState('');
  const commandBase = useRef<{ text: string; refs: Reference[] } | undefined>(undefined);
  const creationBase = useRef<{ text: string; refs: Reference[] }>({ text: '', refs: [] });
  const appliedIntent = useRef<string | undefined>(undefined);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [stickers, setStickers] = useState(false);
  const [pickingPosts, setPickingPosts] = useState(false);
  const [files, setFiles] = useState<File[]>(() => getChatDraft(draftKey).files);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editing = mode?.kind === 'edit' ? mode.message : undefined;
  const remaining = maxLength - text.length;
  const attachmentsBlocked = disabled || sending || retryingAttachments || Boolean(editing);
  const attachmentPanelId = `${menuId}-attachments`;
  const restoring = useRef(false);
  const currentDraftKey = useRef(draftKey);
  currentDraftKey.current = draftKey;
  const mounted = useRef(true);
  const readingEpoch = useRef(0);
  const presenceCallbacks = useRef({ onTyping, onLiveDraftChange });
  presenceCallbacks.current = { onTyping, onLiveDraftChange };
  const imeLock = `${menuId}:ime`;
  const toolsLock = `${menuId}:tools`;
  const registerInput = reading?.registerInput;
  const setReadingLocked = reading?.setLocked;
  useLayoutEffect(() => {
    registerInput?.(inputRef.current);
    return () => registerInput?.(null);
  }, [registerInput]);
  useLayoutEffect(() => {
    if (!reading?.hidden) return;
    readingEpoch.current++;
    if (document.activeElement === inputRef.current) inputRef.current?.blur();
    presenceCallbacks.current.onTyping?.(false);
    presenceCallbacks.current.onLiveDraftChange?.('');
  }, [reading?.hidden]);
  useEffect(() => () => setReadingLocked?.(imeLock, false), [setReadingLocked, imeLock]);
  const focusComposer = () => {
    if (readingRef.current) readingRef.current.reveal(true);
    else inputRef.current?.focus({ preventScroll: true });
  };
  const refocusVisibleComposer = (epoch: number) => {
    if (readingEpoch.current === epoch && !readingRef.current?.hidden) inputRef.current?.focus({ preventScroll: true });
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => subscribeChatDraft(draftKey, (next) => { if (!editing) { setText(next.text); setRefs(next.refs); setFiles(next.files); } }), [draftKey, Boolean(editing)]);
  useEffect(() => { if (data.me) rememberCommandConversation(data.me.id, location.pathname); }, [data.me?.id, location.pathname]);

  const takeFiles = (list: File[]) => {
    if (attachmentsBlocked) return;
    const accepted: File[] = [];
    const errors: string[] = [];
    for (const file of list) {
      const problem = fileSizeError(file.name, file.size);
      if (problem) errors.push(problem); else accepted.push(file);
    }
    if (accepted.length) setFiles((current) => [...current, ...accepted]);
    setFileError(errors.join(' ') || null);
    setAttachmentsOpen(true);
  };
  const revealAttachments = (event: DragEvent) => {
    if (!attachments || !Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    if (!attachmentsBlocked) setAttachmentsOpen(true);
  };
  const dropAttachments = (event: DragEvent) => {
    if (!attachments || event.defaultPrevented || !event.dataTransfer.files.length) return;
    event.preventDefault();
    takeFiles(Array.from(event.dataTransfer.files));
  };

  // El cuadro crece con el texto hasta el máximo que fija el CSS.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || reading?.hidden) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [text, reading?.hidden]);

  // Al editar, el cuadro toma el texto del mensaje; al salir, vuelve el borrador.
  useEffect(() => {
    restoring.current = true;
    if (editing) {
      setText(stripReferences(editing.text));
      setRefs(referencesIn(editing.text).filter((r) => r.kind !== 'sticker'));
    } else {
      const draft = getChatDraft(draftKey);
      setText(draft.text);
      setRefs(draft.refs);
      setFiles(draft.files);
    }
    if (mode) focusComposer();
  }, [draftKey, editing?.id, mode?.kind, mode?.message.id]);
  useEffect(() => {
    if (error || fileError || retryingAttachments) readingRef.current?.reveal(false);
  }, [error, fileError, retryingAttachments]);
  useEffect(() => {
    if (restoring.current) { restoring.current = false; return; }
    if (!editing) saveChatDraft(draftKey, { text, refs, files });
  }, [draftKey, text, refs, files, editing]);

  const update = (value: string) => {
    onTyping?.(Boolean(value.trim()) && !disabled);
    onLiveDraftChange?.(value);
    setText(value);
    setDismissed(false);
    setActive(0);
    if (editing) return;
    saveChatDraft(draftKey, { text: value, refs, files });
  };

  const compose = (body: string, references: Reference[]) =>
    [body.trim(), ...references.map((r) => formatReference(r.kind, r.id))]
      .filter(Boolean)
      .join('\n');

  const send = async () => {
    if (disabled || sendingRef.current) return;
    const focusEpoch = readingEpoch.current;
    const message = compose(text, refs);
    if (!message && !files.length) return;
    sendingRef.current = true;
    setSending(true);
    const sent = editing ? undefined : rememberChatSend(draftKey, { text, refs, files }, retryingAttachments);
    try {
      if (await onSend(message, files)) {
        const next = sent ? confirmChatDraft(draftKey, sent) : undefined;
        if (mounted.current && currentDraftKey.current === draftKey) {
          if (next) { setText(next.text); setRefs(next.refs); setFiles(next.files); }
          else onCancelMode?.();
          onTyping?.(false); onLiveDraftChange?.('');
          setCommandNotice(''); setFileError(null);
        }
      }
    } finally { sendingRef.current = false; setSending(false); }
    refocusVisibleComposer(focusEpoch);
  };

  const sendSticker = (id: Id) => {
    if (disabled || retryingAttachments || sendingRef.current) return;
    const focusEpoch = readingEpoch.current;
    setStickers(false);
    sendingRef.current = true;
    setSending(true);
    void onSend(formatReference('sticker', id)).finally(() => {
      sendingRef.current = false;
      setSending(false);
      refocusVisibleComposer(focusEpoch);
    });
  };

  const discardAttachments = async () => {
    if (sendingRef.current || !onDiscardAttachments) return;
    sendingRef.current = true;
    setSending(true);
    const sent = rememberChatSend(draftKey, { text, refs, files }, true);
    try {
      if (await onDiscardAttachments()) {
        const next = confirmChatDraft(draftKey, sent);
        if (mounted.current && currentDraftKey.current === draftKey) { setText(next.text); setRefs(next.refs); setFiles(next.files); setFileError(null); }
      }
    } finally { sendingRef.current = false; setSending(false); }
  };

  const addRef = (ref: Reference) => {
    setRefs((current) =>
      current.some((r) => r.kind === ref.kind && r.id === ref.id) ? current : [...current, ref],
    );
    update(commandBase.current?.text ?? '');
    commandBase.current = undefined;
    focusComposer();
  };
  const addPostRef = (target: ChatPostRef) => {
    const reference = postReference(target);
    setRefs((current) => current.some((item) => item.kind === reference.kind && item.id === reference.id) ? current : [...current, reference]);
    setCommandNotice('Publicación añadida al borrador. Puedes escribir un comentario antes de enviarla.');
    focusComposer();
  };

  useEffect(() => {
    const state = location.state as { chatPostShare?: ChatPostShareIntent } | null;
    const intent = state?.chatPostShare;
    if (!intent || !data.me || disabled) return;
    if (editing) { setCommandNotice('Termina o cancela la edición para añadir la publicación al borrador.'); return; }
    if (intent.memberId === data.me.id && consumeChatShareIntent(data.me.id, intent.id)) {
      try { addPostRef(intent.target); }
      catch { setCommandNotice('La publicación no está disponible. Tu borrador se conservó.'); }
    }
    const { chatPostShare: _used, ...rest } = state!;
    void navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: Object.keys(rest).length ? rest : null });
  }, [location.key, data.me?.id, disabled, editing]);

  const openCreate = (kind: ChatResourceKind, title = '') => {
    creationBase.current = commandBase.current ?? { text: parseSlash(text) ? '' : text, refs: [...refs] };
    setCreating({ kind, title });
    onTyping?.(false); onLiveDraftChange?.('');
  };
  const finishCreate = (id?: string, shareable = false) => {
    const base = creationBase.current;
    update(base.text);
    setRefs(id && shareable && creating ? [...base.refs.filter(r => r.kind !== creating.kind || r.id !== id), { kind: creating.kind, id }] : base.refs);
    setCommandNotice(id ? shareable ? 'Recurso creado. La referencia está en tu borrador; envíala cuando quieras.' : 'Nota personal guardada. No se añadió al mensaje porque solo tú puedes verla.' : '');
    setCreating(undefined); commandBase.current = undefined;
    requestAnimationFrame(focusComposer);
  };

  useEffect(() => {
    const intent = location.state as { messageCommand?: string; commandId?: string } | null;
    if (!intent?.messageCommand || appliedIntent.current === location.key || disabled) return;
    appliedIntent.current = location.key;
    const command = intent.commandId ? data.chatCommands.find(c => c.id === intent.commandId) : undefined;
    if (intent.commandId && !command) setCommandNotice('El comando ya no está disponible. Tu borrador se conservó.');
    else if (command?.actionKind === 'create' && command.resourceKind) openCreate(command.resourceKind);
    else if (command) update([text.trim(), command.text].filter(Boolean).join('\n'));
    else {
      commandBase.current = { text, refs: [...refs] };
      update(`/${intent.messageCommand}${intent.messageCommand in LINK_KINDS ? ' ' : ''}`);
    }
    void navigate(location.pathname, { replace: true, state: null });
    focusComposer();
  }, [location.key]);

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
    refOptions.push({ key: `create:${linkKind}`, title: `Crear ${LINK_KINDS[linkKind].label.toLowerCase()}`,
      hint: 'Completa el formulario aquí y vuelve al borrador', run: () => openCreate(linkKind, slash.query) });
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
        .sort((a, b) => Number(b.ownerId === data.me?.id) - Number(a.ownerId === data.me?.id) || a.name.localeCompare(b.name))
        .map((c) => ({
          key: `propio:${c.id}`,
          name: c.name,
          hint: [c.description || (c.actionKind === 'create' ? 'Abrir formulario de creación' : 'Insertar texto'), c.visibility === 'classroom' ? 'Del salón' : 'Personal', memberName(data.members, c.ownerId)].join(' · '),
          icon: 'slash' as IconName,
          run: () => {
            if (c.actionKind === 'create' && c.resourceKind) openCreate(c.resourceKind);
            else { update([commandBase.current?.text, c.text].filter(Boolean).join('\n')); commandBase.current = undefined; }
          },
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
  const readingToolsOpen = Boolean(creating || pickingPosts || stickers || menuOpen);
  useLayoutEffect(() => {
    setReadingLocked?.(toolsLock, readingToolsOpen);
    return () => setReadingLocked?.(toolsLock, false);
  }, [setReadingLocked, toolsLock, readingToolsOpen]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (menuOpen && options[current]) options[current].run();
    else send();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
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
        if (commandBase.current) { update(commandBase.current.text); commandBase.current = undefined; }
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

  const canSend = !disabled && !sending && Boolean(text.trim() || refs.length || files.length);
  const optionId = (i: number) => `${menuId}-${i}`;

  return (
    <><form className="composer messaging-composer" onSubmit={submit} aria-label="Escribir mensaje" aria-busy={sending}
      onDragEnter={revealAttachments} onDragOver={revealAttachments} onDrop={dropAttachments}>
      {error && (
        <p className="composer__error error" role="alert">
          {error}
        </p>
      )}
      {commandNotice && <p className="chat-command-notice" role="status">{commandNotice}</p>}
      {fileError && <p className="composer__error error" role="alert">{fileError}</p>}
      {attachments && (attachmentsOpen || files.length > 0 || uploadItems.length > 0) && <section id={attachmentPanelId} className="b20-upload b20-upload--composer" aria-label="Archivos adjuntos">
        <FilePicker onFiles={takeFiles} disabled={attachmentsBlocked} label="Adjuntar archivos" />
        <UploadFileList
          items={uploadItems.length && (sending || retryingAttachments || !files.length) ? uploadItems : files.map((file, index) => ({
            id: `attachment-${index}`, name: file.name, size: file.size, type: file.type, progress: 0, state: 'selected' as const,
          }))}
          onRemove={!attachmentsBlocked && files.length ? (id) => setFiles((current) => current.filter((_file, index) => `attachment-${index}` !== id)) : undefined}
          onRetry={retryingAttachments && !sending ? () => { void send(); } : undefined}
          onCancel={sending && onCancelAttachments ? () => onCancelAttachments() : undefined}
        />
        {retryingAttachments && onDiscardAttachments && <ChatButton type="button" variant="tertiary" disabled={sending}
          onClick={() => { void discardAttachments(); }}>Descartar adjuntos pendientes</ChatButton>}
      </section>}

      {mode && (
        <div className="composer__mode">
          <Icon name={mode.kind === 'edit' ? 'edit' : 'reply'} size={18} />
          <span className="composer__mode-text">
            <strong>
              {mode.kind === 'edit' ? 'Editando tu mensaje' : `Respondiendo a ${mode.name}`}
            </strong>
            <span>{messagePreview(mode.message)}</span>
          </span>
          <ChatButton
            variant="tertiary"
            type="button"
            className="icon-button"
            aria-label="Cancelar"
            onClick={onCancelMode}
          >
            <Icon name="close" size={18} />
          </ChatButton>
        </div>
      )}

      {refs.length > 0 && (
        <ul className="composer__refs" aria-label="Referencias que se enviarán">
          {refs.map((r) => {
            if (r.kind === 'recurso') return <ChatPostDraftChip key={`${r.kind}:${r.id}`} target={r.target} onRemove={() => setRefs((current) => current.filter((item) => item !== r))} />;
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
          {linkKind && slash.spaced && refOptions.length === 1 && refOptions[0]?.key.startsWith('create:') && (
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

      <div className="messaging-composer__surface">
        <ChatTextArea
          ref={inputRef}
          className="messaging-composer__input ring-0 shadow-none rounded-none bg-transparent px-3.5 py-3"
          rows={2}
          aria-label={placeholder}
          placeholder={placeholder}
          value={text}
          onChange={(e) => update(e.target.value)}
          onBlur={() => { onTyping?.(false); onLiveDraftChange?.(''); }}
          onCompositionStart={() => setReadingLocked?.(imeLock, true)}
          onCompositionEnd={() => setReadingLocked?.(imeLock, false)}
          onKeyDown={onKeyDown}
          maxLength={maxLength}
          disabled={disabled || sending || retryingAttachments}
          autoFocus={!isTouch()}
          role="combobox"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          aria-activedescendant={menuOpen && options.length ? optionId(current) : undefined}
          aria-autocomplete="list"
        />
        <div className="composer__row messaging-composer__toolbar">
          <div className="messaging-composer__tools">
        {attachments && <ChatButton variant="tertiary" type="button" className="icon-button composer__tool" aria-label="Elegir archivos adjuntos" title="Adjuntar archivos"
          aria-expanded={attachmentsOpen || files.length > 0 || uploadItems.length > 0} aria-controls={attachmentPanelId}
          onClick={() => setAttachmentsOpen((open) => !open)} disabled={attachmentsBlocked}><Icon name="upload" /></ChatButton>}
        <ChatButton variant="tertiary"
          type="button"
          className="icon-button composer__tool"
          aria-label="Publicaciones y materiales"
          title="Publicaciones y materiales"
          onClick={() => { setPickingPosts(true); onLiveDraftChange?.(''); }}
          disabled={disabled || sending || retryingAttachments || Boolean(editing)}
        ><Icon name="folder" /></ChatButton>
        <ChatButton variant="tertiary"
          type="button"
          className="icon-button composer__tool"
          aria-label="Stickers"
          title="Stickers"
          aria-expanded={stickers}
          onClick={() => setStickers(!stickers)}
          disabled={disabled || sending || retryingAttachments || Boolean(editing)}
        >
          <Icon name="smile" />
        </ChatButton>
        <ChatButton variant="tertiary"
          type="button"
          className="icon-button composer__tool"
          aria-label="Comandos y referencias"
          title="Comandos y referencias (/)"
          onClick={() => {
            if (!parseSlash(text)) commandBase.current = { text, refs: [...refs] };
            update('/');
            focusComposer();
          }}
          disabled={disabled || sending || retryingAttachments || Boolean(editing)}
        >
          <Icon name="slash" />
        </ChatButton>

          </div>
        <ChatButton
          type="submit"
          className="composer__send"
          loading={sending}
          disabled={!canSend}
          aria-label={editing ? 'Guardar cambios' : retryingAttachments ? 'Reintentar adjuntos' : 'Enviar mensaje'}
        >
          <Icon name={editing ? 'check' : 'send'} size={18} />
          <span>{editing ? 'Guardar' : retryingAttachments ? 'Reintentar' : 'Enviar'}</span>
        </ChatButton>
        </div>
      </div>
      {mentionMemberIds && !editing && <label className="chat-mention-picker">
        <span className="sr-only">Mencionar a un compañero</span>
        <select aria-label="Mencionar a un compañero" value="" disabled={disabled || sending || retryingAttachments} onChange={(event) => {
          if (!event.target.value) return;
          update(`${text}${text && !text.endsWith(' ') ? ' ' : ''}${mentionToken(event.target.value)} `);
          focusComposer();
        }}>
          <option value="">@ Mencionar</option>
          {data.members.filter((member) => member.status === 'active' && mentionMemberIds.includes(member.id)).map((member) => <option value={member.id} key={member.id}>{member.displayName}</option>)}
        </select>
      </label>}
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
    {creating && <ChatResourceCreatePanel kind={creating.kind} initialTitle={creating.title} onCreated={(id, shareable) => finishCreate(id, shareable)} onClose={() => finishCreate()} />}
    {pickingPosts && <ChatPostPicker onPick={addPostRef} onClose={() => { setPickingPosts(false); requestAnimationFrame(focusComposer); }} />}</>
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
