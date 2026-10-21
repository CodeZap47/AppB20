/** Los recursos HTTP se pueden abrir; el contenido del usuario nunca se interpreta como HTML. */
function linkedText(text: string) {
  return text.split(/(https?:\/\/[^\s<>]+)/g).map((part, index) => {
    if (!/^https?:\/\//.test(part)) return part;
    const url = part.replace(/[.,;:!?\])}]+$/, '');
    return <span key={index}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a>{part.slice(url.length)}</span>;
  });
}

/** Muestra texto, enlaces y bloques de código sin interpretar HTML. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/```[^\n]*\n?/);
  return (
    <div className="richtext">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="mono code-block">
            {part.replace(/\n$/, '')}
          </pre>
        ) : (
          part.trim() && (
            <p key={i} className="prewrap">
              {linkedText(part.trim())}
            </p>
          )
        ),
      )}
    </div>
  );
}
