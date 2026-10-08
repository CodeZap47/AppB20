/**
 * Plan de estudios de Ingeniería en Desarrollo de Software que cursa el grupo B20:
 * nueve cuatrimestres con cinco materias cada uno. Cada cuatrimestre se divide en tres
 * parciales, así que cada materia tiene «Parcial 1», «Parcial 2» y «Parcial 3».
 *
 * Los nombres van tal como aparecen en el plan oficial, incluidos «Fronted I» y «Fronted II»:
 * el grupo pidió conservarlos así, no son una errata por corregir.
 */

export interface CurriculumSubject {
  /** Clave oficial de la materia; sirve para no cargarla dos veces. */
  code: string;
  name: string;
  /** Cuatrimestre en que se cursa, de 1 a `PERIOD_COUNT`. */
  period: number;
}

export const PERIOD_COUNT = 9;
export const TERMS_PER_PERIOD = 3;

const BY_PERIOD: readonly (readonly [code: string, name: string])[][] = [
  [
    ['IDSE-05010101', 'Arquitectura de Computadoras'],
    ['IDSE-05010102S', 'Vida Digital'],
    ['IDSE-05010103', 'Lógica de Programación'],
    ['IDSE-05010104', 'Fundamentos de Programación'],
    ['IDSE-05010105', 'Introducción a la Ingeniería en Desarrollo de Software'],
  ],
  [
    ['IDSE-05020106', 'Taller de Comunicación Oral y Escrita'],
    ['IDSE-05020107', 'Matemáticas Discretas'],
    ['IDSE-05020108', 'Programación Orientada a Objetos'],
    ['IDSE-05020109S', 'Pensamiento Crítico para la Resolución de Problemas'],
    ['IDSE-05020110', 'Estadística Inferencial'],
  ],
  [
    ['IDSE-05030111', 'Sistemas Operativos'],
    ['IDSE-05030112', 'Cálculo Diferencial'],
    ['IDSE-05030113', 'Metodología de la Investigación'],
    ['IDSE-05030114', 'Cómputo en la Nube'],
    ['IDSE-05030115', 'Estructura de Datos'],
  ],
  [
    ['IDSE-05040216', 'Arquitectura de Software'],
    ['IDSE-05040217', 'Cálculo Integral'],
    ['IDSE-05040218', 'Base de Datos I'],
    ['IDSE-05040219', 'Análisis de Requerimientos'],
    ['IDSE-05040220', 'Gestión de Sistemas Operativos'],
  ],
  [
    ['IDSE-05050221', 'Tópicos de Electrónica'],
    ['IDSE-05050222', 'Modelado y Diseño'],
    ['IDSE-05050223', 'Base de Datos II'],
    ['IDSE-05050224', 'Interactividad y Videojuegos 2D'],
    ['IDSE-05050225', 'Desarrollo de Software Empresarial'],
  ],
  [
    ['IDSE-05060226', 'Realidad Virtual'],
    ['IDSE-05060227', 'Redes I'],
    ['IDSE-05060228', 'Desarrollo de Software Backend I'],
    ['IDSE-05060229', 'Desarrollo de Software Fronted I'],
    ['IDSE-05060230', 'Aplicaciones Electrónicas'],
  ],
  [
    ['IDSE-05070331', 'Desarrollo de Aplicaciones de Realidad Virtual'],
    ['IDSE-05070332', 'Redes II'],
    ['IDSE-05070333', 'Desarrollo de Software Backend II'],
    ['IDSE-05070334', 'Desarrollo de Software Fronted II'],
    ['IDSE-05070335', 'Ciencia de Datos'],
  ],
  [
    ['IDSE-05080336', 'Realidad Aumentada'],
    ['IDSE-05080337', 'Desarrollo de Apps Móviles'],
    ['IDSE-05080338', 'Seguridad Informática'],
    ['IDSE-05080339', 'NoSQL'],
    ['IDSE-05080340', 'Administración de Proyectos de Software'],
  ],
  [
    ['IDSE-05090341', 'Desarrollo de Aplicación de Realidad Aumentada'],
    ['IDSE-05090342', 'Internet de las Cosas'],
    ['IDSE-05090343', 'Bioética para el Desarrollo de Software'],
    ['IDSE-05090344', 'Programación Funcional'],
    ['IDSE-05090345S', 'Taller de Creatividad e Innovación'],
  ],
];

export const CURRICULUM: readonly CurriculumSubject[] = BY_PERIOD.flatMap((subjects, index) =>
  subjects.map(([code, name]) => ({ code, name, period: index + 1 })),
);

export function isValidPeriod(period: number): boolean {
  return Number.isInteger(period) && period >= 1 && period <= PERIOD_COUNT;
}

export function periodLabel(period: number): string {
  return `Cuatrimestre ${period}`;
}

/** Nombres de los parciales de una materia del plan: «Parcial 1» a «Parcial 3». */
export function termNames(): string[] {
  return Array.from({ length: TERMS_PER_PERIOD }, (_, i) => `Parcial ${i + 1}`);
}
