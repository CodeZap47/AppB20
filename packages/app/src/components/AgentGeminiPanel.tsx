import { useEffect, useState } from 'react';
import { AGENT_AI_STEP_LABELS, type AgentAiOriginalityResult, type AgentAiPlanResult, type AgentAiStep } from '@b20/core';
import { useDataSource } from '../data/DataContext';
import type { AgentAiPreview, AgentAiRun, AgentAiStepStatus } from '../data/agentTypes';
import { useAction } from './useAction';

/**
 * Pasos del agente con Gemini (AG-4): vista previa de lo que se enviaría, confirmación expresa
 * y resultado. Un paso apagado en el Worker solo permite ver la vista previa.
 */
export function AgentGeminiPanel({ bot, steps, sessionId, version }: { bot: string; steps: AgentAiStep[]; sessionId?: string; version: number }) {
  const source = useDataSource(); const action = useAction();
  const [status, setStatus] = useState<AgentAiStepStatus[]>(); const [runs, setRuns] = useState<AgentAiRun[]>([]);
  const [preview, setPreview] = useState<AgentAiPreview>(); const [generationId, setGenerationId] = useState('');
  const [confirmed, setConfirmed] = useState(false); const [acknowledge, setAcknowledge] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.all([source.getAgentAiStatus(), source.listAgentAiRuns(sessionId)]).then(([next, list]) => { if (live) { setStatus(next); setRuns(list); } }, () => { if (live) setStatus([]); });
    return () => { live = false; };
  }, [source, sessionId]);
  // La vista previa caduca cuando cambia el borrador o el perfil que la originó.
  useEffect(() => { setPreview(undefined); setConfirmed(false); }, [version]);
  const enabled = (step: AgentAiStep) => status?.find((s) => s.step === step)?.enabled === true;
  const open = (step: AgentAiStep) => void action.run(async () => { setPreview(await source.previewAgentAi({ step, sessionId })); setGenerationId(crypto.randomUUID()); setConfirmed(false); });
  const send = () => void action.run(async () => {
    const run = await source.runAgentAiStep({ step: preview!.step, sessionId, generationId, confirmed: true, expectedTokens: preview!.estimatedTokens, acknowledgeUnknown: acknowledge });
    setRuns((list) => [run, ...list.filter((r) => r.id !== run.id)]); setPreview(undefined); setConfirmed(false);
  });
  const latest = steps.map((step) => runs.find((r) => r.step === step)).filter((r): r is AgentAiRun => !!r);

  return <div className="agent-gemini">
    <h3>Con Gemini</h3>
    <p className="muted">{bot} usa tu clave personal solo cuando confirmas. Primero ves exactamente qué se enviaría; nada se aplica a tu borrador sin que lo aceptes.</p>
    <div className="agent-actions">{steps.map((step) => <button key={step} type="button" className="secondary" disabled={action.pending} onClick={() => open(step)}>
      {AGENT_AI_STEP_LABELS[step]}{status && !enabled(step) ? ' (apagado)' : ''}</button>)}</div>
    {action.error && <p className="error" role="alert">{action.error}</p>}
    {preview && <div className="agent-gemini__preview" aria-label="Vista previa del envío">
      <p><strong>{AGENT_AI_STEP_LABELS[preview.step]}</strong> · unos {preview.estimatedTokens.toLocaleString('es-MX')} tokens estimados de tu cuota</p>
      <ul className="muted">
        <li>Tu perfil de estilo y {preview.payload.style?.examples.length ?? 0} ejemplos tuyos</li>
        {preview.payload.assignment && <li>La consigna «{preview.payload.assignment.title}»</li>}
        {preview.payload.draft !== undefined && <li>Tu borrador ({preview.payload.draft.length.toLocaleString('es-MX')} caracteres)</li>}
        {preview.payload.matches && <li>{preview.payload.matches.length} coincidencias con trabajos publicados</li>}
      </ul>
      <details><summary>Instrucción que recibe Gemini (premisas de {bot})</summary><pre className="agent-gemini__pre">{preview.systemInstruction}</pre></details>
      <details><summary>Datos exactos que se envían</summary><pre className="agent-gemini__pre">{JSON.stringify(preview.payload, null, 2)}</pre></details>
      {!enabled(preview.step) ? <p className="ai-notice">Este paso todavía no está habilitado: puedes revisar la vista previa, pero no se envía nada.</p> : <>
        <label className="check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />Confirmo que se envíen estos datos a Gemini con mi clave y su posible consumo.</label>
        <label className="check"><input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} />Si hubo un envío de resultado incierto, acepto el posible consumo adicional.</label>
        <button type="button" disabled={!confirmed || action.pending} onClick={send}>Enviar a Gemini</button></>}
    </div>}
    {latest.map((run) => <AgentRunResult key={run.id} bot={bot} run={run} />)}
  </div>;
}

function AgentRunResult({ bot, run }: { bot: string; run: AgentAiRun }) {
  const when = new Date(run.finishedAt ?? run.createdAt).toLocaleString('es-MX');
  if (run.state !== 'succeeded') {
    const text = run.state === 'unknown' ? 'No se conoce el resultado del envío; no se reenvía solo.' : run.state === 'failed' ? (run.error?.slice(run.error.indexOf(':') + 1) ?? 'El envío falló.') : 'Enviando…';
    return <p className="muted" data-state={run.state}>{AGENT_AI_STEP_LABELS[run.step]} · {when}: {text}</p>;
  }
  const badges = <p className="badges"><span className="badge badge--personal">Borrador privado</span><span className="badge badge--ai">Generado con {bot} y Gemini</span></p>;
  if (run.step === 'plan') { const plan = run.result as AgentAiPlanResult; return <div className="agent-output">{badges}<p>{plan.explanation}</p>
    {!!plan.approach.length && <><h4>Enfoque</h4><ul>{plan.approach.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
    {!!plan.outline.length && <><h4>Esquema</h4><ol>{plan.outline.map((x, i) => <li key={i}>{x}</li>)}</ol></>}
    {!!plan.questions.length && <><h4>Para que decidas tú</h4><ul>{plan.questions.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
    <p className="muted">{when}. Los puntos son pistas: la redacción es tuya.</p></div>; }
  if (run.step === 'originality') return <div className="agent-output">{badges}<ul>{(run.result as AgentAiOriginalityResult).notes.map((n) => <li key={n.refKey}><p>{n.why}</p><p><strong>{n.question}</strong></p></li>)}</ul><p className="muted">{when}. {bot} no propone otra versión: explica el parecido y te pregunta.</p></div>;
  return <p className="muted">{AGENT_AI_STEP_LABELS[run.step]} · {when}: {run.applied ? (run.step === 'review' ? 'las sugerencias están en la lista para que las aceptes o rechaces.' : 'el resumen se añadió a tu perfil de estilo.') : 'el borrador o el perfil cambió antes de terminar; no se aplicó.'}</p>;
}
