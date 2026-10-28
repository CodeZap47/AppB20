// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { chatPostReferencesIn } from '@b20/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { EMPTY_RECEIPT_INFO } from '../data/messageReceiptTypes';
import { EMPTY_LIVE_DRAFTS } from '../data/liveDraftTypes';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource, Member, Snapshot } from '../data/types';
import { ChannelThread, DirectThread, GroupThread, MessagesLayout, ThreadPlaceholder } from './MessagesPage';

const at = new Date('2026-10-21T12:00:00Z');
const member = (id: string, isCreator = false): Member => ({ id, displayName: id, status: 'active', isCreator, joinedAt: at });
let container: HTMLDivElement;
let root: Root;
let snapshot: Snapshot;
let source: DataSource;
const actions = {
  markConversationRead: vi.fn(async () => {}), setConversationMuted: vi.fn(async () => {}),
  setMemberBlocked: vi.fn(async () => {}), reportMessage: vi.fn(async () => 'report'),
  resolveMessageReport: vi.fn(async () => {}), createChatChannel: vi.fn(async () => 'channel'),
  setChatChannelArchived: vi.fn(async () => {}), sendChannelMessage: vi.fn(async () => 'new-message'),
  sendGroupMessage: vi.fn(async () => 'new-message'), sendDirectMessage: vi.fn(async () => 'new-message'),
  attachResourceFile: vi.fn(async () => 'file'), downloadResourceFile: vi.fn(async () => new Blob()),
  editMessage: vi.fn(async () => {}), deleteMessage: vi.fn(async () => {}), toggleReaction: vi.fn(async () => {}),
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char.codePointAt(0)!.toString(16)} `) });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  snapshot = { ...emptySnapshot('ready'), me: member('viewer'), members: [member('viewer'), member('other'), member('admin', true)],
    chatChannels: [], channelMessages: [], conversationStates: [], blockedMembers: [], messageReports: [],
    groupMessages: [{ id: 'group1', senderId: 'other', text: 'Mensaje del salón', sentAt: at }],
    directConversations: [{ id: 'private', participantIds: ['viewer', 'other'] }],
    directMessages: [{ id: 'dm1', conversationId: 'private', senderId: 'other', text: 'Historial privado', sentAt: at }],
  };
  source = { ...actions, getSnapshot: () => snapshot, subscribe: () => () => {} } as unknown as DataSource;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function AddSharedPublication() { const navigate = useNavigate(); return <button type="button" aria-label="Compartir otra publicación" onClick={() => void navigate('/m/mensajes', { state: { chatPostShare: { id: 'after-message', memberId: 'viewer', target: { kind: 'answer', id: 'another-answer' } } } })}>Compartir otra publicación</button>; }
async function show(path = '/m/mensajes', strict = false, share = false) {
  const content = <DataProvider source={source}><MemoryRouter initialEntries={[path]}>{share && <AddSharedPublication />}<Routes>
    <Route path="/m/mensajes" element={<MessagesLayout />}>
      <Route index element={<GroupThread />} /><Route path="directos" element={<ThreadPlaceholder />} />
      <Route path="directos/:conversationId" element={<DirectThread />} /><Route path="canales/:channelId" element={<ChannelThread />} />
    </Route>
  </Routes></MemoryRouter></DataProvider>;
  await act(async () => root.render(strict ? <StrictMode>{content}</StrictMode> : content));
}
function enableVisibleReceipts() {
  Object.assign(source, { messageReceipts: { markSeen: vi.fn(async () => {}), subscribe: () => () => {}, getSnapshot: () => EMPTY_RECEIPT_INFO } });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 200, height: 200, left: 0, right: 300, width: 300, x: 0, y: 0, toJSON() {} });
}
async function click(button: HTMLElement) { await act(async () => button.click()); }
async function fill(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function dropFiles(files: File[]) {
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: { files, types: ['Files'] } });
  await act(async () => container.querySelector('textarea')!.dispatchEvent(drop));
}

describe('mensajería de la segunda entrega', () => {
  const conversations = [
    { label: 'grupo', path: '/m/mensajes', action: 'sendGroupMessage', args: ['Mensaje de prueba', undefined] },
    { label: 'canal', path: '/m/mensajes/canales/project', action: 'sendChannelMessage', args: ['project', 'Mensaje de prueba', undefined] },
    { label: 'directo', path: '/m/mensajes/directos/private', action: 'sendDirectMessage', args: ['private', 'Mensaje de prueba', undefined] },
  ] as const;

  it.each(conversations)('pliega y recupera la escritura del $label sin desmontar el borrador ni seguir escribiendo en vivo', async ({ path }) => {
    snapshot.chatChannels = [{ id: 'project', name: 'Proyecto final', kind: 'project', createdBy: 'viewer', createdAt: at }];
    const setTyping = vi.fn(async (_scope: string, _conversation: string, _typing: boolean) => {});
    const publish = vi.fn(async (_scope: string, _conversation: string, _text: string) => {});
    Object.assign(source, { setTyping, liveDrafts: { publish, subscribe: () => () => {}, getSnapshot: () => EMPTY_LIVE_DRAFTS } });
    await show(path);
    const field = container.querySelector<HTMLTextAreaElement>('textarea')!;
    await fill(field, 'Borrador que debe permanecer'); field.focus();
    const log = container.querySelector<HTMLElement>('[role="log"]')!;
    Object.defineProperties(log, { scrollHeight: { configurable: true, value: 3000 }, clientHeight: { configurable: true, value: 500 }, clientWidth: { configurable: true, value: 400 } });
    await act(async () => window.dispatchEvent(new Event('resize')));
    await act(async () => {
      log.dispatchEvent(new WheelEvent('wheel', { deltaY: -150, bubbles: true }));
      log.scrollTop = 2350; log.dispatchEvent(new Event('scroll'));
    });
    expect(container.querySelector('.reading-composer-dock')?.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(log); expect(container.querySelector('textarea')).toBe(field);
    expect(field.value).toBe('Borrador que debe permanecer'); expect(setTyping.mock.calls.at(-1)?.[2]).toBe(false);
    expect(publish.mock.calls.at(-1)?.[2]).toBe('');
    await act(async () => {
      log.dispatchEvent(new WheelEvent('wheel', { deltaY: 20, bubbles: true }));
      log.scrollTop = 2370; log.dispatchEvent(new Event('scroll'));
    });
    expect(container.querySelector('.reading-composer-dock')?.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(log); expect(field.value).toBe('Borrador que debe permanecer');
  });

  it.each(conversations)('envía al $label desde el editor renovado y limpia el borrador confirmado', async ({ path, action, args }) => {
    snapshot.chatChannels = [{ id: 'project', name: 'Proyecto final', kind: 'project', createdBy: 'viewer', createdAt: at }];
    await show(path);
    await fill(container.querySelector('textarea')!, 'Mensaje de prueba');
    await click(container.querySelector('[aria-label="Enviar mensaje"]')!);
    expect(actions[action]).toHaveBeenCalledExactlyOnceWith(...args);
    for (const other of conversations.filter((conversation) => conversation.action !== action)) {
      expect(actions[other.action]).not.toHaveBeenCalled();
    }
    expect(container.querySelector('textarea')?.value).toBe('');
    expect(container.querySelector('[aria-label="Enviar mensaje"]')?.getAttribute('disabled')).not.toBeNull();
  }, 15_000);

  it.each(conversations)('conserva el borrador del $label y anuncia un error asíncrono para reintentarlo', async ({ path, action, args }) => {
    let rejectSend!: (error: Error) => void;
    actions[action].mockImplementationOnce(() => new Promise<string>((_resolve, reject) => { rejectSend = reject; }));
    snapshot.chatChannels = [{ id: 'project', name: 'Proyecto final', kind: 'project', createdBy: 'viewer', createdAt: at }];
    await show(path);
    await fill(container.querySelector('textarea')!, 'Mensaje de prueba');
    await click(container.querySelector('[aria-label="Enviar mensaje"]')!);
    expect(container.querySelector('textarea')?.disabled).toBe(true);
    expect(container.querySelector('textarea')?.value).toBe('Mensaje de prueba');
    await act(async () => rejectSend(new Error('No se pudo confirmar el envío')));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No se pudo confirmar el envío');
    expect(container.querySelector('textarea')?.disabled).toBe(false);
    expect(container.querySelector('textarea')?.value).toBe('Mensaje de prueba');
    await click(container.querySelector('[aria-label="Enviar mensaje"]')!);
    expect(actions[action]).toHaveBeenCalledTimes(2);
    expect(actions[action]).toHaveBeenLastCalledWith(...args);
    expect(container.querySelector('textarea')?.value).toBe('');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  }, 15_000);

  it('marca solo la conversación abierta al estar visible, sin consumir los directos', async () => {
    enableVisibleReceipts();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await show(); expect(actions.markConversationRead).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(actions.markConversationRead).not.toHaveBeenCalled();
    await act(async () => new Promise(resolve => setTimeout(resolve, 1050)));
    expect(actions.markConversationRead).toHaveBeenCalledExactlyOnceWith('group', 'general', 'group1');
    expect(container.querySelector('a[href="/m/mensajes/directos/private"] .chat-unread')?.textContent).toBe('1');
  });
  it('reintenta el mismo adjunto sin volver a enviar el mensaje ya confirmado', async () => {
    actions.attachResourceFile.mockRejectedValueOnce(new Error('Respuesta incierta')).mockResolvedValueOnce('file');
    await show();
    await fill(container.querySelector('textarea')!, 'Adjunto para el salón');
    await click(container.querySelector('[aria-label="Elegir archivos adjuntos"]')!);
    const file = new File(['hola'], 'hola.txt', { type: 'text/plain' });
    const picker = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
    await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })));
    await click(container.querySelector('[aria-label="Enviar mensaje"]')!);
    expect(container.textContent).toContain('El mensaje ya se envió');
    expect(container.querySelector('textarea')?.disabled).toBe(true);
    await click(container.querySelector('[aria-label="Reintentar adjuntos"]')!);
    expect(actions.sendGroupMessage).toHaveBeenCalledExactlyOnceWith('Adjunto para el salón', undefined);
    expect(actions.attachResourceFile).toHaveBeenCalledTimes(2);
    for (const call of actions.attachResourceFile.mock.calls) expect(call.slice(0, 4)).toEqual(['group_message', 'new-message', file, 1]);
    expect(container.querySelector('textarea')?.value).toBe('');
  });
  it('espera la confirmación del adjunto aunque todos los bytes ya se transfirieron', async () => {
    let confirm!: (id: string) => void;
    source.attachResourceFile = vi.fn((_kind, _id, file, _version, options) => {
      options?.onProgress?.(file.size, file.size);
      return new Promise<string>((resolve) => { confirm = resolve; });
    });
    await show();
    const file = new File(['hola'], 'confirmar.txt', { type: 'text/plain' });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
    await act(async () => container.querySelector('textarea')!.dispatchEvent(drop));
    await click(container.querySelector('[aria-label="Enviar mensaje"]')!);
    expect(container.querySelector('[data-upload-state="confirming"]')).not.toBeNull();
    expect(container.querySelector('[data-upload-state="complete"]')).toBeNull();
    expect(container.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false);
    await act(async () => confirm('file'));
    expect(container.querySelector('[data-upload-state="complete"]')).not.toBeNull();
    expect(actions.sendGroupMessage).toHaveBeenCalledExactlyOnceWith('Archivo adjunto', undefined);
  });

  it('reintenta la parte pendiente de una cola sin duplicar el mensaje ni el archivo confirmado', async () => {
    const attach = vi.fn<DataSource['attachResourceFile']>()
      .mockResolvedValueOnce('first-file').mockRejectedValueOnce(new Error('Sin conexión')).mockResolvedValueOnce('second-file');
    source.attachResourceFile = attach;
    await show();
    const files = [new File(['uno'], 'uno.txt', { type: 'text/plain' }), new File(['dos'], 'dos.txt', { type: 'text/plain' })];
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files, types: ['Files'] } });
    await act(async () => container.querySelector('textarea')!.dispatchEvent(drop));
    await click(container.querySelector('[aria-label="Enviar mensaje"]')!);
    expect(container.querySelector('[data-upload-state="complete"]')?.textContent).toContain('uno.txt');
    expect(container.querySelector('[data-upload-state="failed"]')?.textContent).toContain('dos.txt');
    await click(container.querySelector('[aria-label="Reintentar dos.txt"]')!);
    expect(actions.sendGroupMessage).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls.map((call) => [call[1], call[2], call[3]])).toEqual([
      ['new-message', files[0], 1], ['new-message', files[1], 2], ['new-message', files[1], 2],
    ]);
    expect(container.querySelectorAll('[data-upload-state="complete"]')).toHaveLength(2);
  });

  it('conserva una cola cancelada para reintentar los mismos archivos sobre el mismo mensaje', async () => {
    const attach = vi.fn<DataSource['attachResourceFile']>().mockImplementationOnce((_kind, _id, file, _version, options) => {
      options?.onProgress?.(1, file.size);
      return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelaste la transferencia.', 'AbortError')), { once: true }));
    }).mockResolvedValue('file');
    source.attachResourceFile = attach;
    const file = new File(['archivo'], 'cancelar.txt', { type: 'text/plain' });
    await show();
    await fill(container.querySelector('textarea')!, 'Mensaje con adjunto');
    await dropFiles([file]);
    await click(container.querySelector('[aria-label="Enviar mensaje"]')!);
    await click(container.querySelector('[aria-label="Cancelar cancelar.txt"]')!);
    expect(container.querySelector('[data-upload-state="cancelled"]')).not.toBeNull();
    expect(container.querySelector('textarea')?.value).toBe('Mensaje con adjunto');
    await click(container.querySelector('[aria-label="Reintentar cancelar.txt"]')!);
    expect(actions.sendGroupMessage).toHaveBeenCalledExactlyOnceWith('Mensaje con adjunto', undefined);
    expect(attach).toHaveBeenCalledTimes(2);
    expect(attach.mock.calls[0]?.slice(0, 4)).toEqual(attach.mock.calls[1]?.slice(0, 4));
    expect(container.querySelector('[data-upload-state="complete"]')).not.toBeNull();
  });

  it('no pierde los archivos si falla el descarte y reconoce un adjunto que ya estaba confirmado', async () => {
    source.attachResourceFile = vi.fn<DataSource['attachResourceFile']>().mockRejectedValue(new Error('Respuesta perdida'));
    source.discardResourceUpload = vi.fn<DataSource['discardResourceUpload']>().mockRejectedValueOnce(new Error('No pudimos cancelar')).mockResolvedValueOnce('file-ready');
    const file = new File(['archivo'], 'incierto.txt', { type: 'text/plain' });
    await show();
    await dropFiles([file]);
    await click(container.querySelector('[aria-label="Enviar mensaje"]')!);
    const discard = () => [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Descartar adjuntos pendientes')!;
    await click(discard());
    expect(container.textContent).toContain('No pudimos cancelar');
    expect(container.querySelector('[data-upload-state="failed"]')).not.toBeNull();
    expect(container.querySelector('textarea')?.disabled).toBe(true);
    await click(discard());
    expect(source.discardResourceUpload).toHaveBeenCalledTimes(2);
    expect(source.discardResourceUpload).toHaveBeenLastCalledWith('group_message', 'new-message', file);
    expect(container.querySelector('[data-upload-state="complete"]')).not.toBeNull();
    expect(container.querySelector('textarea')?.disabled).toBe(false);
    expect(actions.sendGroupMessage).toHaveBeenCalledOnce();
  });

  it('no inicia adjuntos antiguos si el mensaje se confirma después de cambiar de conversación', async () => {
    let confirmMessage!: (id: string) => void;
    actions.sendGroupMessage.mockImplementationOnce(() => new Promise((resolve) => { confirmMessage = resolve; }));
    await show();
    const file = new File(['archivo'], 'anterior.txt', { type: 'text/plain' });
    await dropFiles([file]);
    await click(container.querySelector('[aria-label="Enviar mensaje"]')!);
    await click(container.querySelector('a[href="/m/mensajes/directos/private"]')!);
    await act(async () => confirmMessage('old-message'));
    expect(actions.attachResourceFile).not.toHaveBeenCalled();
    expect(container.querySelector('[data-upload-state]')).toBeNull();
    expect(container.querySelector('textarea')?.value).toBe('');
    await click(container.querySelector('a[href="/m/mensajes"]')!);
    expect(container.textContent).toContain('anterior.txt');
    expect(container.textContent).toContain('El mensaje ya se envió');
    await click(container.querySelector('[aria-label="Reintentar adjuntos"]')!);
    expect(actions.sendGroupMessage).toHaveBeenCalledTimes(1);
    expect(actions.attachResourceFile.mock.calls[0]?.slice(0, 4)).toEqual(['group_message', 'old-message', file, 1]);
    expect(container.querySelector('textarea')?.value).toBe('');
  });
  it('limpia la confirmación tardía solo en el borrador original y bloquea repetir mientras sigue pendiente', async () => {
    let confirmMessage!: (id: string) => void;
    actions.sendGroupMessage.mockImplementationOnce(() => new Promise(resolve => { confirmMessage = resolve; }));
    await show(); await fill(container.querySelector('textarea')!, 'Texto enviado al salón');
    await click(container.querySelector('[aria-label="Enviar mensaje"]')!);
    await click(container.querySelector('a[href="/m/mensajes/directos/private"]')!);
    await fill(container.querySelector('textarea')!, 'Borrador del directo');
    await click(container.querySelector('a[href="/m/mensajes"]')!);
    expect(container.querySelector('textarea')?.disabled).toBe(true);
    await click(container.querySelector('a[href="/m/mensajes/directos/private"]')!);
    await act(async () => confirmMessage('late'));
    expect(container.querySelector('textarea')?.value).toBe('Borrador del directo');
    await click(container.querySelector('a[href="/m/mensajes"]')!);
    expect(container.querySelector('textarea')?.value).toBe('');
    expect(actions.sendGroupMessage).toHaveBeenCalledTimes(1);
  });
  it('retoma solo el archivo pendiente tras salir durante la subida y conserva la versión confirmada', async () => {
    const attach = vi.fn<DataSource['attachResourceFile']>().mockResolvedValueOnce('first').mockImplementationOnce((_kind, _id, _file, _version, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelado al cambiar de conversación', 'AbortError')), { once: true });
    })).mockResolvedValueOnce('second');
    source.attachResourceFile = attach;
    const files = [new File(['uno'], 'uno.txt'), new File(['dos'], 'dos.txt')];
    await show(); await dropFiles(files); await click(container.querySelector('[aria-label="Enviar mensaje"]')!);
    await click(container.querySelector('a[href="/m/mensajes/directos/private"]')!);
    expect(container.querySelector('[data-upload-state]')).toBeNull();
    await click(container.querySelector('a[href="/m/mensajes"]')!);
    expect(container.querySelector('[data-upload-state="complete"]')?.textContent).toContain('uno.txt');
    expect(container.querySelector('[data-upload-state="cancelled"]')?.textContent).toContain('dos.txt');
    await click(container.querySelector('[aria-label="Reintentar adjuntos"]')!);
    expect(actions.sendGroupMessage).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls.map(call => [call[1], call[2], call[3]])).toEqual([
      ['new-message', files[0], 1], ['new-message', files[1], 2], ['new-message', files[1], 2],
    ]);
    expect(container.querySelector('textarea')?.value).toBe('');
  });
  it('el replay de efectos de StrictMode conserva una sesión de envío utilizable', async () => {
    await show('/m/mensajes', true); await fill(container.querySelector('textarea')!, 'Envío después de StrictMode');
    await click(container.querySelector('[aria-label="Enviar mensaje"]')!);
    expect(actions.sendGroupMessage).toHaveBeenCalledExactlyOnceWith('Envío después de StrictMode', undefined);
    expect(container.querySelector('textarea')?.value).toBe('');
  });
  it('reintentar una subida conserva una publicación añadida después para un mensaje separado', async () => {
    actions.attachResourceFile.mockRejectedValueOnce(new Error('Respuesta perdida')).mockResolvedValueOnce('file');
    await show('/m/mensajes', false, true);
    await fill(container.querySelector('textarea')!, 'Texto ya enviado');
    await dropFiles([new File(['archivo'], 'original.txt')]);
    await click(container.querySelector('[aria-label="Enviar mensaje"]')!);
    await click(container.querySelector('[aria-label="Compartir otra publicación"]')!);
    expect(container.querySelectorAll('.composer__refs li')).toHaveLength(1);
    await click(container.querySelector('[aria-label="Reintentar adjuntos"]')!);
    expect(actions.sendGroupMessage).toHaveBeenCalledTimes(1);
    expect(container.querySelector('textarea')?.value).toBe('');
    expect(container.querySelectorAll('.composer__refs li')).toHaveLength(1);
    await click(container.querySelector('[aria-label="Enviar mensaje"]')!);
    expect(actions.sendGroupMessage).toHaveBeenCalledTimes(2);
    const separateMessage = vi.mocked(source.sendGroupMessage).mock.calls[1]![0];
    expect(chatPostReferencesIn(separateMessage)).toEqual([{ kind: 'answer', id: 'another-answer' }]);
    expect(separateMessage).not.toContain('Texto ya enviado');
    expect(actions.attachResourceFile).toHaveBeenCalledTimes(2);
  });
  it('ofrece reporte con evidencia sin seleccionar por defecto', async () => {
    await show('/m/mensajes/directos/private');
    await click(container.querySelector('[aria-label="Opciones del mensaje"]')!);
    await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim() === 'Reportar mensaje')!);
    const checkbox = container.querySelector<HTMLInputElement>('.chat-report input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);
    await fill(container.querySelector<HTMLTextAreaElement>('.chat-report textarea')!, 'Revisar conducta');
    await act(async () => container.querySelector<HTMLFormElement>('.chat-report form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(actions.reportMessage).toHaveBeenCalledExactlyOnceWith({ scope: 'direct', messageId: 'dm1', reason: 'Revisar conducta', shareText: false, attachmentIds: [] });
  });
  it('conserva el historial al bloquear y deshabilita nuevos envíos', async () => {
    snapshot.blockedMembers = [{ memberId: 'other' }];
    await show('/m/mensajes/directos/private');
    expect(container.querySelector('[role="log"]')?.textContent).toContain('Historial privado');
    expect(container.querySelector('textarea')?.disabled).toBe(true);
    await click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Desbloquear')!);
    expect(actions.setMemberBlocked).toHaveBeenCalledExactlyOnceWith('other', false);
  });
  it('muestra menciones con nombre y deja el código intacto', async () => {
    snapshot.groupMessages[0]!.text = 'Hola [[mencion:viewer]]\n```\n[[mencion:other]]\n```';
    await show();
    expect(container.querySelector('.mention--me')?.textContent).toBe('@viewer');
    expect(container.querySelector('.bubble__code')?.textContent).toBe('[[mencion:other]]');
  });
  it('conserva el historial de un canal archivado y permite a su creador reabrirlo', async () => {
    enableVisibleReceipts();
    snapshot.chatChannels = [{ id: 'project', name: 'Proyecto final', kind: 'project', createdBy: 'viewer', createdAt: at, archivedAt: at }];
    snapshot.channelMessages = [{ id: 'cm1', channelId: 'project', senderId: 'other', text: 'Acuerdos del proyecto', sentAt: at }];
    await show('/m/mensajes/canales/project');
    expect(container.querySelector('[role="log"]')?.textContent).toContain('Acuerdos del proyecto');
    expect(container.querySelector('textarea')?.disabled).toBe(true);
    await click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Reabrir canal')!);
    expect(actions.setChatChannelArchived).toHaveBeenCalledExactlyOnceWith('project', false);
    await act(async () => new Promise(resolve => setTimeout(resolve, 1050)));
    expect(actions.markConversationRead).toHaveBeenCalledExactlyOnceWith('channel', 'project', 'cm1');
  });
});
