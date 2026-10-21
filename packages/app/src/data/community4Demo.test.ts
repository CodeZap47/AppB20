import { describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';
const fields = { intention: 'Hacer un ciclo', symptom: 'No termina', cause: 'Hipótesis: índice inmóvil', correction: '', learning: 'Revisar incremento', minimalCode: 'while (i < 10) {}', evidence: '', language: 'JS', topic: 'Ciclos', bugType: 'Lógico', noteIds: [], questionIds: [] };
const opportunity = { kind: 'event', title: 'Taller Rust', topic: 'Rust', modality: 'online', sourceUrl: 'https://example.com/event', organizer: 'Universidad', requirements: 'Inscripción manual', costKnown: false, cost: '' };
describe('demo comunidad comparte reglas y datos sin compartir interés privado', () => {
  it('Museo crea una pregunta normal, comparte metadata, reutiliza comentarios y preserva idempotencia después de editar', () => {
    const state = createDemoState(), a = new DemoDataSource(state, 'demo-1'), b = new DemoDataSource(state, 'demo-4');
    try { const subjectId = a.getSnapshot().subjects[0]!.id; const initial = a.getSnapshot().questions.length;
      a.createMuseum({ subjectId, title: 'Ciclo infinito', fields, requestId: 'create' }); const entry = a.getSnapshot().museumEntries[0]!; expect(a.getSnapshot().questions).toHaveLength(initial + 1); expect(b.getSnapshot().museumEntries).toHaveLength(1);
      b.commentQuestion(entry.questionId, '¿Qué valor tenía i?'); expect(b.getSnapshot().questionComments.some((r) => r.questionId === entry.questionId)).toBe(true);
      expect(() => b.saveMuseum({ questionId: entry.questionId, expectedVersion: 1, fields, requestId: 'foreign' })).toThrow('autor');
      a.saveMuseum({ questionId: entry.questionId, expectedVersion: 1, fields: { ...fields, correction: 'Incrementar i' }, requestId: 'edit' }); a.createMuseum({ subjectId, title: 'Ciclo infinito', fields, requestId: 'create' }); expect(a.getSnapshot().questions).toHaveLength(initial + 1); expect(a.getSnapshot().museumRevisions).toHaveLength(2);
      a.withdrawContent('question', entry.questionId, true, 1, ''); expect(b.getSnapshot().museumEntries).toEqual([]); expect(b.getSnapshot().museumRevisions).toEqual([]);
      a.withdrawContent('question', entry.questionId, false, 2, ''); expect(b.getSnapshot().museumEntries[0]?.version).toBe(2);
    } finally { a.dispose(); b.dispose(); }
  });
  it('interés no expone identidad al autor/admin hasta permiso expreso y se revoca al cancelar', () => {
    const state = createDemoState(), a = new DemoDataSource(state, 'demo-1'), b = new DemoDataSource(state, 'demo-4');
    try { a.createOpportunity({ fields: opportunity, requestId: 'create' }); a.createOpportunity({ fields: opportunity, requestId: 'create' }); const id = a.getSnapshot().opportunities[0]!.id; expect(b.getSnapshot().opportunities).toHaveLength(1);
      b.setOpportunityInterest({ opportunityId: id, interested: true, seekingTeam: false, shareContact: false, expectedVersion: 0 }); expect(a.getSnapshot().opportunityInterests).toEqual([]); expect(b.getSnapshot().opportunityInterests[0]?.interested).toBe(true);
      b.setOpportunityInterest({ opportunityId: id, interested: true, seekingTeam: true, shareContact: true, expectedVersion: 1 }); expect(a.getSnapshot().opportunityInterests[0]?.memberId).toBe('demo-4');
      b.setOpportunityInterest({ opportunityId: id, interested: false, seekingTeam: true, shareContact: true, expectedVersion: 2 }); expect(a.getSnapshot().opportunityInterests).toEqual([]); expect(b.getSnapshot().opportunityInterests[0]).toMatchObject({ interested: false, seekingTeam: false, shareContact: false });
    } finally { a.dispose(); b.dispose(); }
  });
  it('corrige ficha por versión, resuelve reporte y guarda autoría e historial durante retirada', () => {
    const state = createDemoState(), a = new DemoDataSource(state, 'demo-1'), b = new DemoDataSource(state, 'demo-4');
    try { a.createOpportunity({ fields: opportunity, requestId: 'create' }); const id = a.getSnapshot().opportunities[0]!.id;
      expect(() => b.updateOpportunity({ opportunityId: id, expectedVersion: 1, fields: opportunity })).toThrow('autor');
      b.sendOpportunityFeedback({ opportunityId: id, kind: 'outdated', text: 'Cambió la fecha', requestId: 'report' }); const report = a.getSnapshot().opportunityFeedback[0]!; a.resolveOpportunityFeedback({ feedbackId: report.id, expectedVersion: 1, resolution: 'Fecha revisada' });
      a.updateOpportunity({ opportunityId: id, expectedVersion: 1, fields: { ...opportunity, title: 'Taller corregido' } }); expect(a.getSnapshot().opportunityRevisions).toHaveLength(2); expect(a.getSnapshot().opportunityFeedback[0]?.resolvedBy).toBe('demo-1');
      a.withdrawOpportunity({ opportunityId: id, expectedVersion: 2, withdrawn: true, reason: '' }); expect(b.getSnapshot().opportunities).toEqual([]); expect(a.getSnapshot().opportunityRevisions).toHaveLength(3);
      a.withdrawOpportunity({ opportunityId: id, expectedVersion: 3, withdrawn: false, reason: '' }); expect(b.getSnapshot().opportunities[0]?.authorId).toBe('demo-1');
    } finally { a.dispose(); b.dispose(); }
  });
  it('acepta referencias de las semillas demo sin exigir IDs numéricos del servidor', () => {
    const a = new DemoDataSource(createDemoState(), 'demo-1');
    try { a.saveMuseum({ questionId: 'q2', expectedVersion: 0, requestId: 'seed-museum', fields: { ...fields, noteIds: ['n1'], questionIds: ['q1'] } }); expect(a.getSnapshot().museumEntries[0]).toMatchObject({ questionId: 'q2', noteIds: ['n1'], questionIds: ['q1'] });
      const room = a.getSnapshot().studyRooms.find((r) => r.visibility === 'group' && ['scheduled', 'active'].includes(r.status))!; expect(room.id).toContain('room-');
      a.createOpportunity({ fields: { ...opportunity, roomId: room.id }, requestId: 'seed-room' }); expect(a.getSnapshot().opportunities[0]?.roomId).toBe(room.id);
    } finally { a.dispose(); }
  });
  it('una baja vacía todas las vistas de comunidad', () => { const state = createDemoState(), a = new DemoDataSource(state, 'demo-1'); try { a.createOpportunity({ fields: opportunity, requestId: 'create' }); a.setViewer('nonmember'); expect(a.getSnapshot().opportunities).toEqual([]); expect(a.getSnapshot().museumEntries).toEqual([]); } finally { a.dispose(); } });
});

describe('comunidad: confirmaciones perdidas y ediciones simultáneas', () => {
  it('un snapshot abierto no cambia de versión al guardar desde otra sesión', () => {
    const state = createDemoState(), a = new DemoDataSource(state, 'demo-1'), second = new DemoDataSource(state, 'demo-1');
    try {
      a.createOpportunity({ fields: opportunity, requestId: 'initial' });
      const editing = a.getSnapshot().opportunities[0]!;
      second.updateOpportunity({ opportunityId: editing.id, expectedVersion: 1, fields: { ...opportunity, title: 'Desde otra sesión' } });
      expect(editing.version).toBe(1); expect(editing.title).toBe(opportunity.title);
      expect(() => a.updateOpportunity({ opportunityId: editing.id, expectedVersion: editing.version, fields: opportunity })).toThrow('cambió');
      expect(a.getSnapshot().opportunities[0]?.title).toBe('Desde otra sesión');
      expect(() => a.createOpportunity({ fields: opportunity, requestId: 'initial' })).not.toThrow();
      expect(() => a.createOpportunity({ fields: { ...opportunity, title: 'Otro envío' }, requestId: 'initial' })).toThrow('otro contenido');
    } finally { a.dispose(); second.dispose(); }
  });
  it('una intención de Museo o reporte no acepta datos diferentes tras perder la confirmación', () => {
    const a = new DemoDataSource(createDemoState(), 'demo-1');
    try {
      const subjectId = a.getSnapshot().subjects[0]!.id; const initial = { subjectId, title: 'Ciclo infinito', fields, requestId: 'initial' };
      a.createMuseum(initial); expect(() => a.createMuseum({ ...initial, title: 'Otro error' })).toThrow('otro contenido');
      const questionId = a.getSnapshot().museumEntries[0]!.questionId;
      const edit = { questionId, expectedVersion: 1, fields: { ...fields, correction: 'Incrementar' }, requestId: 'edition' };
      a.saveMuseum(edit); expect(() => a.saveMuseum({ ...edit, fields })).toThrow('otro contenido');
      a.createOpportunity({ fields: opportunity, requestId: 'opportunity' }); const opportunityId = a.getSnapshot().opportunities[0]!.id;
      const feedback = { opportunityId, kind: 'outdated' as const, text: 'Revisar fecha', requestId: 'report' };
      a.sendOpportunityFeedback(feedback); expect(() => a.sendOpportunityFeedback({ ...feedback, text: 'Otra corrección' })).toThrow('otro contenido');
      expect(a.getSnapshot().opportunityFeedback).toHaveLength(1);
    } finally { a.dispose(); }
  });
});
