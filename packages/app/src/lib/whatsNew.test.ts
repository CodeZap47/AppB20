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
