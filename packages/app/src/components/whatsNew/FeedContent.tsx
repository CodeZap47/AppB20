import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { FeedPresentation } from '../../lib/feedPresentation';
import { formatDate, parseDay } from '../../lib/format';
import { Icon } from '../Icon';

export function FeedExcerpt({ text, code = false }: { text: string; code?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const limit = code ? 420 : 300;
  const long = text.length > limit;
  const shown = long && !expanded ? `${text.slice(0, limit).trimEnd()}…` : text;
  return <div className="feed-excerpt">
    {code ? <pre id={id}><code>{shown}</code></pre> : <p id={id}>{shown}</p>}
    {long && <button type="button" className="feed-read-more" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(!expanded)}>{expanded ? 'Ver menos' : 'Ver más'}</button>}
  </div>;
}

const fileSize = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024
  ? `${Math.round(size / 1024)} KB` : `${(size / (1024 * 1024)).toLocaleString('es-MX', { maximumFractionDigits: 1 })} MB`;

export function FeedContent({ presentation: p, link, socialText }: { presentation: FeedPresentation; link: string; socialText?: string }) {
  const facts = p.facts.length > 0 && <dl className="feed-facts">{p.facts.map((fact, index) => (
    <div key={`${fact.label}-${index}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
  ))}</dl>;
  return <div className={`feed-content feed-content--${p.layout}`}>
    {p.eyebrow && <p className="feed-content__eyebrow">{p.eyebrow}</p>}
    <div className="feed-content__heading">
      {['guide', 'document', 'spaced', 'exam', 'achievement', 'opportunity', 'room'].includes(p.layout) &&
        <span className="feed-content__symbol" aria-hidden="true"><Icon name={p.icon} size={26} /></span>}
      {p.layout !== 'social' && <h3><Link to={link}>{p.title}</Link></h3>}
    </div>
    {p.layout === 'date' && p.dateChange && <div className="feed-date-change">
      <div><span>Antes</span><del>{p.dateChange.before ? formatDate(parseDay(p.dateChange.before)) : 'Sin fecha'}</del></div>
      <Icon name="forward" size={20} /><div><span>Ahora</span><strong>{p.dateChange.after ? formatDate(parseDay(p.dateChange.after)) : 'Sin fecha de entrega'}</strong></div>
    </div>}
    {(socialText ?? p.excerpt) && <FeedExcerpt text={socialText ?? p.excerpt!} />}
    {p.code && <FeedExcerpt text={p.code} code />}
    {p.blocks && p.blocks.length > 0 && <div className="feed-content__blocks">{p.blocks.map((block, index) => (
      <section key={`${block.label}-${index}`}><h4>{block.label}</h4><FeedExcerpt text={block.text} /></section>
    ))}</div>}
    {p.layout !== 'poll' && p.bullets && p.bullets.length > 0 && <ul className="feed-topics">{p.bullets.map((text, index) => (
      <li key={`${text}-${index}`}><span aria-hidden="true">{p.layout === 'guide' || p.layout === 'exam' ? String(index + 1).padStart(2, '0') : '•'}</span>{text}</li>
    ))}</ul>}
    {p.layout !== 'poll' && facts}
    {p.files && p.files.length > 0 && <div className="feed-attachments" aria-label="Archivos adjuntos">{p.files.map((file) => (
      <Link key={file.id} to={link} className="feed-attachment" aria-label={`Ver archivo ${file.name}`}>
        <span className="feed-attachment__icon"><Icon name="file" size={21} /></span>
        <span><strong>{file.name}</strong><small>{fileSize(file.size)} · {file.contentType.split('/').at(-1)?.toUpperCase() || 'ARCHIVO'}</small></span>
        <Icon name="forward" size={14} />
      </Link>
    ))}</div>}
    {p.tags.length > 0 && <div className="feed-tags" aria-label="Etiquetas">{p.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
  </div>;
}
