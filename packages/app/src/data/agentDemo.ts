/**
 * Simulación del agente personal (7.13, AG-1). Todo se calcula en el navegador a partir de lo
 * que la persona ya puede leer: no llama a Gemini, no guarda nada en el servidor y se
 * sustituirá por las métricas y la comparación de `@b20/core` en AG-2.
 */
import type { Assignment, Id, Snapshot } from './types';

/** Porcentaje de trigramas compartidos a partir del cual se muestra la alerta. */
export const AGENT_ORIGINALITY_WARN = 25;

export type AgentSourceKind = 'work' | 'evidence' | 'note';
export interface AgentStyleCandidate { key: string; kind: AgentSourceKind; refId: Id; title: string; text: string; coauthored: boolean; updatedAt: Date }
export interface AgentStyleProfile { trainedAt: Date; sourceKeys: string[]; sentenceLength: number; words: number; tone: string; structure: string; technical: string; vocabulary: string[]; examples: string[] }
export interface AgentSuggestion { id: string; reason: string; original: string; replacement: string; state: 'proposed' | 'accepted' | 'rejected' }
export interface AgentOriginalityMatch { refKey: string; title: string; authorName: string; score: number; mine: string; theirs: string }

const STOPWORDS = new Set('a al algo ante como con de del el ella en entre es esa ese esta este hay la las lo los más me mi muy no o para pero por que se si sin sobre su sus también te tu un una uno y ya'.split(' '));
const sentences = (text: string) => text.split(/(?<=[.!?¿¡])\s+|\n+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);
const tokens = (text: string) => text.toLocaleLowerCase('es-MX').normalize('NFD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]+/gu) ?? [];

export function agentStyleCandidates(data: Snapshot): AgentStyleCandidate[] {
  const me = data.me?.id; if (!me) return [];
  const assignmentTitle = (id: Id) => data.assignments.find((a) => a.id === id)?.title ?? 'Tarea';
  const activityTitle = (id: Id) => data.activities.find((a) => a.id === id)?.title ?? 'Actividad';
  return [
    ...data.works.filter((w) => !w.withdrawnAt && w.authorIds.includes(me) && w.description.trim()).map((w) => ({ key: `work:${w.id}`, kind: 'work' as const, refId: w.id, title: w.title || assignmentTitle(w.assignmentId), text: w.description, coauthored: w.authorIds.length > 1, updatedAt: w.updatedAt })),
    ...data.evidences.filter((e) => !e.withdrawnAt && e.authorId === me && e.content.trim()).map((e) => ({ key: `evidence:${e.id}`, kind: 'evidence' as const, refId: e.id, title: `Evidencia · ${activityTitle(e.activityId)}`, text: e.content, coauthored: false, updatedAt: e.createdAt })),
    ...data.notes.filter((n) => !n.withdrawnAt && n.authorId === me && n.source === 'student' && n.body.trim()).map((n) => ({ key: `note:${n.id}`, kind: 'note' as const, refId: n.id, title: `Nota · ${n.title}`, text: n.body, coauthored: false, updatedAt: n.updatedAt })),
  ];
}

export function simulateStyleProfile(sources: AgentStyleCandidate[], now = new Date()): AgentStyleProfile {
  const text = sources.map((s) => s.text).join('\n');
  const all = sentences(text); const words = tokens(text);
  const sentenceLength = all.length ? Math.round(words.length / all.length) : 0;
  const counts = new Map<string, number>(); for (const word of text.toLocaleLowerCase('es-MX').match(/[\p{L}\p{N}]+/gu) ?? []) if (word.length > 3 && !STOPWORDS.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  const vocabulary = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([word]) => word);
  const lists = (text.match(/^\s*([-*•]|\d+[.)])\s/gm) ?? []).length; const code = /[{};=]|function|const |def |class /.test(text);
  return {
    trainedAt: now, sourceKeys: sources.map((s) => s.key), sentenceLength, words: words.length, vocabulary,
    tone: /\b(yo|creo|pienso|me|mi)\b/i.test(text) ? 'Cercano, en primera persona' : 'Impersonal y descriptivo',
    structure: lists >= 2 ? 'Usa listas y pasos numerados' : 'Párrafos corridos',
    technical: code ? 'Incluye código o notación técnica' : 'Explica con lenguaje cotidiano',
    examples: all.slice(0, 2),
  };
}

