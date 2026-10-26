import { useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ExamAttemptQuestion } from '@b20/core';
import { useDataSource } from '../data/DataContext';

export function ExamSpacedButton({ attemptId, question }: { attemptId: string; question: ExamAttemptQuestion }) {
  const source = useDataSource(); const [open, setOpen] = useState(false);
  const [text, setText] = useState(question.text);
  const [explanation, setExplanation] = useState([question.solution?.referenceAnswer ?? question.options.find((option) => option.id === question.solution?.correctOptionId)?.text, question.solution?.explanation].filter(Boolean).join('\n\n'));
  const [hint, setHint] = useState(''); const [reviewed, setReviewed] = useState(false); const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: boolean; collectionId: string }>(); const [error, setError] = useState('');
  const request = useRef({ fingerprint: '', id: '' });
  async function save() {
    const fingerprint = JSON.stringify([attemptId, question.id, text, explanation, hint]);
    if (fingerprint !== request.current.fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    setBusy(true); setError('');
    try { setResult(await source.examAction({ action: 'sendToSpaced', attemptId, questionId: question.id, requestId: request.current.id, question: text, explanation, hint })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo crear la tarjeta.'); }
    finally { setBusy(false); }
  }
  if (result) return <p role="status">{result.created ? 'Tarjeta privada creada.' : 'Esta pregunta ya tiene una tarjeta; se conservaron sus intervalos.'} <Link to={`/m/repaso?coleccion=${encodeURIComponent(result.collectionId)}`}>Abrir Repaso</Link></p>;
  return <section><button type="button" onClick={() => setOpen(!open)}>Enviar esta pregunta a Repaso</button>{open && <fieldset disabled={busy}><legend>Revisar tarjeta privada</legend>
    <label>Pregunta<textarea value={text} onChange={(event) => { setText(event.target.value); setReviewed(false); }} /></label>{text.length > 1000 && <p role="alert">Reduce la pregunta a 1000 caracteres antes de guardarla.</p>}
    <label>Explicación<textarea maxLength={20000} value={explanation} onChange={(event) => { setExplanation(event.target.value); setReviewed(false); }} /></label>
    <label>Pista opcional<textarea maxLength={2000} value={hint} onChange={(event) => setHint(event.target.value)} /></label>
    <label className="check"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />Revisé la pregunta y la explicación; guardarlas en mi Repaso privado.</label>
    <button type="button" disabled={!reviewed || !text.trim() || text.length > 1000 || !explanation.trim()} onClick={() => void save()}>Guardar tarjeta privada</button>
    {error && <p role="alert">{error}</p>}</fieldset>}</section>;
}
