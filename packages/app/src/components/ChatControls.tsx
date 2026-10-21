import { useState, type FormEvent } from 'react';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Id, MessageFields, MessageScope } from '../data/types';
import { chatTarget } from '../lib/chat';
import { formatTime, memberName } from '../lib/format';
import { ResourceDownloads } from './AcademicTools';
import { useAction } from './useAction';

export function ConversationMute({ scope, conversationId }: { scope: MessageScope; conversationId: Id }) {
  const source = useDataSource();
  const { conversationStates } = useSnapshot();
  const { error, pending, run } = useAction();
  const muted = conversationStates.find((row) => row.scope === scope && row.conversationId === conversationId)?.muted ?? false;
  return <div className="chat-control">
    <button className="button secondary" type="button" aria-pressed={muted} disabled={pending}
      onClick={() => void run(() => source.setConversationMuted(scope, conversationId, !muted))}>
      {muted ? 'Activar avisos' : 'Silenciar'}
    </button>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

/** La evidencia parte vacía: el participante elige cada contenido que compartirá. */
export function ReportMessageForm({ scope, message, onClose }: { scope: MessageScope; message: MessageFields; onClose(): void }) {
  const source = useDataSource();
  const { resourceFiles } = useSnapshot();
  const { error, pending, run } = useAction();
  const [reason, setReason] = useState('');
  const [shareText, setShareText] = useState(false);
  const [attachmentIds, setAttachmentIds] = useState<Id[]>([]);
  const files = resourceFiles.filter((file) => file.targetKind === chatTarget(scope) && file.targetId === message.id && !file.removedAt);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(async () => { await source.reportMessage({ scope, messageId: message.id, reason, shareText, attachmentIds }); return true; });
    if (saved) onClose();
  };
  return <section className="panel chat-report" aria-label="Reportar mensaje">
    <h3>Reportar este mensaje</h3>
    <p>Solo tú y los creadores de la app verán el reporte. Elige qué evidencia compartir; el resto de la conversación queda privado.</p>
    <form className="form" onSubmit={(event) => void submit(event)}>
      <label className="field"><span className="field__label">Motivo del reporte</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={2000} rows={3} /></label>
      <label className="chat-check"><input type="checkbox" checked={shareText} onChange={(event) => setShareText(event.target.checked)} /> Compartir el texto de este mensaje</label>
      {shareText && <blockquote className="chat-report__evidence">{message.text}</blockquote>}
      {files.map((file) => <label className="chat-check" key={file.id}><input type="checkbox" checked={attachmentIds.includes(file.id)} onChange={(event) => setAttachmentIds((current) => event.target.checked ? [...current, file.id] : current.filter((id) => id !== file.id))} /> Compartir {file.name}</label>)}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row"><button type="submit" disabled={pending || !reason.trim()}>Enviar reporte</button><button type="button" className="secondary" onClick={onClose} disabled={pending}>Cancelar reporte</button></div>
    </form>
  </section>;
}

/** Los creadores reciben solo las pruebas elegidas, sin abrir el historial privado. */
export function MessageReportsPanel() {
  const source = useDataSource();
  const { messageReports, resourceFiles, me, members } = useSnapshot();
  const { error, pending, run } = useAction();
  if (!messageReports.length) return null;
  return <details className="chat-reports">
    <summary>{me?.isCreator ? 'Reportes de convivencia' : 'Mis reportes'} ({messageReports.length})</summary>
    {messageReports.map((report) => <article className="panel" key={report.id}>
      <p><strong>{memberName(members, report.reporterId)}</strong> · {formatTime(report.createdAt)} · {report.status === 'resolved' ? 'Atendido' : 'Pendiente'}</p>
      <p>{report.reason}</p>
      {report.evidenceText && <blockquote className="chat-report__evidence">{report.evidenceText}</blockquote>}
      {'attachmentIds' in report && Array.isArray(report.attachmentIds) && <ResourceDownloads files={resourceFiles.filter((file) => report.attachmentIds.includes(file.id))} />}
      {me?.isCreator && report.status === 'open' && <button type="button" className="secondary" disabled={pending} onClick={() => void run(() => source.resolveMessageReport(report.id))}>Marcar como atendido</button>}
    </article>)}
    {error && <p className="error" role="alert">{error}</p>}
  </details>;
}
