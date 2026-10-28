// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { Composer } from './Composer';
import { CHAT_RESOURCE_KINDS } from '@b20/core';

// Resource forms have their own real-data integration suite; this boundary verifies
// that the composer restores drafts and only attaches a shareable callback result.
vi.mock('./messaging/ChatResourceCreatePanel', () => ({ ChatResourceCreatePanel: ({ kind, onCreated, onClose }: {
  kind: string; onCreated: (id: string, shareable: boolean) => void; onClose: () => void;
}) => <section role="dialog" aria-label={`Crear ${kind}`}><button onClick={() => onCreated('nuevo', true)}>Guardar compartido</button><button onClick={() => onCreated('privado', false)}>Guardar personal</button><button onClick={onClose}>Cancelar creación</button></section> }));

let container: HTMLDivElement;
let root: Root;
let source: DemoDataSource;
let draftKey: string;
const send = vi.fn<(text: string, files?: File[]) => Promise<boolean>>();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); send.mockResolvedValue(true);
  source = new DemoDataSource(createDemoState(), 'demo-1');
  draftKey = crypto.randomUUID(); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); });
async function show() {
  await act(async () => root.render(<DataProvider source={source}><MemoryRouter initialEntries={['/m/mensajes']}><Composer key={draftKey} draftKey={draftKey} placeholder="Escribe al grupo" onSend={send} /></MemoryRouter></DataProvider>));
}
const input = () => container.querySelector('textarea')!;
async function fill(text: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input(), text); input().dispatchEvent(new Event('input', { bubbles: true })); });
}
async function click(button: HTMLButtonElement) { await act(async () => button.click()); }
async function key(value: string) { await act(async () => input().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))); }
const option = (prefix: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(button => button.querySelector('strong')?.textContent?.startsWith(prefix))!;
const action = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === text)!;
async function openCommands() { await click(container.querySelector<HTMLButtonElement>('[aria-label="Comandos y referencias"]')!); }

describe('comandos completos en el compositor', () => {
  it('muestra autor y alcance de comandos coincidentes y prioriza el personal', async () => {
    source.saveChatCommand({ name: 'atajo-prueba', description: '', text: 'Texto personal' });
    source.setViewer('demo-2');
    source.saveChatCommand({ name: 'atajo-prueba', description: '', text: 'Texto del salón', visibility: 'classroom' });
    source.setViewer('demo-1');
    await show(); await fill('/atajo-prueba');
    const options = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    expect(options).toHaveLength(2);
    expect(options[0]?.textContent).toContain('Personal');
    expect(options[0]?.textContent).toContain(source.getSnapshot().members.find(member => member.id === 'demo-1')!.displayName);
    expect(options[1]?.textContent).toContain('Del salón');
    await key('Enter');
    expect(input().value).toBe('Texto personal'); expect(send).not.toHaveBeenCalled();
    await key('Enter'); expect(send).toHaveBeenCalledWith('Texto personal', []);
  });
  it('cita los cinco tipos de material conservando el texto previo', async () => {
    await show();
    for (const kind of CHAT_RESOURCE_KINDS) {
      await fill(`Texto previo para ${kind}`); await openCommands(); await click(option(`/${kind}`));
      const resource = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(button => !button.querySelector('strong')?.textContent?.startsWith('Crear '))!;
      expect(resource).not.toBeUndefined(); await click(resource);
      expect(input().value).toBe(`Texto previo para ${kind}`);
      await key('Enter'); expect(send.mock.calls.at(-1)?.[0]).toContain(`[[${kind}:`);
    }
  });
  it('crear o cancelar conserva texto y referencias, sin enviar automáticamente', async () => {
    await show(); await fill('Conservar mi explicación'); await openCommands(); await click(option('/nota'));
    await click(option('Crear nota'));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await click(action('Cancelar creación'));
    expect(input().value).toBe('Conservar mi explicación');
    await openCommands(); await click(option('/nota')); await click(option('Crear nota')); await click(action('Guardar compartido'));
    expect(input().value).toBe('Conservar mi explicación'); expect(send).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Referencias que se enviarán"]')).not.toBeNull();
    await key('Enter');
    expect(send).toHaveBeenCalledExactlyOnceWith('Conservar mi explicación\n[[nota:nuevo]]', []);
    expect(container.textContent).not.toContain('La referencia está en tu borrador');
  });
  it('una acción personalizada abre su formulario y una nota privada no se adjunta', async () => {
    source.saveChatCommand({ name: 'mi-nota', description: '', text: '', actionKind: 'create', resourceKind: 'nota' });
    await show(); await fill('/mi-nota'); await key('Enter');
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Crear nota');
    await click(action('Guardar personal'));
    expect(container.querySelector('[aria-label="Referencias que se enviarán"]')).toBeNull();
    expect(container.textContent).toContain('Nota personal guardada'); expect(send).not.toHaveBeenCalled();
  });
  it('Escape restaura el borrador cuando se abrió el menú desde la barra', async () => {
    await show(); await fill('Texto que se conserva'); await openCommands(); await key('Escape');
    expect(input().value).toBe('Texto que se conserva'); expect(container.querySelector('[role="listbox"]')).toBeNull();
  });
});
