import { NavLink, Outlet, useMatches } from 'react-router';
import { modulesForStage } from '@b20/core';
import { usePlatform } from './PlatformContext';
import { DemoBanner } from './DemoBanner';
import { useSnapshot } from '../data/DataContext';

const MVP_MODULES = modulesForStage(1);

export function Layout() {
  const platform = usePlatform();
  const { me } = useSnapshot();
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
          {me && (
            <NavLink to={`/perfil/${me.id}`} className="topbar__link">
              Mi perfil
            </NavLink>
          )}
          <NavLink to="/ajustes" className="topbar__link">
            Ajustes
          </NavLink>
        </div>
      </header>
      <nav className="sidenav" aria-label="Módulos">
        {MVP_MODULES.map((m) => (
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
