/**
 * Ayudas del agente personal (7.13) que todavía no usan Gemini. Las fuentes, el perfil, el
 * borrador y la originalidad se guardan desde AG-3 (servidor o simulación); la ayuda por
 * etapas y las sugerencias siguen calculándose en el navegador hasta AG-4.
 */
import { compareWithPublished, proseSentences, type AgentSourceKind, type AgentSuggestionInput, type OriginalityThresholds } from '@b20/core';
import type { AgentOriginalityMatch, AgentStyleSnapshotRow } from './agentTypes';
import type { Assignment, Id, Snapshot } from './types';

export interface AgentStyleCandidate { key: string; kind: AgentSourceKind; refId: Id; title: string; text: string; coauthored: boolean; version: number }
type Style = AgentStyleSnapshotRow['features'] | undefined;
const sentences = proseSentences;

export function agentStyleCandidates(data: Snapshot): AgentStyleCandidate[] {
  const me = data.me?.id; if (!me) return [];
  const assignmentTitle = (id: Id) => data.assignments.find((a) => a.id === id)?.title ?? 'Tarea';
  const activityTitle = (id: Id) => data.activities.find((a) => a.id === id)?.title ?? 'Actividad';
  return [
    ...data.works.filter((w) => !w.withdrawnAt && w.authorIds.includes(me) && w.description.trim()).map((w) => ({ key: `work:${w.id}`, kind: 'work' as const, refId: w.id, title: w.title || assignmentTitle(w.assignmentId), text: w.description, coauthored: w.authorIds.length > 1, version: w.version })),
    ...data.evidences.filter((e) => !e.withdrawnAt && e.authorId === me && e.content.trim()).map((e) => ({ key: `evidence:${e.id}`, kind: 'evidence' as const, refId: e.id, title: `Evidencia · ${activityTitle(e.activityId)}`, text: e.content, coauthored: false, version: e.version ?? 1 })),
    ...data.notes.filter((n) => !n.withdrawnAt && n.authorId === me && n.source === 'student' && n.body.trim()).map((n) => ({ key: `note:${n.id}`, kind: 'note' as const, refId: n.id, title: `Nota · ${n.title}`, text: n.body, coauthored: false, version: n.version })),
  ];
}

/** Ayuda simulada por etapa; en AG-4b la producirá Gemini con el perfil y la consigna. */
export function simulateHelp(stage: 'understand' | 'approach' | 'outline', assignment: Assignment, style: Style): string[] {
  const parts = sentences(assignment.instructions); const topic = assignment.topic || assignment.title;
  const voice = style ? `Lo escribirías en ${style.structure.toLocaleLowerCase('es-MX')}, con frases de unas ${style.sentenceLength} palabras.` : 'Todavía no conozco tu estilo: entréname con tus trabajos para adaptar estas pistas.';
  if (stage === 'understand') return [`La consigna pide trabajar «${topic}».`, ...parts.slice(0, 3).map((s) => `Punto clave: ${s}`), '¿Qué parte de la consigna te parece menos clara? Escríbela con tus palabras antes de empezar.'];
  if (stage === 'approach') return ['Antes de escribir, anota qué ya sabes del tema y qué necesitas investigar.', `Busca en tus notas de «${topic}» un ejemplo propio que puedas explicar.`, 'Decide qué idea quieres defender o demostrar; eso guía el resto del trabajo.', voice];
  return ['1. Introducción: qué vas a resolver y por qué importa.', `2. Desarrollo: explica «${topic}» con tu ejemplo propio.`, ...parts.slice(0, 2).map((s, i) => `${i + 3}. Responde: ${s}`), `${Math.min(parts.length, 2) + 3}. Conclusión: qué aprendiste y qué te costó.`, voice];
}

/** Sugerencias simuladas sobre el borrador de la persona: nunca reescriben el texto completo. */
export function simulateReview(draft: string, style: Style): AgentSuggestionInput[] {
  const limit = Math.max(18, (style?.sentenceLength ?? 20) + 8); const result: AgentSuggestionInput[] = [];
  for (const sentence of sentences(draft)) {
    const count = sentence.split(/\s+/).length;
    if (count > limit && sentence.includes(', ')) { const at = sentence.indexOf(', ', Math.floor(sentence.length / 2) - 20); if (at > 0) result.push({ reason: `Frase de ${count} palabras; sueles escribir de ${style?.sentenceLength ?? 'unas 20'}. Divídela para que se lea como tú.`, original: sentence, replacement: `${sentence.slice(0, at)}. ${sentence[at + 2]!.toLocaleUpperCase('es-MX')}${sentence.slice(at + 3)}` }); }
    const repeated = /\b(\p{L}{4,})\s+\1\b/iu.exec(sentence); if (repeated) result.push({ reason: `Se repite «${repeated[1]}».`, original: repeated[0], replacement: repeated[1]! });
  }
  if (!/\b(por ejemplo|ejemplo)\b/i.test(draft) && draft.trim()) result.push({ reason: 'No encontré un ejemplo propio. Añade uno con tus palabras; no lo escribiré por ti.', original: '', replacement: '' });
  return result;
}

/**
 * Parecido con lo que el grupo ya publicó, sin contar el texto de la consigna. Es la misma
 * selección que `publishedForComparison` del módulo: no incluye lo propio ni lo retirado.
 */
export function agentOriginality(draft: string, data: Snapshot, assignment?: Assignment, thresholds?: Partial<OriginalityThresholds>): AgentOriginalityMatch[] {
  const me = data.me?.id; if (!me || !draft.trim()) return [];
  const name = (id: Id) => data.members.find((m) => m.id === id)?.displayName ?? 'Compañero';
  const published = [
    ...data.works.filter((w) => !w.withdrawnAt && !w.authorIds.includes(me) && w.description.trim()).map((w) => ({ refKey: `work:${w.id}`, title: w.title || data.assignments.find((a) => a.id === w.assignmentId)?.title || 'Trabajo', authorName: w.authorIds.map(name).join(', '), text: w.description })),
    ...data.evidences.filter((e) => !e.withdrawnAt && e.authorId !== me && !e.participantIds.includes(me) && e.content.trim()).map((e) => ({ refKey: `evidence:${e.id}`, title: 'Evidencia', authorName: name(e.authorId), text: e.content })),
  ];
  return compareWithPublished(draft, published, { ignore: assignment ? [assignment.title, assignment.instructions] : [], thresholds })
    .map(({ refKey, title, authorName, result }) => ({ refKey, title, authorName, status: result.status, score: result.score, level: result.level, pairs: result.pairs, excluded: result.excluded }));
}
