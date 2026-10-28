import { afterEach, describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';
import { unreadMessages } from '../lib/chat';
const sessions: DemoDataSource[] = [];
afterEach(() => { sessions.forEach(source => source.dispose()); sessions.length = 0; });
const make = (state: ReturnType<typeof createDemoState>, id: string, now?: () => Date) => { const source = new DemoDataSource(state, id, now); sessions.push(source); return source; };
describe('recibos de mensajes entre cuentas de la demo', () => {
  it('confirma entrega al obtener caché, lectura explícita y primeras horas persistentes', async () => {
    const state = createDemoState(); let time = new Date('2026-10-26T12:00:00Z'); const clock = () => time;
    const author = make(state, 'demo-2', clock); const recipient = make(state, 'demo-3', clock);
    const chat = author.openDirectConversation('demo-3'); const id = author.sendDirectMessage(chat, 'Archivo o publicación');
    const stop = author.messageReceipts.subscribe('direct', id, () => {});
    expect(author.messageReceipts.getSnapshot('direct', id)).toMatchObject({ tracked: true, receipts: [{ recipientId: 'demo-3' }] });
    expect(author.messageReceipts.getSnapshot('direct', id).receipts[0]?.deliveredAt).toBeUndefined();
    recipient.getSnapshot(); await Promise.resolve();
    expect(author.messageReceipts.getSnapshot('direct', id).receipts[0]).toMatchObject({ deliveredAt: time });
    expect(author.messageReceipts.getSnapshot('direct', id).receipts[0]?.readAt).toBeUndefined();
    time = new Date(time.getTime() + 2000); recipient.messageReceipts.markSeen('direct', chat, [id]);
    const first = author.messageReceipts.getSnapshot('direct', id).receipts[0]!;
    expect(first.readAt).toEqual(time); const anotherTab = make(state, 'demo-3', clock); time = new Date(time.getTime() + 5000);
    anotherTab.messageReceipts.markSeen('direct', chat, [id]); expect(author.messageReceipts.getSnapshot('direct', id).receipts[0]).toEqual(first); stop();
  });
  it('protege información del autor ante destinatarios, terceros y administradores', () => {
    const state = createDemoState(); const author = make(state, 'demo-2'); const id = author.sendGroupMessage('Visible para el grupo');
    for (const actor of ['demo-3', 'demo-1']) { const source = make(state, actor); source.messageReceipts.subscribe('group', id, () => {}); expect(source.messageReceipts.getSnapshot('group', id)).toMatchObject({ unavailable: true, receipts: [] }); }
  });
  it('los recibos individuales evitan que un cursor antiguo oculte mensajes todavía sin visualizar', async () => {
    const state = createDemoState(); const author = make(state, 'demo-2'); const recipient = make(state, 'demo-3'); const id = author.sendGroupMessage('Visible solo después de un segundo');
    recipient.markConversationRead('group', 'general', id); const snapshot = recipient.getSnapshot(); await Promise.resolve();
    expect(unreadMessages(snapshot.groupMessages, 'demo-3', id, snapshot.messageReceipts).map(row => row.id)).toContain(id);
    recipient.messageReceipts.markSeen('group', 'general', [id]); const read = recipient.getSnapshot();
    expect(unreadMessages(read.groupMessages, 'demo-3', id, read.messageReceipts).map(row => row.id)).not.toContain(id);
  });
  it('registra la entrega histórica aplicada sin crear pendientes, conserva su primera hora y respeta el cursor anterior', async () => {
    const state = createDemoState(); let now = new Date('2026-10-26T12:00:00Z'); const clock = () => now;
    const author = make(state, 'demo-2', clock), recipient = make(state, 'demo-3', clock);
    const old = { id: 'historical-message', conversationId: author.openDirectConversation('demo-3'), senderId: 'demo-2', text: 'Anterior', sentAt: new Date(1) }; state.directMessages.push(old);
    author.messageReceipts.subscribe('direct', old.id, () => {}); expect(author.messageReceipts.getSnapshot('direct', old.id)).toMatchObject({ tracked: false, receipts: [] });
    recipient.markConversationRead('direct', old.conversationId, old.id); recipient.getSnapshot(); await Promise.resolve();
    const first = author.messageReceipts.getSnapshot('direct', old.id).receipts[0]!;
    expect(first).toMatchObject({ tracked: false, recipientId: 'demo-3', deliveredAt: now }); expect(first.readAt).toBeUndefined();
    const snapshot = recipient.getSnapshot(); expect(unreadMessages(snapshot.directMessages.filter(row => row.conversationId === old.conversationId), 'demo-3', old.id, snapshot.messageReceipts)).toEqual([]);
    now = new Date(now.getTime() + 4000); recipient.messageReceipts.markSeen('direct', old.conversationId, [old.id]);
    expect(author.messageReceipts.getSnapshot('direct', old.id).receipts[0]).toMatchObject({ deliveredAt: first.deliveredAt, readAt: now });
    const authorRows = author.getSnapshot().messageReceipts ?? []; expect(authorRows.some(row => row.messageId === old.id)).toBe(false);
    author.setMemberBlocked('demo-3', true); expect(() => recipient.messageReceipts.markSeen('direct', old.conversationId, [old.id])).toThrow();
  });

});
