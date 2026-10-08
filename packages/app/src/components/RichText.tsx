/**
 * Muestra texto con bloques de código delimitados por ``` sin interpretar HTML.
 * Es la primera versión del editor de notas (3.4); tablas e imágenes vendrán después.
 */
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
              {part.trim()}
            </p>
          )
        ),
      )}
    </div>
  );
}
