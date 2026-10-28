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
import { replayWelcomeTour } from '../components/WelcomeTour';
import { PasskeySettings } from '../auth/SupabaseSignInForm';
import { ProfileCustomizationHint } from '../components/ProfileCustomizationHint';
import { Icon, type IconName } from '../components/Icon';
import './SettingsPage.css';

type Tab = 'cuenta' | 'calendario' | 'avisos' | 'ia' | 'admin';
const TABS: [Tab, string][] = [
  ['cuenta', 'Cuenta'],
  ['calendario', 'Calendario'],
  ['avisos', 'Avisos'],
  ['ia', 'IA'],
  ['admin', 'Administración'],
];
const TAB_DETAILS: Record<Tab, { icon: IconName; title: string; description: string }> = {
  cuenta: {
    icon: 'users',
    title: 'Tu cuenta, a tu manera',
    description: 'Personaliza cómo te presentas al grupo y administra tu acceso.',
  },
  calendario: {
    icon: 'calendar',
    title: 'El calendario del grupo',
    description: 'Consulta las fechas de cada parcial y organiza el cuatrimestre.',
  },
  avisos: {
    icon: 'chat',
    title: 'Tú eliges qué recibir',
    description: 'Ajusta tus recordatorios, horarios y notificaciones en cada dispositivo.',
  },
  ia: {
    icon: 'book',
    title: 'Tus herramientas de estudio con IA',
    description: 'Administra tu consentimiento y tu clave personal para usar Gemini.',
  },
  admin: {
    icon: 'lock',
    title: 'Administración del grupo',
    description: 'Organiza invitaciones, accesos y materiales de B20 desde un mismo lugar.',
  },
};

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
    <section className="settings-page">
      <header className="settings-header">
        <div>
          <p className="settings-eyebrow">
            <Icon name="more" size={16} /> Tu espacio en B20
          </p>
          <h1>Ajustes</h1>
          <p className="muted">
            {admin
              ? 'Tu cuenta, tus preferencias y la administración del grupo.'
              : 'Tu cuenta y tus preferencias personales.'}
          </p>
        </div>
        {me?.status === 'active' && (
          <Link className="button secondary with-icon" to={`/perfil/${me.id}`}>
            <Icon name="users" size={17} /> Ver mi perfil
          </Link>
        )}
      </header>

      <div className="settings-layout">
        <nav className="settings-navigation" aria-label="Navegación de ajustes">
          <div
            className="settings-tabs"
            role="tablist"
            aria-label="Secciones de ajustes"
            onKeyDown={(event) => {
              const current = tabs.findIndex(([id]) => id === tab);
              const index =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : event.key === 'ArrowRight' || event.key === 'ArrowDown'
                      ? (current + 1) % tabs.length
                      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                        ? (current - 1 + tabs.length) % tabs.length
                        : -1;
              if (index < 0) return;
              event.preventDefault();
              const next = tabs[index]![0];
              go(next);
              document.getElementById(`settings-tab-${next}`)?.focus();
            }}
          >
            {tabs.map(([id, label]) => (
              <button
                key={id}
                id={`settings-tab-${id}`}
                type="button"
                role="tab"
                className="settings-tab"
                aria-selected={tab === id}
                aria-pressed={tab === id}
                aria-controls={`settings-panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => go(id)}
              >
                <Icon name={TAB_DETAILS[id].icon} size={18} />
                <span>{label}</span>
                <Icon name="forward" size={14} />
              </button>
            ))}
          </div>
          <p className="settings-navigation__hint">
            Tus preferencias personales y las herramientas de tu grupo.
          </p>
        </nav>

        <div
          role="tabpanel"
          id={`settings-panel-${tab}`}
          aria-labelledby={`settings-tab-${tab}`}
          className={`settings-panel settings-panel--${tab}`}
        >
          <header className="settings-section-intro">
            <span className="settings-section-intro__icon">
              <Icon name={TAB_DETAILS[tab].icon} size={22} />
            </span>
            <div>
              <h2>{TAB_DETAILS[tab].title}</h2>
              <p>{TAB_DETAILS[tab].description}</p>
            </div>
          </header>
          {tab === 'cuenta' && <AccountSettings admin={admin} />}
          {tab === 'calendario' && <CalendarSettings />}
          {tab === 'avisos' && <NotificationSettings />}
          {tab === 'ia' && <ByokSettings />}
          {tab === 'admin' && <MembershipSettings />}
        </div>
      </div>
    </section>
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
      <ProfileCustomizationHint />
      <section className="panel settings settings-tutorial">
        <span className="settings-card-icon">
          <Icon name="book" size={21} />
        </span>
        <div>
          <h2>Conoce las herramientas de B20</h2>
          <p className="muted">Vuelve a recorrer la app cuando lo necesites.</p>
        </div>
        <button type="button" className="secondary" onClick={replayWelcomeTour}>
          Volver a ver el tutorial
        </button>
      </section>
      <PasskeySettings />
      {simulated && (
        <section className="panel panel--warn settings">
          <h2>Simulación</h2>
          <p>
            El contenido, los integrantes y las invitaciones son datos de prueba. Los cambios no se
            guardan ni se comparten.
          </p>
          <p className="field__hint">
            Para explorar esta versión basta un correo verificado. Las invitaciones solo forman
            parte de la simulación.
          </p>
        </section>
      )}

      <section className="panel settings" aria-labelledby="settings-account-title">
        <h2 id="settings-account-title">Tu cuenta</h2>
        <div className="settings-account">
          <Avatar member={me} size={56} />
          <div className="settings-account__info">
            <strong>{me?.displayName ?? 'Sin perfil en el grupo'}</strong>
            {session?.status === 'signedIn' && (
              <span className="muted">{session.profile.email}</span>
            )}
            <span className="badges">
              {me?.status === 'active' ? (
                <span className={admin ? 'badge badge--admin' : 'badge badge--group'}>
                  {admin ? 'Administración' : 'Integrante'}
                </span>
              ) : (
                <span className="badge badge--warn">Sin acceso vigente</span>
              )}
            </span>
          </div>
        </div>
        {session?.status === 'signedIn' && (
          <>
            <p className="field__hint">
              {simulated
                ? 'Tu sesión es real y la administra Supabase Auth. Elegir un perfil simulado no cambia esta cuenta.'
                : 'Sesión administrada por Supabase Auth. El acceso al grupo depende de tu invitación.'}
            </p>
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
            Las fechas del calendario, las invitaciones y las bajas las gestiona la administración.
            Si necesitas un cambio, pídeselo a:
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
          <Link className="button secondary" to="/m/retirados">
            Abrir publicaciones retiradas
          </Link>
        </div>
      </section>
    </>
  );
}
