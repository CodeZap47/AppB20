import { describe, expect, it } from 'vitest';
import { emptyPresentationObservations, presentationGuidingQuestions } from '@b20/core';
import { createDemoState, DemoDataSource } from './demo';
import type { PresentationPracticeInput } from './presentationTypes';

const at = new Date('2026-10-21T12:00:00Z');
const subjectId = 'IDSE-05010103';
const configuration = { title: 'Mi exposición', topic: 'Decisiones', audience: 'Primer cuatrimestre', targetMinutes: 3, keyPoints: ['Condiciones', 'Ejemplos'] };
const setup = (viewer = 'demo-2') => {
  const state = createDemoState(at); const data = new DemoDataSource(state, viewer, () => new Date(at)); return { state, data };
};
const create = (data: DemoDataSource, fields: Partial<PresentationPracticeInput> = {}) => data.savePresentationPractice({ ...configuration, subjectId, requestId: 'create', ...fields });
const practice = (data: DemoDataSource, id: string) => data.getSnapshot().presentationPractices.find((row) => row.id === id)!;
const attempt = (data: DemoDataSource, id: string) => data.getSnapshot().presentationAttempts.find((row) => row.id === id)!;
const start = (data: DemoDataSource, practiceId: string, requestId = 'attempt') => data.createPresentationAttempt(practiceId, requestId, practice(data, practiceId).version);
const input = { ...emptyPresentationObservations(), body: 'La condición permite elegir. Por ejemplo, si llueve, llevamos paraguas.', clarity: 'Observación estrictamente privada', nextSteps: 'Mi plan privado' };
const finish = (data: DemoDataSource, id: string) => { data.savePresentationAttempt(id, input, attempt(data, id).version); data.completePresentationAttempt(id, attempt(data, id).version); };

