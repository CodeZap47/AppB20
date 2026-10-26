import { describe, expect, it } from 'vitest';
import type { ExamSummary } from '@b20/core';
import { createDemoState, DemoDataSource } from '../data/demo';
import type { Snapshot } from '../data/types';
import { getFeedPresentation } from './feedPresentation';
import { buildNews, ownFeedNews, type NewsItem, type NewsKind } from './whatsNew';

const at = new Date('2026-10-26T12:00:00Z');
const snapshot = () => new DemoDataSource(createDemoState(), 'demo-1').getSnapshot();
const item = (kind: NewsKind, id: string, targetKind?: NonNullable<NewsItem['target']>['kind']): NewsItem => ({
  key: `test-${id}`, kind, actorId: 'demo-2', subjectId: 's1', at, link: '/', text: 'Este texto no contiene datos del recurso',
  target: targetKind ? { kind: targetKind, id } : undefined, resource: targetKind ? undefined : { kind, id },
});
const common = { authorId: 'demo-2', requestId: 'shared', version: 1, createdAt: at, updatedAt: at };

function moduleSnapshot(): Snapshot {
  const data = snapshot();
  data.codingChallenges = [{ ...common, id: 'challenge', subjectId: 's1', title: 'Sumar listas', topic: 'Listas', difficulty: 'advanced', objective: 'Entender el acumulador', instructions: 'Explica tu solución', examples: '[1,2] → 3', hintCount: 1, closed: false, closure: '' }];
  data.challengeSolutions = [{ ...common, id: 'solution', challengeId: 'challenge', body: 'return values.reduce(sum)', explanation: 'Recorre todos los elementos' }];
  data.codeReviews = [{ ...common, id: 'review', subjectId: 's1', title: 'Revisión de suma', language: 'TypeScript', currentVersion: 2, closed: false }];
  data.codeReviewVersions = [1, 2].map((number) => ({ reviewId: 'review', number, code: number === 1 ? 'antes\nlinea exacta\nfin' : 'despues', repositoryUrl: '', summary: `Contexto ${number}`, requestId: `version-${number}`, createdAt: at }));
  data.codeReviewComments = [{ ...common, id: 'comment', reviewId: 'review', versionNumber: 1, lineStart: 2, lineEnd: 2, kind: 'error', body: 'Observa el índice', status: 'applied', resolution: 'Corregido' }];
  data.questions.push({ id: 'museum', subjectId: 's1', topic: 'Listas', title: 'Un bucle infinito', body: 'Pregunta original', status: 'open', authorId: 'demo-2', createdAt: at });
  data.museumEntries = [{ ...common, questionId: 'museum', updatedBy: 'demo-2', intention: 'Iterar', symptom: 'El bucle no termina', cause: 'Índice fijo', correction: 'Incrementar', learning: 'Revisar la condición', minimalCode: 'while (true) {}', evidence: '', language: 'TypeScript', topic: 'Listas', bugType: 'Bucle infinito', noteIds: [], questionIds: [] }];
  data.opportunities = [{ ...common, id: 'opportunity', updatedBy: 'demo-2', kind: 'scholarship', title: 'Beca de programación', topic: 'Programación', modality: 'online', sourceUrl: 'https://example.com/beca', organizer: 'Universidad', requirements: 'Estudiantes activos', deadline: '2027-01-01T00:00:00Z', costKnown: true, cost: 'Gratis', withdrawn: false, withdrawalReason: '' }];
  data.studyRooms = [{ id: 'room', title: 'Repaso de listas', subjectId: 's1', topic: 'Listas', objective: 'Practicar juntos', startsAt: at, endsAt: new Date(at.getTime() + 3_600_000), capacity: 2, visibility: 'group', organizerId: 'demo-2', status: 'scheduled', version: 1, createdAt: at, updatedAt: at, participantCount: 2, requestId: 'room' }];
  return data;
}

