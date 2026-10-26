import { createDemoState, DemoDataSource } from '../../../packages/app/src/data/demo';
import { dayKey } from '../../../packages/app/src/lib/dueCalendar';

/** Synthetic examples used only by the opt-in feed design review. All actions stay in memory. */
export function seedFeedReview(state: ReturnType<typeof createDemoState>): void {
  const source = new DemoDataSource(state, 'demo-1');
  try {
    if (source.getSnapshot().codingChallenges.some((entry) => entry.requestId === 'feed-review-challenge')) return;
    const subjectId = state.assignments[0]?.subjectId ?? state.subjects[0]?.id;
    if (!subjectId) return;

    const challengeId = source.createCodingChallenge({
      requestId: 'feed-review-challenge', subjectId, title: 'Reto de ejemplo · Detectar palabras repetidas',
      topic: 'Ejemplo · Colecciones y cadenas', difficulty: 'intermediate',
      objective: 'Ejemplo: encontrar repeticiones en una lista y explicar el costo de la solución.',
      instructions: 'Ejemplo: normaliza las palabras, identifica las repetidas y conserva el orden de aparición. Compara un recorrido simple con el uso de un conjunto.',
      examples: '// Ejemplo\n["azul", "verde", "azul"] → ["azul"]', hints: [],
    });
    source.saveChallengeSolution({
      challengeId, expectedVersion: 0, requestId: 'feed-review-solution',
      body: '// Solución de ejemplo\nconst repetidas = (palabras: string[]) => {\n  const vistas = new Set<string>();\n  return palabras.filter((palabra) => {\n    const repetida = vistas.has(palabra);\n    vistas.add(palabra);\n    return repetida;\n  });\n};',
      explanation: 'Ejemplo: un conjunto recuerda las palabras visitadas. Así identificamos repeticiones con un recorrido y espacio adicional proporcional a las palabras distintas.',
    });

    const reviewId = source.createCodeReview({
      requestId: 'feed-review-code', subjectId, title: 'Revisión de ejemplo · Una búsqueda más clara', language: 'TypeScript',
      summary: 'Ejemplo: revisemos el nombre de las variables y el comportamiento cuando la lista está vacía. El código es material ficticio para comparar las tarjetas del feed.',
      code: '// Código de ejemplo\nfunction primero(valores: number[]) {\n  return valores[0];\n}', repositoryUrl: '',
    });
    source.addCodeReviewComment({
      reviewId, versionNumber: 1, lineStart: 3, lineEnd: 3, kind: 'suggestion',
      body: 'Ejemplo: documenta que una lista vacía devuelve undefined o define un resultado explícito para ese caso.',
      requestId: 'feed-review-observation',
    });

    source.createMuseum({
      requestId: 'feed-review-museum', subjectId, title: 'Bug de ejemplo · El último elemento se quedaba fuera',
      fields: {
        intention: 'Ejemplo: recorrer todos los elementos de una lista.',
        symptom: 'Ejemplo: el recorrido omitía el último valor y la suma quedaba incompleta.',
        cause: 'Ejemplo: el límite del recorrido restaba uno dos veces.',
        correction: 'Ejemplo: comparar el índice con la longitud completa.',
        learning: 'Ejemplo: probar listas vacías, de un elemento y de varios elementos ayuda a detectar errores en los límites.',
        minimalCode: '// Código de ejemplo\nfor (let i = 0; i < valores.length - 1; i++) {\n  total += valores[i];\n}',
        evidence: 'Ejemplo: con [2, 3, 5] se obtenía 5 en vez de 10.',
        language: 'JavaScript', topic: 'Ejemplo · Recorridos', bugType: 'Ejemplo · Límite de un bucle', noteIds: [], questionIds: [],
      },
    });

    const now = new Date();
    source.createOpportunity({
      requestId: 'feed-review-opportunity',
      fields: {
        kind: 'course', title: 'Curso de ejemplo · Primeros pasos con interfaces accesibles',
        topic: 'Ejemplo · Diseño y accesibilidad', modality: 'online', sourceUrl: 'https://example.com/curso-de-ejemplo',
        organizer: 'Comunidad de ejemplo', requirements: 'Ejemplo: interés por el diseño de interfaces. No requiere experiencia previa.',
        deadline: new Date(now.getTime() + 5 * 86_400_000).toISOString(), costKnown: true, cost: 'Gratis · ejemplo',
      },
    });

    const initialDue = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2));
    const nextDue = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 4));
    const assignment = {
      subjectId, kind: 'tarea' as const, title: 'Entrega de ejemplo · Prototipo de una biblioteca',
      topic: 'Ejemplo · Prototipado', instructions: 'Ejemplo: diseña una pantalla de búsqueda y explica cómo organizaste los resultados.', dueDate: initialDue,
    };
    const assignmentId = source.createAssignment(assignment);
    source.updateAssignment(assignmentId, { ...assignment, dueDate: nextDue }, 1);
  } finally {
    source.dispose();
  }
}
