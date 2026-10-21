/**
 * Métricas de estilo y comparación de parecido del agente personal (7.13, AG-2).
 * Son deterministas y no usan IA: alimentan el perfil de estilo y la alerta de originalidad
 * aunque la persona no haya configurado Gemini.
 *
 * El código, las citas entre comillas y el texto de la consigna no cuentan como parecido:
 * suelen coincidir entre compañeros sin que nadie haya copiado.
 */

export interface OriginalityThresholds {
  /** Porcentaje de tu texto presente en otro a partir del cual se avisa. */
  warn: number;
  /** Porcentaje a partir del cual el parecido se considera alto. */
  block: number;
  /** Palabras mínimas de prosa para calcular un porcentaje confiable. */
  minWords: number;
  /** Palabras por grupo (*shingle*) comparado. */
  shingleSize: number;
}
export type OriginalityLevel = 'ok' | 'warn' | 'block';
export interface SimilarityPair { mine: string; theirs: string; /** Parte de la oración propia presente en la ajena, de 0 a 1. */ ratio: number }
export interface SimilarityResult {
  /** `too_short`: no hay prosa suficiente para un porcentaje; solo se buscan oraciones copiadas. */
  status: 'compared' | 'too_short' | 'nothing_to_compare';
  /** Porcentaje de los grupos de palabras propios presentes en el otro texto. */
  score: number | null;
  /** Grupos compartidos sobre la unión de ambos textos, de 0 a 100. */
  jaccard: number | null;
  level: OriginalityLevel;
  pairs: SimilarityPair[];
  excluded: { codeLines: number; quotes: number; instructionGroups: number };
}
export interface StyleFeatures {
  words: number;
  sentences: number;
  /** Palabras promedio por oración de prosa. */
  sentenceLength: number;
  vocabulary: string[];
  /** Proporción de oraciones en primera persona, de 0 a 1. */
  firstPerson: number;
  listLines: number;
  codeLines: number;
  questions: number;
}
export interface StyleDescription { tone: string; structure: string; technical: string }

export const AGENT_ORIGINALITY_DEFAULTS: Readonly<OriginalityThresholds> = { warn: 25, block: 60, minWords: 25, shingleSize: 5 };

/** Umbrales del grupo con valores por omisión; rechaza combinaciones sin sentido. */
export function originalityThresholds(partial: Partial<OriginalityThresholds> = {}): OriginalityThresholds {
  const value = { ...AGENT_ORIGINALITY_DEFAULTS, ...partial };
  const integer = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  if (!integer(value.warn, 1, 99) || !integer(value.block, 2, 100) || value.warn >= value.block) throw new Error('Los umbrales de originalidad deben cumplir 1 ≤ aviso < alto ≤ 100.');
  if (!integer(value.shingleSize, 3, 8)) throw new Error('El tamaño de los grupos de palabras debe estar entre 3 y 8.');
  if (!integer(value.minWords, value.shingleSize, 500)) throw new Error('El mínimo de palabras no puede ser menor que el tamaño de los grupos.');
  return value;
}

const STOPWORDS = new Set('a al algo ante como con de del el ella en entre es esa ese esta este hay la las lo los mas me mi muy no o para pero por que se si sin sobre su sus tambien te tu un una uno y ya'.split(' '));
const FIRST_PERSON = new Set('yo me mi mis creo pienso considero hice aprendi entendi descubri intente'.split(' '));
const QUOTE = /«[^»\n]*»|“[^”\n]*”|"[^"\n]*"/g;
const LIST_LINE = /^\s*([-*•]|\d+[.)])\s/;

