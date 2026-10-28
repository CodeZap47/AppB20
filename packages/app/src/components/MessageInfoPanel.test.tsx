// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { MessageInfoPanel } from './MessageInfoPanel';
import { MessageList } from './MessageList';
let root: Root; let container: HTMLDivElement; const sources: DemoDataSource[] = [];
const handlers = { onReply() {}, onEdit() {}, onDelete() {}, onReact() {} };
const now = new Date('2026-10-26T12:00:00Z');
const make = (state: ReturnType<typeof createDemoState>, id: string) => { const source = new DemoDataSource(state, id, () => now); sources.push(source); return source; };
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.stubGlobal('CSS', { escape: (value: string) => value }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); sources.forEach(source => source.dispose()); sources.length = 0; container.remove(); vi.unstubAllGlobals(); });
describe('información del mensaje', () => {
  it('muestra estados en vivo y desglosa la primera entrega al abrir una lectura', async () => {
    const state = createDemoState(); const author = make(state, 'demo-2'), recipient = make(state, 'demo-3'); const chat = author.openDirectConversation('demo-3'); const id = author.sendDirectMessage(chat, 'Prueba de información'); const message = author.getSnapshot().directMessages.find(row => row.id === id)!;
    await act(async () => root.render(<DataProvider source={author}><MessageInfoPanel scope="direct" message={message} onClose={() => {}} /></DataProvider>));
    expect(document.querySelector('[aria-label="Pendiente de entrega"]')?.textContent).toContain('Aún no se confirma');
    await act(async () => { recipient.getSnapshot(); await Promise.resolve(); });
    expect(document.querySelector('[aria-label="Entregado"] time')?.getAttribute('datetime')).toBe(now.toISOString());
    await act(async () => recipient.messageReceipts.markSeen('direct', chat, [id]));
    const read = document.querySelector('[aria-label="Leído"]')!; expect(read.querySelector('summary time')?.getAttribute('datetime')).toBe(now.toISOString());
    expect(read.querySelector('details p')?.textContent).toContain('Entregado');
    expect(document.querySelector('.message-info-history')).toBeNull();
  });
  it('señala un histórico sin inventar pendientes', async () => {
    const state = createDemoState(); const author = make(state, 'demo-2'); const message = { id: 'old', senderId: 'demo-2', text: 'Anterior', sentAt: new Date(1) }; state.groupMessages.push(message);
    await act(async () => root.render(<DataProvider source={author}><MessageInfoPanel scope="group" message={message} onClose={() => {}} /></DataProvider>));
    expect(document.body.textContent).toContain('Sin registro anterior'); expect(document.querySelector('[aria-label="Pendiente de entrega"] li')).toBeNull();
  });
  it('solo ofrece la opción en mensajes propios, incluso si el espectador es administrador', async () => {
    const state = createDemoState(); const author = make(state, 'demo-1'); author.sendGroupMessage('Mensaje propio');
    const snapshot = author.getSnapshot(); const messages = snapshot.groupMessages.slice(-2);
    await act(async () => root.render(<DataProvider source={author}><MemoryRouter><MessageList messages={messages} members={snapshot.members} meId="demo-1" showSenders scope="group" empty="" handlers={handlers} /></MemoryRouter></DataProvider>));
    const bubbles = [...container.querySelectorAll('.msg')]; const own = bubbles.find(row => row.textContent?.includes('Mensaje propio'))!;
    await act(async () => (own.querySelector('[aria-label="Opciones del mensaje"]') as HTMLButtonElement).click());
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Información del mensaje');
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    const other = bubbles.find(row => row !== own); if (other) {
      await act(async () => (other.querySelector('[aria-label="Opciones del mensaje"]') as HTMLButtonElement).click()); expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('Información del mensaje');
    }
  });
});
