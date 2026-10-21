import { useEffect, useRef, useState } from 'react';
import type { AiGeneration, AiPreparation, AiStatus, AiStudyDraft } from '@b20/core';
import type { AiClient } from '../data/aiClient';
import { StructuredText } from './StructuredText';

export function AiGenerationPanel({ client, status, preparation, simulated }: { client?: AiClient; status?: AiStatus; preparation?: AiPreparation; simulated: boolean }) {
  const [confirmed, setConfirmed] = useState(false);
  const [unknownRisk, setUnknownRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState<AiGeneration>();
  const [history, setHistory] = useState<AiGeneration[]>([]);
  const [error, setError] = useState('');
  const [published, setPublished] = useState<{ targetKind: string; targetId: string }>();
  const attempt = useRef<string | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const active = new AbortController(); controller.current = active;
    setGeneration(undefined); setPublished(undefined); setConfirmed(false); attempt.current = undefined;
    if (client && !simulated) void client.request<AiGeneration[]>('/ai/generations', 'GET', undefined, active.signal).then((rows) => {
      if (!active.signal.aborted && Array.isArray(rows)) setHistory(rows);
    }).catch(() => {});
    return () => active.abort();
  }, [client, preparation?.id, simulated]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await operation(); } catch (cause) { if (!controller.current?.signal.aborted) setError(cause instanceof Error ? cause.message : 'No pudimos confirmar la operación.'); }
    finally { if (!controller.current?.signal.aborted) setBusy(false); }
  };
  const generate = () => void run(async () => {
    if (!client || simulated || !preparation) return;
    attempt.current ??= crypto.randomUUID();
    const result = await client.request<AiGeneration>('/ai/generations', 'POST', { id: attempt.current, preparationId: preparation.id,
      fingerprint: preparation.fingerprint, config: preparation.config, confirmed, acknowledgeUnknown: unknownRisk }, controller.current?.signal);
    setGeneration(result); setHistory((rows) => [result, ...rows.filter((row) => row.id !== result.id)]);
  });
  const open = (id: string) => void run(async () => { const result = await client!.request<AiGeneration>(`/ai/generations/${id}`, 'GET', undefined, controller.current?.signal); setGeneration(result); setPublished(undefined); });
  const selectedPreparation = generation?.preparation ?? preparation;
  const draft = generation?.state === 'succeeded' && generation.result && typeof generation.result === 'object' && 'sections' in generation.result ? generation.result as AiStudyDraft : undefined;
  return <section aria-label="Generación y borradores privados">
    {preparation && <>
    <h3>Generar con Gemini</h3>
    <p>Se usará tu clave personal de Gemini y el modelo {preparation.model}. Puede consumir cuota o generar cargos en tu proyecto de Google. El presupuesto de la app es un límite estimado, no un precio exacto.</p>
    <p>Presupuesto diario estimado: {status?.limits.dailyEstimatedTokens.toLocaleString('es-MX')} tokens; esta operación reserva hasta {(preparation.estimatedInputTokens + preparation.estimatedOutputTokens).toLocaleString('es-MX')} tokens.</p>
    <label className="check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Revisé los fragmentos, las fuentes y las omisiones. Autorizo su envío con mi clave y entiendo el posible consumo.</label>
    <label className="check"><input type="checkbox" checked={unknownRisk} onChange={(event) => setUnknownRisk(event.target.checked)} />Si hay un envío anterior de resultado incierto, entiendo que otra solicitud puede consumir cuota adicional.</label>
    <button type="button" disabled={busy || simulated || !client || !confirmed || !status?.enabled || !status.consented || !preparation.canGenerate || preparation.expiresAt <= Date.now()} onClick={generate}>{attempt.current ? 'Consultar o reintentar la misma operación' : 'Generar borrador privado'}</button>
    {simulated && <p>La demo prepara material ficticio; no ejecuta generaciones ni solicita claves reales.</p>}
    {generation && ['succeeded', 'failed', 'unknown'].includes(generation.state) && <button type="button" disabled={busy} onClick={() => { attempt.current = undefined; setGeneration(undefined); setPublished(undefined); setConfirmed(false); }}>Preparar otra solicitud con este material</button>}
    </>}
    {generation && <p role="status">Estado: {generation.state}. {generation.error}</p>}
    {generation?.state === 'unknown' && <p className="ai-notice">El envío puede haber consumido cuota. Esta operación no se vuelve a enviar automáticamente.</p>}
    {draft && <article><h3>{draft.title}</h3><p className="ai-notice">Borrador privado generado con IA. Comprueba los ejemplos, los razonamientos y las referencias antes de publicarlo.</p>
      {draft.sections.map((section, index) => <section key={index}><h4>{section.heading}</h4><StructuredText text={section.text} /><p className="field__hint">Referencias: {section.citations.map((id) => selectedPreparation?.fragments.find((fragment) => fragment.id === id)?.origins.map((origin) => `${origin.kind}:${origin.refId} v${origin.version}`).join(', ') ?? id).join('; ')}</p></section>)}
      <p>La publicación crea una nota o guía del grupo. Las fuentes personales deben publicarse por separado antes de compartir un resultado basado en ellas.</p>
      <button type="button" disabled={busy || Boolean(published) || !selectedPreparation || selectedPreparation.sources.some((source) => source.visibility === 'personal')} onClick={() => void run(async () => {
        setPublished(await client!.request(`/ai/generations/${generation!.id}/publish`, 'POST', {}, controller.current?.signal));
      })}>Revisé el borrador: publicar para el grupo</button>
      {published && <a href={`#/m/${published.targetKind === 'guide' ? 'guias' : 'notas'}/${published.targetId}`}>Abrir publicación</a>}
    </article>}
    {history.length > 0 && <details><summary>Mis borradores guardados ({history.length})</summary><ul>{history.map((row) => <li key={row.id}><button type="button" className="link-button" disabled={busy} onClick={() => open(row.id)}>{new Date(row.createdAt).toLocaleString('es-MX')} · {row.state}</button></li>)}</ul></details>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
