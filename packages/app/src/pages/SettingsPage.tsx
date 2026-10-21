import { useState } from 'react';
import { Link } from 'react-router';
import { requestNotificationPermission, webPushSupport } from '../lib/notifications';
import { CalendarSettings } from '../components/CalendarSettings';
import { MembershipSettings } from '../components/MembershipSettings';
import { usePlatform } from '../components/PlatformContext';
import { useSession, useSessionStore } from '../auth/AuthContext';
import { useDataSource } from '../data/DataContext';
import { DemoDataSource } from '../data/demo';

export function SettingsPage() {
  const platform = usePlatform();
  const [permission, setPermission] = useState<string>(
    'Notification' in window ? Notification.permission : 'no disponible',
  );
  const support = platform === 'web' ? webPushSupport() : null;
  const session = useSession();
  const sessionStore = useSessionStore();
  const simulated = useDataSource() instanceof DemoDataSource;

  return (
    <>
      <h1>Ajustes</h1>

      {session?.status === 'signedIn' && (
        <section>
          <h2>Cuenta de acceso</h2>
          <p>
            Entraste como <strong>{session.profile.email}</strong>.
          </p>
          <p className="muted">{simulated
            ? 'Tu sesión es real y la administra SpacetimeAuth. Elegir un perfil simulado no cambia esta cuenta.'
            : 'Sesión administrada por SpacetimeAuth. El acceso al grupo depende de tu invitación.'}</p>
          <button type="button" onClick={() => sessionStore?.signOut()}>
            Cerrar sesión
          </button>
        </section>
      )}

      {simulated && (
        <section>
          <h2>Simulación</h2>
          <p>El contenido, los integrantes y las invitaciones son datos de prueba. Los cambios no se guardan ni se comparten.</p>
          <p className="muted">Para explorar esta versión basta un correo verificado. Las invitaciones solo forman parte de la simulación.</p>
        </section>
      )}

      <CalendarSettings />

      <MembershipSettings />

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
