"use client";

import { useEffect, useId, useState } from 'react';
import { isNavigationItemActive, matchesNavigationUrl, type NavItemType } from '../config';
import { NavItemBase } from './nav-item';

export interface NavListProps {
  activeUrl?: string;
  items: NavItemType[];
  onNavigate?: () => void;
}

/** Mobile counterpart of Slim's icon rail, with explicit labels and expandable areas. */
export function NavList({ activeUrl, items, onNavigate }: NavListProps) {
  const id = useId();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.filter((item) => isNavigationItemActive(item, activeUrl)).map((item) => [item.label, true])));

  useEffect(() => {
    const active = items.find((item) => item.items?.length && isNavigationItemActive(item, activeUrl));
    if (active) setExpanded((previous) => previous[active.label] ? previous : { ...previous, [active.label]: true });
  }, [activeUrl, items]);

  return <ul className="b20-slim-nav-list">
    {items.map((item, index) => {
      const current = isNavigationItemActive(item, activeUrl);
      const childId = `${id}-group-${index}`;
      if (item.items?.length) {
        const open = expanded[item.label] ?? false;
        return <li key={item.label}>
          <NavItemBase type="collapsible" icon={item.icon} current={current} open={open} controls={childId}
            onClick={() => setExpanded((previous) => ({ ...previous, [item.label]: !open }))}>{item.label}</NavItemBase>
          <ul className="b20-slim-nav-children" id={childId} hidden={!open}>
            {item.items.map((child) => <li key={child.href}>
              <NavItemBase type="collapsible-child" href={child.href} icon={child.icon}
                current={matchesNavigationUrl(activeUrl, child.href)} onClick={onNavigate}>{child.label}</NavItemBase>
            </li>)}
          </ul>
        </li>;
      }
      return item.href ? <li key={item.label}>
        <NavItemBase type="link" href={item.href} icon={item.icon} current={current} onClick={onNavigate}>{item.label}</NavItemBase>
      </li> : null;
    })}
  </ul>;
}
