import { describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from '../data/demo';
import { buildNews } from './whatsNew';

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
});
