import { FEED_RESOURCE_KINDS, type FeedResourceRef } from '@b20/core';
import type { NewsItem } from './whatsNew';

/** Cada aviso usa el recurso original; nunca crea una publicación paralela. */
export function feedInteractionTarget(item: NewsItem): FeedResourceRef | undefined {
  // El museo presenta una pregunta con una etiqueta propia, pero mantiene su conversación.
  const ref = item.resource && (FEED_RESOURCE_KINDS as readonly string[]).includes(item.resource.kind)
    ? item.resource : item.target;
  if (!ref || !(FEED_RESOURCE_KINDS as readonly string[]).includes(ref.kind)) return undefined;
  return { kind: ref.kind as FeedResourceRef['kind'], id: ref.id };
}
