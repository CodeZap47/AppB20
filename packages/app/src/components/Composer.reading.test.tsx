// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { getChatDraft, saveChatDraft } from '../lib/chatDrafts';
import { Composer, type ComposerMode } from './Composer';

const reading = vi.hoisted(() => ({ hidden: false, reveal: vi.fn(), setLocked: vi.fn(), registerInput: vi.fn() }));
vi.mock('./messaging/ReadingComposerDock', () => ({ useReadingComposer: () => reading }));

let root: Root;
let host: HTMLDivElement;
let source: DemoDataSource;
let router: ReturnType<typeof createMemoryRouter>;
let draftKey: string;
let mode: ComposerMode | undefined;
let error: string | undefined;
const send = vi.fn<(text: string, files?: File[]) => Promise<boolean>>();
const typing = vi.fn();
const provisional = vi.fn();
function Boundary() { useLocation(); return <Composer draftKey={draftKey} placeholder="Escribe al grupo" onSend={send} onTyping={typing} onLiveDraftChange={provisional} mode={mode} error={error} attachments />; }
async function render() { await act(async () => root.render(<DataProvider source={source}><RouterProvider router={router} /></DataProvider>)); }
async function fill(value: string) {
  await act(async () => { const input = host.querySelector('textarea')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function drop(file: File) {
  await act(async () => { const event = new Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [file] } }); host.querySelector('form')!.dispatchEvent(event); });
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label);
  if (!button) throw new Error(`Falta botón ${label}`);
  await act(async () => button.click());
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  reading.hidden = false; reading.reveal.mockReset(); reading.setLocked.mockReset(); reading.registerInput.mockReset();
  send.mockReset().mockResolvedValue(true); typing.mockReset(); provisional.mockReset();
  source = new DemoDataSource(createDemoState(), 'demo-1');
  draftKey = crypto.randomUUID(); mode = undefined; error = undefined;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  router = createMemoryRouter([{ path: '/m/mensajes', element: <Boundary /> }], { initialEntries: ['/m/mensajes'] });
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); host.remove(); vi.restoreAllMocks(); });

