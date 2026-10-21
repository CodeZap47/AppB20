"use client";

import type { FC, MouseEventHandler, ReactNode } from 'react';
import { ChevronDown } from '@untitledui/icons';
import { Link } from 'react-router';

interface NavItemCommonProps {
  icon?: FC<{ className?: string }>;
  current?: boolean;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLElement>;
}

export type NavItemBaseProps = NavItemCommonProps & (
  | { type: 'link' | 'collapsible-child'; href: string }
  | { type: 'collapsible'; open: boolean; controls: string }
);

/** Untitled UI's link and collapsible rows, adapted to the shared hash router. */
export function NavItemBase(props: NavItemBaseProps) {
  const { icon: Icon, current = false, children, onClick } = props;
  const content = <>
    {Icon && <Icon aria-hidden="true" className="b20-slim-nav-icon" />}
    <span className="b20-slim-nav-label">{children}</span>
    {props.type === 'collapsible' && <ChevronDown aria-hidden="true" className="b20-slim-nav-chevron" />}
  </>;
  const className = `b20-slim-nav-item${props.type === 'collapsible-child' ? ' b20-slim-nav-item--child' : ''}`;

  if (props.type === 'collapsible') {
    return <button type="button" className={className} data-current={current || undefined}
      aria-expanded={props.open} aria-controls={props.controls} onClick={onClick}>{content}</button>;
  }
  return <Link to={props.href} className={className} data-current={current || undefined}
    aria-current={current ? 'page' : undefined} onClick={onClick}>{content}</Link>;
}
