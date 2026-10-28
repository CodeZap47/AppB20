// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_POST_KINDS, chatPostReferencesIn, type ChatPostPreview, type ChatPostRef } from '@b20/core';
import { DataProvider } from '../../data/DataContext';
import { createDemoState, DemoDataSource } from '../../data/demo';
import type { DataSource } from '../../data/types';
import { getChatDraft, saveChatDraft } from '../../lib/chatDrafts';
import { Composer } from '../Composer';
import { ShareToChatButton } from './SharePostDialog';
import { ShareOptionsDialog } from '../whatsNew/ShareOptionsDialog';

let root: Root;
let host: HTMLDivElement;
let source: DemoDataSource;
let router: ReturnType<typeof createMemoryRouter>;
const send = vi.fn<(text: string, files?: File[]) => Promise<boolean>>();
const target: ChatPostRef = { kind: 'answer', id: 'respuesta-original' };
const previews: ChatPostPreview[] = CHAT_POST_KINDS.map((kind) => ({ target: { kind, id: `id-${kind}` }, available: true, title: `Original ${kind}`, kindLabel: kind, path: `/original/${kind}` }));
const draftKey = 'demo-1:sharing-integration';
const button = (label: string) => {
  const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find(row => row.getAttribute('aria-label') === label || row.textContent?.trim() === label);
  if (!node) throw new Error(`Falta botón ${label}`);
  return node;
};
async function click(label: string) { await act(async () => button(label).click()); }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function go(path: string | number) { await act(async () => { if (typeof path === 'number') await router.navigate(path); else await router.navigate(path); }); }
function DirectDraft() { const { conversationId } = useParams(); return <Composer draftKey={`demo-1:direct:${conversationId}`} placeholder="Escribe en directo" onSend={send} attachments />; }
async function fill(value: string) { const input = host.querySelector('textarea')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function drop(file: File) { await act(async () => { const event = new Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [file] } }); host.querySelector('form')!.dispatchEvent(event); }); }
async function mount(initial = '/m/mensajes', entryState?: unknown) {
  router = createMemoryRouter([
    { path: '/m/mensajes', element: <Composer draftKey={draftKey} placeholder="Escribe al grupo" onSend={send} attachments /> },
    { path: '/module', element: <ShareToChatButton target={target} /> },
    { path: '/share', element: <ShareOptionsDialog target={{ kind: 'answer', id: target.id }} onClose={() => {}} /> },
    { path: '/m/mensajes/directos/:conversationId', element: <DirectDraft /> },
    { path: '/m/mensajes/canales/:channelId', element: <p>Canal abierto</p> },
  ], { initialEntries: [{ pathname: initial, state: entryState }] });
  await act(async () => root.render(<DataProvider source={source}><RouterProvider router={router} /></DataProvider>));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, char => `\\${char.codePointAt(0)!.toString(16)} `) });
  source = new DemoDataSource(createDemoState(), 'demo-1');
  vi.spyOn(source, 'resolveChatPosts').mockImplementation(async targets => targets.map(item => ({ target: item, available: true, title: `Original ${item.kind}`, kindLabel: item.kind, path: `/original/${item.kind}/${item.id}` })));
  vi.spyOn(source, 'searchChatPosts').mockImplementation(async (_query, kind) => previews.filter(row => !kind || row.target.kind === kind));
  send.mockReset().mockResolvedValue(true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); host.remove(); vi.restoreAllMocks(); });

