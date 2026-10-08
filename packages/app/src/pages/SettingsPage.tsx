import { useState } from 'react';
import { Link } from 'react-router';
import { requestNotificationPermission, webPushSupport } from '../lib/notifications';
import { usePlatform } from '../components/PlatformContext';

export function SettingsPage() {
  const platform = usePlatform();
  const [permission, setPermission] = useState<string>(
    'Notification' in window ? Notification.permission : 'no disponible',
  );
  const support = platform === 'web' ? webPushSupport() : null;

  return (
    <>
      <h1>Ajustes</h1>

      <section>
        <h2>Gemini (BYOK)</h2>
        <p className="muted">
          Cada alumno usa su propia clave. La clave se guarda cifrada en el backend y aquí solo se
          muestra si existe; nunca se vuelve a mostrar completa. Las funciones del grupo siguen
          disponibles sin configurar IA.
        </p>
        <p className="placeholder">
          Pendiente: habilitar solo después de confirmar edad y acceso a Google AI Studio.
        </p>
      </section>

      <section>
        <h2>Notificaciones</h2>
        {platform === 'android' && (
          <p className="muted">En Android los avisos llegan por Firebase Cloud Messaging.</p>
        )}
        {platform.startsWith('extension') && (
          <p className="muted">La extensión tendrá su propia bandeja de avisos.</p>
        )}
        {support?.kind === 'needs-install' && (
          <p>
            {support.reason} <Link to="/instalar">Ver cómo instalar</Link>
          </p>
        )}
        {support?.kind === 'unsupported' && <p>{support.reason}</p>}
        {support?.kind === 'supported' && (
          <>
            <p>Permiso actual: {permission}</p>
            <button
              type="button"
              onClick={async () => setPermission(await requestNotificationPermission())}
            >
              Activar notificaciones
            </button>
          </>
        )}
      </section>
    </>
  );
}
