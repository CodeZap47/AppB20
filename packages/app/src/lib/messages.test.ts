import { describe, expect, it } from 'vitest';
import { groupByDay, parseMessageText, previewText } from './messages';

const at = (day: number, hour: number, minute: number) => new Date(2026, 9, day, hour, minute);
const message = (id: string, senderId: string, sentAt: Date) => ({ id, senderId, text: id, sentAt });

describe('groupByDay', () => {
  it('separa por día y junta mensajes seguidos del mismo autor', () => {
    const days = groupByDay([
      message('a', 'ana', at(7, 10, 0)),
      message('b', 'ana', at(7, 10, 2)),
      message('c', 'luis', at(7, 10, 3)),
      message('d', 'luis', at(8, 9, 0)),
    ]);
    expect(days.map((d) => d.runs.map((r) => r.messages.map((m) => m.id)))).toEqual([
      [['a', 'b'], ['c']],
      [['d']],
    ]);
  });

  it('empieza un grupo nuevo si el autor tarda más de cinco minutos', () => {
    const [day] = groupByDay([message('a', 'ana', at(7, 10, 0)), message('b', 'ana', at(7, 10, 6))]);
    expect(day?.runs).toHaveLength(2);
  });
});

describe('parseMessageText', () => {
  it('reconoce bloques de código, código en línea y enlaces', () => {
    expect(parseMessageText('Corre `npm test`:\n```js\nconst a = 1;\n```\nlisto')).toEqual([
      {
        kind: 'text',
        parts: [
          { kind: 'plain', text: 'Corre ' },
          { kind: 'code', text: 'npm test' },
          { kind: 'plain', text: ':' },
        ],
      },
      { kind: 'code', text: 'const a = 1;' },
      { kind: 'text', parts: [{ kind: 'plain', text: 'listo' }] },
    ]);
  });

  it('no incluye la puntuación final en el enlace', () => {
    expect(parseMessageText('Mira (https://example.com/a?b=1).')).toEqual([
      {
        kind: 'text',
        parts: [
          { kind: 'plain', text: 'Mira (' },
          { kind: 'link', text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
          { kind: 'plain', text: ').' },
        ],
      },
    ]);
  });

  it('solo enlaza http y https', () => {
    const [block] = parseMessageText('javascript:alert(1) y ftp://x');
    expect(block).toEqual({
      kind: 'text',
      parts: [{ kind: 'plain', text: 'javascript:alert(1) y ftp://x' }],
    });
  });
});

describe('previewText', () => {
  it('deja una sola línea sin las marcas de código', () => {
    expect(previewText('Hola:\n```js\nconst a = 1;\n```')).toBe('Hola: const a = 1;');
  });
});
