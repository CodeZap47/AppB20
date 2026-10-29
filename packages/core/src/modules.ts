/**
 * Catálogo de módulos de App B20 según la definición del proyecto (secciones 3, 6, 7 y 8).
 * La interfaz lo usa para la navegación y para mostrar en qué etapa entra cada módulo.
 *
 * El módulo experimental 3.11 se incorpora en la etapa 3 y permanece pendiente.
 * Las actividades de clase (3.3) no tienen entrada propia: viven dentro de «Tareas y Actividades».
 */

export type Stage = 0 | 1 | 2 | 3;

export interface FeedCreateAction {
  /** Identificador estable de la acción, independiente de su texto y del módulo padre. */
  readonly id: string;
  readonly label: string;
  readonly path: string;
  /** Menor primero. Sin prioridad se conserva el orden del catálogo y de sus acciones. */
  readonly priority?: number;
}

export interface AvailableFeedCreateAction extends FeedCreateAction {
  readonly moduleId: string;
}

export interface ModuleInfo {
  /** Identificador estable; también se usa como ruta. */
  id: string;
  title: string;
  /** Sección del documento de definición. */
  section: string;
  summary: string;
  /** Primera etapa en la que se incorpora. */
  stage: Stage;
  /** Si se puede usar sin configurar Gemini. */
  worksWithoutAi: boolean;
  /** Ya tiene pantalla propia aunque su etapa no haya llegado: aparece en la navegación. */
  ready?: boolean;
  /** Entradas explícitas para crear publicaciones del grupo desde el feed. */
  readonly feedCreateActions?: readonly FeedCreateAction[];
}

