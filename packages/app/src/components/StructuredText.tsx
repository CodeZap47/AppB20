import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useDataSource } from '../data/DataContext';
import type { ResourceFile } from '../data/types';
import './StructuredText.css';

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\((?:https?:\/\/|#\/m\/|#\/perfil\/)[^\s<>]+\)|https?:\/\/[^\s<>]+)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const named = /^\[([^\]]+)\]\(((?:https?:\/\/|#\/m\/|#\/perfil\/)[^\s<>]+)\)$/.exec(part);
    if (named) return <a key={index} href={named[2]} target="_blank" rel="noopener noreferrer">{named[1]}</a>;
    if (/^https?:\/\//.test(part)) {
      const href = part.replace(/[.,;:!?\])}]+$/, '');
      return <Fragment key={index}><a href={href} target="_blank" rel="noopener noreferrer">{href}</a>{part.slice(href.length)}</Fragment>;
    }
    return part;
  });
}

/** Descarga explícita: ni las suscripciones ni una vista previa leen imágenes privadas. */
function PrivateImage({ id, alt }: { id: string; alt: string }) {
  const source = useDataSource();
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const active = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  useEffect(() => () => {
    active.current?.abort();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);
  const load = async () => {
    const controller = new AbortController();
    active.current = controller;
    setLoading(true); setError('');
    try {
      const blob = await source.downloadResourceFile(id, { signal: controller.signal });
      if (controller.signal.aborted) return;
      // SVG puede contener documentos activos; solo se presentan formatos raster.
      if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(blob.type)) throw new Error('Este archivo no es una imagen compatible. Descárgalo desde los adjuntos.');
      const next = URL.createObjectURL(blob);
      objectUrl.current = next;
      setUrl(next);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'No pudimos abrir la imagen.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (active.current === controller) active.current = null;
    }
  };
  return <figure className="structured-image">
    {url ? <img src={url} alt={alt} /> : <button type="button" className="secondary" disabled={loading} onClick={() => void load()}>{loading ? 'Abriendo imagen…' : `Ver imagen: ${alt || 'Adjunto'}`}</button>}
    {alt && <figcaption>{alt}</figcaption>}
    {error && <p className="error" role="alert">{error}</p>}
  </figure>;
}

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
const separator = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
const blockStart = (line: string) => /^(?:```|#{1,4}\s|\s*[-*]\s|\s*\d+\.\s|>\s|!\[)/.test(line);

/** Markdown reducido sin HTML, ejecución de código ni imágenes de terceros. */
export function StructuredText({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const output: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    const key = i;
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const language = line.slice(3).trim(); const code: string[] = []; i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) code.push(lines[i++]!);
      if (i < lines.length) i++;
      output.push(<pre key={key} className="mono code-block"><code aria-label={language ? `Código ${language}` : 'Código'}>{code.join('\n')}</code></pre>); continue;
    }
    const image = /^!\[([^\]]*)\]\(resource:([a-zA-Z0-9_-]+)\)\s*$/.exec(line);
    if (image) { output.push(<PrivateImage key={`${image[2]}:${key}`} id={image[2]!} alt={image[1]!} />); i++; continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) { const content = inline(heading[2]!); output.push(heading[1]!.length <= 2 ? <h2 key={key}>{content}</h2> : heading[1]!.length === 3 ? <h3 key={key}>{content}</h3> : <h4 key={key}>{content}</h4>); i++; continue; }
    if (line.includes('|') && i + 1 < lines.length && separator(lines[i + 1]!)) {
      const headers = cells(line); const rows: string[][] = []; i += 2;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(cells(lines[i++]!));
      output.push(<div key={key} className="structured-table"><table><thead><tr>{headers.map((cell, j) => <th key={j} scope="col">{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, r) => <tr key={r}>{headers.map((_, c) => <td key={c}>{inline(row[c] ?? '')}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    const list = /^\s*(?:([-*])|(\d+)\.)\s+(.+)$/.exec(line);
    if (list) {
      const ordered = Boolean(list[2]); const items: ReactNode[] = [];
      while (i < lines.length) {
        const next = /^\s*(?:([-*])|(\d+)\.)\s+(.+)$/.exec(lines[i]!);
        if (!next || Boolean(next[2]) !== ordered) break;
        items.push(<li key={i}>{inline(next[3]!)}</li>); i++;
      }
      output.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>); continue;
    }
    if (/^>\s/.test(line)) { output.push(<blockquote key={key}>{inline(line.replace(/^>\s?/, ''))}</blockquote>); i++; continue; }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i]!.trim() && !blockStart(lines[i]!) && !(lines[i]!.includes('|') && separator(lines[i + 1] ?? ''))) paragraph.push(lines[i++]!);
    output.push(<p key={key} className="prewrap">{inline(paragraph.join('\n'))}</p>);
  }
  return <div className="richtext structured-text">{output}</div>;
}

export function StructuredEditor({ label, value, onChange, rows = 10, maxLength = 20_000, files = [] }: {
  label: string; value: string; onChange: (text: string) => void; rows?: number; maxLength?: number; files?: ResourceFile[];
}) {
  const id = useId(); const field = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const insert = (before: string, after = '') => {
    const start = field.current?.selectionStart ?? value.length; const end = field.current?.selectionEnd ?? start;
    const next = `${value.slice(0, start)}${before}${value.slice(start, end)}${after}${value.slice(end)}`;
    if (next.length > maxLength) return;
    onChange(next);
    setPreview(false);
    requestAnimationFrame(() => { field.current?.focus(); field.current?.setSelectionRange(start + before.length, end + before.length); });
  };
  const images = files.filter((file) => !file.removedAt && /^image\/(png|jpeg|gif|webp|avif)$/.test(file.contentType));
  return <div className="field structured-editor">
    <label htmlFor={id} className="field__label">{label}</label>
    <div className="row structured-toolbar" role="group" aria-label={`Formato de ${label}`}>
      <button type="button" className="secondary" onClick={() => insert('## ')}>Título</button>
      <button type="button" className="secondary" onClick={() => insert('**', '**')}>Negrita</button>
      <button type="button" className="secondary" onClick={() => insert('\n- ')}>Lista</button>
      <button type="button" className="secondary" onClick={() => insert('\n1. ')}>Numerada</button>
      <button type="button" className="secondary" onClick={() => insert('\n| Columna | Columna |\n| --- | --- |\n| Dato | Dato |\n')}>Tabla</button>
      <button type="button" className="secondary" onClick={() => insert('\n```\n', '\n```\n')}>Código</button>
      <button type="button" className="secondary" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? 'Seguir escribiendo' : 'Vista previa'}</button>
    </div>
    <textarea id={id} ref={field} value={value} onChange={(event) => onChange(event.target.value)} rows={rows} maxLength={maxLength} className="mono" hidden={preview} />
    {preview && <div className="structured-preview"><StructuredText text={value} /></div>}
    {images.length > 0 && <label className="field"><span className="field__hint">Insertar una imagen adjunta</span><select aria-label={`Imagen para ${label}`} value="" onChange={(event) => { const file = images.find((item) => item.id === event.target.value); if (file) insert(`\n![${file.name.replace(/[\[\]]/g, '')}](resource:${file.id})\n`); }}><option value="">Elige una imagen</option>{images.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}</select></label>}
    <span className="field__hint">Texto, listas, tablas y código. Guarda primero para subir imágenes o documentos en los adjuntos; luego puedes insertar las imágenes aquí.</span>
  </div>;
}
