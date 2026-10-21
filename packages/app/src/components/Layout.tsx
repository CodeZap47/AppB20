import { NavLink, Outlet, useMatches } from 'react-router';
import { navigableModules } from '@b20/core';
import { usePlatform } from './PlatformContext';
import { DemoBanner } from './DemoBanner';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { DemoDataSource } from '../data/demo';

const NAV_MODULES = navigableModules();

export function Layout() {
  const platform = usePlatform();
  const { me, notifications } = useSnapshot();
  const unread = notifications.filter((notification) => !notification.readAt).length;
  const simulated = useDataSource() instanceof DemoDataSource;
  const compact = platform === 'extension-panel';
  // Una ruta con `handle: { fill: true }` (el chat) usa todo el alto en vez de alargar la página.
  const fill = useMatches().some((m) => (m.handle as { fill?: boolean } | undefined)?.fill);
  const shell = ['shell', compact && 'shell--compact', fill && 'shell--fill'].filter(Boolean).join(' ');

  return (
    <div className={shell}>
      <header className="topbar">
        <NavLink to="/" className="brand">
          B20
        </NavLink>
        <div className="row">
          <NavLink to="/m/avisos" className="topbar__link">Avisos{unread ? ` (${unread})` : ''}</NavLink>
          {me && (
            <NavLink to={`/perfil/${me.id}`} className="topbar__link">
              {simulated ? 'Perfil simulado' : 'Mi perfil'}
            </NavLink>
          )}
          <NavLink to="/ajustes" className="topbar__link">
            Ajustes
          </NavLink>
        </div>
      </header>
      <nav className="sidenav" aria-label="Módulos">
        {NAV_MODULES.map((m) => (
          <NavLink key={m.id} to={`/m/${m.id}`} className="sidenav__link">
            {m.title}
          </NavLink>
        ))}
      </nav>
      <main className="content">
        <DemoBanner />
        <Outlet />
      </main>
    </div>
  );
}
