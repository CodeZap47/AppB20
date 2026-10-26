import { useEffect, useRef, useState } from 'react';
import { DOCUMENT_LIMITS, type DocumentFileMetadata, type DocumentOcrDraft, type DocumentSegment, type DocumentTranscription } from '@b20/core';
import type { DocumentActions } from '../data/documentTypes';
import { extractExamDocument } from '../lib/documentExtraction';

export interface ExamDocumentPreparationProps {
  actions: DocumentActions; files: { id: string; name: string }[];
  downloadFile: (fileId: string) => Promise<Blob>;
  onPrepared: (transcription: DocumentTranscription) => void;
  simulated?: boolean;
}
const locatorLabel = (s: DocumentSegment) => `${s.locator.kind === 'page' ? 'Página' : s.locator.kind === 'paragraph' ? 'Párrafo' : 'Líneas'} ${s.locator.start}${s.locator.end === s.locator.start ? '' : `–${s.locator.end}`}`;
/** Explicit extraction, OCR consent and text review; opening the panel never calls Gemini. */
export function ExamDocumentPreparation({ actions, files, downloadFile, onPrepared, simulated = false }: ExamDocumentPreparationProps) {
  const [fileId, setFileId] = useState(''); const [metadata, setMetadata] = useState<DocumentFileMetadata>();
  const [segments, setSegments] = useState<DocumentSegment[]>([]); const [selected, setSelected] = useState<string[]>([]);
  const [omissions, setOmissions] = useState<string[]>([]); const [draft, setDraft] = useState<DocumentOcrDraft>();
  const [pages, setPages] = useState('1'); const [consent, setConsent] = useState(false); const [reviewed, setReviewed] = useState(false);
  const [uncertain, setUncertain] = useState(false); const [acknowledgeUnknown, setAcknowledgeUnknown] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState<Awaited<ReturnType<DocumentActions['listDocumentTranscriptions']>>>([]);
  const epoch = useRef(0); const preparedId = useRef<{ signature: string; id: string } | undefined>(undefined);
  const submission = useRef<{ draftId: string; generationId: string } | undefined>(undefined);
  useEffect(() => { return () => { epoch.current++; }; }, [actions]);
  const execute = async <T,>(work: () => Promise<T>, done: (result: T) => void) => {
    if (busy) return; const generation = ++epoch.current; setBusy(true); setError(''); setNotice('');
    try { const value = await work(); if (generation === epoch.current) done(value); }
    catch (failure) { if (generation === epoch.current) { setError(failure instanceof Error ? failure.message : 'No se pudo confirmar la preparación. Consulta su estado antes de repetir.');
      if (failure && typeof failure === 'object' && 'code' in failure && failure.code === 'unknown_confirmation_required') { setUncertain(true); setAcknowledgeUnknown(false); }
    } }
    finally { if (generation === epoch.current) setBusy(false); }
  };
  const resetText = () => { setReviewed(false); preparedId.current = undefined; };
  const chooseFile = (id: string) => { epoch.current++; setBusy(false); setFileId(id); setMetadata(undefined); setSegments([]); setSelected([]); setOmissions([]); setDraft(undefined); setSaved([]); setConsent(false); resetText(); setError(''); setNotice(''); };
  const extract = () => void execute(async () => {
    const info = await actions.getDocumentFile(fileId); const blob = await downloadFile(fileId);
    const result = await extractExamDocument({ fileId, fileHash: info.fileHash, fileVersion: info.targetVersion, fileName: info.name, mimeType: info.contentType, blob });
    return { info, result, stored: await actions.listDocumentTranscriptions(fileId) };
  }, ({ info, result, stored }) => {
    setMetadata(info); setSegments(result.segments); setOmissions(result.omissions); setSaved(stored);
    setSelected(result.segments.reduce((total, s) => total + s.text.length, 0) <= DOCUMENT_LIMITS.maxSelectedCharacters ? result.segments.map((s) => s.id) : []);
    setDraft(undefined); resetText(); setNotice('Extracción local preparada. Revisa el texto y selecciona las secciones que utilizarás.');
  });
  const adoptOcr = (next: DocumentOcrDraft) => { setDraft(next); setConsent(false); if (next.state === 'unknown') { setUncertain(true); setAcknowledgeUnknown(false); } if (next.state === 'ready' && next.result) {
    setSegments(next.result.segments); setSelected(next.result.segments.reduce((n, s) => n + s.text.length, 0) <= 40_000 ? next.result.segments.map((s) => s.id) : []);
    setOmissions(next.result.omissions); resetText(); setNotice('OCR privado disponible. Corrige la transcripción y confirma su revisión antes de utilizarla.');
  } };
  const prepareOcr = () => void execute(async () => {
    const info = metadata ?? await actions.getDocumentFile(fileId);
    const requested = pages.split(',').map((page) => Number(page.trim()));
    if (!requested.length || requested.length > 5 || requested.some((p) => !Number.isInteger(p) || p < 1 || p > 200) || new Set(requested).size !== requested.length) throw new Error('Indica de una a cinco páginas distintas, separadas por comas.');
    const next = await actions.prepareDocumentOcr({ id: crypto.randomUUID(), input: { fileId, fileHash: info.fileHash, targetVersion: info.targetVersion, pages: requested } });
    return { info, next };
  }, ({ info, next }) => { setMetadata(info); adoptOcr(next); submission.current = undefined; });
  const runOcr = () => { if (!draft || !consent) return; if (submission.current?.draftId !== draft.id) submission.current = { draftId: draft.id, generationId: crypto.randomUUID() };
    void execute(() => actions.runDocumentOcr(draft.id, { generationId: submission.current!.generationId, expectedRevision: draft.revision, fingerprint: draft.fingerprint, confirmed: true, ...(acknowledgeUnknown ? { acknowledgeUnknown: true } : {}) }), adoptOcr); };
  const chosen = segments.filter((s) => selected.includes(s.id)); const count = chosen.reduce((n, s) => n + s.text.length, 0);
  const save = () => { if (!metadata || !reviewed || !chosen.length || count > 40_000) return;
    const input = { fileId, fileHash: metadata.fileHash, targetKind: metadata.targetKind, targetId: metadata.targetId, targetVersion: metadata.targetVersion,
      segments: chosen, omissions: [...omissions, ...(selected.length < segments.length ? ['El alumno seleccionó solo algunas páginas o secciones; el resto no se utilizará.'] : [])], reviewed: true as const,
      ...(draft?.state === 'ready' ? { ocrDraftId: draft.id } : {}) };
    const signature = JSON.stringify(input); if (preparedId.current?.signature !== signature) preparedId.current = { signature, id: crypto.randomUUID() };
    void execute(() => actions.saveDocumentTranscription({ ...input, id: preparedId.current!.id }), (result) => { onPrepared(result); setNotice('Texto revisado añadido al examen con su original, huella y localizadores.'); });
  };
  return <details className="panel exam-documents"><summary>Preparar documentos y OCR opcional</summary>
    <p>PDF con texto, DOCX, texto y código: extracción local sin enviar archivos a Gemini. Hasta 10 MiB, 200 páginas PDF y 32 MiB DOCX descomprimido. Selecciona hasta 40 000 caracteres para el examen.</p>
    {simulated && <p>Simulación local: el OCR de demostración no llama a Gemini ni consume una clave real.</p>}
    <label>Adjunto original <select value={fileId} disabled={busy} onChange={(e) => chooseFile(e.target.value)}><option value="">Elige un archivo de las fuentes</option>{files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
    <button type="button" disabled={!fileId || busy} onClick={extract}>Extraer y comprobar original</button>
    {saved.length > 0 && <details><summary>Textos revisados guardados</summary>{saved.map((s) => <button type="button" key={s.id} disabled={busy} onClick={() => void execute(() => actions.getDocumentTranscription(s.id), (value) => { onPrepared(value); setNotice('Texto guardado añadido a la selección.'); })}>Usar preparación · {s.characters.toLocaleString('es')} caracteres</button>)}</details>}
    {fileId && <details><summary>Reconocer imágenes o páginas escaneadas con Gemini</summary>
      <p>El OCR envía únicamente las páginas seleccionadas del original. Requiere tu clave y consentimiento en Ajustes. Cada lote admite de una a cinco páginas; una imagen corresponde a la página 1.</p>
      <label>Páginas originales (por ejemplo 2, 4, 5) <input value={pages} disabled={busy} onChange={(e) => { setPages(e.target.value); setDraft(undefined); setConsent(false); }} /></label>
      <button type="button" disabled={busy} onClick={prepareOcr}>Preparar vista previa de OCR</button>
      {draft && <div><p>Páginas: {draft.pages.join(', ')} · Modelo: {draft.model} · Entrada estimada: {draft.estimatedInputTokens.toLocaleString('es')} tokens · Salida máxima: {draft.estimatedOutputTokens.toLocaleString('es')} tokens. Es una estimación, el consumo final puede variar.</p>
        <p>Estado: {draft.state === 'prepared' ? 'Preparado para confirmar' : draft.state === 'running' ? 'En curso' : draft.state === 'ready' ? 'Listo para revisar' : draft.state === 'unknown' ? 'Resultado incierto; consulta el envío' : draft.state === 'cancelled' ? 'Cancelado' : 'Requiere atención'} {draft.error}</p>
        {draft.state === 'prepared' && <><label><input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} />He revisado las páginas y el consumo. Confirmo enviarlas a Gemini.</label><button type="button" disabled={busy || !consent} onClick={runOcr}>Enviar este lote a Gemini</button></>}
        {uncertain && <label><input type="checkbox" checked={acknowledgeUnknown} disabled={busy} onChange={(e) => setAcknowledgeUnknown(e.target.checked)} />Consulté el envío incierto y entiendo que un nuevo envío puede consumir cuota adicional.</label>}
        <button type="button" disabled={busy} onClick={() => void execute(() => actions.getDocumentOcr(draft.id), adoptOcr)}>Consultar este envío</button>
        {draft.state !== 'cancelled' && <button type="button" disabled={busy} onClick={() => void execute(() => actions.cancelDocumentOcr(draft.id, draft.revision), adoptOcr)}>Cancelar OCR</button>}
      </div>}
    </details>}
    {omissions.length > 0 && <ul>{omissions.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}
    {segments.length > 0 && <fieldset disabled={busy}><legend>Revisar y seleccionar texto · {count.toLocaleString('es')} / 40 000 caracteres</legend>
      <button type="button" onClick={() => { setSelected([]); resetText(); }}>Quitar selección</button>
      {segments.map((s) => <details key={s.id}><summary><label><input type="checkbox" checked={selected.includes(s.id)} onChange={(e) => { setSelected((prior) => e.target.checked ? [...prior, s.id] : prior.filter((id) => id !== s.id)); resetText(); }} />{locatorLabel(s)} · {s.text.length.toLocaleString('es')} caracteres</label></summary>
        <textarea aria-label={`Texto ${locatorLabel(s)}`} value={s.text} rows={6} onChange={(e) => { setSegments((prior) => prior.map((segment) => segment.id === s.id ? { ...segment, text: e.target.value } : segment)); resetText(); }} />
      </details>)}
      {count > 40_000 && <p role="alert">Reduce las páginas o secciones seleccionadas. El contenido no se recortará automáticamente.</p>}
      <label><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />Revisé y corregí el texto seleccionado, sus localizadores y las omisiones.</label>
      <button type="button" disabled={!reviewed || !count || count > 40_000} onClick={save}>Guardar texto revisado y usarlo en Exámenes</button>
    </fieldset>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </details>;
}
