import type { FC } from 'react';

export interface NavChildItemType {
  label: string;
  href: string;
  icon?: FC<{ className?: string }>;
}

export interface NavItemType {
  label: string;
  href?: string;
  icon?: FC<{ className?: string }>;
  items?: NavChildItemType[];
}

export type SlimNavItemType = NavItemType & { icon: FC<{ className?: string }> };

/** Match complete path segments, so a module stays selected on its detail pages. */
export function matchesNavigationUrl(activeUrl: string | undefined, href: string | undefined): boolean {
  if (!activeUrl || !href) return false;
  const pathname = activeUrl.split(/[?#]/)[0]?.replace(/\/$/, '') || '/';
  const destination = href.replace(/\/$/, '') || '/';
  return pathname === destination || (destination !== '/' && pathname.startsWith(`${destination}/`));
}

export function isNavigationItemActive(item: NavItemType, activeUrl?: string): boolean {
  return item.items?.length
    ? item.items.some((child) => matchesNavigationUrl(activeUrl, child.href))
    : matchesNavigationUrl(activeUrl, item.href);
}
