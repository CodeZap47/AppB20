// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageMenu } from './MessageParts';

let container: HTMLDivElement;
let root: Root;
const reply = vi.fn();
const remove = vi.fn();
const react = vi.fn();
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char.codePointAt(0)!.toString(16)} `) });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<MessageMenu mine myReaction="👍" onReact={react} actions={[
    { label: 'Responder', icon: 'reply', onSelect: reply },
    { label: 'Eliminar', icon: 'trash', danger: true, confirm: '¿Eliminar para todos?', onSelect: remove },
  ]} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const trigger = () => container.querySelector<HTMLButtonElement>('[aria-label="Opciones del mensaje"]')!;
const item = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent?.trim() === label)!;
async function pressKey(element: Element, key: string) {
  await act(async () => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}

describe('menú de mensaje de Untitled UI', () => {
  it('abre por teclado y permite recorrer acciones con flechas, Inicio, Fin y Escape', async () => {
    await act(async () => trigger().focus());
    await pressKey(trigger(), 'ArrowDown');
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(container.querySelector('[role="menu"]')).toBeNull();
    await pressKey(document.activeElement!, 'End');
    expect(document.activeElement?.textContent).toContain('Eliminar');
    await pressKey(document.activeElement!, 'ArrowUp');
    expect(document.activeElement?.textContent).toContain('Responder');
    await pressKey(document.activeElement!, 'Home');
    expect(document.activeElement?.getAttribute('aria-label')).toContain('Reaccionar con');
    await pressKey(document.activeElement!, 'Escape');
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(remove).not.toHaveBeenCalled();
  });

  it('exige confirmar la eliminación y permite cancelarla', async () => {
    await click(trigger());
    await click(item('Eliminar'));
    expect(remove).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('¿Eliminar para todos?');
    await click([...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === 'Cancelar')!);
    expect(remove).not.toHaveBeenCalled();
    await click(trigger());
    await click(item('Eliminar'));
    await click([...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === 'Eliminar')!);
    expect(remove).toHaveBeenCalledOnce();
  });

  it('mantiene las reacciones y cierra el menú después de elegir una', async () => {
    await click(trigger());
    const reaction = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.getAttribute('aria-label') === 'Reaccionar con 👍, tu reacción actual')!;
    expect(reaction.classList.contains('is-selected')).toBe(true);
    expect(reaction.textContent).toContain('👍');
    await click(reaction);
    expect(react).toHaveBeenCalledExactlyOnceWith('👍');
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
