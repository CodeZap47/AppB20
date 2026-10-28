import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { useGuideMaterialSelection } from '../lib/useGuideMaterialSelection';

export function GuideMaterialDraftStatus({ draft, mode }: { draft: ReturnType<typeof useGuideMaterialSelection>; mode: 'manual' | 'ai' }) {
  const navigate = useNavigate(); const [error, setError] = useState('');
  const move = async () => {
    setError('');
    try { await draft.flush(); void navigate(`/m/guias/nueva?materialDraft=${draft.id}${mode === 'manual' ? '&modo=ia' : ''}`); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Guarda la selección antes de cambiar de editor.'); }
  };
  return <section className="guide-material-draft" aria-label="Selección privada guardada">
    <div className="guide-material-draft__status"><p role="status">{!draft.ready ? 'Recuperando tus materiales…' : draft.saving ? 'Guardando tus materiales…' : draft.saved ? 'Selección guardada en tu borrador privado.' : 'Tus materiales se guardarán al definir la materia.'}</p>
      <div className="row"><button type="button" className="secondary" disabled={!draft.ready || draft.saving} onClick={() => void draft.flush().catch(() => {})}>Guardar borrador privado</button><button type="button" className="secondary" disabled={!draft.ready || draft.saving} onClick={() => void move()}>{mode === 'manual' ? 'Usar estos materiales con IA' : 'Redactar manualmente con estos materiales'}</button></div></div>
    {(draft.error || error) && <div><p className="error" role="alert">{draft.error || error}</p><button type="button" className="secondary" onClick={() => draft.open(crypto.randomUUID())}>Iniciar un borrador nuevo</button></div>}
    <details onToggle={(event) => { if (event.currentTarget.open) void draft.refreshList().catch(() => {}); }}><summary>Retomar materiales de otro borrador</summary><ul>{draft.summaries.filter((entry) => entry.id !== draft.id).map((entry) => <li key={entry.id}><button type="button" className="link-button" onClick={() => { void draft.flush().then(() => draft.open(entry.id)).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'No pudimos cambiar de borrador.')); }}>{entry.title || 'Guía sin título'}</button> · {entry.materialCount} materiales</li>)}</ul></details>
  </section>;
}
