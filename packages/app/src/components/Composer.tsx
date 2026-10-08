import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Icon } from './Icon';

/** Borradores por conversación: cambiar de chat no borra lo que estabas escribiendo. */
const drafts = new Map<string, string>();

/** En pantallas táctiles Enter agrega un salto de línea; se envía con el botón. */
function isTouch(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export function Composer({
  placeholder,
  onSend,
  draftKey,
  error,
  maxLength = 4000,
}: {
  placeholder: string;
  /** Devuelve false si no se envió, para conservar el texto. */
  onSend: (text: string) => boolean;
  /** Identifica la conversación (y a quien escribe) para guardar su borrador. */
  draftKey: string;
  error?: string | null;
  maxLength?: number;
}) {
  const [text, setText] = useState(() => drafts.get(draftKey) ?? '');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const remaining = maxLength - text.length;

  // El cuadro crece con el texto hasta el máximo que fija el CSS.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [text]);

  const update = (value: string) => {
    setText(value);
    if (value) drafts.set(draftKey, value);
    else drafts.delete(draftKey);
  };

  const send = () => {
    if (text.trim() && onSend(text)) update('');
    inputRef.current?.focus();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || isTouch()) return;
    e.preventDefault();
    send();
  };

  return (
    <form className="composer" onSubmit={submit}>
      {error && (
        <p className="composer__error error" role="alert">
          {error}
        </p>
      )}
      <div className="composer__row">
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
        />
        <button type="submit" className="composer__send" disabled={!text.trim()} aria-label="Enviar mensaje">
          <Icon name="send" />
        </button>
      </div>
      <p className="composer__hint">
        <span className="composer__keys">Enter para enviar · Mayús + Enter para otra línea</span>
        {remaining <= 200 && (
          <span className={remaining === 0 ? 'error' : undefined} aria-live="polite">
            {remaining === 0 ? 'Llegaste al límite de caracteres' : `Te quedan ${remaining} caracteres`}
          </span>
        )}
      </p>
    </form>
  );
}
