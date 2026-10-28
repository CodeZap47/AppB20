// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource } from '../data/types';
import { EMPTY_RECEIPT_INFO } from '../data/messageReceiptTypes';
import { bubbleIsReadable, useVisibleMessageReceipts } from './useVisibleMessageReceipts';
let container: HTMLDivElement; let root: Root; let focus = true; let hidden = false; let top = 20; let height = 60;
const seen = vi.fn(async () => {}); const legacy = vi.fn();
const messages = [{ id: '42', senderId: 'peer', text: 'Texto', sentAt: new Date(1) }];
const snapshot = { ...emptySnapshot('ready'), me: { id: 'me', status: 'active' } as never };
const source = { getSnapshot: () => snapshot, subscribe: () => () => {}, messageReceipts: { markSeen: seen, subscribe: () => () => {}, getSnapshot: () => EMPTY_RECEIPT_INFO } } as unknown as DataSource;
const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 400, width: 400, x: 0, y: top, toJSON() {} });
function Harness({ conversationId = 'general' }: { conversationId?: string }) {
  const ref = useRef<HTMLDivElement>(null); useVisibleMessageReceipts({ scope: 'group', conversationId, messages, root: ref, onLegacyRead: legacy });
  return <div ref={ref} className="viewport"><div data-message-id="42"><div className="bubble">Texto</div></div></div>;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); seen.mockClear(); legacy.mockClear(); focus = true; hidden = false; top = 20; height = 60;
  vi.stubGlobal('CSS', undefined); vi.spyOn(document, 'hasFocus').mockImplementation(() => focus);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return this.classList.contains('bubble') ? rect(top, height) : rect(0, 200); });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = async (id?: string) => { await act(async () => root.render(<DataProvider source={source}><Harness conversationId={id} /></DataProvider>)); };
const advance = async (ms: number) => { await act(async () => vi.advanceTimersByTimeAsync(ms)); };
describe('visualización continua por burbuja', () => {
  it('requiere un segundo sin depender de CSS.escape y conserva el cursor histórico separado', async () => {
    await render(); await advance(999); expect(seen).not.toHaveBeenCalled(); await advance(1);
    expect(seen).toHaveBeenCalledExactlyOnceWith('group', 'general', ['42']); expect(legacy).toHaveBeenCalledExactlyOnceWith('42');
    container.querySelector('.viewport')!.dispatchEvent(new Event('scroll')); await advance(1500); expect(seen).toHaveBeenCalledTimes(1);
  });
  it('cancela al perder foco o esconder la ventana y reinicia el segundo completo', async () => {
    await render(); await advance(700); focus = false; window.dispatchEvent(new Event('blur')); await advance(500); expect(seen).not.toHaveBeenCalled();
    focus = true; window.dispatchEvent(new Event('focus')); await advance(600); hidden = true; document.dispatchEvent(new Event('visibilitychange')); await advance(600); expect(seen).not.toHaveBeenCalled();
    hidden = false; document.dispatchEvent(new Event('visibilitychange')); await advance(1000); expect(seen).toHaveBeenCalledTimes(1);
  });
  it('admite mensajes más altos que el historial y cancela al salir de la conversación', async () => {
    top = -500; height = 3000; await render(); await advance(1000); expect(seen).toHaveBeenCalledTimes(1);
    seen.mockClear(); await render('other'); await advance(700); await act(async () => root.render(<div />)); await advance(1000); expect(seen).not.toHaveBeenCalled();
  });
  it('no cuenta una burbuja fuera de la vista aunque el historial esté al final', async () => {
    top = 250; await render(); await advance(1200); expect(seen).not.toHaveBeenCalled();
    top = 40; container.querySelector('.viewport')!.dispatchEvent(new Event('scroll')); await advance(1000); expect(seen).toHaveBeenCalledTimes(1);
  });
  it('no considera visible una burbuja de tamaño cero', () => { expect(bubbleIsReadable(rect(0, 0), rect(0, 200))).toBe(false); });
});
