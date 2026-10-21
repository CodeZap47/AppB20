import { describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from '../data/demo';
import { buildLeaderboard, contributionEntries, leaderboardPeriods } from './contributions';

const now = new Date(2026, 9, 9, 12);
const snapshot = (viewer = 'demo-1') =>
  new DemoDataSource(createDemoState(now), viewer).getSnapshot();

describe('contribuciones del grupo', () => {
  it('no cuenta apuntes personales, mensajes ni preguntas', () => {
    const data = snapshot('demo-3');
    const refs = new Set(contributionEntries(data).map((e) => e.refId));
    expect(refs.has('n2')).toBe(false);
    expect(data.groupMessages.some((m) => refs.has(m.id))).toBe(false);
    expect(data.questions.some((q) => refs.has(q.id))).toBe(false);
  });

  it('da los puntos de un trabajo en equipo a cada autor', () => {
    const data = snapshot();
    data.works.find((work) => work.id === 'w3')!.status = 'final';
    const authors = contributionEntries(data)
      .filter((e) => e.kind === 'trabajo' && e.refId === 'w3')
      .map((e) => e.memberId);
    expect(authors.sort()).toEqual(['demo-2', 'demo-3', 'demo-4']);
  });

  it('cada punto lleva al registro que lo generó', () => {
    const accepted = contributionEntries(snapshot()).find((e) => e.kind === 'respuesta-aceptada');
    expect(accepted?.link).toMatch(/^\/m\/preguntas\//);
  });

  it('la segunda respuesta en la misma pregunta aparece pero no suma', () => {
    const board = buildLeaderboard(snapshot(), {});
    const demo6 = board.find((s) => s.memberId === 'demo-6');
    const answers = demo6?.events.filter((e) => e.kind === 'respuesta') ?? [];
    expect(answers.map((e) => e.points).sort()).toEqual([0, 4]);
  });

  it('ordena el leaderboard de mayor a menor', () => {
    const board = buildLeaderboard(snapshot(), {});
    const totals = board.map((s) => s.points);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    expect(board[0]?.rank).toBe(1);
  });

  it('excluye borradores y retirados; restaurarlos recupera el mismo aporte una sola vez', () => {
    const data = snapshot();
    const work = data.works[0]!;
    const before = buildLeaderboard(data, {});
    work.withdrawnAt = now;
    expect(contributionEntries(data).some((event) => event.kind === 'trabajo' && event.refId === work.id)).toBe(false);
    delete work.withdrawnAt;
    expect(buildLeaderboard(data, {})).toEqual(before);
    work.status = 'draft';
    expect(contributionEntries(data).some((event) => event.kind === 'trabajo' && event.refId === work.id)).toBe(false);
  });

  it('las respuestas y comentarios de contenido retirado dejan de sumar', () => {
    const data = snapshot();
    data.questions.forEach((question) => { question.withdrawnAt = now; });
    data.notes.forEach((note) => { note.withdrawnAt = now; });
    const events = contributionEntries(data);
    expect(events.some((event) => ['apunte', 'comentario', 'respuesta', 'respuesta-aceptada'].includes(event.kind))).toBe(false);
  });

  it('no vuelve a puntuar una fuente que se agrega dos veces a la misma guía', () => {
    const data = snapshot();
    const source = data.guideSources.find((entry) => entry.status === 'processed')!;
    expect(source).toBeDefined();
    data.guideSources.push({ ...source, id: 'duplicate-source' });
    const entries = buildLeaderboard(data, {}).flatMap((standing) => standing.events).filter((event) => event.kind === 'fuente' && event.memberId === source.addedBy && event.limitKey === `${source.guideId}:${source.kind}:${source.refId}`);
    expect(entries.reduce((total, entry) => total + entry.points, 0)).toBe(2);
  });

  it('las notas idénticas del mismo autor y contexto conservan el primer crédito al cambiar de ID o periodo', () => {
    const data = snapshot();
    const original = { ...data.notes.find((note) => note.visibility === 'group')!, id: 'original-note', authorId: 'demo-1', title: '  Código  ', body: 'const x = 1;\r\nreturn x;', createdAt: new Date(2026, 9, 1) };
    data.notes = [original, { ...original, id: 'copied-note', title: 'Código', body: 'const x = 1;\nreturn x;\n', createdAt: new Date(2026, 9, 20) }, { ...original, id: 'other-author-note', authorId: 'demo-2', createdAt: new Date(2026, 9, 21) }];
    const all = buildLeaderboard(data, {});
    expect(all.find((member) => member.memberId === 'demo-1')?.events.filter((event) => event.kind === 'apunte').map((event) => event.points).sort()).toEqual([0, 8]);
    expect(all.find((member) => member.memberId === 'demo-2')?.events.filter((event) => event.kind === 'apunte').map((event) => event.points)).toEqual([8]);
    const thisPeriod = buildLeaderboard(data, { from: new Date(2026, 9, 15) });
    expect(thisPeriod.find((member) => member.memberId === 'demo-1')?.events.filter((event) => event.kind === 'apunte').map((event) => event.points)).toEqual([0]);
  });

  it('no normaliza mayúsculas ni espacios internos del código', () => {
    const data = snapshot(); const note = { ...data.notes.find((entry) => entry.visibility === 'group')!, authorId: 'demo-1' };
    data.notes = [{ ...note, id: 'code-upper', body: 'const value = "A";' }, { ...note, id: 'code-lower', body: 'const value = "a";' }, { ...note, id: 'code-spacing', body: 'const  value = "A";' }];
    expect(buildLeaderboard(data, {}).find((member) => member.memberId === 'demo-1')?.events.filter((event) => event.kind === 'apunte').map((event) => event.points)).toEqual([8, 8, 8]);
  });

  it('las guías, trabajos y evidencias copiados no suman de nuevo y el contexto separa materiales distintos', () => {
    const data = snapshot();
    const guide = { ...data.guides[0]!, id: 'original-guide', createdBy: 'demo-1' };
    data.guides = [guide, { ...guide, id: 'copied-guide' }];
    const work = { ...data.works[0]!, id: 'original-work', authorIds: ['demo-1'], description: 'La misma solución', status: 'final' as const };
    data.works = [work, { ...work, id: 'copied-work' }, { ...work, id: 'different-context-work', assignmentId: 'other-assignment' }];
    data.resourceFiles = []; data.workFiles = [];
    const evidence = { ...data.evidences[0]!, id: 'original-evidence', authorId: 'demo-1', participantIds: [], content: 'La misma evidencia' };
    data.evidences = [evidence, { ...evidence, id: 'copied-evidence' }];
    const events = buildLeaderboard(data, {}).find((member) => member.memberId === 'demo-1')!.events;
    expect(events.filter((event) => event.kind === 'guia').map((event) => event.points).sort()).toEqual([0, 15]);
    expect(events.filter((event) => event.kind === 'trabajo').map((event) => event.points).sort()).toEqual([0, 10, 10]);
    expect(events.filter((event) => event.kind === 'evidencia').map((event) => event.points).sort()).toEqual([0, 5]);
  });

  it('dos trabajos basados en archivos distintos no se consideran iguales por compartir título y tamaño', () => {
    const data = snapshot(); const work = { ...data.works[0]!, title: 'Trabajo adjunto', description: '', authorIds: ['demo-1'], status: 'final' as const };
    data.works = [{ ...work, id: 'file-work-1' }, { ...work, id: 'file-work-2' }];
    data.resourceFiles = [
      { id: 'file-1', targetKind: 'work', targetId: 'file-work-1', name: 'trabajo.pdf', size: 10, contentType: 'application/pdf', uploadedBy: 'demo-1', createdAt: now },
      { id: 'file-2', targetKind: 'work', targetId: 'file-work-2', name: 'trabajo.pdf', size: 10, contentType: 'application/pdf', uploadedBy: 'demo-1', createdAt: now },
    ];
    expect(buildLeaderboard(data, {}).find((member) => member.memberId === 'demo-1')?.events.filter((event) => event.kind === 'trabajo').map((event) => event.points)).toEqual([10, 10]);
  });

  it('retirar y restaurar el original no mueve el crédito al clon ni cambia el ranking entre personas', async () => {
    const state = createDemoState(now);
    const original = { ...state.notes.find((note) => note.visibility === 'group')!, id: 'original-shared-note', authorId: 'demo-1', body: 'Un contenido completo que no debe copiarse al desglose', version: 1, createdAt: new Date(2026, 9, 1) };
    state.notes = [original, { ...original, id: 'later-copy', createdAt: new Date(2026, 9, 20) }];
    const author = new DemoDataSource(state, 'demo-1', () => now); const peer = new DemoDataSource(state, 'demo-2', () => now);
    const pointsFor = (source: DemoDataSource) => buildLeaderboard(source.getSnapshot(), {}).find((member) => member.memberId === 'demo-1')!.events.filter((event) => event.kind === 'apunte').reduce((total, event) => total + event.points, 0);
    expect(pointsFor(author)).toBe(8); expect(pointsFor(peer)).toBe(8);
    expect(JSON.stringify(contributionEntries(peer.getSnapshot()))).not.toContain(original.body);
    await author.withdrawContent('note', original.id, true, 1);
    expect(peer.getSnapshot().notes.map((note) => note.id)).toEqual(['later-copy']);
    expect(pointsFor(author)).toBe(0); expect(pointsFor(peer)).toBe(0);
    const origin = peer.getSnapshot().contributionOrigins.find((entry) => entry.refId === 'later-copy')!;
    expect(origin.duplicateOf).toBe(original.id); expect(origin.creditedAt).toEqual(original.createdAt);
    expect(buildLeaderboard(peer.getSnapshot(), { from: new Date(2026, 9, 15) }).find((member) => member.memberId === 'demo-1')!.events.filter((event) => event.kind === 'apunte').reduce((total, event) => total + event.points, 0)).toBe(0);
    await author.withdrawContent('note', original.id, false, 2);
    expect(pointsFor(author)).toBe(8); expect(pointsFor(peer)).toBe(8);
    author.dispose(); peer.dispose();
  });

  it('los apuntes personales no reservan crédito ni dejan identificadores privados en los orígenes grupales', () => {
    const state = createDemoState(now); const note = state.notes.find((entry) => entry.visibility === 'group')!;
    state.notes = [{ ...note, id: 'private-origin', authorId: 'demo-1', visibility: 'personal', createdAt: new Date(2026, 8, 1) }, { ...note, id: 'public-copy', authorId: 'demo-1', visibility: 'group', createdAt: new Date(2026, 9, 20) }];
    const peer = new DemoDataSource(state, 'demo-2'); const data = peer.getSnapshot();
    expect(data.contributionOrigins.find((origin) => origin.refId === 'public-copy')).toMatchObject({ duplicateOf: undefined, creditedAt: new Date(2026, 9, 20) });
    expect(JSON.stringify(data.contributionOrigins)).not.toContain('private-origin');
    peer.dispose();
  });

  it('sin fechas en Ajustes ofrece los últimos 30 días y todo', () => {
    expect(leaderboardPeriods([], now).map((p) => p.id)).toEqual(['mes', 'todo']);
    const withCalendar = leaderboardPeriods(snapshot().calendar, now);
    expect(withCalendar.map((p) => p.id)).toEqual(['parcial', 'cuatrimestre', 'todo']);
  });
});
