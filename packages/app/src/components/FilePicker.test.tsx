// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FILE_BYTES } from '@b20/core';
import { FilePicker, type FilePickerProps } from './FilePicker';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function show(props: FilePickerProps) { await act(async () => root.render(<FilePicker {...props} />)); }
async function pick(files: File[]) {
  const input = container.querySelector('input')!;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
async function drop(files: File[]) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } });
  await act(async () => container.querySelector('[data-dropzone]')!.dispatchEvent(event));
  return event;
}

describe('selector y arrastre de Untitled UI', () => {
  it.each(['pick', 'drop'])('acepta imágenes y documentos y explica rechazos por %s', async (method) => {
    const onFiles = vi.fn();
    await show({ onFiles });
    const image = new File(['foto'], 'imagen.png', { type: 'image/png' });
    const document = new File(['pdf'], 'documento.pdf', { type: 'application/pdf' });
    const empty = new File([], 'vacio.txt');
    const huge = new File(['x'], 'grande.bin'); Object.defineProperty(huge, 'size', { value: MAX_FILE_BYTES + 1 });
    await (method === 'pick' ? pick : drop)([image, empty, document, huge]);
    expect(onFiles).toHaveBeenCalledExactlyOnceWith([image, document]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('vacío');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('50 MB');
    expect(container.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('permite elegir nuevamente el mismo objeto File y limpia los errores anteriores', async () => {
    const onFiles = vi.fn(); await show({ onFiles });
    await pick([new File([], 'vacio.txt')]);
    const file = new File(['datos'], 'guia.pdf');
    await pick([file]); await pick([file]);
    expect(onFiles.mock.calls).toEqual([[[file]], [[file]]]);
    expect(container.querySelector('input')!.value).toBe('');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('bloquea selector y drop deshabilitados y previene que el navegador abra el archivo', async () => {
    const onFiles = vi.fn(); await show({ onFiles, disabled: true });
    const event = await drop([new File(['datos'], 'archivo.pdf')]);
    expect(event.defaultPrevented).toBe(true);
    expect(onFiles).not.toHaveBeenCalled();
    expect(container.querySelector('input')!.disabled).toBe(true);
  });

  it('aplica tipos, tamaño y validación específica también al arrastrar', async () => {
    const onFiles = vi.fn();
    await show({ onFiles, accept: 'image/png,image/jpeg', maxSize: 5, label: 'Foto de perfil' });
    const valid = new File(['png'], 'foto.png', { type: 'image/png' });
    await drop([valid, new File(['pdf'], 'guia.pdf', { type: 'application/pdf' }), new File(['demasiado'], 'foto2.png', { type: 'image/png' })]);
    expect(onFiles).toHaveBeenCalledExactlyOnceWith([valid]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('formato');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('límite');
    expect(container.querySelector('input')!.getAttribute('aria-label')).toBe('Foto de perfil');
  });

  it('explica el límite de selección única sin descartar silenciosamente los extras', async () => {
    const onFiles = vi.fn(); await show({ onFiles, multiple: false });
    const first = new File(['a'], 'a.png'); await drop([first, new File(['b'], 'b.png')]);
    expect(onFiles).toHaveBeenCalledExactlyOnceWith([first]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('un solo archivo');
  });
});
