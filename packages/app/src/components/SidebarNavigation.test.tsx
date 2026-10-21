// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createHashRouter, Link, RouterProvider, useLocation } from 'react-router';
import { navigableModules } from '@b20/core';
import type { NavItemType } from '@b20-ui/components/application/app-navigation/config';
import { SidebarNavigationSlim } from '@b20-ui/components/application/app-navigation/sidebar-navigation/sidebar-slim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNavigation, resolveActiveUrl } from './navigation';

let container: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createHashRouter> | undefined;

function leaves(items: NavItemType[]): NavItemType[] {
  return items.flatMap((item) => item.items?.length ? leaves(item.items) : [item]);
}

function button(label: string, within: ParentNode = container): HTMLButtonElement {
  const target = [...within.querySelectorAll<HTMLButtonElement>('button')]
    .find((element) => (element.getAttribute('aria-label') ?? element.textContent?.trim()) === label);
  if (!target) throw new Error(`Falta el botón ${label}`);
  return target;
}

function link(href: string, within: ParentNode = container): HTMLAnchorElement {
  const target = [...within.querySelectorAll<HTMLAnchorElement>('a')]
    .find((element) => element.getAttribute('href') === `#${href}`);
  if (!target) throw new Error(`Falta el enlace ${href}`);
  return target;
}

function panelFor(group: HTMLButtonElement): HTMLElement | null {
  return document.getElementById(group.getAttribute('aria-controls') ?? '');
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

async function focus(element: HTMLElement) {
  await act(async () => element.focus());
}

async function escape() {
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  })));
}

