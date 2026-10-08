/** Normaliza texto para buscar sin importar mayúsculas ni acentos. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Coincide si todas las palabras de la búsqueda aparecen en alguno de los campos. */
export function matches(query: string, ...fields: string[]): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = normalize(fields.join(' '));
  return words.every((w) => haystack.includes(w));
}

/** Palabras significativas de un título, para sugerir preguntas parecidas. */
export function similarity(a: string, b: string): number {
  const words = (s: string) => new Set(normalize(s).split(/\W+/).filter((w) => w.length > 3));
  const wa = words(a);
  const wb = words(b);
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared;
}
