import { useState } from 'react';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { WithdrawableKind } from '../data/delivery2Types';
import { formatTime } from '../lib/format';
import { useAction } from './useAction';
import { useTrashClock } from './useTrashClock';

/** Retirada reversible: el recurso deja de estar disponible para el resto del grupo. */
export function ContentWithdrawal({ kind, id, version, withdrawnAt, canEdit, reasonRequired = false }: {
  kind: WithdrawableKind; id: string; version: number; withdrawnAt?: Date; canEdit?: boolean; reasonRequired?: boolean;
}) {
  const source = useDataSource();
  const data = useSnapshot();
  const entry = data.trashEntries?.find((row) => row.kind === kind && row.targetId === id);
  const clock = useTrashClock(Boolean(withdrawnAt));
  const expiresAt = entry?.expiresAt ?? (withdrawnAt ? new Date(withdrawnAt.getTime() + 30 * 86_400_000) : undefined);
  const expired = Boolean(clock.now && expiresAt && clock.now >= expiresAt);
  const { error, pending, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  return <section className="content-withdrawal" aria-label="Disponibilidad de la publicación">
    {withdrawnAt && <p role="status" className="placeholder">{expired ? 'Terminó el plazo de recuperación de 30 días. La publicación ya no se puede restaurar.' : <>Publicación retirada el {formatTime(withdrawnAt)}. Puedes recuperar el mismo registro, versiones y adjuntos hasta {expiresAt && formatTime(expiresAt)}.</>}</p>}
    {canEdit && (withdrawnAt ? <button type="button" className="secondary" disabled={pending || !clock.now || expired || entry?.canRestore === false} onClick={() => void run(() => source.withdrawContent(kind, id, false, version))}>Restaurar publicación</button> : !confirming ? <button type="button" className="link-button" onClick={() => setConfirming(true)}>Retirar publicación</button> : <div className="form">
      <p>La publicación y sus archivos dejarán de estar disponibles para el grupo. Podrás restaurarla durante 30 días; después se eliminarán sus datos sin referencias compartidas vigentes.</p>
      <label className="field"><span className="field__label">Motivo{reasonRequired ? '' : ' (opcional)'}</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} rows={2} /></label>
      <div className="row"><button type="button" className="secondary" disabled={pending} onClick={() => { setConfirming(false); setReason(''); }}>Cancelar</button><button type="button" disabled={pending || (reasonRequired && !reason.trim())} onClick={() => void run(async () => { await source.withdrawContent(kind, id, true, version, reason); setConfirming(false); setReason(''); })}>Confirmar retirada</button></div>
    </div>)}
    {withdrawnAt && entry?.canRestore === false && <p className="muted">La restauración requiere a la persona responsable de esta retirada o a un administrador.</p>}
    {clock.error && <p className="error" role="status">{clock.error}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