async function restoreFocusFrame() {
  // React Aria restores focus after the modal's exit frame.
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

async function show(path = '/m/inicio', compact = false) {
  window.history.replaceState({}, '', `/#${path}`);
  function Navigation() {
    const { pathname } = useLocation();
    const { items, footerItems } = buildNavigation();
    return <>
      <SidebarNavigationSlim items={items} footerItems={footerItems}
        activeUrl={resolveActiveUrl(pathname, items, footerItems)} compact={compact}
        account={<Link to="/perfil/demo-1">Perfil simulado</Link>} />
      <button type="button" aria-label="Contenido de la página">Contenido</button>
      <output data-testid="route">{pathname}</output>
    </>;
  }
  router = createHashRouter([{ path: '*', element: <Navigation /> }]);
  await act(async () => root.render(<RouterProvider router={router!} />));
}

async function historyStep(delta: number, expectedPath: string) {
  await act(async () => {
    await new Promise<void>((resolve) => {
      const unsubscribe = router!.subscribe((state) => {
        if (state.location.pathname !== expectedPath) return;
        unsubscribe();
        resolve();
      });
      void router!.navigate(delta);
    });
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char.codePointAt(0)!.toString(16)} `) });
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query.includes('min-width') && query.includes('1024'), media: query,
    onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => true,
  })));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  router?.dispose();
  router = undefined;
  container.remove();
  vi.unstubAllGlobals();
});

describe('configuración de la navegación B20', () => {
  it('incluye cada módulo disponible una sola vez y toma sus nombres del catálogo', () => {
    const modules = navigableModules();
    const { items, footerItems } = buildNavigation();
    const moduleLinks = leaves(items);
    expect(moduleLinks.map((item) => item.href).sort()).toEqual(modules.map((module) => `/m/${module.id}`).sort());
    for (const module of modules.filter((module) => module.id !== 'inicio')) {
      expect(moduleLinks.find((item) => item.href === `/m/${module.id}`)?.label).toBe(module.title);
    }
    expect(footerItems.map((item) => item.href)).toEqual(['/m/avisos', '/ajustes', '/instalar']);
    const withoutNotes = buildNavigation(modules.filter((module) => module.id !== 'notas'));
    expect(leaves(withoutNotes.items).some((item) => item.href === '/m/notas')).toBe(false);
  });

  it.each([
    ['/', '/m/inicio'], ['/modulos', '/m/inicio'], ['/modulos/', '/m/inicio'], ['/m/inicio', '/m/inicio'],
    ['/m/notas/n1/editar', '/m/notas'], ['/perfil/demo-1', '/m/perfiles'],
    ['/m/actividades', '/m/tareas'], ['/m/actividades/a1', '/m/tareas'],
    ['/m/mensajes/conversacion', '/m/mensajes'], ['/m/exposiciones/ensayo', '/m/exposiciones'],
    ['/m/avisos', '/m/avisos'], ['/ajustes', '/ajustes'], ['/instalar', '/instalar'],
    ['/m/notas-archivo', undefined], ['/desconocida', undefined],
  ])('resuelve %s al acceso %s sin confundir prefijos', (path, expected) => {
    const { items, footerItems } = buildNavigation();
    expect(resolveActiveUrl(path, items, footerItems)).toBe(expected);
  });
});

describe('Sidebar Slim con el router real', () => {
  it('abre con el cursor y mantiene el submenú al entrar desde la barra', async () => {
    await show();
    const study = button('Estudio', container.querySelector('.b20-slim-desktop')!);
    function mousePointer(type: string, relatedTarget?: EventTarget) {
      return Object.assign(new MouseEvent(type, { bubbles: true, relatedTarget }), { pointerType: 'mouse' });
    }
    await act(async () => study.dispatchEvent(mousePointer('pointerover')));
    expect(study.getAttribute('aria-expanded')).toBe('true');
    const panel = panelFor(study)!;
    await act(async () => {
      study.dispatchEvent(mousePointer('pointerout', panel));
      panel.dispatchEvent(mousePointer('pointerover', study));
    });
    expect(study.getAttribute('aria-expanded')).toBe('true');
    expect(link('/m/notas', panel)).not.toBeNull();
  });

  it('abre grupos con el foco, conserva el panel al entrar y devuelve el foco con Escape', async () => {
    await show('/m/notas/n1');
    const desktop = container.querySelector('.b20-slim-desktop')!;
    const study = button('Estudio', desktop);
    await focus(study);
    expect(study.getAttribute('aria-expanded')).toBe('true');
    const panel = panelFor(study)!;
    expect(panel).not.toBeNull();
    const notes = link('/m/notas', panel);
    expect(notes.getAttribute('aria-current')).toBe('page');
    await focus(notes);
    expect(document.activeElement).toBe(notes);
    expect(study.getAttribute('aria-expanded')).toBe('true');
    await escape();
    expect(study.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(study);
  });

  it('permite explorar otra área sin cambiar la selección y cierra al interactuar fuera', async () => {
    await show('/m/notas/n1');
    const desktop = container.querySelector('.b20-slim-desktop')!;
    const study = button('Estudio', desktop);
    const community = button('Comunidad', desktop);
    await click(community);
    expect(community.getAttribute('aria-expanded')).toBe('true');
    expect(study.getAttribute('data-current')).toBe('true');
    expect(community.getAttribute('data-current')).not.toBe('true');
    expect(link('/m/perfiles', panelFor(community)!).getAttribute('aria-current')).toBeNull();
    expect(window.location.hash).toBe('#/m/notas/n1');
    await act(async () => button('Contenido de la página').dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(community.getAttribute('aria-expanded')).toBe('false');
  });

  it('conserva enlaces hash y actualiza la selección al navegar, retroceder y avanzar', async () => {
    await show('/m/inicio');
    const desktop = container.querySelector('.b20-slim-desktop')!;
    const messages = link('/m/mensajes', desktop);
    expect(messages.tagName).toBe('A');
    await click(messages);
    expect(window.location.hash).toBe('#/m/mensajes');
    expect(messages.getAttribute('aria-current')).toBe('page');
    const study = button('Estudio', desktop);
    await click(study);
    await click(link('/m/notas', panelFor(study)!));
    expect(window.location.hash).toBe('#/m/notas');
    expect(study.getAttribute('aria-expanded')).toBe('false');
    expect(study.getAttribute('data-current')).toBe('true');
    await historyStep(-1, '/m/mensajes');
    expect(messages.getAttribute('aria-current')).toBe('page');
    expect(study.getAttribute('data-current')).not.toBe('true');
    await historyStep(1, '/m/notas');
    expect(study.getAttribute('data-current')).toBe('true');
    expect(messages.getAttribute('aria-current')).toBeNull();
  });

  it('abre el cajón compacto con etiquetas y lo cierra al elegir incluso la ruta actual', async () => {
    await show('/m/notas', true);
    const open = button('Abrir menú de navegación');
    await focus(open);
    await click(open);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Navegación de B20"]')!;
    expect(dialog).not.toBeNull();
    const modules = dialog.querySelector('nav[aria-label="Módulos"]')!;
    const study = button('Estudio', modules);
    if (study.getAttribute('aria-expanded') !== 'true') await click(study);
    expect(link('/m/notas', modules).textContent).toContain('Notas de clase');
    await focus(link('/m/notas', modules));
    await click(link('/m/notas', modules));
    expect(window.location.hash).toBe('#/m/notas');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await restoreFocusFrame();
    expect(document.activeElement).toBe(open);
  });

  it('incluye la cuenta y los accesos inferiores en el cajón y restaura el foco al cerrarlo', async () => {
    await show('/m/inicio', true);
    const open = button('Abrir menú de navegación');
    await focus(open);
    await click(open);
    let dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const footer = dialog.querySelector('nav[aria-label="Cuenta y aplicación"]')!;
    expect(link('/m/avisos', footer).textContent).toContain('Avisos');
    expect(link('/ajustes', footer).textContent).toContain('Ajustes');
    expect(link('/instalar', footer).textContent).toContain('Instalar app');
    expect(link('/perfil/demo-1', dialog).textContent).toContain('Perfil simulado');
    await click(button('Cerrar menú de navegación', dialog));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await restoreFocusFrame();
    expect(document.activeElement).toBe(open);
    await click(open);
    dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await focus(button('Cerrar menú de navegación', dialog));
    await escape();
    await restoreFocusFrame();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(open);
    await click(open);
    dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await click(link('/perfil/demo-1', dialog));
    expect(window.location.hash).toBe('#/perfil/demo-1');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
