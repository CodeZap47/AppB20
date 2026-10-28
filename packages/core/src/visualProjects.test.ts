import { describe, expect, it } from 'vitest';
import { cleanVisualProjectInput, cleanVisualProjectLinks, cleanVisualProjectRemovedLinks, mergeVisualProjectLinks,
  cleanVisualProjectUrl, visualProjectCoverError, VISUAL_PROJECT_LIMITS, type VisualProjectLink } from './visualProjects';

describe('visual project metadata', () => {
  it('normalizes optional fields and keeps only explicit metadata', () => {
    const clean = cleanVisualProjectInput({ title: '  Hardware  ', kind: '3d', authorId: 'other', visibility: 'group',
      tags: ['RAM', 'RAM'], subjectIds: ['1', '1'], links: [{ kind: 'note', id: 'demo-note' }, { kind: 'note', id: 'demo-note' }] });
    expect(clean).toEqual({ title: 'Hardware', kind: '3d', description: '', objective: '', topic: '', tags: ['RAM'], subjectIds: ['1'],
      termId: undefined, links: [{ kind: 'note', id: 'demo-note' }], resources: [] });
  });
  it('rejects malformed and oversized input rather than silently truncating it', () => {
    for (const input of [null, [], {}, { title: 'x', kind: 'unknown' }, { title: ' ', kind: '3d' },
      { title: 'x'.repeat(VISUAL_PROJECT_LIMITS.title + 1), kind: '3d' }, { title: 'x', kind: '3d', links: [{ kind: 'answer', id: '1' }] },
      { title: 'x', kind: '3d', subjectIds: ['../1'] }]) expect(() => cleanVisualProjectInput(input)).toThrow();
  });
  it('accepts attributed HTTPS references without credentials or executable schemes', () => {
    const value = cleanVisualProjectInput({ title: 'CPU', kind: '3d', resources: [
      { label: ' CPU ', url: 'HTTPS://example.com/models/cpu?a=1#part', author: 'Ada', provider: 'Catálogo', format: 'STEP', license: 'CC BY' },
    ] });
    expect(value.resources[0]).toEqual({ label: 'CPU', url: 'https://example.com/models/cpu?a=1#part', author: 'Ada', provider: 'Catálogo', format: 'STEP', license: 'CC BY' });
    for (const url of ['javascript:alert(1)', 'data:image/png,a', 'http://example.com', 'https://user:pass@example.com/model',
      'https://example.com/ model', 'https://example.com\\@bad.test', 'https://', 'https://host:99999/model']) {
      expect(() => cleanVisualProjectUrl(url)).toThrow();
    }
  });
  it('only accepts bounded PNG, JPEG and WebP covers', () => {
    expect(visualProjectCoverError('cover.webp', 'image/webp', VISUAL_PROJECT_LIMITS.coverBytes)).toBeUndefined();
    expect(visualProjectCoverError('cover.png', 'image/png', 0)).toBeDefined();
    expect(visualProjectCoverError('cover.png', 'image/png', VISUAL_PROJECT_LIMITS.coverBytes + 1)).toBeDefined();
    expect(visualProjectCoverError('cover.svg', 'image/svg+xml', 10)).toBeDefined();
  });
  it('validates explicit reference removals without persisting them as project metadata', () => {
    const input = { title: 'CPU', kind: '3d', removedLinks: [{ kind: 'note', id: 'demo-note' }, { kind: 'note', id: 'demo-note' }] };
    expect(cleanVisualProjectRemovedLinks(input)).toEqual([{ kind: 'note', id: 'demo-note' }]);
    expect(cleanVisualProjectInput(input)).not.toHaveProperty('removedLinks');
    expect(cleanVisualProjectLinks(undefined)).toEqual([]);
    expect(() => cleanVisualProjectRemovedLinks({ removedLinks: [{ kind: 'other', id: '1' }] })).toThrow();
    expect(() => cleanVisualProjectRemovedLinks({ removedLinks: [{ kind: 'note', id: '../1' }] })).toThrow();
  });
  it('preserves omitted hidden references while allowing explicit removal and replacement', () => {
    const hidden = { kind: 'note', id: 'hidden' } as const;
    const visible = { kind: 'assignment', id: 'visible' } as const;
    const replacement = { kind: 'guide', id: 'replacement' } as const;
    const preserve = (link: VisualProjectLink) => link.id === hidden.id;
    expect(mergeVisualProjectLinks([hidden, visible], [visible], [], preserve)).toEqual([visible, hidden]);
    expect(mergeVisualProjectLinks([hidden, visible], [], [], preserve)).toEqual([hidden]);
    expect(mergeVisualProjectLinks([hidden], [replacement], [hidden], preserve)).toEqual([replacement]);
    expect(() => mergeVisualProjectLinks([hidden], [], [visible], preserve)).toThrow('no pertenece');
    expect(() => mergeVisualProjectLinks([hidden], [hidden], [hidden], preserve)).toThrow('conservar y quitar');
  });
  it('counts preserved references toward the project bound without mutating the original list', () => {
    const hidden = { kind: 'note', id: 'hidden' } as const;
    const previous = [hidden];
    const full = Array.from({ length: VISUAL_PROJECT_LIMITS.links }, (_, index): VisualProjectLink => ({ kind: 'assignment', id: String(index) }));
    expect(() => mergeVisualProjectLinks(previous, full, [], () => true)).toThrow('hasta 100');
    expect(previous).toEqual([hidden]);
  });
});
