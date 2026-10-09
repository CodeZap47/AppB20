import { describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from '../data/demo';
import { birthdaysToday, buildNews, summarizeNews, unreadMessages, upcomingDue } from './whatsNew';

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
  });

  it('resume en una frase con singular y plural', () => {
    expect(summarizeNews([item('nota'), item('nota'), item('fecha'), item('respuesta')])).toBe(
      '1 cambio de fecha, 2 apuntes y 1 respuesta',
    );
    expect(summarizeNews([])).toBe('');
  });

  it('cuenta mensajes ajenos desde la última visita', () => {
    const data = new DemoDataSource(createDemoState(), 'demo-3');
    const snapshot = data.getSnapshot();
    const all = unreadMessages(snapshot, undefined);
    expect(all.group).toBe(snapshot.groupMessages.filter((m) => m.senderId !== 'demo-3').length);
    expect(all.direct.every((d) => d.otherId !== 'demo-3')).toBe(true);
    expect(unreadMessages(snapshot, new Date(Date.now() + 60_000)).group).toBe(0);
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
