import { Link, Outlet, useLocation, useMatches } from 'react-router';
import { useLayoutEffect } from 'react';
import { SidebarNavigationSlim } from '@b20-ui/components/application/app-navigation/sidebar-navigation/sidebar-slim';
import { Tooltip } from '@b20-ui/components/base/tooltip/tooltip';
import { Pressable } from 'react-aria-components';
import { usePlatform } from './PlatformContext';
import { DemoBanner } from './DemoBanner';
import { Avatar } from './Avatar';
import { buildNavigation, resolveActiveUrl } from './navigation';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { DemoDataSource } from '../data/demo';
import { WelcomeTour } from './WelcomeTour';

const NAVIGATION = buildNavigation();

export function Layout() {
  const platform = usePlatform();
  const location = useLocation();
  const { me, notifications } = useSnapshot();
  const unread = notifications.filter((notification) => !notification.readAt).length;
  const footerItems = NAVIGATION.footerItems.map((item) => item.href === '/m/avisos' && unread
    ? { ...item, label: `Avisos (${unread})` }
    : item);
  const simulated = useDataSource() instanceof DemoDataSource;
  const compact = platform === 'extension-panel';
  // Una ruta con `handle: { fill: true }` (el chat) usa todo el alto en vez de alargar la página.
  const fill = useMatches().some((m) => (m.handle as { fill?: boolean } | undefined)?.fill);
  useLayoutEffect(() => {
    // New screens begin at their heading; chat retains its own conversation scroll.
    const scrolling = document.scrollingElement;
    if (!fill && typeof scrolling?.scrollTo === 'function') scrolling.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname, fill]);
  const shell = ['shell', 'shell--slim', compact && 'shell--compact', fill && 'shell--fill'].filter(Boolean).join(' ');
  const profileLabel = simulated ? 'Perfil simulado' : 'Mi perfil';

  return (
    <div className={shell}>
      <div className="b20-sidebar-slot">
        <SidebarNavigationSlim
          {...NAVIGATION}
          footerItems={footerItems}
          activeUrl={resolveActiveUrl(location.pathname, NAVIGATION.items, footerItems)}
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
        <div className="route-surface" data-enter={fill ? undefined : location.pathname} key={fill ? 'chat' : location.pathname}><Outlet /></div>
      </main>
      <WelcomeTour />
    </div>
  );
}
