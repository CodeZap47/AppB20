import { useDataSource, useSnapshot } from '../data/DataContext';
import { DemoDataSource } from '../data/demo';

/** Aviso visible mientras la app usa datos de prueba en lugar de SpacetimeDB. */
export function DemoBanner() {
  const source = useDataSource();
  const { members } = useSnapshot();
  if (!(source instanceof DemoDataSource)) return null;

  return (
    <div className="demo-banner" role="status">
      <span>Datos de prueba: todavía no está conectado a SpacetimeDB.</span>
      <label>
        Ver como{' '}
        <select value={source.viewerId} onChange={(e) => source.setViewer(e.target.value)}>
          {(members.length ? members : [{ id: source.viewerId, displayName: source.viewerId }]).map(
            (m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ),
          )}
        </select>
      </label>
    </div>
  );
}
