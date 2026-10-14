import { useDataSource, useSnapshot } from '../data/DataContext';
import { DemoDataSource } from '../data/demo';

/** Aviso visible mientras la app usa datos de prueba, o cuando se perdió la conexión. */
export function DemoBanner() {
  const source = useDataSource();
  const { members, connection } = useSnapshot();
  if (connection === 'offline') {
    return (
      <div className="demo-banner" role="status">
        <span>Sin conexión. Reconectando; lo que ves puede no estar al día.</span>
      </div>
    );
  }
  if (!(source instanceof DemoDataSource)) return null;

  return (
    <div className="demo-banner" role="status">
      <span>Datos de prueba: lo que hagas aquí no se guarda.</span>
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
