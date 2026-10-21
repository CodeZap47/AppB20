import { useEffect, useMemo, useRef, useState } from 'react';
import { buildAiPreparation, parseTopics, type AiPreparation, type AiPrepareInput, type AiSourceRef, type AiStatus } from '@b20/core';
import { AiClient } from '../data/aiClient';
import { useSnapshot } from '../data/DataContext';
import { aiCandidateKey, aiSourceCandidates } from '../lib/aiSources';
import { AiSourcePreview } from './AiSourcePreview';
import { AiSourceSelector } from './AiSourceSelector';

export function AiPreparationPanel({ client, status, simulated }: { client?: AiClient; status?: AiStatus; simulated: boolean }) {
  const data = useSnapshot();
  const [subjectId, setSubjectId] = useState(data.subjects[0]?.id ?? '');
  const [termId, setTermId] = useState('');
  const [topicsText, setTopicsText] = useState('');
  const [selected, setSelected] = useState<AiSourceRef[]>([]);
  const [result, setResult] = useState<{ signature: string; preparation: AiPreparation }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | undefined>(undefined);
  const candidates = aiSourceCandidates(data, subjectId, termId || undefined);
  const parsed = useMemo(() => parseTopics(topicsText), [topicsText]);
  const topics = 'topics' in parsed ? parsed.topics : [];
  const sources = selected.map((source) => ({ ...source, topics: source.topics.filter((topic) => topics.includes(topic)) }));
  const signature = JSON.stringify([subjectId, termId, topics, sources, status?.model,
    sources.map((ref) => candidates.find((candidate) => aiCandidateKey(ref) === aiCandidateKey(candidate))?.revision ?? 'unavailable')]);
  const currentSignature = useRef(signature); currentSignature.current = signature;
  useEffect(() => {
    controller.current?.abort(); setBusy(false); setError('');
    return () => controller.current?.abort();
  }, [signature, client]);
  const stale = Boolean(result && result.signature !== signature);
  const unavailable = sources.some((ref) => !candidates.some((candidate) => aiCandidateKey(ref) === aiCandidateKey(candidate)));
  const valid = Boolean(subjectId && topics.length && sources.length && !unavailable && status?.model);
  const prepare = async () => {
    if (!valid || busy) return;
    const captured = signature;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setResult(undefined);
    const input: AiPrepareInput = { subjectId, ...(termId ? { termId } : {}), topics, sources };
    try {
      let preparation: AiPreparation;
      if (simulated) {
        // The demo intentionally prepares fictitious text and never calls the HTTP service.
        const demoInput: AiPrepareInput = { ...input, subjectId: '1', ...(termId ? { termId: '1' } : {}),
          sources: sources.map((ref, index) => ({ ...ref, refId: String(index + 1) })) };
        preparation = buildAiPreparation(demoInput, demoInput.sources.map((ref, index) => {
          const candidate = candidates.find((entry) => aiCandidateKey(entry) === aiCandidateKey(sources[index]!))!;
          return { kind: ref.kind, refId: ref.refId, version: candidate.version, subjectId: '1', ...(candidate.termId ? { termId: '1' } : {}),
            title: candidate.title, visibility: candidate.personal ? 'personal' as const : 'group' as const,
            fields: [{ name: 'Texto ficticio', text: `Material ficticio de demostración.\nTemas de ejemplo: ${ref.topics.join(', ') || 'Sin asignar'}.\nEste fragmento permite revisar la vista previa sin enviar material a ningún proveedor.` }],
            omissions: ['La simulación sustituye el contenido por texto ficticio.'] };
        }), { id: crypto.randomUUID(), model: 'simulado', now: Date.now() });
      } else {
        preparation = await client!.request<AiPreparation>('/ai/preparations', 'POST', input, abort.signal);
      }
      if (!abort.signal.aborted && currentSignature.current === captured) setResult({ signature: captured, preparation });
    } catch (failure) {
      if (!abort.signal.aborted && currentSignature.current === captured) setError(failure instanceof Error ? failure.message : 'No se pudo preparar el material.');
    } finally { if (!abort.signal.aborted && currentSignature.current === captured) setBusy(false); }
  };
  return <section className="panel settings" aria-label="Preparar material para IA">
    <h2>Preparar material para IA</h2>
    <p>Elige fuentes y revisa exactamente el texto que se usaría para crear preguntas. Esta vista previa no llama a Gemini.</p>
    {simulated && <p className="ai-notice">Simulación local: los fragmentos son ficticios. No se envían datos ni claves a la red.</p>}
    <div className="ai-scope">
      <label className="field"><span>Materia del material</span><select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setTermId(''); setSelected([]); setResult(undefined); }}>
        {!subjectId && <option value="">Elige una materia</option>}{data.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
      </select></label>
      <label className="field"><span>Parcial del material</span><select value={termId} onChange={(e) => { setTermId(e.target.value); setSelected([]); setResult(undefined); }}>
        <option value="">Todos los parciales</option>{data.terms.filter((term) => term.subjectId === subjectId).map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}
      </select></label>
    </div>
    <label className="field"><span>Temario para IA (un tema por línea)</span><textarea value={topicsText} maxLength={4840} rows={4} onChange={(e) => setTopicsText(e.target.value)} placeholder="Escribe los temas que quieres evaluar" /></label>
    {topicsText && 'problem' in parsed && <p className="field__hint">{parsed.problem}</p>}
    <AiSourceSelector candidates={candidates} topics={topics} value={sources} maxSources={status?.limits.maxSources ?? 10} onChange={setSelected} />
    {unavailable && <p role="alert" className="error">Una fuente seleccionada ya no está disponible. Limpia la selección y vuelve a elegir el material.</p>}
    {stale && <p role="status" className="ai-notice">La selección, el contenido o la configuración cambió. Prepara el material nuevamente.</p>}
    {!status?.model && <p className="field__hint">El servicio debe tener un modelo configurado para preparar material. No necesitas guardar una clave para revisar fuentes.</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="form__actions"><button type="button" disabled={!valid || busy} aria-busy={busy} onClick={() => void prepare()}>{busy ? 'Preparando material…' : 'Preparar vista previa'}</button>
      <button type="button" className="button--secondary" onClick={() => { controller.current?.abort(); setSelected([]); setResult(undefined); setError(''); setBusy(false); }}>Limpiar selección</button></div>
    {result && !stale && <AiSourcePreview preparation={result.preparation} />}
  </section>;
}
