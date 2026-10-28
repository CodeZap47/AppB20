import type { VisualProject, VisualProjectKind } from '../../../packages/core/src/visualProjects';
import type { createDemoState } from '../../../packages/app/src/data/demo';

/** Synthetic fixtures, explicitly requested only by the development preview entry. */
export function seedVisualReview(state: ReturnType<typeof createDemoState>) {
  const assignment = state.assignments[0];
  const subjectId = assignment?.subjectId ?? state.subjects[0]?.id;
  const examples: [string, VisualProjectKind, string, string][] = [
    ['Dentro de una computadora', '3d', 'Hardware', 'Organiza CPU, memoria y almacenamiento para explicar cómo colaboran los componentes.'],
    ['El viaje de un paquete', 'simulation', 'Redes', 'Prepara el recorrido de la información entre equipos, switches y routers.'],
    ['De la idea al algoritmo', 'graphic', 'Programación', 'Un diseño por pasos para conectar el problema, el diagrama y la solución.'],
    ['Compuertas lógicas', 'mixed', 'Electrónica', 'Reúne los componentes y las tablas de verdad para tu próxima explicación.'],
    ['Fuerzas y movimiento', 'simulation', 'Física', 'Una ficha para planear los parámetros y las observaciones de un mecanismo.'],
    ['Memoria por capas', '3d', 'Hardware', 'Referencias y modelos para explicar qué guarda cada tipo de memoria.'],
  ];
  const at = Date.now();
  state.visualProjects.push(...examples.map(([title, kind, topic, description], index): VisualProject => ({
    id: `visual-demo-${index}`, authorId: index % 2 ? 'demo-2' : 'demo-1', title: `Ejemplo · ${title}`,
    kind, description, objective: 'Preparar una explicación visual del tema con fuentes y modelos identificados.',
    topic, tags: ['Demostración', topic], subjectIds: subjectId ? [subjectId] : [], termId: assignment?.termId,
    links: assignment ? [{ kind: 'assignment', id: assignment.id }] : [],
    resources: index === 0 ? [{ label: 'Biblioteca Adafruit CAD Parts', provider: 'Adafruit',
      url: 'https://github.com/adafruit/Adafruit_CAD_Parts' }] : [],
    visibility: index === 0 ? 'personal' : 'group', archived: false, version: 1,
    createdAt: at - index * 3_600_000, updatedAt: at - index * 3_600_000,
  })));
}
