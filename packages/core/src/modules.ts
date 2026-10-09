/**
 * Catálogo de módulos de App B20 según la definición del proyecto (secciones 3, 6, 7 y 8).
 * La interfaz lo usa para la navegación y para mostrar en qué etapa entra cada módulo.
 *
 * El módulo 3.11 (lenguaje de señales y respuestas preparadas) no forma parte de este proyecto.
 * Las actividades de clase (3.3) no tienen entrada propia: viven dentro de «Tareas y Actividades».
 */

export type Stage = 0 | 1 | 2 | 3;

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
}

export const MODULES: readonly ModuleInfo[] = [
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
  },
  {
    id: 'notas',
    title: 'Notas de clase',
    section: '3.4',
    summary: 'Apuntes por materia, parcial y tema.',
    stage: 1,
    worksWithoutAi: true,
  },
  {
    id: 'preguntas',
    title: 'Preguntas y respuestas',
    section: '3.7',
    summary: 'Dudas del grupo con respuestas y revisiones.',
    stage: 1,
    worksWithoutAi: true,
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
  },
  {
    id: 'votaciones',
    title: 'Votaciones',
    section: '3.8',
    summary: 'Encuestas y votaciones nominales transparentes.',
    stage: 2,
    worksWithoutAi: true,
  },
  {
    id: 'salas',
    title: 'Salas de estudio',
    section: '7.2',
    summary: 'Horarios, inscripción y temporizador.',
    stage: 2,
    worksWithoutAi: true,
  },
  {
    id: 'ayuda',
    title: 'Puedo ayudarte / necesito ayuda',
    section: '7.3',
    summary: 'Ofertas y solicitudes de apoyo entre compañeros.',
    stage: 2,
    worksWithoutAi: true,
  },
  {
    id: 'retos',
    title: 'Retos de programación',
    section: '7.4',
    summary: 'Retos cortos vinculados a materias.',
    stage: 2,
    worksWithoutAi: true,
  },
  {
    id: 'revision-codigo',
    title: 'Revisión de código',
    section: '7.5',
    summary: 'Fragmentos y comentarios entre compañeros.',
    stage: 2,
    worksWithoutAi: true,
  },
  {
    id: 'museo-bugs',
    title: 'Museo de bugs',
    section: '7.7',
    summary: 'Errores documentados con plantilla y etiquetas.',
    stage: 2,
    worksWithoutAi: true,
  },
  {
    id: 'aprende-ensenando',
    title: 'Aprende enseñando',
    section: '7.8',
    summary: 'Explica un tema y responde preguntas.',
    stage: 2,
    worksWithoutAi: false,
  },
  {
    id: 'repaso',
    title: 'Repaso espaciado',
    section: '7.9',
    summary: 'Tarjetas e historial personal.',
    stage: 2,
    worksWithoutAi: true,
  },
  {
    id: 'oportunidades',
    title: 'Radar de oportunidades',
    section: '7.12',
    summary: 'Publicaciones del grupo y búsqueda de equipo.',
    stage: 2,
    worksWithoutAi: true,
  },
  {
    id: 'leaderboard',
    title: 'Contribuciones',
    section: '3.6',
    summary: 'Estadísticas de contribución y leaderboard verificable.',
    stage: 3,
    worksWithoutAi: true,
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
    worksWithoutAi: false,
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

export function findModule(id: string): ModuleInfo | undefined {
  return MODULES.find((m) => m.id === id);
}
