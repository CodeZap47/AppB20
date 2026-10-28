// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource } from '../data/types';
import { prepareStickers } from '../lib/stickerImport';
import { StickersPage } from './ChatToolsPage';

vi.mock('../lib/stickerImport', () => ({ prepareStickers: vi.fn() }));
let container: HTMLDivElement;
let root: Root;
let source: DataSource;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:sticker');
    static revokeObjectURL = vi.fn();
  });
  vi.mocked(prepareStickers).mockImplementation(async (files) => ({ files, skipped: [], packName: 'Reacciones' }));
  const snapshot = emptySnapshot('ready');
  source = { getSnapshot: () => snapshot, subscribe: () => () => {}, importStickers: vi.fn().mockResolvedValue('pack-1') } as unknown as DataSource;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function show() {
  await act(async () => root.render(<DataProvider source={source}><MemoryRouter><StickersPage /></MemoryRouter></DataProvider>));
}
async function choose(files: File[], drop = false) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  if (drop) {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } });
    await act(async () => input.closest('[data-dropzone]')!.dispatchEvent(event));
  } else {
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  }
}
async function submit() {
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

describe('importación de stickers con el cargador compartido', () => {
  it('acepta paquetes por arrastre y conserva el límite por imagen después de preparar', async () => {
    const zip = new File(['archivo comprimido'], 'Reacciones.wastickers');
    Object.defineProperty(zip, 'size', { value: 2 * 1024 * 1024 });
    const sticker = new File(['webp'], 'saludo.webp', { type: 'image/webp' });
    vi.mocked(prepareStickers).mockResolvedValueOnce({ files: [sticker], skipped: ['Una imagen superó 1 MB.'], packName: 'Reacciones' });
    await show();
    await choose([zip], true);
    expect(prepareStickers).toHaveBeenCalledExactlyOnceWith([zip]);
    expect(container.querySelector('[data-upload-state="selected"]')?.textContent).toContain('saludo.webp');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('superó 1 MB');
    await submit();
    expect(source.importStickers).toHaveBeenCalledExactlyOnceWith('Reacciones', [sticker]);
    expect(container.querySelector('[data-upload-state="complete"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Quitar saludo.webp"]')).toBeNull();
  });

  it('anuncia preparación e importación indeterminadas y bloquea nuevos drops mientras importa', async () => {
    let completePreparation!: (value: Awaited<ReturnType<typeof prepareStickers>>) => void;
    let completeImport!: (id: string) => void;
    vi.mocked(prepareStickers).mockImplementationOnce(() => new Promise((resolve) => { completePreparation = resolve; }));
    source.importStickers = vi.fn<DataSource['importStickers']>(() => new Promise((resolve) => { completeImport = resolve; }));
    const sticker = new File(['png'], 'reaccion.png', { type: 'image/png' });
    await show();
    await choose([sticker]);
    expect(container.textContent).toContain('Preparando stickers…');
    expect(container.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false);
    await act(async () => completePreparation({ files: [sticker], skipped: [], packName: 'Reacciones' }));
    await submit();
    expect(container.textContent).toContain('Importando stickers…');
    expect(container.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false);
    await choose([new File(['png'], 'otro.png', { type: 'image/png' })], true);
    expect(prepareStickers).toHaveBeenCalledTimes(1);
    await act(async () => completeImport('pack'));
    expect(container.querySelector('[data-upload-state="complete"]')).not.toBeNull();
  });

  it('reintenta el mismo paquete y los mismos archivos, sin borrar stickers confirmados individualmente', async () => {
    source.importStickers = vi.fn<DataSource['importStickers']>().mockRejectedValueOnce(new Error('Sin conexión')).mockResolvedValueOnce('pack');
    const sticker = new File(['png'], 'reaccion.png', { type: 'image/png' });
    await show();
    await choose([sticker]);
    await submit();
    expect(container.querySelector('[data-upload-state="failed"]')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[maxlength="60"]')?.disabled).toBe(true);
    expect(container.querySelector('[aria-label="Quitar reaccion.png"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Reintentar reaccion.png"]')!.click());
    expect(source.importStickers).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(source.importStickers).mock.calls) {
      expect(call[0]).toBe('Reacciones');
      expect(call[1][0]).toBe(sticker);
    }
    expect(prepareStickers).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Se importó 1 sticker');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it('quita una miniatura antes de importar y libera sus imágenes al descartar', async () => {
    const one = new File(['png'], 'uno.png', { type: 'image/png' });
    const two = new File(['png'], 'dos.png', { type: 'image/png' });
    await show(); await choose([one, two]);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Quitar de la selección uno.png"]')!.click());
    expect(container.querySelector('[aria-label="Stickers listos para importar"]')?.textContent).not.toContain('uno.png');
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    await submit();
    expect(source.importStickers).toHaveBeenCalledExactlyOnceWith('Reacciones', [two]);
  });

  it('presenta ayuda por plataforma con pasos desplegables y copia la ruta de Android', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await show();
    const guide = container.querySelector('.sticker-help')!;
    expect(guide.querySelectorAll('details')).toHaveLength(4);
    expect(guide.querySelectorAll('ol')).toHaveLength(4);
    await act(async () => guide.querySelector<HTMLButtonElement>('[aria-label="Copiar ruta de Android"]')!.click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith('Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Stickers');
    expect(guide.querySelector('[role="status"]')?.textContent).toBe('Ruta copiada.');
  });

  it('actualiza la imagen correcta cuando dos stickers tienen el mismo nombre', async () => {
    const one = new File(['uno'], 'reaccion.png', { type: 'image/png' });
    const two = new File(['dos'], 'reaccion.png', { type: 'image/png' });
    vi.mocked(URL.createObjectURL).mockImplementation((file) => file === one ? 'blob:uno' : 'blob:dos');
    await show(); await choose([one, two]);
    const remove = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Quitar de la selección reaccion.png"]')];
    expect(remove).toHaveLength(2);
    await act(async () => remove[0]!.click());
    expect(container.querySelector('.sticker-preview img')?.getAttribute('src')).toBe('blob:dos');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:uno');
    await submit();
    expect(source.importStickers).toHaveBeenCalledExactlyOnceWith('Reacciones', [two]);
  });

  it('muestra una alternativa manual si no se puede copiar la ruta', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    await show();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Copiar ruta de Android"]')!.click());
    const guide = container.querySelector('.sticker-help')!;
    expect(guide.querySelector('[role="alert"]')?.textContent).toContain('copiarla manualmente');
    expect(guide.querySelector('code')?.textContent).toBe('Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Stickers');
  });

  it('bloquea cambios simultáneos del mismo paquete y deja reintentar un fallo al compartir', async () => {
    const snapshot = source.getSnapshot();
    snapshot.me = { id: 'owner', displayName: 'Yo', status: 'active', isCreator: false, joinedAt: new Date() };
    snapshot.stickerPacks = [{ id: 'pack', ownerId: 'owner', name: 'Favoritos', shared: false, createdAt: new Date() }];
    let reject!: (error: Error) => void;
    source.setStickerPackShared = vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue(undefined);
    await show();
    const checkbox = container.querySelector<HTMLInputElement>('[aria-label="Compartir Favoritos con el grupo"]')!;
    await act(async () => { checkbox.click(); checkbox.click(); });
    expect(source.setStickerPackShared).toHaveBeenCalledExactlyOnceWith('pack', true);
    expect(checkbox.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Quitar el paquete Favoritos"]')!.disabled).toBe(true);
    await act(async () => reject(new Error('Sin conexión')));
    expect(container.querySelector('.sticker-library [role="alert"]')?.textContent).toBe('Sin conexión');
    expect(checkbox.disabled).toBe(false);
    expect(checkbox.checked).toBe(false);
    await act(async () => checkbox.click());
    expect(source.setStickerPackShared).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.sticker-library [role="alert"]')).toBeNull();
  });

});
