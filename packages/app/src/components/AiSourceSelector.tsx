import type { AiSourceRef } from '@b20/core';
import { useState } from 'react';
import { AI_SOURCE_LABELS, aiCandidateKey, type AiCandidate, type AiCandidateKind } from '../lib/aiSources';

export function AiSourceSelector({ candidates, topics, value, maxSources, disabled, onChange }: {
  candidates: AiCandidate[]; topics: string[]; value: AiSourceRef[]; maxSources: number;
  disabled?: boolean; onChange(value: AiSourceRef[]): void;
}) {
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<AiCandidateKind | ''>('');
  const visible = candidates.filter((source) => (!kind || source.kind === kind) &&
    `${source.title} ${source.topics.join(' ')}`.toLocaleLowerCase('es').includes(filter.toLocaleLowerCase('es')));
  const toggle = (source: AiCandidate, checked: boolean) => {
    const rest = value.filter((ref) => aiCandidateKey(ref) !== aiCandidateKey(source));
    onChange(checked ? [...rest, { kind: source.kind, refId: source.refId,
      topics: topics.filter((topic) => source.topics.some((candidate) => candidate.toLocaleLowerCase('es') === topic.toLocaleLowerCase('es'))),
      includeUnplaced: !source.termId, ...(source.answers ? { answerIds: source.answers.filter((answer) => answer.accepted).map((answer) => answer.id) } : {}) }] : rest);
  };
  return <fieldset className="ai-selector" disabled={disabled}>
    <legend>Material para preparar ({value.length} de {maxSources})</legend>
    <p className="field__hint">Selecciona cada fuente. Las notas personales y el material sin parcial siempre requieren tu elección expresa.</p>
    <div className="ai-scope">
      <label className="field"><span>Buscar material</span><input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
      <label className="field"><span>Tipo de fuente</span><select value={kind} onChange={(e) => setKind(e.target.value as AiCandidateKind | '')}>
        <option value="">Todos los tipos</option>{Object.entries(AI_SOURCE_LABELS).filter(([id]) => id !== 'answer').map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
    </div>
    {!visible.length && <p className="muted">No hay material visible para esta selección.</p>}
    {visible.map((source) => {
      const selected = value.find((ref) => aiCandidateKey(ref) === aiCandidateKey(source));
      return <div key={aiCandidateKey(source)} className="ai-source">
        <label className="ai-source__choice"><input type="checkbox" checked={Boolean(selected)}
          disabled={!selected && value.length >= maxSources} onChange={(e) => toggle(source, e.target.checked)} />
          <span><strong>{source.title}</strong> · {AI_SOURCE_LABELS[source.kind]} · v{source.version}
            {source.personal && <span className="badge">Personal propia</span>}
            {!source.termId && <span className="badge">Sin parcial · inclusión manual</span>}
            {source.status && <span className="badge">{source.status}</span>}
            <span className="field__hint">{selected ? 'Seleccionada · pendiente de preparar' : 'Excluida'}{source.topics.length ? ` · ${source.topics.join(', ')}` : ''}</span>
          </span>
        </label>
        {selected && source.answers && <fieldset><legend>Respuestas seleccionadas</legend><p className="field__hint">La respuesta aceptada no garantiza exactitud. Revisa las demás antes de incluirlas.</p>{source.answers.map((answer) => <label className="check" key={answer.id}><input type="checkbox" checked={(selected.answerIds ?? []).includes(answer.id)} onChange={(event) => onChange(value.map((ref) => aiCandidateKey(ref) === aiCandidateKey(source) ? { ...ref, answerIds: event.target.checked ? [...(ref.answerIds ?? []), answer.id] : (ref.answerIds ?? []).filter((id) => id !== answer.id) } : ref))} />{answer.accepted ? 'Aceptada · ' : 'Requiere revisión · '}{answer.text.slice(0, 240)}</label>)}</fieldset>}
        {selected && <fieldset className="ai-source__topics"><legend>Temas que cubre esta fuente</legend>
          {!topics.length && <p className="field__hint">Escribe el temario para asignar temas a la fuente.</p>}
          {topics.map((topic) => <label key={topic}><input type="checkbox" checked={selected.topics.includes(topic)} onChange={(e) => onChange(value.map((ref) => aiCandidateKey(ref) === aiCandidateKey(source)
            ? { ...ref, topics: e.target.checked ? [...ref.topics, topic] : ref.topics.filter((entry) => entry !== topic) } : ref))} />{topic}</label>)}
        </fieldset>}
      </div>;
    })}
  </fieldset>;
}
