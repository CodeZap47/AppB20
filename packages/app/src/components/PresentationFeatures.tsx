import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { PRESENTATION_AUDIO_LIMITS, type PresentationAiDraft, type PresentationAiDraftSummary, type PresentationAiPurpose, type PresentationAiResult, type PresentationAudio } from '@b20/core';
import type { PresentationFeatureActions } from '../data/presentationFeatureClient';
import type { PresentationAttempt, PresentationPractice } from '../data/presentationTypes';
const labels: Record<PresentationAiPurpose, string> = { outline: 'Esquema inicial', questions: 'Preguntas', feedback: 'Comentarios orientativos', transcription: 'Transcripción con tiempos' };
const message = (error: unknown) => error instanceof Error ? error.message : 'No pudimos completar la operación.';
const seconds = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;

export function PresentationAiPanel({ actions, attempt, archived }: { actions: PresentationFeatureActions; attempt: PresentationAttempt; archived: boolean }) {
  const [drafts, setDrafts] = useState<PresentationAiDraftSummary[]>([]); const [selected, setSelected] = useState<PresentationAiDraft>();
  const [result, setResult] = useState<PresentationAiResult>(); const [error, setError] = useState(''); const [pending, setPending] = useState(false);
  const [consent, setConsent] = useState(false); const [reviewed, setReviewed] = useState(false); const [unknown, setUnknown] = useState(false);
  const active = useRef(true); const sends = useRef(new Map<string, string>()); const busy = useRef(false);
  useEffect(() => { active.current = true; let current = true;
    void actions.listDrafts(attempt.id).then((values) => { if (current) setDrafts(values); }).catch((failure) => { if (current) setError(message(failure)); });
    return () => { active.current = false; current = false; };
  }, [actions, attempt.id]);
  const select = (value: PresentationAiDraft) => { setSelected(value); setResult(value.result); setConsent(false); setReviewed(false); };
  const run = async (task: () => Promise<PresentationAiDraft>) => {
    if (busy.current) return; busy.current = true; setPending(true); setError('');
    try { const value = await task(); if (active.current) { select(value); setDrafts((rows) => [value, ...rows.filter((row) => row.id !== value.id)]); } }
    catch (failure) { if (active.current) setError(message(failure)); }
    finally { busy.current = false; if (active.current) setPending(false); }
  };
  const generate = async () => {
    if (!selected) return;
    const generationId = sends.current.get(selected.id) ?? selected.generationId ?? crypto.randomUUID(); sends.current.set(selected.id, generationId);
    await run(async () => {
      // A lost reply is consulted before another POST; a stored UUID always denotes the same send.
      const current = await actions.get(selected.id);
      if (current.generationId && current.state !== 'prepared') return current;
      return actions.generate(current, current.generationId ?? generationId, unknown);
    });
  };
  return <section className="panel form" aria-busy={pending}><h2>Ayuda privada con Gemini</h2>
    <p className="muted">Usa tu clave personal de <Link to="/ajustes">Ajustes</Link>. Solo se envían el contexto y los materiales que revises aquí; tus autoobservaciones se excluyen. Cada envío consume la cuota compartida de IA.</p>
    {!archived && <div className="row">{(attempt.status === 'draft' ? ['outline'] : ['transcription', 'questions', 'feedback']).map((purpose) => <button key={purpose} type="button" className="secondary" disabled={pending} onClick={() => void run(() => actions.prepare({ id: crypto.randomUUID(), attemptId: attempt.id, expectedVersion: attempt.version, purpose: purpose as PresentationAiPurpose }))}>Preparar {labels[purpose as PresentationAiPurpose].toLowerCase()}</button>)}</div>}
    {drafts.length > 0 && <label className="field">Borradores y resultados privados<select value={selected?.id ?? ''} onChange={(event) => { const found = drafts.find((row) => row.id === event.target.value); if (found) void run(() => actions.get(found.id)); }}><option value="">Elige un resultado</option>{drafts.map((row) => <option key={row.id} value={row.id}>{labels[row.purpose]} · {row.state === 'accepted' ? 'Aceptado' : row.state === 'succeeded' ? 'Pendiente de revisión' : row.state === 'unknown' ? 'Resultado incierto' : row.state === 'running' ? 'En curso' : row.state === 'cancelled' ? 'Cancelado' : row.state === 'failed' ? 'Falló' : 'Vista previa'}</option>)}</select></label>}
    {selected && <>
      <details><summary>Material que se enviará · {selected.estimatedTokens.toLocaleString('es-MX')} tokens estimados</summary><p>Modelo: {selected.model}. El consumo es orientativo e incluye respuesta; Gemini determina el consumo real.</p><p>Tema: {selected.context.topic} · Público: {selected.context.audience} · Objetivo: {selected.context.targetMinutes} min</p><ul>{selected.context.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul>
        {selected.context.material ? <><p>Referencia {selected.context.material.kind === 'note' ? 'nota' : 'guía'}, versión {selected.context.material.version}.</p><pre className="prewrap">{selected.context.material.text}</pre></> : <p>Sin material académico: el esquema será una estructura orientativa.</p>}
        {selected.context.body && <pre className="prewrap">{selected.context.body}</pre>}{selected.context.transcript && <p>Incluye la transcripción aceptada con sus marcas de tiempo.</p>}
        {selected.purpose === 'transcription' && selected.context.audio && <p>Se enviará el audio privado completo de {seconds(selected.context.audio.durationSeconds)}. Puedes cancelarlo antes de enviar.</p>}
      </details>
      {selected.state === 'prepared' && !archived && <><label className="presentation-toggle"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> Revisé el material y autorizo enviarlo a Gemini con mi clave.</label><label className="presentation-toggle"><input type="checkbox" checked={unknown} onChange={(event) => setUnknown(event.target.checked)} /> Consulté mis envíos anteriores; acepto posible consumo adicional si alguno tiene resultado incierto.</label><button type="button" disabled={pending || !consent} onClick={() => void generate()}>Enviar a Gemini</button></>}
      {['running', 'unknown'].includes(selected.state) && <p role="status">{selected.state === 'running' ? 'El envío está en curso.' : 'No se pudo confirmar el resultado. No se reenviará automáticamente.'}</p>}
      {selected.error && <p role="alert" className="error">{selected.error}</p>}
      {result && <ResultEditor value={result} onChange={setResult} disabled={pending || selected.state === 'accepted'} />}
      {selected.state === 'succeeded' && !archived && result && <><label className="presentation-toggle"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> Revisé y corregí el resultado.{selected.purpose === 'outline' ? ' Aplicar reemplazará la explicación guardada de este borrador; carga después la versión guardada en el editor.' : selected.purpose === 'questions' ? ' Las preguntas aceptadas se añadirán al intento y serán visibles para su revisor.' : ' Se conservará como resultado privado, separado de mis autoobservaciones.'}</label><button type="button" disabled={pending || !reviewed} onClick={() => void run(() => actions.accept(selected, result))}>{selected.purpose === 'outline' ? 'Aplicar esquema revisado' : 'Aceptar resultado revisado'}</button></>}
      {selected.state === 'accepted' && <p role="status">Resultado aceptado y conservado. Los comentarios son orientativos; no son una calificación.</p>}
      <div className="row"><button type="button" className="secondary" disabled={pending} onClick={() => void run(() => actions.get(selected.id))}>Consultar estado</button>{!archived && !['accepted', 'cancelled'].includes(selected.state) && <button type="button" className="secondary" disabled={pending} onClick={() => void run(() => actions.cancel(selected))}>Cancelar borrador</button>}</div>
    </>}{error && <p className="error" role="alert">{error}</p>}
  </section>;
}
function ResultEditor({ value, onChange, disabled }: { value: PresentationAiResult; onChange: (value: PresentationAiResult) => void; disabled: boolean }) {
  if ('outline' in value) return <label className="field">Esquema editable{value.orientative && <span className="field__hint">Estructura orientativa, sin fuente académica.</span>}<textarea rows={12} maxLength={30_000} disabled={disabled} value={value.outline} onChange={(event) => onChange({ ...value, outline: event.target.value })} /></label>;
  if ('questions' in value) return <>{value.questions.map((text, index) => <label key={index} className="field">Pregunta {index + 1}<textarea value={text} disabled={disabled} maxLength={1000} onChange={(event) => onChange({ questions: value.questions.map((question, at) => at === index ? event.target.value : question) })} /></label>)}</>;
  if ('segments' in value) return <div><h3>Transcripción revisable</h3>{value.segments.map((segment, index) => <div key={index} className="form__section"><div className="row"><label className="field">Inicio (segundos)<input type="number" min="0" step="0.1" disabled={disabled} value={segment.startSeconds} onChange={(event) => onChange({ segments: value.segments.map((row, at) => at === index ? { ...row, startSeconds: Number(event.target.value) } : row) })} /></label><label className="field">Fin (segundos)<input type="number" min="0" step="0.1" disabled={disabled} value={segment.endSeconds} onChange={(event) => onChange({ segments: value.segments.map((row, at) => at === index ? { ...row, endSeconds: Number(event.target.value) } : row) })} /></label></div><label className="field">Texto de {seconds(segment.startSeconds)}<textarea value={segment.text} disabled={disabled} maxLength={6000} onChange={(event) => onChange({ segments: value.segments.map((row, at) => at === index ? { ...row, text: event.target.value } : row) })} /></label></div>)}</div>;
  return <><h3>Comentarios orientativos</h3>{(['clarity', 'examples', 'decisions', 'limitations', 'duration'] as const).map((key, index) => <label key={key} className="field">{['Claridad', 'Ejemplos', 'Decisiones', 'Limitaciones', 'Duración'][index]}<textarea rows={3} value={value[key]} disabled={disabled} maxLength={3000} onChange={(event) => onChange({ ...value, [key]: event.target.value })} /></label>)}{value.oral.map((item, index) => <label key={index} className="field">Audio · {seconds(item.atSeconds)}<textarea value={item.comment} maxLength={1000} disabled={disabled} onChange={(event) => onChange({ ...value, oral: value.oral.map((row, at) => at === index ? { ...row, comment: event.target.value } : row) })} /></label>)}</>;
}

export function PresentationMediaPanel({ actions, attempt, practice, owner, onReady }: { actions: PresentationFeatureActions; attempt: PresentationAttempt; practice: PresentationPractice; owner: boolean; onReady: (ready: boolean) => void }) {
  const [files, setFiles] = useState<PresentationAudio[]>([]); const [file, setFile] = useState<File>(); const [localUrl, setLocalUrl] = useState(''); const [playUrl, setPlayUrl] = useState('');
  const [error, setError] = useState(''); const [pending, setPending] = useState(false); const [progress, setProgress] = useState(0); const [recording, setRecording] = useState(false); const [elapsed, setElapsed] = useState(0); const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const recorder = useRef<MediaRecorder | undefined>(undefined); const stream = useRef<MediaStream | undefined>(undefined); const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined); const disposed = useRef(false); const busy = useRef(false); const request = useRef<string>(crypto.randomUUID());
  const ready = files.find((item) => item.state === 'ready'); const uploading = files.find((item) => item.state === 'pending'); const locked = !owner || practice.archived || attempt.status !== 'draft';
  const stop = () => { if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop(); stream.current?.getTracks().forEach((track) => track.stop()); if (timer.current) clearInterval(timer.current); setRecording(false); };
  useEffect(() => { disposed.current = false; let active = true;
    void actions.listAudio(attempt.id).then((values) => { if (active) { setFiles(values); onReady(values.some((item) => item.state === 'ready')); } }).catch((failure) => { if (active) setError(message(failure)); });
    return () => { active = false; disposed.current = true; if (recorder.current?.state !== 'inactive') recorder.current?.stop(); stream.current?.getTracks().forEach((track) => track.stop()); if (timer.current) clearInterval(timer.current); };
  }, [actions, attempt.id, onReady]);
  useEffect(() => { if (!file) { setLocalUrl(''); return; } const url = URL.createObjectURL(file); setLocalUrl(url); return () => URL.revokeObjectURL(url); }, [file]);
  useEffect(() => () => { if (playUrl) URL.revokeObjectURL(playUrl); }, [playUrl]);
  const update = (value: PresentationAudio) => { setFiles((rows) => [value, ...rows.filter((row) => row.id !== value.id)]); onReady(value.state === 'ready'); };
  const run = async (task: () => Promise<void>) => { if (busy.current) return; busy.current = true; setPending(true); setError(''); try { await task(); } catch (failure) { if (!disposed.current) setError(message(failure)); } finally { busy.current = false; if (!disposed.current) setPending(false); } };
  const selectFile = (value?: File) => { setFile(value); request.current = crypto.randomUUID(); setProgress(0); };
  const start = () => void run(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Este dispositivo no permite grabar aquí. Puedes subir un archivo de audio.');
    const mime = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mime) throw new Error('No hay un formato de grabación compatible. Sube un archivo de audio.');
    let media: MediaStream;
    try { media = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { throw new Error('El permiso del micrófono fue denegado o no hay un micrófono disponible. Puedes subir un archivo de audio.'); }
    if (disposed.current) { media.getTracks().forEach((track) => track.stop()); return; }
    stream.current = media; let device: MediaRecorder; try { device = new MediaRecorder(media, { mimeType: mime, audioBitsPerSecond: 48_000 }); } catch (failure) { media.getTracks().forEach((track) => track.stop()); throw failure; }
    recorder.current = device; const chunks: Blob[] = []; let bytes = 0; let oversized = false;
    device.ondataavailable = (event) => { if (event.data.size) { bytes += event.data.size; if (bytes <= PRESENTATION_AUDIO_LIMITS.bytes) chunks.push(event.data); else { oversized = true; stop(); } } };
    device.onerror = () => { stop(); setError('No pudimos grabar. Puedes subir un archivo de audio.'); };
    device.onstop = () => { media.getTracks().forEach((track) => track.stop()); if (timer.current) clearInterval(timer.current); if (disposed.current) return; setRecording(false);
      if (oversized) { setError('La grabación superó 10 MiB y fue descartada. Graba con menor duración o sube un archivo comprimido.'); return; }
      const blob = new Blob(chunks, { type: device.mimeType || mime }); if (blob.size) selectFile(new File([blob], `ensayo.${mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'}`, { type: blob.type })); };
    device.start(1000); setRecording(true); setElapsed(0); const startAt = Date.now();
    timer.current = setInterval(() => { const value = Math.floor((Date.now() - startAt) / 1000); setElapsed(value); if (value >= PRESENTATION_AUDIO_LIMITS.seconds) stop(); }, 500);
  });
  return <section className="panel form" aria-busy={pending}><h2>Audio del ensayo</h2><p className="muted">Hasta 20 minutos y 10 MiB, un audio por intento. Se conserva hasta que lo elimines; compartir con el revisor requiere tu autorización.</p>
    {!locked && !ready && !uploading && <><div className="row"><button type="button" className="secondary" disabled={pending || recording} onClick={start}>Grabar audio</button>{recording && <button type="button" onClick={stop}>Detener · {seconds(elapsed)}</button>}</div><label className="field">Subir archivo de audio<input type="file" accept="audio/webm,audio/mp4,audio/mpeg,audio/ogg,audio/wav,.m4a,.mp3,.wav,.webm,.ogg,.opus" disabled={recording || pending} onChange={(event) => selectFile(event.target.files?.[0])} /></label></>}
    {file && !ready && <><p>{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MiB</p>{localUrl && <audio controls src={localUrl} preload="metadata" />}<div className="row"><button type="button" disabled={pending || recording || locked} onClick={() => void run(async () => { const value = await actions.upload(attempt.id, attempt.version, file, request.current, setProgress); if (!disposed.current) { update(value); setFile(undefined); } })}>{pending ? `Subiendo ${progress}%…` : 'Guardar audio privado'}</button><button type="button" className="secondary" disabled={pending} onClick={() => { selectFile(undefined); if (uploading) void run(async () => update(await actions.cancelAudio(uploading))); }}>Descartar</button></div></>}
    {uploading && <><p role="status">Hay una subida sin confirmar. Elige de nuevo el mismo archivo para continuar; los bloques recibidos se conservan por 24 horas.</p>{!file && <label className="field">Continuar subida<input type="file" accept="audio/*" disabled={pending} onChange={(event) => { setFile(event.target.files?.[0]); request.current = uploading.id; }} /></label>}<button type="button" className="secondary" disabled={pending} onClick={() => void run(async () => update(await actions.cancelAudio(uploading)))}>Cancelar subida</button></>}
    {ready && <><p>{ready.name} · {seconds(ready.durationSeconds ?? 0)} · {(ready.bytes / 1024 / 1024).toFixed(2)} MiB</p>{playUrl ? <audio controls src={playUrl} preload="metadata" /> : <button type="button" className="secondary" disabled={pending} onClick={() => void run(async () => { const blob = await actions.audioBlob(ready); if (!disposed.current) setPlayUrl(URL.createObjectURL(blob)); })}>Escuchar audio guardado</button>}
      {owner && !practice.archived && attempt.status === 'completed' && practice.reviewerId && <label className="presentation-toggle"><input type="checkbox" disabled={pending} checked={ready.shared} onChange={(event) => void run(async () => update(await actions.shareAudio(ready, event.target.checked)))} /> Autorizar al revisor actual a escuchar este audio. Cambiar de revisor o archivar revoca el acceso.</label>}
      {owner && <><label className="presentation-toggle"><input type="checkbox" checked={deleteConfirmed} onChange={(event) => setDeleteConfirmed(event.target.checked)} /> Confirmo eliminar definitivamente el audio y liberar su espacio. Las transcripciones y comentarios aceptados se conservan.</label><button type="button" className="secondary" disabled={pending || !deleteConfirmed} onClick={() => void run(async () => { update(await actions.deleteAudio(ready)); setPlayUrl(''); setDeleteConfirmed(false); })}>Eliminar audio definitivamente</button></>}
    </>}{!ready && files.some((item) => item.state === 'deleted') && <p role="status">Audio eliminado.</p>}{locked && !ready && !files.length && <p className="muted">No hay audio disponible para tu cuenta.</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
