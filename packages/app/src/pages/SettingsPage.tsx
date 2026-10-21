import { Link } from 'react-router';
import { ByokSettings } from '../components/ByokSettings';
import { CalendarSettings } from '../components/CalendarSettings';
import { MembershipSettings } from '../components/MembershipSettings';
import { NotificationSettings } from '../components/NotificationSettings';
import { useSession, useSessionStore } from '../auth/AuthContext';
import { useDataSource } from '../data/DataContext';
import { DemoDataSource } from '../data/demo';

export function SettingsPage() {
  const session = useSession();
  const sessionStore = useSessionStore();
  const simulated = useDataSource() instanceof DemoDataSource;

  return (
    <>
      <h1>Ajustes</h1>
      <section><h2>Publicaciones retiradas</h2><p>Consulta y recupera tus publicaciones retiradas. La administración también puede revisar retiros del grupo.</p><Link to="/m/retirados">Abrir publicaciones retiradas</Link></section>

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

      <ByokSettings />

      <NotificationSettings />
    </>
  );
}
