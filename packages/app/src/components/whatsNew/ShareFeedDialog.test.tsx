// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedShareLink, FeedShareRecord } from '@b20/core';
import { DataProvider } from '../../data/DataContext';
import { createDemoState, DemoDataSource } from '../../data/demo';
import { ShareFeedDialog } from './ShareFeedDialog';

let root: Root, container: HTMLDivElement, source: DemoDataSource;
const target = { kind: 'assignment', id: 'a' } as const;
const link: FeedShareLink = { id: 'share1', preview: { title: 'Funciones y parámetros', description: 'Ejercicios para el grupo', kindLabel: 'Tarea', path: '/m/tareas/a', subject: 'Programación' }, url: 'https://api.b20.mx/s/opaque' };
const record: FeedShareRecord = { id: 'share1', target, createdBy: 'demo-1', createdAt: '2026-10-26T18:00:00Z', active: true, canRevoke: true };
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); source = new DemoDataSource(createDemoState(), 'demo-1'); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); vi.restoreAllMocks(); });
async function show(onClose = vi.fn()) { await act(async () => root.render(<StrictMode><DataProvider source={source}><ShareFeedDialog target={target} onClose={onClose} /></DataProvider></StrictMode>)); }
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
async function click(label: string) { const button = [...dialog().querySelectorAll('button')].find((r) => (r.getAttribute('aria-label') ?? r.textContent)?.trim() === label)!; expect(button).toBeDefined(); await act(async () => button.click()); }

describe('diálogo de compartir', () => {
  it('crea una vez con StrictMode, muestra preview, copia y prepara WhatsApp sin enviar', async () => {
    const create = vi.spyOn(source, 'createFeedShare').mockResolvedValue(link); vi.spyOn(source, 'listFeedShares').mockResolvedValue([record]);
    const copy = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    await show(); expect(create).toHaveBeenCalledTimes(1); expect(dialog().textContent).toContain('Funciones y parámetros');
    const whatsapp = dialog().querySelector<HTMLAnchorElement>('a[href^="https://wa.me/"]')!;
    expect(whatsapp.textContent).toContain('Compartir por WhatsApp'); expect(new URL(whatsapp.href).searchParams.get('text')).toBe(`${link.preview.title}\n${link.url}`);
    expect(whatsapp.rel).toContain('noopener'); await click('Copiar enlace'); expect(copy).toHaveBeenCalledWith(link.url);
    expect(dialog().textContent).toContain('Enlace copiado');
  });

  it('revoca y deja de ofrecer el enlace; Escape permite cerrar', async () => {
    vi.spyOn(source, 'createFeedShare').mockResolvedValue(link); vi.spyOn(source, 'listFeedShares').mockResolvedValue([record]); const revoke = vi.spyOn(source, 'revokeFeedShare').mockResolvedValue(undefined); const close = vi.fn();
    await show(close); await click('Revocar enlace'); expect(revoke).toHaveBeenCalledWith('share1');
    expect(dialog().textContent).toContain('Enlace revocado'); expect(dialog().querySelector('a[href^="https://wa.me/"]')).toBeNull();
    await act(async () => dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(close).toHaveBeenCalledOnce();
  });

  it('el demo indica simulación y no ofrece un enlace WhatsApp real', async () => {
    vi.spyOn(source, 'createFeedShare').mockResolvedValue({ ...link, url: '#/m/tareas/a' }); vi.spyOn(source, 'listFeedShares').mockResolvedValue([record]);
    await show(); expect(dialog().textContent).toContain('Modo de prueba'); expect(dialog().querySelector('a[href^="https://wa.me/"]')).toBeNull();
    expect(dialog().querySelector('input')?.value).toBe('#/m/tareas/a');
  });

  it('un fallo ambiguo consulta la lista y exige reintento explícito', async () => {
    const create = vi.spyOn(source, 'createFeedShare').mockRejectedValue(new Error('No se pudo confirmar. Revisa los enlaces existentes.')); const list = vi.spyOn(source, 'listFeedShares').mockResolvedValue([record]);
    await show(); expect(create).toHaveBeenCalledTimes(1); expect(list).toHaveBeenCalledTimes(1); expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('No se pudo confirmar');
    expect(dialog().textContent).toContain('Enlace activo'); await click('Revisar enlaces y reintentar'); expect(create).toHaveBeenCalledTimes(1); expect(list).toHaveBeenCalledTimes(2);
    create.mockResolvedValue(link); await click('Crear enlace con vista previa'); expect(create).toHaveBeenCalledTimes(2); expect(dialog().textContent).toContain(link.preview.title);
  });
});
