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
    const authors = contributionEntries(snapshot())
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

  it('sin fechas en Ajustes ofrece los últimos 30 días y todo', () => {
    expect(leaderboardPeriods([], now).map((p) => p.id)).toEqual(['mes', 'todo']);
    const withCalendar = leaderboardPeriods(snapshot().calendar, now);
    expect(withCalendar.map((p) => p.id)).toEqual(['parcial', 'cuatrimestre', 'todo']);
  });
});