export const MODULES: readonly ModuleInfo[] = [
  { id: 'calendario', title: 'Calendario de entregas', section: '3.2', summary: 'Tareas en su fecha de entrega y agenda por día.', stage: 1, worksWithoutAi: true, ready: true },
  { id: 'materias', title: 'Materias', section: '3.2', summary: 'Consignas y apuntes compartidos por materia.', stage: 1, worksWithoutAi: true, ready: true },
  {
    id: 'inicio',
    title: '¿Qué me perdí?',
    section: '7.1',
    summary: 'Novedades del grupo desde tu última visita.',
    stage: 1,
    worksWithoutAi: true,
  },
  {
    id: 'mensajes',
    title: 'Mensajes',
    section: '3.1',
    summary: 'Canal del salón y conversaciones 1 a 1.',
    stage: 1,
    worksWithoutAi: true,
  },
  {
    id: 'tareas',
    title: 'Tareas y Actividades',
    section: '3.2',
    summary: 'Tareas, exámenes y actividades de clase, con lo que subió cada quien.',
    stage: 1,
    worksWithoutAi: true,
    feedCreateActions: [
      { id: 'task', label: 'Crear tarea', path: '/m/tareas/nueva', priority: 0 },
      { id: 'activity', label: 'Registrar actividad', path: '/m/actividades/nueva' },
    ],
  },
  {
    id: 'notas',
    title: 'Notas de clase',
    section: '3.4',
    summary: 'Apuntes por materia, parcial y tema.',
    stage: 1,
    worksWithoutAi: true,
    feedCreateActions: [{ id: 'note', label: 'Compartir apunte', path: '/m/notas/nueva?visibilidad=grupo', priority: 1 }],
  },
  {
    id: 'preguntas',
    title: 'Preguntas y respuestas',
    section: '3.7',
    summary: 'Dudas del grupo con respuestas y revisiones.',
    stage: 1,
    worksWithoutAi: true,
    feedCreateActions: [{ id: 'question', label: 'Hacer pregunta', path: '/m/preguntas/nueva', priority: 2 }],
  },
  {
    id: 'perfiles',
    title: 'Perfiles',
    section: '3.9',
    summary: 'Foto, nombre y archivo de trabajos por materia y parcial.',
    stage: 1,
    worksWithoutAi: true,
  },
  {
    id: 'cumpleanos',
    title: 'Cumpleaños',
    section: '3.10',
    summary: 'Calendario anual con participación voluntaria.',
    stage: 1,
    worksWithoutAi: true,
  },
  {
    id: 'guias',
    title: 'Guías de estudio',
    section: '3.5',
    summary: 'Guías por materia y parcial con fuentes y omisiones visibles.',
    stage: 1,
    worksWithoutAi: false,
    feedCreateActions: [{ id: 'guide', label: 'Crear guía', path: '/m/guias/nueva' }],
  },
  {
    id: 'examenes',
    title: 'Exámenes de estudio',
    section: '3.12',
    summary: 'Autoevaluaciones y simulacros con fuentes y resultados privados.',
    stage: 2,
    worksWithoutAi: true,
    ready: true,
    feedCreateActions: [{ id: 'exam', label: 'Preparar examen', path: '/m/examenes/nuevo' }],
  },
  {
    id: 'votaciones',
    title: 'Votaciones',
    section: '3.8',
    summary: 'Encuestas y votaciones nominales transparentes.',
    stage: 2,
    worksWithoutAi: true,
    ready: true,
    feedCreateActions: [{ id: 'poll', label: 'Crear votación', path: '/m/votaciones/nueva' }],
  },
  {
    id: 'salas',
    title: 'Salas de estudio',
    section: '7.2',
    summary: 'Horarios, inscripción y temporizador.',
    stage: 2,
    worksWithoutAi: true,
    ready: true,
    feedCreateActions: [{ id: 'room', label: 'Crear sala', path: '/m/salas/nueva' }],
  },
  {
    id: 'ayuda',
    title: 'Puedo ayudarte / necesito ayuda',
    section: '7.3',
    summary: 'Ofertas y solicitudes de apoyo entre compañeros.',
    stage: 2,
    worksWithoutAi: true,
    ready: true,
    feedCreateActions: [{ id: 'help', label: 'Publicar ayuda', path: '/m/ayuda/nueva' }],
  },
  {
    id: 'retos',
    title: 'Retos de programación',
    section: '7.4',
    summary: 'Retos cortos vinculados a materias.',
    stage: 2,
    worksWithoutAi: true,
    ready: true,
    feedCreateActions: [{ id: 'challenge', label: 'Crear reto', path: '/m/retos/nuevo' }],
  },
  {
    id: 'revision-codigo',
    title: 'Revisión de código',
    section: '7.5',
    summary: 'Fragmentos y comentarios entre compañeros.',
    stage: 2,
    worksWithoutAi: true,
    ready: true,
    feedCreateActions: [{ id: 'review', label: 'Pedir revisión de código', path: '/m/revision-codigo/nueva' }],
  },
  {
    id: 'museo-bugs',
    title: 'Museo de bugs',
    section: '7.7',
    summary: 'Errores documentados con plantilla y etiquetas.',
    stage: 2,
    worksWithoutAi: true,
    ready: true,
    feedCreateActions: [{ id: 'museum', label: 'Documentar bug', path: '/m/museo-bugs?crear=1' }],
  },
  {
    id: 'aprende-ensenando',
    title: 'Aprende enseñando',
    section: '7.8',
    summary: 'Explica un tema y responde preguntas.',
    stage: 2,
    worksWithoutAi: true,
    ready: true,
  },
  {
    id: 'repaso',
    title: 'Repaso espaciado',
    section: '7.9',
    summary: 'Tarjetas e historial personal.',
    stage: 2,
    worksWithoutAi: true,
    ready: true,
    feedCreateActions: [{ id: 'collection', label: 'Crear colección de repaso', path: '/m/repaso/nueva?visibilidad=grupo' }],
  },
  {
    id: 'agente',
    title: 'Mi agente',
    section: '7.13',
    summary: 'Agente personal que te ayuda a escribir con tu propio estilo.',
    stage: 2,
    worksWithoutAi: false,
    ready: true,
  },
  {
    id: 'oportunidades',
    title: 'Radar de oportunidades',
    section: '7.12',
    summary: 'Publicaciones del grupo y búsqueda de equipo.',
    stage: 2,
    worksWithoutAi: true,
    ready: true,
    feedCreateActions: [{ id: 'opportunity', label: 'Compartir oportunidad', path: '/m/oportunidades?crear=1' }],
  },
  {
    id: 'leaderboard',
    title: 'Contribuciones',
    section: '3.6',
    summary: 'Estadísticas de contribución y leaderboard verificable.',
    stage: 3,
    worksWithoutAi: true,
    ready: true,
  },
  {
    id: 'microproyectos',
    title: 'Microproyectos',
    section: '7.6',
    summary: 'Equipos, pendientes y demostraciones.',
    stage: 3,
    worksWithoutAi: true,
  },
  {
    id: 'exposiciones',
    title: 'Simulador de exposiciones',
    section: '7.10',
    summary: 'Ensayo por texto antes de evaluar audio.',
    stage: 3,
    worksWithoutAi: true,
    ready: true,
  },
  {
    id: 'senales',
    title: 'Lenguaje de señales',
    section: '3.11',
    summary: 'Diccionario versionado, prácticas y fichas de anotaciones con fuentes.',
    stage: 3,
    worksWithoutAi: true,
  },
  {
    id: 'prestamos',
    title: 'Préstamo de materiales',
    section: '7.11',
    summary: 'Catálogo y acuerdos sin pagos.',
    stage: 3,
    worksWithoutAi: true,
  },
];

export function modulesForStage(stage: Stage): ModuleInfo[] {
  return MODULES.filter((m) => m.stage <= stage);
}

/** Lo que va en la navegación: el MVP y los módulos que ya tienen pantalla. */
export function navigableModules(): ModuleInfo[] {
  return MODULES.filter(moduleAvailable);
}

function moduleAvailable(module: ModuleInfo): boolean {
  return module.stage <= 1 || module.ready === true;
}

/** Solo creaciones declaradas y disponibles; las tres prioridades iniciales preceden al catálogo. */
export function availableFeedCreateActions(modules: readonly ModuleInfo[] = MODULES): readonly AvailableFeedCreateAction[] {
  return modules.filter(moduleAvailable).flatMap((module) =>
    (module.feedCreateActions ?? []).map((action) => ({ ...action, moduleId: module.id })),
  ).sort((a, b) => {
    const first = a.priority ?? Number.POSITIVE_INFINITY; const second = b.priority ?? Number.POSITIVE_INFINITY;
    return first === second ? 0 : first - second;
  });
}

export function findModule(id: string): ModuleInfo | undefined {
  return MODULES.find((m) => m.id === id);
}
