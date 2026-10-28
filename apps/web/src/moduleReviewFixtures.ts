import { createDemoState, DemoDataSource } from '../../../packages/app/src/data/demo';

/** Ejemplos en memoria para revisar estas pantallas sin tocar cuentas ni datos reales. */
export function seedModuleReview(state: ReturnType<typeof createDemoState>, source: DemoDataSource) {
  const subjectId = state.assignments[0]?.subjectId ?? state.subjects[0]?.id;
  if (!subjectId) return;
  const titles = [
    'Encuentra las palabras repetidas',
    'Construye una tabla de verdad paso a paso',
    'La ruta más corta: compara distintas estrategias de búsqueda para recorrer una red de estaciones',
  ];
  const ids = titles.map((title, index) => source.createCodingChallenge({
    requestId: `modules-review-${index}`, subjectId, title,
    topic: ['Cadenas y colecciones', 'Proposiciones', 'Grafos y búsqueda'][index]!,
    difficulty: (['basic', 'intermediate', 'advanced'] as const)[index]!,
    objective: 'Diseña un algoritmo, prueba sus límites y explica por qué funciona. Compara tu razonamiento con las propuestas del grupo.',
    instructions: 'Recorre los datos y conserva el orden de aparición. Incluye los casos de una lista vacía y una lista con un solo elemento.\n\nExplica qué información necesitas guardar en cada paso.',
    examples: 'Entrada: ["azul", "verde", "azul"]\nSalida: ["azul"]',
    hints: ['Considera qué información necesitas recordar de cada elemento.', 'Un conjunto permite comprobar si ya has visto una palabra.'],
  }));
  source.saveChallengeSolution({
    challengeId: ids[0]!, expectedVersion: 0, requestId: 'modules-review-solution',
    body: 'const vistas = new Set();\nconst repetidas = palabras.filter(palabra => {\n  const repetida = vistas.has(palabra);\n  vistas.add(palabra);\n  return repetida;\n});',
    explanation: 'Guardamos las palabras visitadas en un conjunto. Cada comparación permite decidir si una palabra ya apareció antes.',
  });
  source.addChallengeComment({challengeId: ids[0]!, requestId: 'modules-review-comment', body: 'Podemos comparar qué ocurre cuando una palabra aparece tres veces.'});
  source.closeCodingChallenge(ids[2]!, 'Comparamos búsqueda en anchura y búsqueda en profundidad. La elección depende de las condiciones del problema.', 1);
}
