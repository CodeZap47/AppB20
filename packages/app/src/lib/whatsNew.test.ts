import { describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from '../data/demo';
import { birthdaysToday, buildNews, ownFeedNews, summarizeNews, unreadMessages, upcomingDue } from './whatsNew';

describe('buildNews', () => {
  it('no incluye lo propio ni notas personales ajenas', () => {
    const data = new DemoDataSource(createDemoState(), 'demo-2');
    const news = buildNews(data.getSnapshot());
    expect(news.every((n) => n.actorId !== 'demo-2')).toBe(true);
    expect(news.some((n) => n.key === 'nn2')).toBe(false);
  });

  it('ordena de lo más reciente a lo más antiguo', () => {
    const data = new DemoDataSource(createDemoState(), 'demo-1');
    const times = buildNews(data.getSnapshot()).map((n) => n.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('avisa cuando una edición movió la fecha de entrega, sin repetirla como edición', () => {
    const data = new DemoDataSource(createDemoState(), 'demo-1');
    const news = buildNews(data.getSnapshot());
    const change = news.find((n) => n.kind === 'fecha');
    expect(change?.actorId).toBe('demo-3');
    expect(change?.text).toContain('cambió la entrega de «Tarea de prueba 1» al');
    expect(news.some((n) => n.key === 'tt1')).toBe(false);
  });

  it('avisa cuando alguien quita la fecha de entrega', () => {
    const data = new DemoDataSource(createDemoState(), 'demo-2');
    const t1 = data.getSnapshot().assignments.find((a) => a.id === 't1')!;
    data.updateAssignment('t1', { ...t1, dueDate: undefined });
    data.setViewer('demo-1');
    const latest = buildNews(data.getSnapshot()).find((n) => n.kind === 'fecha');
    expect(latest?.text).toBe('quitó la fecha de entrega de «Tarea de prueba 1»');
  });

  it('incluye guías, ayuda y repaso compartido; solo votaciones abiertas', () => {
    const snapshot = new DemoDataSource(createDemoState(), 'demo-1').getSnapshot();
    const now = new Date();
    snapshot.polls = [
      { ...snapshot.polls[0]!, id: 'open-poll', createdBy: 'demo-2', closesAt: new Date(now.getTime() + 60_000) },
      { ...snapshot.polls[0]!, id: 'closed-poll', createdBy: 'demo-2', closesAt: new Date(now.getTime() - 60_000) },
      { ...snapshot.polls[0]!, id: 'cancelled-poll', createdBy: 'demo-2', closesAt: new Date(now.getTime() + 60_000), cancelledAt: now },
    ];
    snapshot.spacedCollections = [
      { id: 'private-collection', ownerId: 'demo-2', title: 'Privada', subjectId: 's1', visibility: 'personal', version: 1, archived: false, createdAt: now, updatedAt: now, updatedBy: 'demo-2' },
      { id: 'public-collection', ownerId: 'demo-2', title: 'Compartida', subjectId: 's1', visibility: 'group', version: 1, archived: false, createdAt: now, updatedAt: now, updatedBy: 'demo-2' },
    ];
    const news = buildNews(snapshot, now);
    expect(news.filter((item) => item.kind === 'votacion').map((item) => item.key)).toEqual(['popen-poll']);
    expect(news.filter((item) => item.kind === 'repaso').map((item) => item.key)).toEqual(['srspublic-collection']);
    expect(news.some((item) => item.kind === 'guia')).toBe(true);
    expect(news.some((item) => item.text.includes('Privada'))).toBe(false);
  });

  it('oculta retirados incluso para su autor y no resume información personal de prácticas', () => {
    const snapshot = new DemoDataSource(createDemoState(), 'demo-1').getSnapshot();
    snapshot.notes.forEach((note) => { note.withdrawnAt = new Date(); });
    snapshot.works.forEach((work) => { work.withdrawnAt = new Date(); });
    snapshot.guides.forEach((guide) => { guide.withdrawnAt = new Date(); });
    const news = buildNews(snapshot);
    expect(news.some((item) => ['nota', 'trabajo', 'guia'].includes(item.kind))).toBe(false);
    expect(news.some((item) => item.link.includes('ensenar'))).toBe(false);
  });
});

describe('notas de clase y lo propio en el feed', () => {
  it('tus notas compartidas salen en el feed propio, nunca en buildNews ni las personales', () => {
    const data = new DemoDataSource(createDemoState(), 'demo-2');
    const snapshot = data.getSnapshot();
    const shared = snapshot.notes.filter((n) => n.authorId === 'demo-2' && n.visibility === 'group' && !n.withdrawnAt);
    const personal = snapshot.notes.filter((n) => n.authorId === 'demo-2' && n.visibility !== 'group');
    const own = ownFeedNews(snapshot).filter((n) => n.kind === 'nota');
    expect(own.map((n) => n.target?.id).sort()).toEqual(shared.map((n) => n.id).sort());
    expect(own.every((n) => n.selfText?.includes('la nota de clase'))).toBe(true);
    expect(own.some((n) => personal.some((p) => p.id === n.target?.id))).toBe(false);
    expect(buildNews(snapshot).some((n) => n.kind === 'nota' && n.actorId === 'demo-2')).toBe(false);
  });

  it('el #1 del ranking es un aviso sin reacciones que enlaza al leaderboard', () => {
    const news = buildNews(new DemoDataSource(createDemoState(), 'demo-1').getSnapshot());
    const ranking = news.filter((n) => n.kind === 'ranking');
    expect(ranking.every((n) => !n.target && n.link === '/m/leaderboard' && /#1 del ranking/.test(n.text))).toBe(true);
  });
});

describe('resumen y paneles de «¿Qué me perdí?»', () => {
  const item = (kind: Parameters<typeof summarizeNews>[0][number]['kind']) => ({
    key: kind + Math.random(),
    kind,
    subjectId: undefined,
    actorId: 'x',
    text: '',
    link: '',
    at: new Date(),
    target: { kind: 'note' as const, id: 'x' },
  });

  it('resume en una frase con singular y plural', () => {
    expect(summarizeNews([item('nota'), item('nota'), item('fecha'), item('respuesta')])).toBe(
      '1 cambio de fecha, 2 notas de clase y 1 respuesta',
    );
    expect(summarizeNews([])).toBe('');
  });

  it('cuenta mensajes ajenos desde la última visita', () => {
    const data = new DemoDataSource(createDemoState(), 'demo-3');
    const snapshot = data.getSnapshot();
    const all = unreadMessages(snapshot, undefined);
    expect(all.group).toBe(snapshot.groupMessages.filter((m) => m.senderId !== 'demo-3' && !m.deletedAt).length);
    expect(all.direct.every((d) => d.otherId !== 'demo-3')).toBe(true);
    // Marcar las novedades como vistas no marca las conversaciones como leídas.
    expect(unreadMessages(snapshot, new Date(Date.now() + 60_000)).group).toBe(all.group);
    snapshot.conversationStates = [{ scope: 'group', conversationId: 'general', readThroughId: snapshot.groupMessages.at(-1)?.id, muted: false }];
    expect(unreadMessages(snapshot).group).toBe(0);
  });

  it('lista entregas próximas y cumpleaños de hoy', () => {
    const now = new Date(2026, 9, 9, 18);
    const base = { subjectId: 's', kind: 'tarea', instructions: '', version: 1 } as const;
    const due = upcomingDue(
      [
        { ...base, id: 'a', title: 'Pasada', dueDate: '2026-10-08' },
        { ...base, id: 'b', title: 'Hoy', dueDate: '2026-10-09' },
        { ...base, id: 'c', title: 'Lejana', dueDate: '2026-10-30' },
        { ...base, id: 'd', title: 'Sin fecha' },
      ].map((a) => ({ ...a, createdBy: 'x', createdAt: now, updatedBy: 'x', updatedAt: now })),
      now,
    );
    expect(due.map((d) => [d.assignment.id, d.inDays])).toEqual([['b', 0]]);
    const today = birthdaysToday(
      [
        { memberId: 'a', day: 9, month: 10, remind: true },
        { memberId: 'b', day: 10, month: 10, remind: true },
      ],
      now,
    );
    expect(today.map((b) => b.memberId)).toEqual(['a']);
  });
});

describe('catálogo compartido de todos los módulos', () => {
  function fixture() {
    const snapshot = new DemoDataSource(createDemoState(), 'demo-1').getSnapshot();
    const at = new Date('2026-10-26T12:00:00Z');
    const common = { authorId: 'demo-2', requestId: 'shared', version: 1, createdAt: at, updatedAt: at };
    snapshot.codingChallenges = [{ ...common, id: 'challenge', subjectId: 's1', title: 'Reto compartido', topic: 'Listas', difficulty: 'basic', objective: 'Sumar', instructions: 'Sumar elementos', examples: '1+1=2', hintCount: 0, closed: false, closure: '' }];
    snapshot.challengeSolutions = [{ ...common, id: 'solution', challengeId: 'challenge', body: 'sum()', explanation: 'Acumula' }, { ...common, id: 'orphan', challengeId: 'missing', body: 'Secreto huérfano', explanation: '' }];
    snapshot.codeReviews = [{ ...common, id: 'review', subjectId: 's1', title: 'Revisar bucle', language: 'TS', currentVersion: 1, closed: false }];
    snapshot.codeReviewComments = [{ ...common, id: 'comment', reviewId: 'review', versionNumber: 1, lineStart: 1, lineEnd: 1, kind: 'suggestion', body: 'Simplificar', status: 'pending', resolution: '' }];
    const question = { id: 'museum-question', subjectId: 's1', topic: 'Listas', title: 'Bug compartido', body: 'Contexto', authorId: 'demo-2', status: 'open' as const, createdAt: at };
    snapshot.questions.push(question);
    snapshot.museumEntries = [{ ...common, questionId: question.id, updatedBy: 'demo-2', intention: 'Sumar', symptom: 'No termina', cause: 'Índice fijo', correction: '', learning: 'Incrementar', minimalCode: '', evidence: '', language: 'TS', topic: 'Listas', bugType: 'Bucle', noteIds: [], questionIds: [] }];
    snapshot.opportunities = [{ ...common, id: 'opportunity', updatedBy: 'demo-2', kind: 'course', title: 'Curso compartido', topic: 'Listas', modality: 'online', sourceUrl: 'https://example.com/course', organizer: 'Escuela', requirements: 'Ninguno', costKnown: true, cost: 'Gratis', withdrawn: false, withdrawalReason: '' }];
    snapshot.studyRooms = [{ id: 'room', title: 'Sala compartida', subjectId: 's1', topic: 'Listas', objective: 'Repasar', startsAt: at, endsAt: new Date(at.getTime() + 3_600_000), capacity: 2, visibility: 'group', organizerId: 'demo-2', status: 'scheduled', version: 1, createdAt: at, updatedAt: at, participantCount: 1, requestId: 'room' }];
    const exam = { id: 'exam', revision: 1, title: 'Examen aprobado', subjectId: 's1', ownerId: 'demo-2', visibility: 'group' as const, archived: false, readyVersion: 1, questionCount: 3, topics: ['Listas'], createdAt: at.getTime(), updatedAt: at.getTime(), canEdit: false, sourceIssues: [] };
    return { snapshot, exam, at };
  }

  it('incluye todos los módulos nuevos con recursos estables y conserva objetivos de reacciones', () => {
    const { snapshot, exam, at } = fixture();
    const news = buildNews(snapshot, at, [exam]);
    for (const kind of ['reto', 'solucion', 'revision', 'observacion', 'museo', 'oportunidad', 'sala', 'examen']) expect(news.some((item) => item.kind === kind)).toBe(true);
    const museum = news.filter((item) => item.key === 'qmuseum-question');
    expect(museum).toHaveLength(1);
    expect(museum[0]).toMatchObject({ kind: 'museo', target: { kind: 'question', id: 'museum-question' } });
    expect(news.filter((item) => ['reto', 'solucion', 'revision', 'observacion', 'oportunidad', 'sala', 'examen'].includes(item.kind)).every((item) => item.resource && !item.target)).toBe(true);
    expect(news.some((item) => item.resource?.id === 'orphan')).toBe(false);
    expect(news.find((item) => item.kind === 'observacion')?.link).toBe('/m/revision-codigo/review?observacion=comment');
    const updated = snapshot.codingChallenges[0]!; updated.version++; updated.title = 'Reto actualizado'; updated.updatedAt = new Date(at.getTime() + 1);
    expect(buildNews(snapshot, at, [exam]).filter((item) => item.key === 'chchallenge')).toHaveLength(1);
    expect(buildNews(snapshot, at, [exam]).find((item) => item.key === 'chchallenge')?.text).toContain('Reto actualizado');
  });

  it('todo aporte de la persona activa aparece una sola vez en lo propio y no cuenta como ajeno', () => {
    const { snapshot, exam, at } = fixture();
    snapshot.me = snapshot.members.find((entry) => entry.id === 'demo-2');
    const own = ownFeedNews(snapshot, at, [exam]);
    expect(new Set(own.map((item) => item.key)).size).toBe(own.length);
    for (const kind of ['reto', 'solucion', 'revision', 'observacion', 'museo', 'oportunidad', 'sala', 'examen']) expect(own.some((item) => item.kind === kind)).toBe(true);
    expect(own.every((item) => item.selfText && /^(cambiaste|quitaste|editaste|creaste|subiste|compartiste|actualizaste|registraste|preguntaste|respondiste|aceptaste|publicaste|abriste|organizaste|llegaste|empataste)/.test(item.selfText))).toBe(true);
    expect(buildNews(snapshot, at, [exam]).every((item) => item.actorId !== 'demo-2')).toBe(true);
    snapshot.me = { ...snapshot.me!, status: 'removed' };
    expect(ownFeedNews(snapshot, at, [exam])).toEqual([]);
  });

  it('descarta salas privadas, oportunidades retiradas y exámenes privados, archivados o sin aprobar', () => {
    const { snapshot, exam, at } = fixture();
    snapshot.studyRooms.push({ ...snapshot.studyRooms[0]!, id: 'private-room', visibility: 'private', title: 'Sala privada' });
    snapshot.opportunities.push({ ...snapshot.opportunities[0]!, id: 'withdrawn', withdrawn: true, title: 'Retirada' });
    const exams = [exam, { ...exam, id: 'private', visibility: 'personal' as const }, { ...exam, id: 'archive', archived: true }, { ...exam, id: 'draft', readyVersion: undefined }];
    const items = [...buildNews(snapshot, at, exams), ...ownFeedNews(snapshot, at, exams)];
    expect(items.filter((item) => item.kind === 'sala').map((item) => item.resource?.id)).toEqual(['room']);
    expect(items.filter((item) => item.kind === 'oportunidad').map((item) => item.resource?.id)).toEqual(['opportunity']);
    expect(items.filter((item) => item.kind === 'examen').map((item) => item.resource?.id)).toEqual(['exam']);
    snapshot.questions.find((entry) => entry.id === 'museum-question')!.withdrawnAt = at;
    expect(buildNews(snapshot, at, exams).some((item) => item.kind === 'museo')).toBe(false);
  });

  it('las notas publicadas desde prácticas y salas aparecen una vez, sin exponer su origen privado', () => {
    const { snapshot, at } = fixture();
    const note = snapshot.notes.find((entry) => entry.visibility === 'group')!;
    snapshot.notes = [{ ...note, id: 'teaching-note', authorId: 'demo-2', tags: ['aprende-ensenando'] }, { ...note, id: 'room-note', authorId: 'demo-2', tags: ['sala-de-estudio'] }, { ...note, id: 'private-note', authorId: 'demo-2', visibility: 'personal' }];
    const news = buildNews(snapshot, at);
    expect(news.filter((item) => item.kind === 'nota').map((item) => item.key).sort()).toEqual(['nroom-note', 'nteaching-note']);
    expect(news.some((item) => /aprende-ensenando|practica-privada/.test(item.link))).toBe(false);
  });
});
