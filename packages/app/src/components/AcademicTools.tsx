import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { formatBytes, WORK_KIND_LABEL } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { ProgressStatus, ResourceFile, ResourceTargetKind, Work } from '../data/types';
import { formatTime, memberName } from '../lib/format';
import { FilePicker } from './FilePicker';
import { RichText } from './RichText';
import { useAction } from './useAction';

export const PROGRESS_LABEL: Record<ProgressStatus, string> = {
  pending: 'Sin empezar', in_progress: 'En proceso', done: 'Terminado',
};
export const WORK_STATUS_LABEL = { draft: 'Borrador compartido', final: 'Final', reviewed: 'Revisado' } as const;

export function ProgressControl({ kind, id }: { kind: 'assignment' | 'activity'; id: string }) {
  const data = useSnapshot();
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const current = data.myProgress.find((p) => p.targetKind === kind && p.targetId === id)?.status ?? 'pending';
  if (!data.me) return null;
  return <section className="panel academic-progress">
    <label className="field">
      <span className="field__label">Mi avance</span>
      <select aria-label="Mi avance" value={current} disabled={pending}
        onChange={(e) => { const status = e.target.value as ProgressStatus; void run(() => source.setProgress(kind, id, status)); }}>
        {Object.entries(PROGRESS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    <p className="field__hint">Solo tú puedes verlo. Publicar un trabajo no cambia tu avance.</p>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

export function ResourceDownloads({ files, onRemove, disabled }: {
  files: ResourceFile[]; onRemove?: (file: ResourceFile) => void; disabled?: boolean;
}) {
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const controller = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<{ name: string; done: number; total: number } | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const download = async (file: ResourceFile) => {
    const current = new AbortController();
    controller.current = current;
    setProgress({ name: file.name, done: 0, total: file.size });
    try { await run(async () => {
      const blob = await source.downloadResourceFile(file.id, { signal: current.signal,
        onProgress: (done, total) => setProgress({ name: file.name, done, total }) });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.name;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }); } finally { controller.current = null; setProgress(null); }
  };
  return <>
    <ul className="files">
      {files.map((file) => <li key={file.id} className="file">
        <span className="file__main">
          <button type="button" className="link-button academic-file-name" disabled={pending}
            onClick={() => void download(file)}>{file.name}</button>
          <span className="file__meta">{formatBytes(file.size)}</span>
        </span>
        {onRemove && <button type="button" className="link-button" disabled={disabled}
          aria-label={`Quitar ${file.name}`} onClick={() => onRemove(file)}>Quitar</button>}
      </li>)}
    </ul>
    {progress && <p role="status">Descargando {progress.name}: {Math.round(progress.done / progress.total * 100)} % <button type="button" className="link-button" onClick={() => controller.current?.abort()}>Cancelar descarga</button></p>}
    {error && <p className="error" role="alert">{error}</p>}
  </>;
}

export function ResourceSection({ kind, id, version, canEdit, title = 'Archivos y recursos' }: {
  kind: ResourceTargetKind; id: string; version: number; canEdit: boolean; title?: string;
}) {
  const { resourceFiles } = useSnapshot();
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<{ files: File[]; version: number } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<{ name: string; done: number; total: number } | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const files = resourceFiles.filter((f) => f.targetKind === kind && f.targetId === id && !f.removedAt);
  const upload = async (list: File[], firstVersion = version) => {
    if (busy) return;
    setBusy(true);
    setRetry(null);
    const current = new AbortController();
    controller.current = current;
    let expected = firstVersion;
    try {
      for (let index = 0; index < list.length; index++) {
        const file = list[index]!;
        setProgress({ name: file.name, done: 0, total: file.size });
        const saved = await run(async () => { await source.attachResourceFile(kind, id, file, expected,
          { signal: current.signal, onProgress: (done, total) => setProgress({ name: file.name, done, total }) }); return true; });
        if (!saved) { if (!current.signal.aborted) setRetry({ files: list.slice(index), version: expected }); break; }
        expected++;
      }
    } finally { controller.current = null; setProgress(null); setBusy(false); }
  };
  return <section className="academic-resources" aria-label={title}>
    <h3 className="label">{title}</h3>
    {!files.length && <p className="muted">Sin archivos adjuntos.</p>}
    <ResourceDownloads files={files} disabled={busy || pending}
      onRemove={canEdit ? (file) => { void run(() => source.removeResourceFile(file.id, version)); } : undefined} />
    {canEdit && <>
      <FilePicker onFiles={(list) => void upload(list)} busy={busy || pending} disabled={Boolean(retry)} />
      {progress && <p role="status">Subiendo {progress.name}: {Math.round(progress.done / progress.total * 100)} % <button type="button" className="link-button" onClick={() => controller.current?.abort()}>Cancelar subida</button></p>}
      {retry && <div className="academic-upload-retry"><p>Quedan por confirmar: {retry.files.map((file) => file.name).join(', ')}.</p><button type="button" disabled={busy || pending} onClick={() => void upload(retry.files, retry.version)}>Reintentar archivos pendientes</button><button type="button" className="secondary" disabled={busy || pending} onClick={() => setRetry(null)}>Descartar pendientes</button></div>}
      <p className="field__hint">Hasta 50 MB por archivo. Los archivos de versiones anteriores se conservan en el historial.</p>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

export function AcademicComments({ kind, id }: { kind: 'work' | 'evidence'; id: string }) {
  const { academicComments, members, me } = useSnapshot();
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const [text, setText] = useState('');
  const comments = academicComments.filter((c) => c.targetKind === kind && c.targetId === id);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(async () => { await source.commentAcademic(kind, id, text); return true; });
    if (saved) setText('');
  };
  return <section className="academic-comments">
    <h3 className="label">Comentarios ({comments.length})</h3>
    {comments.map((comment) => <article key={comment.id} className="academic-comment">
      <p className="muted"><strong>{memberName(members, comment.authorId)}</strong> · {formatTime(comment.createdAt)}</p>
      <RichText text={comment.text} />
    </article>)}
    {me && <form className="form" onSubmit={(event) => void submit(event)}>
      <label className="field"><span className="field__label">Comentar o pedir una aclaración</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} required />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={pending || !text.trim()}>Publicar comentario</button>
    </form>}
  </section>;
}

export function WorkHistoryAndReview({ work }: { work: Work }) {
  const { workRevisions, workReviews, resourceFiles, members, me } = useSnapshot();
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const [comment, setComment] = useState('');
  const [reviewVersion, setReviewVersion] = useState(work.version);
  const author = Boolean(me && work.authorIds.includes(me.id));
  const history = workRevisions.filter((r) => r.workId === work.id).sort((a, b) => b.version - a.version);
  const reviews = workReviews.filter((r) => r.workId === work.id && r.workVersion === work.version);
  const reviewed = reviews.some((r) => r.reviewerId === me?.id);
  const status = work.status ?? 'draft';
  const review = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(async () => { await source.reviewWork(work.id, reviewVersion, comment); return true; });
    if (saved) setComment('');
  };
  return <section className="academic-history">
    <p><span className={`badge ${status === 'reviewed' ? 'badge--resolved' : ''}`}>{WORK_STATUS_LABEL[status]}</span></p>
    {reviews.map((item) => <article key={item.id} className="academic-comment">
      <p className="muted">Revisión de <strong>{memberName(members, item.reviewerId)}</strong> · {formatTime(item.createdAt)}</p>
      <RichText text={item.comment} />
    </article>)}
    {me && !author && status !== 'draft' && !reviewed && <form className="form" onSubmit={(e) => void review(e)}>
      <label className="field"><span className="field__label">Revisar esta versión final</span>
        <textarea rows={3} value={comment} onChange={(e) => { if (!comment) setReviewVersion(work.version); setComment(e.target.value); }} maxLength={2000} required
          placeholder="Qué comprobaste y qué observaciones tienes sobre esta versión" />
      </label>
      <p className="field__hint">La revisión corresponde a la versión {reviewVersion}. No es una calificación oficial.</p>
      {comment && reviewVersion !== work.version && <p className="error" role="alert">El trabajo cambió mientras lo revisabas. <button type="button" className="link-button" onClick={() => { setComment(''); setReviewVersion(work.version); }}>Revisar la versión actual</button></p>}
      <button type="submit" disabled={pending || !comment.trim() || reviewVersion !== work.version}>Aprobar esta versión</button>
    </form>}
    <details className="academic-version-list">
      <summary>Historial del trabajo ({history.length})</summary>
      <p className="field__hint">Se conservan las versiones desde la activación del historial. Las anteriores que no se guardaron no se pueden reconstruir.</p>
      {history.map((revision) => <details key={revision.id} className="academic-version">
        <summary>Versión {revision.version} · {WORK_STATUS_LABEL[revision.status]} · {formatTime(revision.editedAt)}{revision.version === work.version ? ' · Actual' : ''}</summary>
        <p className="muted">{revision.version > 1 && revision.version === history.at(-1)?.version ? 'Versión existente al activar el historial; editor previo no registrado' : revision.editedBy ? memberName(members, revision.editedBy) : 'Autor de esta edición no registrado'}</p>
        <strong>{revision.title || 'Sin título propio'}</strong>
        {revision.topic && <p className="muted">Tema: {revision.topic}</p>}
        <RichText text={revision.description} />
        <ResourceDownloads files={resourceFiles.filter((f) => revision.attachmentIds.includes(f.id))} />
        {workReviews.filter((r) => r.workId === work.id && r.workVersion === revision.version).map((r) => <p key={r.id} className="muted">
          Revisión de {memberName(members, r.reviewerId)}: {r.comment}
        </p>)}
        {author && revision.version !== work.version && <button type="button" className="secondary" disabled={pending}
          onClick={() => void run(() => source.restoreWorkVersion(work.id, revision.version, work.version))}>Restaurar como versión nueva</button>}
      </details>)}
    </details>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

export function PageHistory({ kind, id, version }: { kind: 'assignment' | 'activity'; id: string; version: number }) {
  const { pageSnapshots, resourceFiles, revisions, members, subjects, terms, assignments, notes } = useSnapshot();
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const history = pageSnapshots.filter((r) => r.page === kind && r.pageId === id).sort((a, b) => b.version - a.version);
  const legacy = revisions.filter((r) => r.page === kind && r.pageId === id && !history.some((s) => s.version === r.version));
  return <section className="panel academic-history" aria-label="Historial de cambios">
    <h2 className="label">Historial de cambios</h2>
    {history.map((r) => <details key={r.id} className="academic-version">
      <summary>Versión {r.version} · {formatTime(r.editedAt)}{r.version === version ? ' · Actual' : ''}</summary>
      <p className="muted">{r.editedBy ? memberName(members, r.editedBy) : 'Edición anterior'}</p>
      <strong>{r.title}</strong>
      <dl className="facts"><dt>Materia</dt><dd>{subjects.find((s) => s.id === r.subjectId)?.name ?? 'Materia anterior'}</dd><dt>Parcial</dt><dd>{terms.find((term) => term.id === r.termId)?.name ?? 'Sin parcial'}</dd>{r.kind && <><dt>Tipo</dt><dd>{WORK_KIND_LABEL[r.kind]}</dd></>}</dl>
      {(r.assignmentIds.length > 0 || r.noteIds.length > 0) && <ul className="links">{r.assignmentIds.map((targetId) => <li key={`task:${targetId}`}><Link to={`/m/tareas/${targetId}`}>{assignments.find((a) => a.id === targetId)?.title ?? 'Tarea relacionada'}</Link></li>)}{r.noteIds.map((targetId) => <li key={`note:${targetId}`}><Link to={`/m/notas/${targetId}`}>{notes.find((n) => n.id === targetId)?.title ?? 'Nota no disponible'}</Link></li>)}</ul>}
      {r.topic && <p>Tema: {r.topic}</p>}
      {r.dueDate && <p>Entrega: {r.dueDate}</p>}
      {r.date && <p>Sesión: {r.date}</p>}
      {r.summary && <RichText text={r.summary} />}
      <RichText text={r.body} />
      <ResourceDownloads files={resourceFiles.filter((f) => r.attachmentIds.includes(f.id))} />
      {r.version !== version && <button type="button" className="secondary" disabled={pending}
        onClick={() => void run(() => source.restorePageSnapshot(kind, id, r.version, version))}>Restaurar esta versión completa</button>}
    </details>)}
    {legacy.length > 0 && <details className="academic-version"><summary>Registro anterior al historial completo</summary>
      <p className="field__hint">Estas ediciones solo conservaron el texto. Su clasificación y archivos anteriores no están disponibles.</p>
      {legacy.map((r) => <details key={r.id}><summary>Versión {r.version} · {formatTime(r.editedAt)}</summary><strong>{r.title}</strong><RichText text={r.body} /></details>)}
    </details>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

export function ActivityRelations({ activityId, version, editable = true }: { activityId: string; version: number; editable?: boolean }) {
  const { activityLinks, assignments, notes, activities } = useSnapshot();
  const source = useDataSource();
  const activity = activities.find((a) => a.id === activityId);
  const links = activityLinks.filter((l) => l.activityId === activityId && !l.removedAt);
  const [editing, setEditing] = useState(false);
  const [baseVersion, setBaseVersion] = useState(version);
  const [assignmentIds, setAssignmentIds] = useState<string[]>([]);
  const [noteIds, setNoteIds] = useState<string[]>([]);
  const { error, pending, run } = useAction();
  const start = () => {
    setBaseVersion(version);
    setAssignmentIds(links.filter((l) => l.targetKind === 'assignment').map((l) => l.targetId));
    setNoteIds(links.filter((l) => l.targetKind === 'note').map((l) => l.targetId));
    setEditing(true);
  };
  const toggle = (values: string[], id: string) => values.includes(id) ? values.filter((x) => x !== id) : [...values, id];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(async () => { await source.saveActivityLinks(activityId, assignmentIds, noteIds, baseVersion); return true; })) setEditing(false);
  };
  return <section className="panel academic-relations">
    <h2 className="label">Material relacionado</h2>
    <ul className="links">{links.map((link) => <li key={link.id}><Link to={link.targetKind === 'assignment' ? `/m/tareas/${link.targetId}` : `/m/notas/${link.targetId}`}>
      {link.targetKind === 'assignment' ? assignments.find((a) => a.id === link.targetId)?.title ?? 'Tarea' : notes.find((n) => n.id === link.targetId)?.title ?? 'Nota'}
    </Link></li>)}</ul>
    {!links.length && <p className="muted">Todavía no hay tareas ni notas enlazadas.</p>}
    {editable && !editing && <button type="button" className="secondary" onClick={start}>Elegir tareas y notas</button>}
    {editing && <form className="form" onSubmit={(e) => void submit(e)}>
      <fieldset className="field"><legend>Tareas de esta materia</legend>
        {assignments.filter((a) => a.subjectId === activity?.subjectId).map((a) => <label className="academic-choice" key={a.id}>
          <input type="checkbox" checked={assignmentIds.includes(a.id)} onChange={() => setAssignmentIds(toggle(assignmentIds, a.id))} />{a.title}
        </label>)}
      </fieldset>
      <fieldset className="field"><legend>Notas compartidas de esta materia</legend>
        {notes.filter((n) => n.visibility === 'group' && n.subjectId === activity?.subjectId).map((n) => <label className="academic-choice" key={n.id}>
          <input type="checkbox" checked={noteIds.includes(n.id)} onChange={() => setNoteIds(toggle(noteIds, n.id))} />{n.title}
        </label>)}
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form__actions"><button type="button" className="secondary" onClick={() => setEditing(false)}>Cancelar</button><button type="submit" disabled={pending}>Guardar relaciones</button></div>
    </form>}
  </section>;
}
