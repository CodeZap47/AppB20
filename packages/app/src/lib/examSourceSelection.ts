import type { AiPreparation, AiSourceRef } from '@b20/core';

/** A fresh preparation combines reviewed selections; historical snapshots stay distinct. */
export function examSourceSelection(sources: AiPreparation['sources']): AiSourceRef[] {
  const result = new Map<string, AiSourceRef>();
  for (const source of sources) {
    const key = `${source.kind}:${source.refId}`; const previous = result.get(key);
    const answers = source.kind === 'question' ? source.answerIds ?? source.origins.filter((origin) => origin.kind === 'answer').map((origin) => origin.refId) : undefined;
    const merge = (left?: string[], right?: string[]) => left === undefined && right === undefined ? undefined : [...new Set([...(left ?? []), ...(right ?? [])])];
    result.set(key, { kind: source.kind, refId: source.refId, topics: merge(previous?.topics, source.topics)!,
      includeUnplaced: previous?.includeUnplaced === true || !source.termId,
      ...(answers !== undefined ? { answerIds: merge(previous?.answerIds, answers) } : {}),
      ...(source.transcriptionIds || previous?.transcriptionIds ? { transcriptionIds: merge(previous?.transcriptionIds, source.transcriptionIds) } : {}),
      ...(source.segmentIds || previous?.segmentIds ? { segmentIds: merge(previous?.segmentIds, source.segmentIds) } : {}) });
  }
  return [...result.values()];
}
