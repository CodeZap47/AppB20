// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmojiPicker } from './EmojiPicker';
import { emojiCatalog } from '../lib/emojiCatalog';

let container: HTMLDivElement;
let root: Root;
const select = vi.fn();
const close = vi.fn();
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); localStorage.clear();
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char.codePointAt(0)!.toString(16)} `) });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<EmojiPicker open onSelect={select} onClose={close} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function fill(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('busca en español y permite elegir reacciones fuera de los seis accesos rápidos', async () => {
  expect(emojiCatalog.length).toBeGreaterThan(3900);
  await fill('Buscar emoji', 'pizza');
  const button = document.querySelector<HTMLButtonElement>('[aria-label="pizza"]')!;
  expect(button).not.toBeNull();
  await act(async () => button.click());
  expect(select).toHaveBeenCalledExactlyOnceWith('🍕');
  expect(close).toHaveBeenCalledOnce();
  expect(JSON.parse(localStorage.getItem('b20:reaction-emojis:v1')!)).toEqual(['🍕']);
});
it('admite familia, bandera y tonos desde el teclado; rechaza múltiples emojis', async () => {
  await fill('Emoji del teclado', '👍👍');
  const use = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Usar')!;
  expect(use.disabled).toBe(true);
  await fill('Emoji del teclado', '👨‍👩‍👧‍👦');
  expect(use.disabled).toBe(false);
  await act(async () => use.click());
  expect(select).toHaveBeenCalledWith('👨‍👩‍👧‍👦');
});
it('recorre el catálogo con flechas sin añadir cientos de paradas de tabulación', async () => {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-emoji-index]')];
  expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
  await act(async () => {
    buttons[0]!.focus();
    buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  });
  expect(document.activeElement).toBe(buttons[1]);
});