describe('publicaciones compartidas dentro de Mensajes', () => {
  it('conserva texto, referencias y archivos al elegir un chat, sin enviar; atrás/adelante no duplica la tarjeta', async () => {
    const file = new File(['contenido'], 'apuntes.txt', { type: 'text/plain' });
    saveChatDraft(draftKey, { text: 'Mi explicación antes de compartir', refs: [{ kind: 'tarea', id: 'tarea-previa' }], files: [] });
    await mount();
    await drop(file);
    expect(host.textContent).toContain('apuntes.txt');
    expect(host.querySelector('textarea')?.value).toBe('Mi explicación antes de compartir');
    await go('/module'); await click('Enviar a chat'); await click('Compartir en Canal del salón');
    expect(router.state.location.pathname).toBe('/m/mensajes');
    expect(host.querySelector('textarea')?.value).toBe('Mi explicación antes de compartir');
    expect(host.textContent).toContain('apuntes.txt');
    expect(host.querySelectorAll('.composer__refs li')).toHaveLength(2);
    expect(send).not.toHaveBeenCalled();
    expect(router.state.location.state).toBeNull();
    await go(-1); await go(1);
    expect(host.querySelectorAll('.composer__refs li')).toHaveLength(2);
    await click('Enviar mensaje');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toContain('Mi explicación antes de compartir\n[[tarea:tarea-previa]]');
    expect(chatPostReferencesIn(send.mock.calls[0]![0])).toEqual([target]);
    expect(send.mock.calls[0]?.[1]).toEqual([file]);
  });

  it('mantiene separados los borradores y archivos reales al cambiar de conversación y regresar', async () => {
    const groupFile = new File(['grupo'], 'grupo.txt'); const directFile = new File(['directo'], 'directo.txt');
    await mount(); await fill('Comentario para el salón'); await drop(groupFile);
    await go('/m/mensajes/directos/otra');
    expect(host.querySelector('textarea')?.value).toBe(''); expect(host.textContent).not.toContain('grupo.txt');
    await fill('Comentario en directo'); await drop(directFile);
    await go('/m/mensajes');
    expect(host.querySelector('textarea')?.value).toBe('Comentario para el salón'); expect(host.textContent).toContain('grupo.txt'); expect(host.textContent).not.toContain('directo.txt');
    await go('/m/mensajes/directos/otra');
    expect(host.querySelector('textarea')?.value).toBe('Comentario en directo'); expect(host.textContent).toContain('directo.txt');
    await click('Enviar mensaje'); expect(send).toHaveBeenCalledExactlyOnceWith('Comentario en directo', [directFile]);
    await go('/m/mensajes'); await click('Enviar mensaje'); expect(send.mock.calls[1]).toEqual(['Comentario para el salón', [groupFile]]);
  });

  it('una confirmación tardía consume solo lo enviado y conserva una publicación añadida después', async () => {
    let finish!: (ok: boolean) => void;
    send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const file = new File(['original'], 'enviado.txt');
    saveChatDraft(draftKey, { text: 'Comentario original', refs: [{ kind: 'tarea', id: 'ya-enviada' }], files: [file] });
    await mount(); await click('Enviar mensaje');
    await go('/module'); await click('Enviar a chat'); await click('Compartir en Canal del salón');
    expect(host.querySelectorAll('.composer__refs li')).toHaveLength(2);
    await act(async () => finish(true));
    expect(host.querySelector('textarea')?.value).toBe('');
    expect(host.textContent).not.toContain('enviado.txt');
    expect(host.querySelectorAll('.composer__refs li')).toHaveLength(1);
    await click('Enviar mensaje');
    expect(chatPostReferencesIn(send.mock.calls[1]![0])).toEqual([target]);
    expect(send.mock.calls[1]?.[1]).toEqual([]);
    expect(send.mock.calls[1]?.[0]).not.toContain('ya-enviada');
  });

  it('presenta los 22 tipos del catálogo y los añade al borrador conservando la decisión de enviar', async () => {
    await mount();
    for (const kind of CHAT_POST_KINDS) {
      await click('Publicaciones y materiales');
      const select = document.querySelector<HTMLSelectElement>('select[aria-label="Tipo de publicación"]')!;
      expect([...select.options].slice(1).map(option => option.value)).toEqual(CHAT_POST_KINDS);
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, kind); select.dispatchEvent(new Event('change', { bubbles: true })); });
      await settle();
      const row = [...document.querySelectorAll<HTMLButtonElement>('.chat-post-result')].find(item => item.querySelector('strong')?.textContent === `Original ${kind}`)!;
      await act(async () => row.click());
      expect(send).not.toHaveBeenCalled();
    }
    expect(host.querySelectorAll('.composer__refs li')).toHaveLength(CHAT_POST_KINDS.length);
    await click('Enviar mensaje');
    expect(chatPostReferencesIn(send.mock.calls[0]![0]).map(row => row.kind)).toEqual(CHAT_POST_KINDS);
  }, 15_000);

  it('deduplica intenciones y una referencia repetida; conserva el borrador tras un envío fallido', async () => {
    const intent = { id: 'once', memberId: 'demo-1', target };
    await mount('/m/mensajes', { chatPostShare: intent });
    expect(host.querySelectorAll('.composer__refs li')).toHaveLength(1);
    await act(async () => { await router.navigate('/m/mensajes', { state: { chatPostShare: { ...intent, id: 'twice' } } }); });
    expect(host.querySelectorAll('.composer__refs li')).toHaveLength(1);
    send.mockResolvedValueOnce(false); await click('Enviar mensaje');
    expect(host.querySelectorAll('.composer__refs li')).toHaveLength(1);
    expect(getChatDraft(draftKey).refs).toHaveLength(1);
    await click('Enviar mensaje');
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    expect(host.querySelectorAll('.composer__refs li')).toHaveLength(0);
  });

  it('la selección interna del feed no crea enlaces públicos ni vistas previas de WhatsApp', async () => {
    const external = vi.spyOn(source, 'createFeedShare');
    await mount('/share');
    expect(external).not.toHaveBeenCalled();
    await click('Enviar a chat');
    await click('Compartir en Canal del salón');
    expect(host.querySelectorAll('.composer__refs li')).toHaveLength(1);
    expect(external).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it('bloquea una publicación privada o retirada sin abrir el chat ni revelar su contenido', async () => {
    vi.mocked(source.resolveChatPosts).mockResolvedValue([{ target, available: false }]);
    await mount('/module'); await click('Enviar a chat');
    expect(document.body.textContent).toContain('Publicación no disponible para compartir');
    const destination = button('Compartir en Canal del salón'); expect(destination.disabled).toBe(true);
    await act(async () => destination.click());
    expect(router.state.location.pathname).toBe('/module'); expect(send).not.toHaveBeenCalled();
  });

  it('reutiliza un directo existente y permite elegir un canal disponible', async () => {
    const peer = source.getSnapshot().members.find(member => member.id !== 'demo-1' && member.status === 'active')!;
    const directId = source.openDirectConversation(peer.id);
    const channelId = source.createChatChannel({ name: 'Canal de prueba', kind: 'topic' });
    const open = vi.spyOn(source, 'openDirectConversation');
    await mount('/module'); await click('Enviar a chat'); await click(`Compartir en ${peer.displayName}`);
    expect(router.state.location.pathname).toBe(`/m/mensajes/directos/${directId}`);
    expect(open).not.toHaveBeenCalled(); expect(host.querySelectorAll('.composer__refs li')).toHaveLength(1);
    await go('/module'); await click('Enviar a chat'); await click('Compartir en Canal de prueba');
    expect(router.state.location.pathname).toBe(`/m/mensajes/canales/${channelId}`); expect(send).not.toHaveBeenCalled();
  });

  it('reintenta iniciar un directo sin duplicar solicitudes y cancela la navegación si cambia la cuenta', async () => {
    const peer = source.getSnapshot().members.find(member => member.id !== 'demo-1' && member.status === 'active' && !source.getSnapshot().directConversations.some(chat => chat.participantIds.includes(member.id)))!;
    let fail!: (cause: Error) => void;
    const open = vi.spyOn(source as DataSource, 'openDirectConversation').mockImplementationOnce(() => new Promise<string>((_resolve, reject) => { fail = reject; }));
    await mount('/module'); await click('Enviar a chat');
    const label = `Iniciar chat con ${peer.displayName}`;
    await click(label); await click(label); expect(open).toHaveBeenCalledTimes(1);
    await act(async () => fail(new Error('Conexión interrumpida')));
    expect(document.body.textContent).toContain('Conexión interrumpida');
    let finish!: (id: string) => void;
    open.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    await click(label); await act(async () => source.setViewer(peer.id));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => finish('sin-navegar'));
    expect(router.state.location.pathname).toBe('/module'); expect(send).not.toHaveBeenCalled();
  });
});
