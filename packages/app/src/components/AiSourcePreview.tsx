import { useEffect, useState } from 'react';
import type { AiPreparation, AiSourceStatus } from '@b20/core';
import { AI_SOURCE_LABELS } from '../lib/aiSources';

const STATUS_LABEL: Record<AiSourceStatus, string> = { prepared: 'Preparada', pending: 'Pendiente', failed: 'Sin texto procesable', outdated: 'Desactualizada', unauthorized: 'Sin acceso' };
export function AiSourcePreview({ preparation }: { preparation: AiPreparation }) {
  const [expired, setExpired] = useState(preparation.expiresAt <= Date.now());
  useEffect(() => {
    setExpired(preparation.expiresAt <= Date.now());
    const timer = setTimeout(() => setExpired(true), Math.max(0, preparation.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [preparation]);
  return <div className="ai-preview" aria-label="Vista previa del material preparado">
    <h3>Vista previa del material preparado</h3>
    <p>{expired ? 'Esta preparación venció. Prepara el material nuevamente.' : 'La preparación vence a los 30 minutos. Cambiar la selección o el contenido requiere prepararla otra vez.'}</p>
    <dl className="facts"><div><dt>Modelo previsto</dt><dd>{preparation.model}</dd></div>
      <div><dt>Entrada estimada</dt><dd>{preparation.estimatedInputTokens.toLocaleString('es-MX')} tokens</dd></div>
      <div><dt>Salida máxima estimada</dt><dd>{preparation.estimatedOutputTokens.toLocaleString('es-MX')} tokens</dd></div>
    </dl>
    <p className="field__hint">Estimación de control de la app; no representa un precio ni un cargo exacto. Preparar el material no llama a Gemini.</p>
    <h4>Cobertura del temario</h4>
    <ul>{preparation.coverage.map((entry) => <li key={entry.topic}>{entry.topic}: {entry.sourceIds.length ? `${entry.sourceIds.length} fuente(s) preparada(s)` : 'Sin cobertura: requiere material o revisión'}</li>)}</ul>
    <h4>Estado de las fuentes</h4>
    <ul>{preparation.sources.map((source) => <li key={`${source.kind}:${source.refId}`}>{source.title} · {AI_SOURCE_LABELS[source.kind]} · v{source.version} · {STATUS_LABEL[source.status]}
      {source.visibility === 'personal' ? ' · Personal propia' : ''}{source.reason ? ` · ${source.reason}` : ''}</li>)}</ul>
    <h4>Omisiones y revisión</h4>
    <p className="field__hint">Se excluyen adjuntos, comentarios, chats, progreso, metadatos personales y contenido de enlaces externos. Revisa los fragmentos: los patrones automáticos no detectan todos los datos sensibles.</p>
    {preparation.omissions.length ? <ul>{preparation.omissions.map((omission, index) => <li key={index}>{omission}</li>)}</ul> : <p>No se registraron otras omisiones.</p>}
    <h4>Texto exacto preparado</h4>
    {preparation.fragments.map((fragment) => <details key={fragment.id} className="ai-fragment" open>
      <summary>Fragmento {fragment.id}</summary>
      <ul className="field__hint">{fragment.origins.map((origin, index) => <li key={index}>{AI_SOURCE_LABELS[origin.kind]} {origin.refId}, v{origin.version} · {origin.field} · líneas {origin.startLine}–{origin.endLine}</li>)}</ul>
      <pre>{fragment.text}</pre>
    </details>)}
    {!preparation.fragments.length && <p>No hay fragmentos preparados.</p>}
    <p role="status">{expired ? 'Preparación vencida.' : preparation.canGenerate ? 'Material listo para revisar. La creación de exámenes llegará en la siguiente entrega.' : 'El material requiere revisión antes de poder generar preguntas.'}</p>
  </div>;
}
