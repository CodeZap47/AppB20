import { describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from '../data/demo';
import { buildNews, ownFeedNews, type NewsItem } from './whatsNew';
import { feedInteractionTarget } from './feedInteractionTargets';

describe('referencias de conversación y enlaces del feed', () => {
  it('conserva la conversación de la pregunta cuando se presenta como Museo de bugs', () => {
    const item: NewsItem = { key: 'bug', kind: 'museo', actorId: 'author', subjectId: 'subject', text: '', link: '/m/preguntas/5', at: new Date(), resource: { kind: 'museum', id: '5' }, target: { kind: 'question', id: '5' } };
    expect(feedInteractionTarget(item)).toEqual({ kind: 'question', id: '5' });
  });
  it('cada aviso del catálogo real obtiene un recurso, incluyendo propios, fechas y ranking', () => {
    const source = new DemoDataSource(createDemoState(), 'demo-1');
    try {
      const data = source.getSnapshot();
      const news = [...buildNews(data), ...ownFeedNews(data)];
      expect(news.some((item) => item.kind === 'ranking')).toBe(true);
      expect(news.some((item) => item.kind === 'publicacion')).toBe(true);
      for (const item of news) expect(feedInteractionTarget(item), `${item.kind}: ${item.key}`).toBeDefined();
      const question = news.find((item) => item.kind === 'pregunta')!;
      const resolved = news.find((item) => item.kind === 'resuelta' && item.target?.id === question.target?.id);
      if (resolved) expect(feedInteractionTarget(resolved)).toEqual(feedInteractionTarget(question));
    } finally { source.dispose(); }
  });
});