describe('conservación del compositor al leer el historial', () => {
  it('oculta sin desmontar ni perder el texto, referencias o archivos y detiene la escritura provisional', async () => {
    const file = new File(['contenido'], 'lectura.txt', { type: 'text/plain' });
    saveChatDraft(draftKey, { text: 'Mi borrador', refs: [{ kind: 'tarea', id: 't1' }], files: [] });
    await render(); await drop(file);
    const input = host.querySelector('textarea')!;
    expect(reading.registerInput).toHaveBeenCalledWith(input);
    reading.hidden = true;
    await act(async () => router.navigate('/m/mensajes', { replace: true, state: { render: 1 } }));
    expect(host.querySelector('textarea')).toBe(input);
    expect(input.value).toBe('Mi borrador');
    expect(host.textContent).toContain('lectura.txt');
    expect(host.querySelectorAll('.composer__refs li')).toHaveLength(1);
    expect(getChatDraft(draftKey)).toEqual({ text: 'Mi borrador', refs: [{ kind: 'tarea', id: 't1' }], files: [file] });
    expect(document.activeElement).not.toBe(input);
    expect(typing).toHaveBeenLastCalledWith(false); expect(provisional).toHaveBeenLastCalledWith('');
    reading.hidden = false;
    const historyButton = document.createElement('button'); document.body.append(historyButton); historyButton.focus();
    await act(async () => router.navigate('/m/mensajes', { replace: true, state: { render: 2 } }));
    expect(document.activeElement).toBe(historyButton); expect(reading.reveal).not.toHaveBeenCalled(); historyButton.remove();
  });

  it('revela respuesta y edición sin borrar el borrador personal', async () => {
    saveChatDraft(draftKey, { text: 'Antes de responder', refs: [], files: [] });
    await render(); const message = source.getSnapshot().groupMessages[0]!;
    mode = { kind: 'reply', message, name: 'Compañero' }; reading.hidden = true;
    await act(async () => router.navigate('/m/mensajes', { replace: true, state: { mode: 1 } }));
    expect(reading.reveal).toHaveBeenLastCalledWith(true); expect(host.querySelector('textarea')?.value).toBe('Antes de responder');
    mode = { kind: 'edit', message };
    await act(async () => router.navigate('/m/mensajes', { replace: true, state: { mode: 2 } }));
    expect(reading.reveal).toHaveBeenLastCalledWith(true); expect(host.querySelector('textarea')?.value).toBe(message.text);
    expect(getChatDraft(draftKey).text).toBe('Antes de responder');
  });

  it('una publicación compartida recupera el bloque y conserva el File real y comentario previo', async () => {
    const file = new File(['apunte'], 'apunte.txt');
    saveChatDraft(draftKey, { text: 'Comentario que ya tenía', refs: [], files: [file] });
    await render(); reading.hidden = true;
    await act(async () => router.navigate('/m/mensajes', { replace: true, state: { chatPostShare: { id: crypto.randomUUID(), memberId: 'demo-1', target: { kind: 'assignment', id: 't1' } } } }));
    expect(reading.reveal).toHaveBeenCalledWith(true);
    expect(host.querySelector('textarea')?.value).toBe('Comentario que ya tenía'); expect(host.textContent).toContain('apunte.txt');
    expect(getChatDraft(draftKey).files).toEqual([file]); expect(getChatDraft(draftKey).refs).toHaveLength(1); expect(send).not.toHaveBeenCalled();
  });

  it('protege la composición IME y libera la protección al terminar', async () => {
    await render(); const input = host.querySelector('textarea')!;
    await act(async () => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'に' })));
    expect(reading.setLocked.mock.calls.some(([owner, locked]) => owner.endsWith(':ime') && locked === true)).toBe(true);
    await act(async () => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本' })));
    expect(reading.setLocked.mock.calls.some(([owner, locked]) => owner.endsWith(':ime') && locked === false)).toBe(true);
  });

  it('protege un diálogo de herramientas abierto y libera al cerrarlo', async () => {
    await render(); await click('Stickers');
    expect(document.querySelector('[role="dialog"][aria-label="Stickers"]')).not.toBeNull();
    expect(reading.setLocked.mock.calls.some(([owner, locked]) => owner.endsWith(':tools') && locked === true)).toBe(true);
    reading.setLocked.mockClear(); await click('Cerrar stickers');
    expect(reading.setLocked.mock.calls.some(([owner, locked]) => owner.endsWith(':tools') && locked === false)).toBe(true);
  });

  it('los errores nuevos muestran sus controles sin abrir el teclado', async () => {
    await render(); reading.hidden = true; error = 'No se pudieron enviar los adjuntos';
    await act(async () => router.navigate('/m/mensajes', { replace: true, state: { error: 1 } }));
    expect(reading.reveal).toHaveBeenLastCalledWith(false); expect(host.textContent).toContain(error);
  });

  it('una confirmación tardía no enfoca ni abre el compositor que se ocultó durante el envío', async () => {
    let finish!: (ok: boolean) => void;
    send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render(); await fill('Mensaje en curso');
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    reading.hidden = true;
    await act(async () => router.navigate('/m/mensajes', { replace: true, state: { hidden: 1 } }));
    const historyButton = document.createElement('button'); document.body.append(historyButton); historyButton.focus();
    await act(async () => finish(true));
    expect(document.activeElement).toBe(historyButton); expect(reading.reveal).not.toHaveBeenCalled();
    expect(host.querySelector('textarea')?.value).toBe(''); expect(getChatDraft(draftKey).text).toBe(''); historyButton.remove();
  });

  it('un fallo tardío tampoco abre el teclado si el bloque ya reapareció para mostrar el error', async () => {
    let finish!: (ok: boolean) => void;
    send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render(); await fill('Borrador que debe continuar');
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    reading.hidden = true;
    await act(async () => router.navigate('/m/mensajes', { replace: true, state: { hidden: 1 } }));
    const historyButton = document.createElement('button'); document.body.append(historyButton); historyButton.focus();
    reading.hidden = false; error = 'Reintenta el envío';
    await act(async () => router.navigate('/m/mensajes', { replace: true, state: { error: 1 } }));
    expect(reading.reveal).toHaveBeenLastCalledWith(false);
    await act(async () => finish(false));
    expect(document.activeElement).toBe(historyButton); expect(host.querySelector('textarea')?.value).toBe('Borrador que debe continuar');
    historyButton.remove();
  });
});
