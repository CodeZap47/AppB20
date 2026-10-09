import { describe, expect, it } from 'vitest';
import type { Evidence } from '../data/types';
import { participantsOf } from './activities';

const evidence = (id: string, activityId: string, participantIds: string[]): Evidence => ({
  id,
  activityId,
  authorId: participantIds[0] ?? '',
  participantIds,
  content: 'x',
  createdAt: new Date(2026, 9, 6),
});

describe('participantsOf', () => {
  it('junta a quienes aparecen en las evidencias sin repetir', () => {
    const evidences = [evidence('e1', 'b', ['ana', 'luis']), evidence('e2', 'b', ['eva', 'luis'])];
    expect(participantsOf('b', evidences)).toEqual(['ana', 'luis', 'eva']);
    expect(participantsOf('a', evidences)).toEqual([]);
  });
});
