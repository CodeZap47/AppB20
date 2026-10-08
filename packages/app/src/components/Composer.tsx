import { useState, type FormEvent } from 'react';

export function Composer({
  placeholder,
  onSend,
}: {
  placeholder: string;
  /** Devuelve false si no se envió, para conservar el texto. */
  onSend: (text: string) => boolean;
}) {
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (onSend(text)) setText('');
  };
  return (
    <form className="composer" onSubmit={submit}>
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={4000}
      />
      <button type="submit" disabled={!text.trim()}>
        Enviar
      </button>
    </form>
  );
}
