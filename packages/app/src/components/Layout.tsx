import { Link, Outlet, useLocation, useMatches } from 'react-router';
import { SidebarNavigationSlim } from '@b20-ui/components/application/app-navigation/sidebar-navigation/sidebar-slim';
import { Tooltip } from '@b20-ui/components/base/tooltip/tooltip';
import { Pressable } from 'react-aria-components';
import { usePlatform } from './PlatformContext';
import { DemoBanner } from './DemoBanner';
import { Avatar } from './Avatar';
import { buildNavigation, resolveActiveUrl } from './navigation';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { DemoDataSource } from '../data/demo';

const NAVIGATION = buildNavigation();

export function Layout() {
  const platform = usePlatform();
  const location = useLocation();
  const { me } = useSnapshot();
  const simulated = useDataSource() instanceof DemoDataSource;
  const compact = platform === 'extension-panel';
  // Una ruta con `handle: { fill: true }` (el chat) usa todo el alto en vez de alargar la página.
  const fill = useMatches().some((m) => (m.handle as { fill?: boolean } | undefined)?.fill);
  const shell = ['shell', 'shell--slim', compact && 'shell--compact', fill && 'shell--fill'].filter(Boolean).join(' ');
  const profileLabel = simulated ? 'Perfil simulado' : 'Mi perfil';

  return (
    <div className={shell}>
      <div className="b20-sidebar-slot">
        <SidebarNavigationSlim
          {...NAVIGATION}
          activeUrl={resolveActiveUrl(location.pathname, NAVIGATION.items, NAVIGATION.footerItems)}
          compact={compact}
          account={me && (
            <Tooltip title={profileLabel} placement="right">
              <Pressable>
                <Link to={`/perfil/${me.id}`} className="b20-navigation-account" aria-label={profileLabel}>
                  <Avatar member={me} size={36} />
                  <span className="b20-navigation-account__details">
                    <strong>{me.displayName}</strong>
                    <span>{profileLabel}</span>
                  </span>
                </Link>
              </Pressable>
            </Tooltip>
          )}
        />
      </div>
      <main className="content">
        <DemoBanner />
        <Outlet />
      </main>
    </div>
  );
}
