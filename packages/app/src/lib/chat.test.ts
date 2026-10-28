import { describe, expect, it } from 'vitest';
import { chatTarget, mentionedMembers, mentionParts, mentionToken, unreadMessages } from './chat';

describe('menciones y lectura por conversación', () => {
  it('conserva identidades estables y elimina menciones repetidas', () => {
    const text = `Hola ${mentionToken('demo-2')}, ${mentionToken('demo-3')} y ${mentionToken('demo-2')}`;
    expect(mentionedMembers(text)).toEqual(['demo-2', 'demo-3']);
    expect(mentionParts('Antes [[mencion:demo-2]] después')).toEqual([{ kind: 'text', text: 'Antes ' }, { kind: 'mention', memberId: 'demo-2' }, { kind: 'text', text: ' después' }]);
  });
  it('cuenta solo mensajes ajenos vivos después del puntero de esta conversación', () => {
    const rows = [
      { id: '10', senderId: 'other', text: 'Leído', sentAt: new Date(1) },
      { id: '11', senderId: 'me', text: 'Mío', sentAt: new Date(2) },
      { id: '12', senderId: 'other', text: '', sentAt: new Date(3), deletedAt: new Date() },
      { id: '13', senderId: 'other', text: 'Nuevo', sentAt: new Date(4) },
    ];
    expect(unreadMessages(rows, 'me', '10').map((message) => message.id)).toEqual(['13']);
    expect(unreadMessages(rows, 'me', '13')).toEqual([]);
    expect(unreadMessages(rows, 'me').map((message) => message.id)).toEqual(['10', '13']);
  });
  it('conserva el puntero u64 con caché parcial y desordenada sin redondear IDs', () => {
    const rows = ['9007199254740995', '9007199254740992', '9007199254740994'].map((id) => ({ id, senderId: 'other', text: id, sentAt: new Date() }));
    expect(unreadMessages(rows, 'me', '9007199254740993').map((m) => m.id)).toEqual(['9007199254740995', '9007199254740994']);
  });
  it('el recibo individual prevalece sobre el cursor y una lectura fuera de orden no borra pendientes', () => {
    const rows = ['1', '2', '3'].map(id => ({ id, senderId: 'other', text: id, sentAt: new Date() }));
    const receipts = rows.map(row => ({ scope: 'group' as const, conversationId: 'general', messageId: row.id, recipientId: 'me', deliveredAt: new Date(), readAt: row.id === '2' ? new Date() : undefined }));
    expect(unreadMessages(rows, 'me', '3', receipts).map(row => row.id)).toEqual(['1', '3']);
  });
  it('no resucita históricos entregados después de actualizar y sí respeta su nueva lectura individual', () => {
    const rows = ['1', '2'].map(id => ({ id, senderId: 'other', text: id, sentAt: new Date() }));
    const receipts = rows.map(row => ({ scope: 'group' as const, conversationId: 'general', messageId: row.id, recipientId: 'me', deliveredAt: new Date(), tracked: false, readAt: row.id === '2' ? new Date() : undefined }));
    expect(unreadMessages(rows, 'me', '1', receipts)).toEqual([]);
  });
  it('asigna adjuntos al mensaje y a su ámbito exacto', () => {
    expect(['group', 'direct', 'channel'].map((scope) => chatTarget(scope as 'group' | 'direct' | 'channel'))).toEqual(['group_message', 'direct_message', 'channel_message']);
  });
});
