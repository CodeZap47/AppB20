"use client";

import { useEffect, useId, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { Link, useLocation } from 'react-router';
import { MobileNavigationHeader } from '../base-components/mobile-header';
import { NavButton } from '../base-components/nav-button';
import { NavItemBase } from '../base-components/nav-item';
import { NavList } from '../base-components/nav-list';
import { isNavigationItemActive, matchesNavigationUrl, type SlimNavItemType } from '../config';
import './sidebar-slim.css';

export interface SidebarNavigationSlimProps {
  items: SlimNavItemType[];
  footerItems?: SlimNavItemType[];
  activeUrl?: string;
  compact?: boolean;
  account?: ReactNode;
}

const DESKTOP_QUERY = '(min-width: 1024px)';

interface SecondarySidebarProps {
  id: string;
  item: SlimNavItemType;
  activeUrl?: string;
  onNavigate: () => void;
  reducedMotion: boolean;
}

function SecondarySidebar({ id, item, activeUrl, onNavigate, reducedMotion }: SecondarySidebarProps) {
  const present = useIsPresent();
  return <motion.aside id={id} aria-label={item.label} aria-hidden={!present || undefined} inert={!present}
    data-area={item.label} className="b20-slim-secondary"
    initial={{ opacity: 0, width: reducedMotion ? 256 : 0 }}
    animate={{ opacity: 1, width: 256 }}
    exit={{ opacity: 0, width: reducedMotion ? 256 : 0 }}
    transition={reducedMotion ? { duration: 0 } : { type: 'spring', damping: 26, stiffness: 220, bounce: 0 }}>
    <div className="b20-slim-secondary-inner">
      <h2 className="b20-slim-secondary-title">{item.label}</h2>
      <ul className="b20-slim-secondary-list">
        {item.items?.map((child) => <li key={child.href}>
          <NavItemBase type="link" href={child.href} icon={child.icon}
            current={matchesNavigationUrl(activeUrl, child.href)} onClick={onNavigate}>{child.label}</NavItemBase>
        </li>)}
      </ul>
    </div>
  </motion.aside>;
}

function useDesktopNavigation(compact: boolean) {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && (
    typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY).matches : window.innerWidth >= 1024));
  useEffect(() => {
    if (typeof window.matchMedia === 'function') {
      const query = window.matchMedia(DESKTOP_QUERY);
      const update = () => setWide(query.matches);
      update();
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }
    const update = () => setWide(window.innerWidth >= 1024);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return wide && !compact;
}

/**
 * Adapted from Untitled UI's free Slim navigation. Its 68px rail, 256px preview,
 * inset ring and React Aria mobile dialog are shared across B20's platforms.
 * https://github.com/untitleduico/react/tree/main/components/application/app-navigation
 */
export function SidebarNavigationSlim({ items, footerItems = [], activeUrl, compact = false, account }: SidebarNavigationSlimProps) {
  const id = useId();
  const location = useLocation();
  const desktop = useDesktopNavigation(compact);
  const reducedMotion = useReducedMotion();
  const desktopRef = useRef<HTMLDivElement>(null);
  const groupButtons = useRef(new Map<string, HTMLButtonElement>());
  const pointerInside = useRef(false);
  const suppressedFocus = useRef<HTMLElement | null>(null);
  const [openArea, setOpenArea] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const openedItem = [...items, ...footerItems].find((item) => item.label === openArea && item.items?.length);
  const panelIdFor = (label: string) => `${id}-secondary-${encodeURIComponent(label)}`;

  function closePreview(restoreFocus = false) {
    setOpenArea(null);
    const trigger = openArea ? groupButtons.current.get(openArea) : undefined;
    if (restoreFocus && trigger && document.activeElement !== trigger) {
      suppressedFocus.current = trigger;
      trigger.focus();
    }
  }

  function closeNavigation() {
    setOpenArea(null);
    setMobileOpen(false);
  }

  useEffect(() => {
    setOpenArea(null);
    setMobileOpen(false);
  }, [location.key, activeUrl, desktop]);

  useEffect(() => {
    if (!openArea) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !desktopRef.current?.contains(event.target)) setOpenArea(null);
    };
    // Capture before tooltip overlays, which can otherwise consume Escape first.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closePreview(true);
    };
    document.addEventListener('pointerdown', closeOutside, true);
    window.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true);
      window.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [openArea]);

  function focusGroup(event: FocusEvent<HTMLElement>, label: string) {
    if (suppressedFocus.current === event.currentTarget) return;
    setOpenArea(label);
  }

  function renderRailItem(item: SlimNavItemType) {
    const group = Boolean(item.items?.length);
    return <li key={item.label}>
      <NavButton label={item.label} icon={item.icon} href={group ? undefined : item.href}
        current={isNavigationItemActive(item, activeUrl)} open={group ? openArea === item.label : undefined}
        controls={group ? panelIdFor(item.label) : undefined}
        buttonRef={group ? (element) => {
          if (element) groupButtons.current.set(item.label, element);
          else groupButtons.current.delete(item.label);
        } : undefined}
        onFocus={(event) => group ? focusGroup(event, item.label) : closePreview()}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'mouse') return;
          if (group) {
            suppressedFocus.current = null;
            setOpenArea(item.label);
          }
          else closePreview();
        }}
        onClick={() => {
          suppressedFocus.current = null;
          if (group) setOpenArea(item.label);
          else closeNavigation();
        }} />
    </li>;
  }

  return <div className={`b20-navigation b20-sidebar${compact ? ' b20-sidebar--compact' : ''}`}>
    <div ref={desktopRef} className="b20-slim-desktop" hidden={!desktop}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') pointerInside.current = true; }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse') return;
        pointerInside.current = false;
        if (!event.currentTarget.contains(document.activeElement)) closePreview();
      }}
      onBlurCapture={(event) => {
        if (event.target === suppressedFocus.current) suppressedFocus.current = null;
        if (!pointerInside.current && !event.currentTarget.contains(event.relatedTarget)) closePreview();
      }}>
      <aside className="b20-slim-rail">
        <div className="b20-slim-rail-inner">
          <Link to="/" className="b20-slim-brand b20-slim-brand--minimal" aria-label="B20, inicio"
            onFocus={() => closePreview()} onClick={closeNavigation}>B20</Link>
          <nav aria-label="Módulos" className="b20-slim-primary-nav">
            <ul className="b20-slim-rail-list">{items.map(renderRailItem)}</ul>
          </nav>
          <div className="b20-slim-rail-footer">
            <nav aria-label="Cuenta y aplicación"><ul className="b20-slim-rail-list">{footerItems.map(renderRailItem)}</ul></nav>
            {account && <div className="b20-slim-account" onClick={closeNavigation} onFocus={() => closePreview()}>{account}</div>}
          </div>
        </div>
      </aside>
      <AnimatePresence initial={false}>
        {openedItem && <SecondarySidebar key={openedItem.label} id={panelIdFor(openedItem.label)} item={openedItem} activeUrl={activeUrl}
          onNavigate={closeNavigation} reducedMotion={Boolean(reducedMotion)} />}
      </AnimatePresence>
    </div>
    <MobileNavigationHeader isOpen={mobileOpen && !desktop} onOpenChange={setMobileOpen} hidden={desktop}>
      <nav aria-label="Módulos" className="b20-slim-drawer-nav">
        <NavList items={items} activeUrl={activeUrl} onNavigate={closeNavigation} />
      </nav>
      <div className="b20-slim-drawer-footer">
        <nav aria-label="Cuenta y aplicación"><NavList items={footerItems} activeUrl={activeUrl} onNavigate={closeNavigation} /></nav>
        {account && <div className="b20-slim-account" onClick={closeNavigation}>{account}</div>}
      </div>
    </MobileNavigationHeader>
  </div>;
}
