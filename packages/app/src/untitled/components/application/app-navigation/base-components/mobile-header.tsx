"use client";

import { useEffect, useRef, type PropsWithChildren } from 'react';
import { Menu02, X } from '@untitledui/icons';
import { Button, Dialog, DialogTrigger, Modal, ModalOverlay } from 'react-aria-components';
import { Link } from 'react-router';

export interface MobileNavigationHeaderProps extends PropsWithChildren {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  hidden?: boolean;
}

/** Untitled UI's React Aria modal header, with the B20 brand and Spanish controls. */
export function MobileNavigationHeader({ children, isOpen, onOpenChange, hidden }: MobileNavigationHeaderProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    const restore = wasOpen.current && !isOpen && !hidden;
    wasOpen.current = isOpen;
    if (!restore) return;
    // Router navigation can move focus after the modal's own restoration cleanup.
    const frame = requestAnimationFrame(() => triggerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen, hidden]);

  return <DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
    <header className="b20-slim-mobile-header" hidden={hidden}>
      <Link to="/" className="b20-slim-brand" aria-label="B20, inicio">B20</Link>
      <Button ref={triggerRef} aria-label="Abrir menú de navegación" className="b20-slim-menu-button">
        <Menu02 aria-hidden="true" className="b20-slim-menu-icon" />
      </Button>
    </header>
    <ModalOverlay isDismissable className="b20-navigation-overlay b20-sidebar-overlay b20-slim-mobile-overlay">
      <Modal className="b20-slim-mobile-modal">
        <Dialog aria-label="Navegación de B20" className="b20-slim-mobile-dialog">
          <div className="b20-slim-drawer-header">
            <Link to="/" className="b20-slim-brand" aria-label="B20, inicio" onClick={() => onOpenChange(false)}>B20</Link>
            <Button aria-label="Cerrar menú de navegación" className="b20-slim-menu-button" onPress={() => onOpenChange(false)}>
              <X aria-hidden="true" className="b20-slim-menu-icon" />
            </Button>
          </div>
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  </DialogTrigger>;
}
