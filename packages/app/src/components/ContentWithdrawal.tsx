import { useState } from 'react';
import { useDataSource } from '../data/DataContext';
import type { WithdrawableKind } from '../data/delivery2Types';
import { formatTime } from '../lib/format';
import { useAction } from './useAction';

/** Retirada reversible: el recurso deja de estar disponible para el resto del grupo. */
export function ContentWithdrawal({ kind, id, version, withdrawnAt, canEdit, reasonRequired = false }: {
  kind: WithdrawableKind; id: string; version: number; withdrawnAt?: Date; canEdit?: boolean; reasonRequired?: boolean;
}) {
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  return <section className="content-withdrawal" aria-label="Disponibilidad de la publicación">
    {withdrawnAt && <p role="status" className="placeholder">Publicación retirada el {formatTime(withdrawnAt)}. No está disponible para el resto del grupo; su historial se conserva.</p>}
    {canEdit && (withdrawnAt ? <button type="button" className="secondary" disabled={pending} onClick={() => void run(() => source.withdrawContent(kind, id, false, version))}>Restaurar publicación</button> : !confirming ? <button type="button" className="link-button" onClick={() => setConfirming(true)}>Retirar publicación</button> : <div className="form">
      <p>La publicación y sus archivos dejarán de estar disponibles para el grupo. Podrás restaurarla después.</p>
      <label className="field"><span className="field__label">Motivo{reasonRequired ? '' : ' (opcional)'}</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} rows={2} /></label>
      <div className="row"><button type="button" className="secondary" disabled={pending} onClick={() => { setConfirming(false); setReason(''); }}>Cancelar</button><button type="button" disabled={pending || (reasonRequired && !reason.trim())} onClick={() => void run(async () => { await source.withdrawContent(kind, id, true, version, reason); setConfirming(false); setReason(''); })}>Confirmar retirada</button></div>
    </div>)}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
