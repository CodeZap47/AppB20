import { describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';

describe('Ayuda versionada entre dos sesiones', () => {
  it('rechaza sobrescribir una edición ajena a la sesión y conserva las versiones propias', () => {
    const state = createDemoState(); const owner = new DemoDataSource(state, 'demo-2'); const second = new DemoDataSource(state, 'demo-2'); const peer = new DemoDataSource(state, 'demo-3');
    try {
      const subjectId = owner.getSnapshot().subjects[0]!.id;
      const fields = { subjectId, kind: 'offer' as const, title: 'Ayuda con tipos', topic: 'Tipos', description: 'Primera explicación', level: 'initial' as const, modality: 'messages' as const, availability: '' };
      const id = owner.saveHelpPost({ ...fields, requestId: 'create-help' });
      expect(owner.saveHelpPost({ ...fields, requestId: 'create-help' })).toBe(id);
      owner.saveHelpPost({ ...fields, id, description: 'Segunda explicación', expectedVersion: 1, requestId: 'edit-help' });
      expect(second.getSnapshot().helpPosts.find(row => row.id === id)?.version).toBe(2);
      expect(() => second.saveHelpPost({ ...fields, id, expectedVersion: 1, requestId: 'stale-help' })).toThrow('cambió');
      expect(() => peer.getHelpPostHistory(id)).toThrow('autor');
      const history = owner.getHelpPostHistory(id);
      expect(history.map(row => row.fields.description)).toEqual(['Segunda explicación', 'Primera explicación']);
      history[0]!.fields.description = 'Alterar la copia';
      expect(owner.getHelpPostHistory(id)[0]!.fields.description).toBe('Segunda explicación');
      expect(() => owner.saveHelpPost({ ...fields, title: 'Otra intención', requestId: 'create-help' })).toThrow('otro cambio');
    } finally { owner.dispose(); second.dispose(); peer.dispose(); }
  });
  it('cerrar comprueba versión, mantiene contactos aceptados y el historial sigue privado', () => {
    const state = createDemoState(); const owner = new DemoDataSource(state, 'demo-2'); const peer = new DemoDataSource(state, 'demo-3'); const admin = new DemoDataSource(state, 'demo-1');
    try {
      const id = owner.saveHelpPost({ subjectId: owner.getSnapshot().subjects[0]!.id, kind: 'request', title: 'Repasar', topic: 'Rust', description: 'Entender préstamos', level: 'basics', modality: 'messages', availability: '' });
      const contact = peer.sendHelpContact(id, 'Podemos repasar'); owner.respondHelpContact(contact, 'accepted');
      owner.setHelpPostStatus(id, 'closed', 1);
      expect(peer.getSnapshot().helpContacts.find(row => row.id === contact)?.status).toBe('accepted');
      expect(() => owner.withdrawHelpPost(id, '', 1)).toThrow('cambió');
      owner.withdrawHelpPost(id, '', 2);
      expect(peer.getSnapshot().helpPosts.some(row => row.id === id)).toBe(false);
      expect(() => admin.getHelpPostHistory(id)).toThrow('autor');
      expect(owner.getHelpPostHistory(id).map(row => row.status)).toEqual(['withdrawn', 'closed', 'open']);
    } finally { owner.dispose(); peer.dispose(); admin.dispose(); }
  });
});
