/**
 * Guías integrales de estudio por materia y parcial (sección 3.5). Esta primera versión es
 * manual: el grupo elige las fuentes, marca cuáles ya se procesaron y escribe la guía. El
 * borrador con Gemini llegará cuando BYOK esté habilitado, sobre estas mismas reglas.
 */

/** Secciones de la guía, en el orden de la definición. El temario va aparte. */
export const GUIDE_SECTIONS = [
  {
    id: 'objetivos',
    title: 'Objetivos',
    hint: 'Qué se espera saber hacer al terminar el parcial.',
  },
  { id: 'conceptos', title: 'Conceptos', hint: 'Definiciones clave, en palabras del grupo.' },
  { id: 'explicaciones', title: 'Explicaciones', hint: 'Cómo funciona cada tema, paso a paso.' },
  { id: 'ejemplos', title: 'Ejemplos', hint: 'Casos resueltos de los trabajos y actividades.' },
  {
    id: 'codigo',
    title: 'Código comentado',
    hint: 'Fragmentos con comentarios; enciérralos entre ``` para que se vean como código.',
  },
  { id: 'errores', title: 'Errores comunes', hint: 'Lo que más se equivoca y cómo evitarlo.' },
  { id: 'ejercicios', title: 'Ejercicios', hint: 'Práctica para resolver por tu cuenta.' },
  {
    id: 'preguntas',
    title: 'Preguntas de práctica y respuestas razonadas',
    hint: 'Pregunta, respuesta y por qué es correcta.',
  },
] as const;

export type GuideSectionId = (typeof GUIDE_SECTIONS)[number]['id'];

export const MAX_GUIDE_TOPICS = 40;
export const MAX_GUIDE_TOPIC_LENGTH = 120;
export const MAX_GUIDE_SECTION_LENGTH = 20_000;
export const MAX_SOURCE_REASON_LENGTH = 200;
export const MAX_REVIEW_COMMENT_LENGTH = 2_000;

/** Material del grupo que puede citarse como fuente de una guía. */
export const GUIDE_SOURCE_KINDS = ['trabajo', 'tarea', 'actividad', 'nota', 'pregunta'] as const;
export type GuideSourceKind = (typeof GUIDE_SOURCE_KINDS)[number];

export function isGuideSourceKind(value: string): value is GuideSourceKind {
  return (GUIDE_SOURCE_KINDS as readonly string[]).includes(value);
}

/** Procesada: su contenido ya está en la guía. Pendiente: falta, y se dice por qué. */
export type GuideSourceStatus = 'processed' | 'pending';

export type GuideReviewVerdict = 'approved' | 'changes';

export function isGuideReviewVerdict(value: string): value is GuideReviewVerdict {
  return value === 'approved' || value === 'changes';
}

/**
 * Temario limpio: un tema por renglón, sin viñetas ni repetidos. Devuelve el problema en vez
 * de la lista si no cumple los límites.
 */
export function parseTopics(text: string): { topics: string[] } | { problem: string } {
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const line of text.split('\n')) {
    const topic = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
    if (!topic) continue;
    if (topic.length > MAX_GUIDE_TOPIC_LENGTH) {
      return { problem: `Cada tema debe tener a lo más ${MAX_GUIDE_TOPIC_LENGTH} caracteres.` };
    }
    const key = topic.toLocaleLowerCase('es');
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(topic);
  }
  if (!topics.length) return { problem: 'Escribe al menos un tema del temario.' };
  if (topics.length > MAX_GUIDE_TOPICS) {
    return { problem: `El temario admite hasta ${MAX_GUIDE_TOPICS} temas.` };
  }
  return { topics };
}

/** Una fuente pendiente siempre dice por qué; una procesada no necesita razón. */
export function sourceStatusError(status: GuideSourceStatus, reason: string): string | null {
  if (status !== 'processed' && status !== 'pending') return 'Estado de fuente inválido.';
  if (reason.trim().length > MAX_SOURCE_REASON_LENGTH) {
    return `La razón excede ${MAX_SOURCE_REASON_LENGTH} caracteres.`;
  }
  if (status === 'pending' && !reason.trim()) return 'Di por qué la fuente sigue pendiente.';
  return null;
}

export interface CoverageSource {
  status: GuideSourceStatus;
  topics: readonly string[];
}

/**
 * Cobertura de cada tema del temario: cuántas fuentes procesadas lo cubren y cuántas
 * pendientes lo cubrirían. Un tema sin fuentes procesadas no se da por cubierto.
 */
export function guideCoverage(topics: readonly string[], sources: readonly CoverageSource[]) {
  return topics.map((topic) => ({
    topic,
    processed: sources.filter((s) => s.status === 'processed' && s.topics.includes(topic)).length,
    pending: sources.filter((s) => s.status === 'pending' && s.topics.includes(topic)).length,
  }));
}

/** Nadie revisa una versión que guardó: la revisión es de un compañero. */
export function canReviewGuide(viewerId: string, lastEditorId: string): boolean {
  return viewerId !== lastEditorId;
}
