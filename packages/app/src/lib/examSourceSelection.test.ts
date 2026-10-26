import { expect, it } from 'vitest';
import type { AiPreparation } from '@b20/core';
import { examSourceSelection } from './examSourceSelection';
it('reprepara variantes uniendo selecciones explícitas sin duplicar la fuente ni modificar el historial', () => {
  const base: AiPreparation['sources'][number] = { kind: 'question', refId: '1', version: 1, subjectId: '1', title: 'Ciclos', visibility: 'group', fingerprint: 'one', topics: ['Ciclos'], status: 'prepared', fragmentIds: ['first'], origins: [{ kind: 'answer', refId: '10', version: 1 }] };
  const sources = [base, { ...base, fingerprint: 'two', answerIds: ['11'], transcriptionIds: ['document-2'], segmentIds: ['page-2'] }];
  const original = structuredClone(sources); const result = examSourceSelection(sources);
  expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ answerIds: ['10', '11'], transcriptionIds: ['document-2'], segmentIds: ['page-2'] });
  expect(sources).toEqual(original);
});
