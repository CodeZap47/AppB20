import { Link, useRouteError } from 'react-router';
import { Empty } from './Empty';

/**
 * Lo que se ve cuando una pantalla falla al dibujarse. Sustituye al aviso en inglés de React
 * Router y ofrece cómo seguir: recargar o volver al inicio. El menú sigue disponible.
 */
export function ErrorPage() {
  const error = useRouteError();
  const detail = error instanceof Error ? error.message : String(error ?? '');

  return (
    <Empty
      icon="close"
      title="Esta pantalla tuvo un problema"
      action={
        <div className="row error-page__actions">
          <button type="button" onClick={() => window.location.reload()}>
            Recargar la app
          </button>
          <Link to="/" className="button secondary">
            Ir al inicio
          </Link>
        </div>
      }
    >
      No se pudo mostrar. Recarga la app para intentarlo de nuevo.
      {detail && (
        <span className="error-page__detail">
          Detalle técnico: <code className="mono">{detail}</code>
        </span>
      )}
    </Empty>
  );
}