const normalize = (text: string) => text.toLocaleLowerCase('es-MX').normalize('NFD').replace(/\p{M}/gu, '');
const tokens = (text: string) => normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [];
const isCodeLine = (line: string) => {
  const t = line.trim();
  return (/[;{}]$/.test(t) && /[=(){}[\]<>]/.test(t)) || /^(\/\/|\/\*|#include|<\/?[a-z][\w-]*[\s>])/i.test(t) || /^(const|let|var|function|def|class|import|return|for|while|if|elif|else|print|console\.)\b.*[(:={]/.test(t);
};

/** Separa la prosa del código: bloques ``` ```, código en línea y líneas con forma de código. */
export function splitProse(text: string): { prose: string; code: string[] } {
  const code: string[] = [];
  const withoutFences = text.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, body: string) => { code.push(...body.split('\n').filter((l) => l.trim())); return '\n'; });
  const lines = withoutFences.replace(/`[^`\n]+`/g, ' ').split('\n').filter((line) => { if (line.trim() && isCodeLine(line)) { code.push(line); return false; } return true; });
  return { prose: lines.join('\n'), code };
}

/** Oraciones de prosa, sin listas vacías ni fragmentos de menos de tres palabras. */
export function proseSentences(text: string): string[] {
  return splitProse(text).prose.split(/(?<=[.!?])\s+|\n+/).map((s) => s.replace(LIST_LINE, '').trim()).filter((s) => s.split(/\s+/).length >= 3);
}

export function styleFeatures(texts: readonly string[]): StyleFeatures {
  const parts = texts.map(splitProse); const prose = parts.map((p) => p.prose).join('\n');
  const sentences = texts.flatMap(proseSentences); const words = tokens(prose);
  const counts = new Map<string, { n: number; form: string }>();
  for (const word of prose.toLocaleLowerCase('es-MX').match(/[\p{L}\p{N}]+/gu) ?? []) {
    const key = normalize(word); if (key.length <= 3 || STOPWORDS.has(key) || /^\d+$/.test(key)) continue;
    const entry = counts.get(key); counts.set(key, { n: (entry?.n ?? 0) + 1, form: entry?.form ?? word });
  }
  return {
    words: words.length, sentences: sentences.length,
    sentenceLength: sentences.length ? Math.round(sentences.reduce((sum, s) => sum + tokens(s).length, 0) / sentences.length) : 0,
    vocabulary: [...counts.values()].sort((a, b) => b.n - a.n || a.form.localeCompare(b.form, 'es-MX')).slice(0, 8).map((e) => e.form),
    firstPerson: sentences.length ? sentences.filter((s) => tokens(s).some((t) => FIRST_PERSON.has(t))).length / sentences.length : 0,
    listLines: prose.split('\n').filter((l) => LIST_LINE.test(l)).length,
    codeLines: parts.reduce((sum, p) => sum + p.code.length, 0),
    questions: sentences.filter((s) => s.trim().endsWith('?')).length,
  };
}

export function describeStyle(f: StyleFeatures): StyleDescription {
  return {
    tone: f.firstPerson >= 0.2 ? 'Cercano, en primera persona' : 'Impersonal y descriptivo',
    structure: f.listLines >= 2 ? 'Usa listas y pasos numerados' : 'Párrafos corridos',
    technical: f.codeLines ? 'Incluye código o notación técnica' : 'Explica con lenguaje cotidiano',
  };
}

const shingles = (words: string[], size: number) => { const set = new Set<string>(); for (let i = 0; i + size <= words.length; i++) set.add(words.slice(i, i + size).join(' ')); return set; };
const comparable = (text: string) => { const { prose, code } = splitProse(text); let quotes = 0; const unquoted = prose.replace(QUOTE, () => { quotes++; return ' . '; }); return { prose: unquoted, code, quotes }; };

/**
 * Cuánto de `mine` aparece en `theirs`. `ignore` recibe textos que ambos pueden citar
 * legítimamente, como la consigna: sus grupos de palabras no cuentan.
 */
export function similarity(mine: string, theirs: string, options: { ignore?: readonly string[]; thresholds?: Partial<OriginalityThresholds> } = {}): SimilarityResult {
  const limits = originalityThresholds(options.thresholds); const size = limits.shingleSize;
  const a = comparable(mine), b = comparable(theirs);
  const ignored = new Set<string>(); for (const text of options.ignore ?? []) for (const g of shingles(tokens(splitProse(text).prose), size)) ignored.add(g);
  const own = shingles(tokens(a.prose), size); const other = shingles(tokens(b.prose), size);
  const instructionGroups = [...own].filter((g) => ignored.has(g)).length;
  for (const g of ignored) { own.delete(g); other.delete(g); }
  const excluded = { codeLines: a.code.length, quotes: a.quotes, instructionGroups };

  const theirSentences = proseSentences(b.prose).map((s) => ({ s, g: shingles(tokens(s), size) }));
  const pairs = proseSentences(a.prose).flatMap((s) => {
    const g = [...shingles(tokens(s), size)].filter((x) => !ignored.has(x)); if (!g.length) return [];
    const best = theirSentences.map((t) => ({ t: t.s, n: g.filter((x) => t.g.has(x)).length })).sort((x, y) => y.n - x.n)[0];
    const ratio = best ? best.n / g.length : 0;
    return ratio >= 0.5 ? [{ mine: s, theirs: best!.t, ratio: Math.round(ratio * 100) / 100 }] : [];
  });
  const copied = pairs.some((p) => p.ratio === 1);

  if (!own.size) return { status: 'nothing_to_compare', score: null, jaccard: null, level: 'ok', pairs: [], excluded };
  if (tokens(a.prose).length < limits.minWords) return { status: 'too_short', score: null, jaccard: null, level: copied ? 'warn' : 'ok', pairs: pairs.filter((p) => p.ratio === 1), excluded };
  const shared = [...own].filter((g) => other.has(g)).length;
  const score = Math.round((shared / own.size) * 100); const union = new Set([...own, ...other]).size;
  const level: OriginalityLevel = score >= limits.block ? 'block' : score >= limits.warn || copied ? 'warn' : 'ok';
  return { status: 'compared', score, jaccard: Math.round((shared / union) * 100), level, pairs, excluded };
}

/** Compara un borrador con lo publicado y devuelve solo lo que merece alerta, de mayor a menor. */
export function compareWithPublished<T extends { text: string }>(draft: string, published: readonly T[], options: { ignore?: readonly string[]; thresholds?: Partial<OriginalityThresholds> } = {}): (T & { result: SimilarityResult })[] {
  const rank = { block: 2, warn: 1, ok: 0 } as const;
  return published.map((entry) => ({ ...entry, result: similarity(draft, entry.text, options) }))
    .filter((entry) => entry.result.level !== 'ok')
    .sort((x, y) => rank[y.result.level] - rank[x.result.level] || (y.result.score ?? 0) - (x.result.score ?? 0));
}
