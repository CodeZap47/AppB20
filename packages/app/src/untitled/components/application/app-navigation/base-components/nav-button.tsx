"use client";

import type { FC, FocusEventHandler, MouseEventHandler, PointerEventHandler, Ref } from 'react';
import { Pressable } from 'react-aria-components';
import { Link } from 'react-router';
import { Tooltip } from '@b20-ui/components/base/tooltip/tooltip';

/** Adapted from Untitled UI's free NavButton, retaining its tooltip and icon treatment. */
export interface NavButtonProps {
  label: string;
  icon: FC<{ className?: string }>;
  href?: string;
  current?: boolean;
  open?: boolean;
  controls?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  onClick?: MouseEventHandler<HTMLElement>;
  onFocus?: FocusEventHandler<HTMLElement>;
  onPointerEnter?: PointerEventHandler<HTMLElement>;
}

export function NavButton({ label, icon: Icon, href, current = false, open, controls, buttonRef, onClick, onFocus, onPointerEnter }: NavButtonProps) {
  const content = <Icon aria-hidden="true" className="b20-slim-nav-icon" />;
  const shared = {
    'aria-label': label,
    'data-current': current || undefined,
    className: 'b20-slim-nav-button',
    onClick,
    onFocus,
    onPointerEnter,
  };

  return (
    <Tooltip title={label} placement="right" isDisabled={open}>
      <Pressable>
        {href ? (
          <Link {...shared} to={href} aria-current={current ? 'page' : undefined}>{content}</Link>
        ) : (
          <button {...shared} ref={buttonRef} type="button" aria-expanded={open} aria-controls={controls}>{content}</button>
        )}
      </Pressable>
    </Tooltip>
  );
}
