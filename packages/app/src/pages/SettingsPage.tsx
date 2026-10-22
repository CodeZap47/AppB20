import { Link, useSearchParams } from 'react-router';
import { canManageCalendar } from '@b20/core';
import { Avatar } from '../components/Avatar';
import { CalendarSettings } from '../components/CalendarSettings';
import { ByokSettings } from '../components/ByokSettings';
import { MembershipSettings } from '../components/MembershipSettings';
import { NotificationSettings } from '../components/NotificationSettings';
import { useSession, useSessionStore } from '../auth/AuthContext';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { DemoDataSource } from '../data/demo';
import { ThemeSwitch } from '../design/Theme';
import { replayWelcomeTour } from '../components/WelcomeTour';
import { PasskeySettings } from '../auth/SupabaseSignInForm';

type Tab = 'cuenta' | 'calendario' | 'avisos' | 'ia' | 'admin';
const TABS: [Tab, string][] = [
  ['cuenta', 'Cuenta'],
  ['calendario', 'Calendario'],
  ['avisos', 'Avisos'],
  ['ia', 'IA'],
  ['admin', 'Administración'],
];

/**
 * Ajustes por pestañas; la elegida vive en `?pestana=` para poder enlazarla. La pestaña de
 * Administración solo aparece para los creadores y, si alguien más la pide, se muestra Cuenta.
 */
export function SettingsPage() {
  const { me } = useSnapshot();
  const admin = canManageCalendar(me);
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter(([id]) => id !== 'admin' || admin);
  const requested = params.get('pestana');
  const tab = tabs.find(([id]) => id === requested)?.[0] ?? 'cuenta';
  const go = (next: Tab) =>
    setParams((current) => {
      const copy = new URLSearchParams(current);
      copy.set('pestana', next);
      return copy;
    });

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Ajustes</h1>
          <p className="muted">
            {admin
              ? 'Tu cuenta, tus preferencias y la administración del grupo.'
              : 'Tu cuenta y tus preferencias personales.'}
          </p>
        </div>
      </header>

      <div className="chips chips--scroll settings-tabs" role="tablist" aria-label="Secciones de ajustes">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="chip"
            aria-selected={tab === id}
            aria-pressed={tab === id}
            onClick={() => go(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="settings-panel">
        {tab === 'cuenta' && <AccountSettings admin={admin} />}
        {tab === 'calendario' && <CalendarSettings />}
        {tab === 'avisos' && <NotificationSettings />}
        {tab === 'ia' && <ByokSettings />}
        {tab === 'admin' && <MembershipSettings />}
      </div>
    </>
  );
}

function AccountSettings({ admin }: { admin: boolean }) {
  const session = useSession();
  const sessionStore = useSessionStore();
  const { me, members } = useSnapshot();
  const simulated = useDataSource() instanceof DemoDataSource;
  const admins = members
    .filter((m) => m.status === 'active' && m.isCreator)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <>
      <section className="panel settings"><h2>Hazlo tuyo</h2><p className="muted">Elige la edición visual y conoce las herramientas de tu grupo.</p><ThemeSwitch /><p><button type="button" className="secondary" onClick={replayWelcomeTour}>Volver a ver el tutorial</button></p></section>
      <PasskeySettings />
      {simulated && (
        <section className="panel panel--warn settings">
          <h2>Simulación</h2>
          <p>El contenido, los integrantes y las invitaciones son datos de prueba. Los cambios no se guardan ni se comparten.</p>
          <p className="field__hint">Para explorar esta versión basta un correo verificado. Las invitaciones solo forman parte de la simulación.</p>
        </section>
      )}

      <section className="panel settings" aria-labelledby="settings-account-title">
        <h2 id="settings-account-title">Tu cuenta</h2>
        <div className="settings-account">
          <Avatar member={me} size={56} />
          <div className="settings-account__info">
            <strong>{me?.displayName ?? 'Sin perfil en el grupo'}</strong>
            {session?.status === 'signedIn' && <span className="muted">{session.profile.email}</span>}
            <span className="badges">
              {me?.status === 'active'
                ? <span className={admin ? 'badge badge--admin' : 'badge badge--group'}>{admin ? 'Administración' : 'Integrante'}</span>
                : <span className="badge badge--warn">Sin acceso vigente</span>}
            </span>
          </div>
        </div>
        {session?.status === 'signedIn' && (
          <>
            <p className="field__hint">{simulated
              ? 'Tu sesión es real y la administra SpacetimeAuth. Elegir un perfil simulado no cambia esta cuenta.'
              : 'Sesión administrada por SpacetimeAuth. El acceso al grupo depende de tu invitación.'}</p>
            <div className="form__actions">
              <button type="button" className="secondary" onClick={() => sessionStore?.signOut()}>
                Cerrar sesión
              </button>
            </div>
          </>
        )}
      </section>

      {!admin && (
        <section className="panel settings" aria-labelledby="settings-admins-title">
          <h2 id="settings-admins-title">Administración del grupo</h2>
          <p className="muted">
            Las fechas del calendario, las invitaciones y las bajas las gestiona la administración. Si necesitas un cambio, pídeselo a:
          </p>
          {admins.length ? (
            <ul className="plain-list settings-people">
              {admins.map((m) => (
                <li key={m.id} className="row">
                  <Avatar member={m} size={28} />
                  <span>{m.displayName}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Todavía no hay administradores activos.</p>
          )}
        </section>
      )}

      <section className="panel settings" aria-labelledby="settings-retired-title">
        <h2 id="settings-retired-title">Publicaciones retiradas</h2>
        <p className="muted">
          {admin
            ? 'Consulta y recupera tus publicaciones retiradas, y revisa los retiros del grupo.'
            : 'Consulta y recupera tus publicaciones retiradas.'}
        </p>
        <div className="form__actions">
          <Link className="button secondary" to="/m/retirados">Abrir publicaciones retiradas</Link>
        </div>
      </section>
    </>
  );
}