describe('presentación estructurada del feed', () => {
  it('distingue tarea, actividad, exposición y examen académico sin interpretar el aviso', () => {
    const data = snapshot(); const assignment = data.assignments[0]!;
    const labels = ['Tarea', 'Actividad académica', 'Exposición', 'Examen académico'];
    (['tarea', 'actividad', 'exposicion', 'examen'] as const).forEach((kind, index) => {
      data.assignments = [{ ...assignment, id: 'assignment', kind, title: 'Título real', instructions: 'Instrucciones reales', dueDate: '2026-10-30' }];
      const result = getFeedPresentation(item('tarea', 'assignment', 'assignment'), data);
      expect(result).toMatchObject({ layout: 'assignment', label: labels[index], title: 'Título real', excerpt: 'Instrucciones reales', status: 'Con fecha de entrega' });
      expect(result.facts.find((entry) => entry.label === 'Entrega')?.value).toContain('2026');
    });
  });

  it('compara las fechas de la revisión concreta e indica la retirada sin inventar fechas', () => {
    const data = snapshot(); const assignment = data.assignments[0]!;
    data.revisions = [1, 2].map((version) => ({ id: `date-${version}`, page: 'assignment', pageId: assignment.id, title: assignment.title, summary: '', body: '', version, editedBy: 'demo-2', editedAt: at, dueDate: version === 1 ? '2026-10-30' : undefined }));
    data.assignments = [{ ...assignment, dueDate: undefined }];
    const result = getFeedPresentation({ ...item('fecha', assignment.id, 'assignment'), key: 'fdate-2' }, data);
    expect(result).toMatchObject({ layout: 'date', status: 'Fecha retirada', dateChange: { after: undefined } });
    expect(result.dateChange?.before).toBe('2026-10-30');
    expect(result.facts).toContainEqual({ label: 'Entrega vigente', value: 'Sin fecha' });
  });

  it('muestra archivos y autores, sin duplicar adjuntos antiguos ni resucitar los retirados', () => {
    const data = snapshot(); const work = { id: 'work', assignmentId: data.assignments[0]!.id, title: 'Mi entrega', description: 'Trabajo final', status: 'final' as const, version: 1, authorIds: ['demo-2', 'demo-3'], createdAt: at, updatedAt: at };
    data.works = [work];
    const file = { name: 'Entrega.pdf', size: 1024, contentType: 'application/pdf', uploadedBy: 'demo-2', createdAt: at };
    data.workFiles = [{ ...file, id: 'old', workId: work.id }, { ...file, id: 'removed', workId: work.id }];
    data.resourceFiles = [{ ...file, id: 'legacy:old', targetKind: 'work', targetId: work.id }, { ...file, id: 'legacy:removed', targetKind: 'work', targetId: work.id, removedAt: at }];
    const result = getFeedPresentation(item('trabajo', work.id, 'work'), data);
    expect(result.layout).toBe('submission');
    expect(result.files).toEqual([{ id: 'legacy:old', name: 'Entrega.pdf', size: 1024, contentType: 'application/pdf' }]);
    expect(result.facts.find((entry) => entry.label === 'Autores')?.value).toBeTruthy();
    data.resourceFiles = []; data.workFiles = [];
    expect(getFeedPresentation(item('trabajo', work.id, 'work'), data).files).toEqual([]);
  });

  it('explica el origen público de notas de prácticas y salas, conservando una sola nota', () => {
    const data = snapshot(); const note = data.notes.find((entry) => entry.visibility === 'group')!;
    for (const [tag, label] of [['aprende-ensenando', 'Aprende enseñando'], ['sala-de-estudio', 'Sala de estudio']]) {
      data.notes = [{ ...note, tags: [tag!, 'Vectores'] }];
      const result = getFeedPresentation(item('nota', note.id, 'note'), data);
      expect(result).toMatchObject({ layout: 'document', eyebrow: label, excerpt: note.body });
      expect(result.tags).toContain(label);
      expect(result.tags).not.toContain(tag);
    }
  });

  it('preguntas, respuestas y guías exponen contexto, aceptación, temas y fuentes reales', () => {
    const data = snapshot(); const question = data.questions[0]!;
    data.questions = [{ ...question, id: 'question', status: 'resolved', acceptedAnswerId: 'answer', resolvedAt: at }];
    data.answers = [{ id: 'answer', questionId: 'question', authorId: 'demo-2', body: 'Respuesta aceptada real', createdAt: at }, { id: 'withdrawn', questionId: 'question', authorId: 'demo-2', body: 'Retirada', createdAt: at, withdrawnAt: at }];
    const questionView = getFeedPresentation(item('pregunta', 'question', 'question'), data);
    expect(questionView).toMatchObject({ layout: 'question', status: 'Resuelta' });
    expect(questionView.facts).toContainEqual({ label: 'Respuestas', value: '1' });
    expect(getFeedPresentation(item('resuelta', 'question', 'question'), data).blocks).toEqual([{ label: 'Respuesta aceptada', text: 'Respuesta aceptada real' }]);
    expect(getFeedPresentation(item('respuesta', 'answer', 'answer'), data)).toMatchObject({ layout: 'answer', status: 'Aceptada', title: question.title });
    const guide = data.guides[0]!;
    const guideView = getFeedPresentation(item('guia', guide.id, 'guide'), data);
    expect(guideView.bullets).toEqual(guide.topics);
    expect(guideView.facts).toContainEqual({ label: 'Fuentes', value: String(data.guideSources.filter((entry) => entry.guideId === guide.id).length) });
  });

  it('presenta opciones y selección nominal, modalidad de ayuda y tarjetas de repaso', () => {
    const data = snapshot(); const poll = data.polls[0]!;
    data.pollVotes = [{ pollId: poll.id, voterId: data.me!.id, choices: [0], votedAt: at }];
    const pollView = getFeedPresentation(item('votacion', poll.id, 'poll'), data);
    expect(pollView.tags).toContain('Voto nominal');
    expect(pollView.bullets).toEqual(poll.options);
    expect(pollView.facts).toContainEqual({ label: 'Tu selección', value: poll.options[0] });
    const help = data.helpPosts.find((entry) => entry.status === 'open')!;
    data.helpPosts = [{ ...help, kind: 'offer', availability: 'Lunes por la tarde' }];
    expect(getFeedPresentation(item('ayuda', help.id, 'help'), data)).toMatchObject({ label: 'Puedo ayudarte', facts: expect.arrayContaining([{ label: 'Disponibilidad', value: 'Lunes por la tarde' }]) });
    data.helpPosts[0]!.kind = 'request';
    expect(getFeedPresentation(item('ayuda', help.id, 'help'), data).label).toBe('Necesito ayuda');
    const collection = data.spacedCollections.find((entry) => entry.visibility === 'group' && !entry.archived)!;
    expect(getFeedPresentation(item('repaso', collection.id, 'spaced'), data).facts).toContainEqual({ label: 'Tarjetas compartidas', value: String(data.spacedCards.filter((entry) => entry.collectionId === collection.id && !entry.archived).length) });
  });

  it('distingue reto, solución, revisión y observación sobre su versión y líneas originales', () => {
    const data = moduleSnapshot();
    expect(getFeedPresentation(item('reto', 'challenge'), data)).toMatchObject({ layout: 'challenge', status: 'Abierto', blocks: [{ label: 'Objetivo', text: 'Entender el acumulador' }] });
    expect(getFeedPresentation(item('solucion', 'solution'), data)).toMatchObject({ layout: 'code', code: 'return values.reduce(sum)', excerpt: 'Recorre todos los elementos' });
    expect(getFeedPresentation(item('revision', 'review'), data)).toMatchObject({ layout: 'code', code: 'despues', excerpt: 'Contexto 2' });
    const comment = getFeedPresentation(item('observacion', 'comment'), data);
    expect(comment).toMatchObject({ layout: 'code', status: 'Aplicada', code: 'linea exacta', excerpt: 'Observa el índice' });
    expect(comment.facts).toContainEqual({ label: 'Versión', value: '1' });
    expect(comment.facts).toContainEqual({ label: 'Ubicación', value: 'Línea 2' });
  });

  it('presenta síntoma y aprendizaje del museo, plazos de oportunidades y cupo de salas', () => {
    const data = moduleSnapshot();
    const museum = getFeedPresentation(item('museo', 'museum'), data);
    expect(museum).toMatchObject({ layout: 'museum', title: 'Un bucle infinito', code: 'while (true) {}' });
    expect(museum.blocks).toEqual([{ label: 'Síntoma', text: 'El bucle no termina' }, { label: 'Aprendizaje', text: 'Revisar la condición' }]);
    expect(museum.tags).toEqual(expect.arrayContaining(['TypeScript', 'Bucle infinito']));
    const opportunity = getFeedPresentation(item('oportunidad', 'opportunity'), data);
    expect(opportunity).toMatchObject({ layout: 'opportunity', label: 'Beca', eyebrow: 'Universidad' });
    expect(opportunity.facts).toContainEqual({ label: 'Costo', value: 'Gratis' });
    const room = getFeedPresentation(item('sala', 'room'), data);
    expect(room).toMatchObject({ layout: 'room', status: 'Programada' });
    expect(room.facts).toContainEqual({ label: 'Plazas disponibles', value: '0' });
    data.studyRooms[0]!.capacity = undefined;
    expect(getFeedPresentation(item('sala', 'room'), data).facts).toContainEqual({ label: 'Plazas disponibles', value: 'Sin límite' });
  });

  it('usa exclusivamente el resumen aprobado del examen y no datos privados del autor', () => {
    const data = snapshot();
    const exam: ExamSummary = { id: 'exam', revision: 2, title: 'Versión aprobada', subjectId: 's1', ownerId: data.me!.id, visibility: 'group', archived: false, readyVersion: 1, questionCount: 5, topics: ['Tema aprobado'], createdAt: at.getTime(), updatedAt: at.getTime(), canEdit: false, sourceIssues: [] };
    const view = getFeedPresentation(item('examen', 'exam'), data, [exam]);
    expect(view).toMatchObject({ layout: 'exam', title: 'Versión aprobada', bullets: ['Tema aprobado'], status: 'Versión aprobada' });
    expect(view.facts).toContainEqual({ label: 'Preguntas', value: '5' });
    expect(getFeedPresentation(item('examen', 'exam'), data, [{ ...exam, visibility: 'personal', title: 'Título privado' }]).title).not.toBe('Título privado');
  });

  it('permite extractos completos para Ver más y devuelve tarjetas seguras para recursos ausentes', () => {
    const data = snapshot(); const note = data.notes.find((entry) => entry.visibility === 'group')!; const long = 'Contenido largo '.repeat(500);
    data.notes = [{ ...note, body: long, title: 'Título muy largo '.repeat(20) }];
    expect(getFeedPresentation(item('nota', note.id, 'note'), data).excerpt).toBe(long);
    const before = JSON.stringify(data);
    for (const kind of ['tarea', 'fecha', 'trabajo', 'evidencia', 'actividad', 'nota', 'pregunta', 'respuesta', 'resuelta', 'guia', 'votacion', 'ayuda', 'repaso', 'reto', 'solucion', 'revision', 'observacion', 'museo', 'oportunidad', 'sala', 'examen', 'publicacion'] as const) {
      const view = getFeedPresentation(item(kind, 'missing'), data);
      expect(view.title).toBeTruthy(); expect(view.excerpt).toBeUndefined(); expect(view.facts).toEqual([]);
    }
    expect(JSON.stringify(data)).toBe(before);
  });

  it('todos los avisos del demo resuelven una composición y el logro usa puntos estructurados', () => {
    const data = snapshot(); const news = [...buildNews(data), ...ownFeedNews(data)];
    const views = news.map((entry) => getFeedPresentation(entry, data));
    expect(views.every((view) => view.label && view.title && view.cta)).toBe(true);
    const ranking = news.find((entry) => entry.kind === 'ranking');
    if (!ranking) throw new Error('El demo debe incluir una llegada al primer lugar');
    const view = getFeedPresentation(ranking, data);
    expect(view.layout).toBe('achievement');
    expect(Number(view.facts.find((entry) => entry.label === 'Puntos')?.value)).toBeGreaterThan(0);
  });
});
