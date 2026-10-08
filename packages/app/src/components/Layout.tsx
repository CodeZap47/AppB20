import { NavLink, Outlet } from 'react-router';
import { modulesForStage } from '@b20/core';
import { usePlatform } from './PlatformContext';

const MVP_MODULES = modulesForStage(1);

export function Layout() {
  const platform = usePlatform();
  const compact = platform === 'extension-panel';

  return (
    <div className={compact ? 'shell shell--compact' : 'shell'}>
      <header className="topbar">
        <NavLink to="/" className="brand">
          B20
        </NavLink>
        <NavLink to="/ajustes" className="topbar__link">
          Ajustes
        </NavLink>
      </header>
      <nav className="sidenav" aria-label="Módulos">
        {MVP_MODULES.map((m) => (
          <NavLink key={m.id} to={`/m/${m.id}`} className="sidenav__link">
            {m.title}
          </NavLink>
        ))}
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
