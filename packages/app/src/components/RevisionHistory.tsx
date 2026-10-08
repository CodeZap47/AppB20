import { useState } from 'react';
import type { Member, Revision } from '../data/types';
import { formatTime, memberName } from '../lib/format';
import { Avatar } from './Avatar';
import { RichText } from './RichText';

/**
 * Historial de una página que todos editan: quién guardó cada versión y cuándo. Permite ver
 * una versión anterior y restaurarla, lo que crea una versión nueva sin borrar las demás.
 */
export function RevisionHistory({
  revisions,
  members,
  summaryLabel,
  bodyLabel = 'Instrucciones',
  onRestore,
  error,
}: {
  /** De la más reciente a la primera. */
  revisions: Revision[];
  members: Member[];
  /** Nombre del texto secundario (el objetivo de una actividad), si la página lo tiene. */
  summaryLabel?: string;
  bodyLabel?: string;
  onRestore: (revision: Revision) => void;
  error?: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const current = revisions[0];

  return (
    <section className="panel history" aria-label="Historial de cambios">
      <h2 className="label">Historial de cambios</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ol className="history__list">
        {revisions.map((revision) => {
          const isCurrent = revision.id === current?.id;
          const open = revision.id === openId;
          return (
            <li key={revision.id} className="history__item">
              <div className="history__row">
                <Avatar member={members.find((m) => m.id === revision.editedBy)} size={28} />
                <span className="history__who">
                  <strong>
                    Versión {revision.version}
                    {isCurrent && <span className="badge badge--resolved">Actual</span>}
                  </strong>
                  <span className="muted">
                    {memberName(members, revision.editedBy)} · {formatTime(revision.editedAt)}
                  </span>
                </span>
                {!isCurrent && (
                  <button
                    type="button"
                    className="link-button"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : revision.id)}
                  >
                    {open ? 'Ocultar' : 'Ver'}
                  </button>
                )}
              </div>
              {open && (
                <div className="history__preview">
                  <strong>{revision.title}</strong>
                  {summaryLabel && revision.summary && (
                    <>
                      <span className="label">{summaryLabel}</span>
                      <RichText text={revision.summary} />
                    </>
                  )}
                  <span className="label">{bodyLabel}</span>
                  {revision.body ? <RichText text={revision.body} /> : <p className="muted">Sin texto.</p>}
                  <div className="form__actions">
                    <span className="muted form__note">Restaurarla crea una versión nueva; no borra nada.</span>
                    <button type="button" className="secondary" onClick={() => onRestore(revision)}>
                      Restaurar esta versión
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