describe('Exposiciones en la demo', () => {
  it('crea configuración y un intento separado, conserva historial y vuelve a practicar con texto anterior', () => {
    const { data } = setup(); const id = create(data); expect(practice(data, id)).toMatchObject({ ...configuration, version: 1 });
    expect(data.getSnapshot().presentationAttempts.filter((row) => row.practiceId === id)).toEqual([]);
    const first = start(data, id); expect(practice(data, id).version).toBe(2); expect(attempt(data, first)).toMatchObject({ status: 'draft', number: 1, version: 1, body: '' });
    finish(data, first); const prior = structuredClone(attempt(data, first));
    const second = start(data, id, 'second'); expect(attempt(data, second)).toMatchObject({ number: 2, status: 'draft', body: input.body, version: 1 });
    expect(data.getSnapshot().presentationPersonal.find((row) => row.attemptId === second)).toMatchObject({ ...emptyPresentationObservations(), nextSteps: '' });
    data.savePresentationAttempt(second, { ...input, body: 'Nueva explicación' }, 1);
    expect(attempt(data, first)).toEqual(prior);
  });
  it('fotografía la configuración y fuente de cada intento; los cambios no alteran el anterior', () => {
    const { data } = setup(); const id = create(data, { source: { kind: 'note', id: 'n1' } }); const first = start(data, id); finish(data, first);
    data.savePresentationPractice({ ...configuration, id, subjectId, title: 'Nueva configuración privada', keyPoints: ['Otro punto'], expectedVersion: 2, requestId: 'edit' });
    const second = start(data, id, 'second'); expect(attempt(data, first)).toMatchObject({ ...configuration, sourceId: 'n1', sourceVersion: 1 });
    expect(attempt(data, second)).toMatchObject({ title: 'Nueva configuración privada', keyPoints: ['Otro punto'] });
    expect(attempt(data, second).sourceId).toBeUndefined();
  });
  it('solo expone al compañero invitado los intentos completados y la configuración completada', () => {
    const { data } = setup(); const id = create(data); const first = start(data, id);
    data.setPresentationReviewer(id, 'demo-3', 2); data.setViewer('demo-3');
    expect(data.getSnapshot().presentationPractices.some((row) => row.id === id)).toBe(false);
    data.setViewer('demo-2'); finish(data, first);
    data.savePresentationPractice({ ...configuration, id, subjectId, title: 'Borrador oculto', expectedVersion: 3, requestId: 'edit' });
    const second = start(data, id, 'second'); data.savePresentationAttempt(second, { ...input, body: 'Explicación en borrador secreta' }, 1);
    data.setViewer('demo-3'); expect(practice(data, id).title).toBe(configuration.title);
    expect(data.getSnapshot().presentationAttempts.filter((row) => row.practiceId === id).map((row) => row.id)).toEqual([first]);
    expect(data.getSnapshot().presentationPersonal.find((row) => row.attemptId === first)).toBeUndefined();
    expect(JSON.stringify(data.getSnapshot().presentationPractices)).not.toContain('Borrador oculto');
    expect(JSON.stringify(data.getSnapshot().presentationAttempts)).not.toContain('secreta');
    expect(() => data.savePresentationAttempt(first, input, 3)).toThrow('acceso');
  });
  it('ni los administradores ni otros integrantes reciben observaciones personales o prácticas privadas', () => {
    const { data } = setup(); const id = create(data); const first = start(data, id); finish(data, first);
    for (const viewer of ['demo-1', 'demo-4']) { data.setViewer(viewer);
      expect(data.getSnapshot().presentationPractices.find((row) => row.id === id)).toBeUndefined();
      expect(data.getSnapshot().presentationPersonal.find((row) => row.attemptId === first)).toBeUndefined();
      expect(() => data.askPresentationQuestion(first, 'Pregunta', 'peer')).toThrow('acceso');
      expect(() => data.createPresentationAttempt(id, 'attempt-third', 2)).toThrow('acceso');
    }
  });
  it('oculta la referencia a una nota personal al revisor y admite notas/guías de la misma materia', () => {
    const { data } = setup('demo-3');
    const id = create(data, { subjectId: 'IDSE-05010104', source: { kind: 'note', id: 'n2' } }); const first = start(data, id); finish(data, first);
    data.setPresentationReviewer(id, 'demo-2', 2); data.setViewer('demo-2');
    expect(practice(data, id)).not.toHaveProperty('sourceId'); expect(attempt(data, first)).not.toHaveProperty('sourceId');
    data.setViewer('demo-3'); expect(practice(data, id).sourceId).toBe('n2');
    const guide = data.getSnapshot().guides[0]!; const guidePractice = create(data, { requestId: 'guide', subjectId: guide.subjectId, source: { kind: 'guide', id: guide.id } });
    expect(practice(data, guidePractice).sourceVersion).toBe(guide.version);
  });
  it('rechaza fuentes inaccesibles, referencias ajenas, parciales cruzados y datos no válidos sin filas parciales', () => {
    const { data } = setup(); const before = data.getSnapshot().presentationPractices.length;
    expect(() => create(data, { source: { kind: 'note', id: 'n2' } })).toThrow('fuente');
    expect(() => create(data, { source: { kind: 'note', id: 'missing' } })).toThrow('fuente');
    expect(() => create(data, { source: { kind: 'note', id: 'n3' } })).toThrow('materia');
    expect(() => create(data, { termId: 'IDSE-05010104-p1' })).toThrow('parcial');
    expect(() => create(data, { title: ' ' })).toThrow('obligatorio'); expect(() => create(data, { targetMinutes: 0 })).toThrow('duración');
    expect(() => create(data, { requestId: '' })).toThrow('envío'); expect(data.getSnapshot().presentationPractices).toHaveLength(before);
  });
  it('versiona cambios y bloquea doble borrador/concurrencia sin alterar contenido', () => {
    const { data } = setup(); const id = create(data); const first = start(data, id);
    expect(() => data.createPresentationAttempt(id, 'concurrent', 1)).toThrow('versión');
    expect(() => data.createPresentationAttempt(id, 'second-draft', 2)).toThrow('borrador');
    data.savePresentationAttempt(first, input, 1); expect(() => data.savePresentationAttempt(first, { ...input, body: 'Perdida' }, 1)).toThrow('versión');
    expect(attempt(data, first).body).toBe(input.body);
    expect(() => data.setPresentationReviewer(id, 'demo-3', 1)).toThrow('versión');
    expect(() => data.archivePresentationPractice(id, true, 1)).toThrow('versión');
  });
  it('deduplica altas con identificación y contenido y rechaza reutilizar un envío diferente', () => {
    const { data } = setup(); const id = create(data); expect(create(data)).toBe(id);
    expect(() => create(data, { title: 'Otro título' })).toThrow('otro contenido');
    const first = data.createPresentationAttempt(id, 'attempt', 1); expect(data.createPresentationAttempt(id, 'attempt', 1)).toBe(first);
    expect(() => data.createPresentationAttempt(id, 'attempt', 2)).toThrow('otro contenido');
    finish(data, first); const question = data.askPresentationQuestion(first, 'Mi pregunta', 'question');
    expect(data.askPresentationQuestion(first, ' Mi pregunta ', 'question')).toBe(question);
    expect(() => data.askPresentationQuestion(first, 'Otra pregunta', 'question')).toThrow('otro contenido');
    expect(data.getSnapshot().presentationQuestions.filter((row) => row.id === question)).toHaveLength(1);
  });
  it('genera cinco preguntas una sola vez y conserva cuerpos completados e historial de respuestas', () => {
    const { data } = setup(); const id = create(data); const first = start(data, id);
    expect(() => data.completePresentationAttempt(first, 1)).toThrow('obligatorio'); finish(data, first);
    data.completePresentationAttempt(first, 2); data.completePresentationAttempt(first, 3);
    const questions = data.getSnapshot().presentationQuestions.filter((row) => row.attemptId === first);
    expect(questions.map((row) => row.text)).toEqual(presentationGuidingQuestions(configuration));
    expect(() => data.savePresentationAttempt(first, input, 3)).toThrow('conserva');
    data.answerPresentationQuestion(questions[0]!.id, 'Mi respuesta', 1);
    expect(() => data.answerPresentationQuestion(questions[0]!.id, 'Respuesta perdida', 1)).toThrow('versión');
    expect(data.getSnapshot().presentationQuestions.find((row) => row.id === questions[0]!.id)).toMatchObject({ answer: 'Mi respuesta', version: 2, answeredAt: at });
  });
  it('permite preguntas propias y del revisor y solo el autor puede responder', () => {
    const { data } = setup(); const id = create(data); const first = start(data, id);
    const draftQuestion = data.askPresentationQuestion(first, 'Antes', 'before'); data.answerPresentationQuestion(draftQuestion, 'Borrador propio', 1); finish(data, first);
    const personal = data.askPresentationQuestion(first, 'Pregunta propia', 'own'); expect(data.getSnapshot().presentationQuestions.find((row) => row.id === personal)?.kind).toBe('personal');
    data.setPresentationReviewer(id, 'demo-3', 2); data.setViewer('demo-3');
    const peer = data.askPresentationQuestion(first, 'Pregunta del compañero', 'peer');
    expect(data.getSnapshot().presentationQuestions.find((row) => row.id === peer)?.kind).toBe('peer');
    expect(() => data.answerPresentationQuestion(peer, 'Respuesta', 1)).toThrow('acceso');
    data.setViewer('demo-2'); data.answerPresentationQuestion(peer, 'Respuesta del autor', 1); data.setViewer('demo-3');
    expect(data.getSnapshot().presentationQuestions.find((row) => row.id === peer)?.answer).toBe('Respuesta del autor');
  });
  it('versiona retroalimentación del revisor y conserva revisiones anteriores solo para el autor', () => {
    const { data } = setup(); const id = create(data); const first = start(data, id); finish(data, first);
    expect(() => data.savePresentationFeedback(first, { ...emptyPresentationObservations(), comment: 'Comentario' })).toThrow('revisor');
    data.setPresentationReviewer(id, 'demo-3', 2); data.setViewer('demo-3');
    const feedback = { ...emptyPresentationObservations(), clarity: 'Está claro', comment: 'Primera revisión' };
    data.savePresentationFeedback(first, feedback); expect(() => data.savePresentationFeedback(first, feedback)).toThrow('versión');
    data.savePresentationFeedback(first, { ...feedback, comment: 'Comentario actualizado' }, 1);
    data.setViewer('demo-2'); data.setPresentationReviewer(id, 'demo-4', 3); data.setViewer('demo-4');
    expect(data.getSnapshot().presentationFeedback.find((row) => row.attemptId === first)).toBeUndefined();
    data.savePresentationFeedback(first, { ...feedback, comment: 'Revisión nueva' });
    data.setViewer('demo-2'); expect(data.getSnapshot().presentationFeedback.filter((row) => row.attemptId === first)).toHaveLength(2);
    data.setViewer('demo-3'); expect(data.getSnapshot().presentationAttempts.some((row) => row.id === first)).toBe(false);
  });
  it('archivar conserva historial del propietario y retira al revisor; puede restaurarse sin borrar', () => {
    const { data } = setup(); const id = create(data); const first = start(data, id); finish(data, first); data.setPresentationReviewer(id, 'demo-3', 2);
    data.archivePresentationPractice(id, true, 3); expect(practice(data, id).archived).toBe(true); expect(attempt(data, first).body).toBe(input.body);
    expect(() => start(data, id, 'second')).toThrow('archivada'); data.setViewer('demo-3');
    expect(data.getSnapshot().presentationPractices.some((row) => row.id === id)).toBe(false);
    expect(() => data.askPresentationQuestion(first, 'Pregunta', 'question')).toThrow('acceso');
    data.setViewer('demo-2'); data.archivePresentationPractice(id, false, 4); data.setViewer('demo-3'); expect(practice(data, id)).toBeUndefined();
    data.setViewer('demo-2'); data.setPresentationReviewer(id, 'demo-3', 5); data.setViewer('demo-3'); expect(practice(data, id)).toBeDefined();
  });
  it('la baja de cualquiera revoca permisos y una sesión cerrada elimina la copia local', () => {
    const { data } = setup(); const id = create(data); const first = start(data, id); finish(data, first); data.setPresentationReviewer(id, 'demo-3', 2);
    data.setViewer('demo-1'); data.removeMember('demo-3'); data.setViewer('demo-3');
    expect(data.getSnapshot().presentationPractices).toEqual([]); expect(() => data.askPresentationQuestion(first, 'Pregunta', 'q')).toThrow('miembro activo');
    data.setViewer('demo-2'); expect(() => data.setPresentationReviewer(id, 'demo-3', 3)).toThrow('integrante activo'); data.setPresentationReviewer(id, 'demo-4', 3);
    data.setViewer('demo-1'); data.removeMember('demo-2'); data.setViewer('demo-4'); expect(data.getSnapshot().presentationPractices.some((row) => row.id === id)).toBe(false);
    data.dispose(); expect(data.getSnapshot().presentationPractices).toEqual([]); expect(() => data.savePresentationPractice({ ...configuration, subjectId, requestId: 'after-close' })).toThrow('terminó');
  });
  it('reserva las cinco preguntas guiadas y aplica los límites sin bloquear reintentos existentes', () => {
    const { data } = setup(); const id = create(data); const first = start(data, id);
    for (let i = 0; i < 95; i++) data.askPresentationQuestion(first, `Pregunta ${i}`, `q-${i}`);
    expect(() => data.askPresentationQuestion(first, 'Exceso', 'excess')).toThrow('100 preguntas');
    finish(data, first); expect(data.getSnapshot().presentationQuestions.filter((row) => row.attemptId === first)).toHaveLength(100);
    expect(() => data.askPresentationQuestion(first, 'Exceso', 'excess')).toThrow('100 preguntas');
    expect(data.askPresentationQuestion(first, 'Pregunta 0', 'q-0')).toBeDefined();
  });
  it('limita a cien intentos y doscientas prácticas por autor, conservando reintentos de altas', () => {
    const { data } = setup(); const id = create(data);
    for (let i = 0; i < 100; i++) { const item = start(data, id, `attempt-${i}`); finish(data, item); }
    expect(() => start(data, id, 'attempt-100')).toThrow('100 intentos');
    for (let i = 1; i < 200; i++) create(data, { requestId: `practice-${i}` });
    expect(() => create(data, { requestId: 'practice-200' })).toThrow('200 exposiciones');
    expect(create(data)).toBe(id);
  });
  it('un envío no puede reutilizarse en otra práctica o intento y las fuentes cambiadas de materia se ocultan al revisor', () => {
    const { data } = setup(); const id = create(data, { source: { kind: 'note', id: 'n1' } }); const first = start(data, id); finish(data, first);
    const otherPractice = create(data, { requestId: 'other' });
    expect(() => data.createPresentationAttempt(otherPractice, 'attempt', 1)).toThrow('otro contenido');
    const second = start(data, otherPractice, 'other-attempt'); finish(data, second);
    data.askPresentationQuestion(first, 'Pregunta', 'question'); expect(() => data.askPresentationQuestion(second, 'Pregunta', 'question')).toThrow('otro contenido');
    data.setPresentationReviewer(id, 'demo-3', 2);
    const note = data.getSnapshot().notes.find((row) => row.id === 'n1')!;
    data.saveNote({ ...note, subjectId: 'IDSE-05010104' });
    expect(attempt(data, first).sourceId).toBe('n1'); data.setViewer('demo-3');
    expect(practice(data, id)).not.toHaveProperty('sourceId'); expect(attempt(data, first)).not.toHaveProperty('sourceId');
  });
  it('rechaza fuentes retiradas e intentos nuevos, conserva el historial y oculta la referencia al revisor', () => {
    const { data } = setup(); const id = create(data, { source: { kind: 'note', id: 'n1' } }); const first = start(data, id); finish(data, first);
    data.setPresentationReviewer(id, 'demo-3', 2);
    const note = data.getSnapshot().notes.find((row) => row.id === 'n1')!;
    data.withdrawContent('note', note.id, true, note.version);
    expect(() => create(data, { requestId: 'retired-note', source: { kind: 'note', id: note.id } })).toThrow('fuente');
    expect(() => start(data, id, 'retired-attempt')).toThrow('retirada');
    expect(attempt(data, first)).toMatchObject({ body: input.body, sourceId: note.id, sourceVersion: note.version });
    data.setViewer('demo-3'); expect(attempt(data, first)).not.toHaveProperty('sourceId'); expect(practice(data, id)).not.toHaveProperty('sourceId');
    data.setViewer('demo-2'); data.savePresentationPractice({ ...configuration, id, subjectId, expectedVersion: 3, requestId: 'remove-reference' });
    expect(start(data, id, 'without-reference')).toBeDefined();
    const guide = data.getSnapshot().guides[0]!; data.setViewer('demo-1'); data.withdrawContent('guide', guide.id, true, guide.version, 'Retirada de prueba');
    expect(() => create(data, { requestId: 'retired-guide', subjectId: guide.subjectId, source: { kind: 'guide', id: guide.id } })).toThrow('fuente');
  });
  it('no publica notas, novedades, puntos ni otro contenido comunitario al practicar', () => {
    const { data } = setup(); const before = data.getSnapshot(); const id = create(data); const first = start(data, id); finish(data, first);
    const after = data.getSnapshot(); for (const key of ['notes', 'questions', 'answers', 'activities', 'revisions', 'groupMessages', 'guides'] as const) expect(after[key]).toEqual(before[key]);
  });
  it('purga la referencia de IA pendiente y conserva el esquema que el autor ya aceptó', async () => {
    const { data } = setup(); const id = create(data, { source: { kind: 'note', id: 'n1' } }); const first = start(data, id);
    const features = data.presentationFeatures;
    const prepared = await features.prepare({ id: 'outline-accepted', attemptId: first, expectedVersion: 1, purpose: 'outline' });
    const generated = await features.generate(prepared, 'generation-accepted');
    const accepted = await features.accept(generated, { outline: 'Esquema propio revisado.', orientative: true });
    const pending = await features.prepare({ id: 'outline-pending', attemptId: first, expectedVersion: attempt(data, first).version, purpose: 'outline' });
    await features.generate(pending, 'generation-pending');
    features.purgeSource('note', 'n1');
    expect(await features.get(pending.id)).toMatchObject({ state: 'cancelled', result: undefined });
    expect(await features.generate(pending, 'late-generation')).toMatchObject({ state: 'cancelled', result: undefined });
    expect(await features.get(accepted.id)).toMatchObject({ state: 'accepted', result: { outline: 'Esquema propio revisado.' } });
    expect(attempt(data, first).body).toBe('Esquema propio revisado.');
    const revision = (await features.get(pending.id)).revision; features.purgeSource('note', 'n1');
    expect((await features.get(pending.id)).revision).toBe(revision);
  });
});
