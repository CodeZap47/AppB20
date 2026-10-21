// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import type { DataSource } from '../data/types';
import { StructuredEditor, StructuredText } from './StructuredText';

let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('contenido académico estructurado', () => {
  it('permite referencias internas del material y bloquea otros protocolos', async () => {
    await act(async () => root.render(<StructuredText text={'[Fuente v2](#/m/notas/42) [Perfil](#/perfil/alumno) [Script](javascript:alert(1)) [Data](data:text/html,x)'} />));
    expect([...container.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(['#/m/notas/42', '#/perfil/alumno']);
  });
  it('presenta listas, tablas y código, y mantiene el contenido HTML como texto seguro', async () => {
    const text = '## Tema\n\n- Uno\n- Dos\n\n1. Paso\n2. Siguiente\n\n| Nombre | Valor |\n| --- | --- |\n| **A** | `4` |\n\n```html\n<script>alert(1)</script>\n```\n\n<img src=x onerror=alert(1)>\n![remota](https://ejemplo.invalid/espia.png)\n[javascript](javascript:alert(1))';
    await act(async () => root.render(<StructuredText text={text} />));
    expect(container.querySelector('h2')?.textContent).toBe('Tema');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(container.querySelector('th')?.getAttribute('scope')).toBe('col');
    expect(container.querySelector('td strong')?.textContent).toBe('A');
    expect(container.querySelector('pre code')?.textContent).toContain('<script>');
    expect(container.querySelectorAll('img,script,iframe')).toHaveLength(0);
    expect([...container.querySelectorAll('a')].every((link) => link.href.startsWith('https://'))).toBe(true);
    expect(container.textContent).toContain('<img src=x');
  });

  it('descarga una imagen privada solo al pulsar y libera su URL al desmontar', async () => {
    const downloadResourceFile = vi.fn().mockResolvedValue(new Blob(['bytes'], { type: 'image/png' }));
    const create = vi.fn().mockReturnValue('blob:imagen-privada'); const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const source = { downloadResourceFile } as unknown as DataSource;
    await act(async () => root.render(<DataProvider source={source}><StructuredText text="![Diagrama](resource:uuid-privado)" /></DataProvider>));
    expect(downloadResourceFile).not.toHaveBeenCalled();
    expect(container.querySelector('img')).toBeNull();
    await act(async () => container.querySelector('button')!.click());
    expect(downloadResourceFile).toHaveBeenCalledWith('uuid-privado', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:imagen-privada');
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('Diagrama');
    await act(async () => root.render(<span />));
    expect(revoke).toHaveBeenCalledWith('blob:imagen-privada');
  });

  it('rechaza SVG y errores de permisos sin crear una imagen activa', async () => {
    const downloadResourceFile = vi.fn().mockResolvedValueOnce(new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' })).mockRejectedValueOnce(new Error('No tienes acceso a este archivo.'));
    await act(async () => root.render(<DataProvider source={{ downloadResourceFile } as unknown as DataSource}><StructuredText text="![Documento](resource:restringido)" /></DataProvider>));
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelector('img')).toBeNull(); expect(container.textContent).toContain('no es una imagen compatible');
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('No tienes acceso a este archivo.');
  });

  it('inserta una tabla editable y ofrece vista previa sin perder el texto', async () => {
    function Editor() { const [value, setValue] = useState('Apuntes'); return <StructuredEditor label="Mi apunte" value={value} onChange={setValue} />; }
    await act(async () => root.render(<Editor />));
    const textarea = container.querySelector('textarea')!;
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Tabla')!.click());
    expect(textarea.value).toContain('| Columna | Columna |');
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Vista previa')!.click());
    expect(container.querySelector('table')).toBeTruthy(); expect(textarea.hidden).toBe(true);
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Seguir escribiendo')!.click());
    expect(textarea.value).toContain('Apuntes'); expect(textarea.hidden).toBe(false);
  });
});
