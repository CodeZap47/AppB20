// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource, Snapshot } from '../data/types';
import { StickerImage } from './StickerImage';

let container: HTMLDivElement;
let root: Root;
let snapshot: Snapshot;
let source: DataSource;
let show: () => void;
let listeners: Set<() => void>;
const download = vi.fn<() => Promise<Blob>>();
const createUrl = vi.fn(() => 'blob:sticker-authorized');
const revokeUrl = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { show = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    observe() {} disconnect() {}
  });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
  const at = new Date(); const me = { id: 'viewer', displayName: 'Viewer', status: 'active' as const, isCreator: false, joinedAt: at };
  snapshot = { ...emptySnapshot('ready'), me, members: [me], stickers: [{ id: '8', packId: '7', url: 'native:8', size: 12, contentType: 'image/png', animated: false, createdAt: at }] };
  download.mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
  listeners = new Set(); source = { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); }, downloadSticker: download } as unknown as DataSource;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(shown = true) { await act(async () => root.render(<DataProvider source={source}>{shown && <StickerImage id="8" />}</DataProvider>)); }

describe('imágenes de stickers privados', () => {
  it('no pide bytes fuera de pantalla, carga al hacerse visible y libera la URL al salir', async () => {
    await render(); expect(download).not.toHaveBeenCalled(); expect(container.querySelector('img')).toBeNull();
    await act(async () => show());
    expect(download).toHaveBeenCalledExactlyOnceWith('8');
    expect(container.querySelector('img')?.src).toBe('blob:sticker-authorized');
    await render(false); expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:sticker-authorized');
  });
  it('descarta la respuesta pendiente al cerrar sesión o perder visibilidad del sticker', async () => {
    let resolve!: (value: Blob) => void;
    download.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await render(); await act(async () => show());
    await act(async () => {
      snapshot = { ...snapshot, me: undefined, stickers: [] }; listeners.forEach((listener) => listener());
      resolve(new Blob(['private']));
    });
    expect(createUrl).not.toHaveBeenCalled(); expect(container.querySelector('img')).toBeNull();
  });
  it('nunca usa una URL externa de metadatos como descarga autorizada', async () => {
    snapshot.stickers[0]!.url = 'https://example.com/sticker.png';
    await render();
    expect(download).not.toHaveBeenCalled(); expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('Sticker no disponible');
  });
});
