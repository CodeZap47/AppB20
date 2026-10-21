// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource } from '../data/types';
import { Composer, type ComposerMode } from './Composer';

let container: HTMLDivElement;
let root: Root;
let draftKey: string;
const onSend = vi.fn<(text: string, files?: File[]) => Promise<boolean>>();
const cancel = vi.fn();
const source = {
  getSnapshot: () => snapshot,
  subscribe: () => () => {},
} as unknown as DataSource;
const snapshot = { ...emptySnapshot('ready'), members: [
  { id: 'peer', displayName: 'Ana', status: 'active' as const, isCreator: false, joinedAt: new Date() },
] };

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  onSend.mockResolvedValue(true);
  draftKey = crypto.randomUUID();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function show(mode?: ComposerMode) {
  await act(async () => root.render(<DataProvider source={source}><MemoryRouter>
    <Composer key={draftKey} draftKey={draftKey} placeholder="Escribe al grupo" onSend={onSend} mode={mode} onCancelMode={cancel} mentionMemberIds={['peer']} />
  </MemoryRouter></DataProvider>));
}
const input = () => container.querySelector('textarea')!;
async function fill(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function key(value: string, options: KeyboardEventInit = {}) {
  await act(async () => input().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options })));
}

describe('composición con la presentación de Untitled UI', () => {
  it('espera la confirmación del servidor y conserva el texto si el envío falla', async () => {
    let finish!: (ok: boolean) => void;
    onSend.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await show();
    await fill('Un mensaje pendiente');
    await key('Enter');
    expect(input().disabled).toBe(true);
    expect(input().value).toBe('Un mensaje pendiente');
    await act(async () => finish(false));
    expect(input().disabled).toBe(false);
    expect(input().value).toBe('Un mensaje pendiente');
    await key('Enter');
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(input().value).toBe('');
  });

  it('no envía ni elige comandos mientras el teclado está componiendo texto', async () => {
    await show();
    await fill('/codigo');
    await key('Enter', { isComposing: true });
    expect(input().value).toBe('/codigo');
    expect(onSend).not.toHaveBeenCalled();
    await key('Enter');
    expect(input().value).toBe('```\n\n```');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('mantiene Enter como salto de línea en dispositivos táctiles', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    await show();
    await fill('Hola desde el teléfono');
    await key('Enter');
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Enviar mensaje"]')!.click());
    expect(onSend).toHaveBeenCalledWith('Hola desde el teléfono', []);
  });

  it('restaura el borrador de cada conversación y al cancelar una edición', async () => {
    await show();
    await fill('Borrador del grupo');
    await show({ kind: 'edit', message: { id: 'edit', senderId: 'me', text: 'Mensaje publicado', sentAt: new Date() } });
    expect(input().value).toBe('Mensaje publicado');
    await show();
    expect(input().value).toBe('Borrador del grupo');
    const original = draftKey;
    draftKey = crypto.randomUUID();
    await show();
    expect(input().value).toBe('');
    draftKey = original;
    await show();
    expect(input().value).toBe('Borrador del grupo');
  });

  it('conserva las menciones como identidad estable al enviar', async () => {
    await show();
    await fill('Hola');
    const select = container.querySelector('select')!;
    await act(async () => { select.value = 'peer'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(input().value).toBe('Hola [[mencion:peer]] ');
    await key('Enter');
    expect(onSend).toHaveBeenCalledWith('Hola [[mencion:peer]]', []);
  });
});
