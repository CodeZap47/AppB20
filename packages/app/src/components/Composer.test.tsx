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
async function show(mode?: ComposerMode, attachments = false, disabled = false) {
  await act(async () => root.render(<DataProvider source={source}><MemoryRouter>
    <Composer key={draftKey} draftKey={draftKey} placeholder="Escribe al grupo" onSend={onSend} mode={mode} onCancelMode={cancel} mentionMemberIds={['peer']} attachments={attachments} disabled={disabled} />
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
  it('abre el cargador desde el botón y conserva el archivo seleccionado hasta enviar', async () => {
    await show(undefined, true);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Elegir archivos adjuntos"]')!.click());
    const picker = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['archivo'], 'apuntes.txt', { type: 'text/plain' });
    Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
    await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })));
    expect(container.querySelector('[data-upload-state="selected"]')?.textContent).toContain('apuntes.txt');
    await key('Enter');
    expect(onSend).toHaveBeenCalledExactlyOnceWith('', [file]);
  });

  it('revela el cargador al soltar sobre el editor y no altera el borrador', async () => {
    await show(undefined, true);
    await fill('Borrador con un archivo');
    const file = new File(['archivo'], 'actividad.txt', { type: 'text/plain' });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
    await act(async () => input().dispatchEvent(drop));
    expect(input().value).toBe('Borrador con un archivo');
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    expect(container.querySelector('[data-upload-state="selected"]')?.textContent).toContain('actividad.txt');
    await key('Enter');
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Borrador con un archivo', [file]);
  });

  it('ignora archivos soltados cuando el chat está bloqueado', async () => {
    await show(undefined, true, true);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [new File(['x'], 'a.txt')], types: ['Files'] } });
    await act(async () => input().dispatchEvent(drop));
    expect(drop.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-upload-state]')).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

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