/** Ayuda simulada por etapa; en AG-4b la producirá Gemini con el perfil y la consigna. */
export function simulateHelp(stage: 'understand' | 'approach' | 'outline', assignment: Assignment, profile: AgentStyleProfile | undefined): string[] {
  const parts = sentences(assignment.instructions); const topic = assignment.topic || assignment.title;
  const voice = profile ? `Lo escribirías en ${profile.structure.toLocaleLowerCase('es-MX')}, con frases de unas ${profile.sentenceLength} palabras.` : 'Todavía no conozco tu estilo: entréname con tus trabajos para adaptar estas pistas.';
  if (stage === 'understand') return [`La consigna pide trabajar «${topic}».`, ...parts.slice(0, 3).map((s) => `Punto clave: ${s}`), '¿Qué parte de la consigna te parece menos clara? Escríbela con tus palabras antes de empezar.'];
  if (stage === 'approach') return ['Antes de escribir, anota qué ya sabes del tema y qué necesitas investigar.', `Busca en tus notas de «${topic}» un ejemplo propio que puedas explicar.`, 'Decide qué idea quieres defender o demostrar; eso guía el resto del trabajo.', voice];
  return ['1. Introducción: qué vas a resolver y por qué importa.', `2. Desarrollo: explica «${topic}» con tu ejemplo propio.`, ...parts.slice(0, 2).map((s, i) => `${i + 3}. Responde: ${s}`), `${Math.min(parts.length, 2) + 3}. Conclusión: qué aprendiste y qué te costó.`, voice];
}

/** Sugerencias simuladas sobre el borrador de la persona: nunca reescriben el texto completo. */
export function simulateReview(draft: string, profile: AgentStyleProfile | undefined): AgentSuggestion[] {
  const limit = Math.max(18, (profile?.sentenceLength ?? 20) + 8); const result: AgentSuggestion[] = [];
  for (const sentence of sentences(draft)) {
    const count = sentence.split(/\s+/).length;
    if (count > limit && sentence.includes(', ')) { const at = sentence.indexOf(', ', Math.floor(sentence.length / 2) - 20); if (at > 0) result.push({ id: `split:${result.length}`, reason: `Frase de ${count} palabras; sueles escribir de ${profile?.sentenceLength ?? 'unas 20'}. Divídela para que se lea como tú.`, original: sentence, replacement: `${sentence.slice(0, at)}. ${sentence[at + 2]!.toLocaleUpperCase('es-MX')}${sentence.slice(at + 3)}`, state: 'proposed' }); }
    const repeated = /\b(\p{L}{4,})\s+\1\b/iu.exec(sentence); if (repeated) result.push({ id: `repeat:${result.length}`, reason: `Se repite «${repeated[1]}».`, original: repeated[0], replacement: repeated[1]!, state: 'proposed' });
  }
  if (!/\b(por ejemplo|ejemplo)\b/i.test(draft) && draft.trim()) result.push({ id: 'example', reason: 'No encontré un ejemplo propio. Añade uno con tus palabras; no lo escribiré por ti.', original: '', replacement: '', state: 'proposed' });
  return result;
}

/** Parecido simulado por trigramas contra lo que el grupo ya publicó; AG-2 lo sustituye. */
export function simulateOriginality(draft: string, data: Snapshot): AgentOriginalityMatch[] {
  const me = data.me?.id; const grams = (text: string) => { const t = tokens(text); return new Set(t.slice(0, Math.max(0, t.length - 2)).map((_, i) => t.slice(i, i + 3).join(' '))); };
  const mine = grams(draft); if (!me || mine.size < 3) return [];
  const name = (id: Id) => data.members.find((m) => m.id === id)?.displayName ?? 'Compañero';
  const published = [
    ...data.works.filter((w) => !w.withdrawnAt && !w.authorIds.includes(me) && w.description.trim()).map((w) => ({ refKey: `work:${w.id}`, title: w.title || data.assignments.find((a) => a.id === w.assignmentId)?.title || 'Trabajo', authorName: w.authorIds.map(name).join(', '), text: w.description })),
    ...data.evidences.filter((e) => !e.withdrawnAt && e.authorId !== me && e.content.trim()).map((e) => ({ refKey: `evidence:${e.id}`, title: 'Evidencia', authorName: name(e.authorId), text: e.content })),
  ];
  return published.map((entry) => {
    const theirs = grams(entry.text); const shared = [...mine].filter((g) => theirs.has(g)).length; const score = Math.round((shared / mine.size) * 100);
    const best = (text: string) => sentences(text).map((s) => ({ s, n: [...grams(s)].filter((g) => (text === draft ? theirs : mine).has(g)).length })).sort((a, b) => b.n - a.n)[0]?.s ?? '';
    return { refKey: entry.refKey, title: entry.title, authorName: entry.authorName, score, mine: best(draft), theirs: best(entry.text) };
  }).filter((m) => m.score >= AGENT_ORIGINALITY_WARN).sort((a, b) => b.score - a.score);
}
