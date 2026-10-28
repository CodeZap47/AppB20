import { cleanVisualProjectUrl, type VisualProject, type VisualProjectKind, type VisualProjectLink, type VisualProjectResource } from '@b20/core';
import type { Snapshot } from '../data/types';

export const VISUAL_PROJECT_PATH = '/m/laboratorio-visual';
export const VISUAL_KIND_LABEL: Record<VisualProjectKind, string> = {
  '3d': '3D', graphic: 'Diseño gráfico', simulation: 'Simulación', mixed: 'Mixto',
};
export const VISUAL_LINK_LABEL: Record<VisualProjectLink['kind'], string> = {
  assignment: 'Tarea o actividad', activity: 'Actividad de clase', note: 'Nota', guide: 'Guía',
};
export interface VisualAcademicOption extends VisualProjectLink {
  title: string;
  href: string;
  subjectId: string;
  termId?: string;
  topic?: string;
  personal: boolean;
}

/** Every label comes from the current authorized snapshot, never from a copied source. */
export function visualAcademicOptions(data: Snapshot): VisualAcademicOption[] {
  return [
    ...data.assignments.map(row => ({ kind: 'assignment' as const, id: row.id, title: row.title, href: `/m/tareas/${row.id}`, subjectId: row.subjectId, termId: row.termId, topic: row.topic, personal: false })),
    ...data.activities.map(row => ({ kind: 'activity' as const, id: row.id, title: row.title, href: `/m/actividades/${row.id}`, subjectId: row.subjectId, termId: row.termId, topic: row.topic, personal: false })),
    ...data.notes.filter(row => !row.withdrawnAt && (row.visibility === 'group' || row.authorId === data.me?.id)).map(row => ({ kind: 'note' as const, id: row.id, title: row.title, href: `/m/notas/${row.id}`, subjectId: row.subjectId, termId: row.termId, topic: row.topic, personal: row.visibility === 'personal' })),
    ...data.guides.filter(row => !row.withdrawnAt).map(row => ({ kind: 'guide' as const, id: row.id, title: row.title, href: `/m/guias/${row.id}`, subjectId: row.subjectId, termId: row.termId, personal: false })),
  ];
}
export function visualSourceKey(link: VisualProjectLink) { return `${link.kind}:${link.id}`; }
export function visualProjectSubjects(project: VisualProject, options: VisualAcademicOption[]): string[] {
  return [...new Set([...project.subjectIds, ...project.links.flatMap(link => {
    const item = options.find(row => row.kind === link.kind && row.id === link.id);
    return item ? [item.subjectId] : [];
  })])];
}

export const VISUAL_PROVIDERS = [
  { id: 'adafruit', name: 'Adafruit CAD Parts', initials: 'Ad', area: 'Hardware educativo', formats: 'STEP · STL · Fusion 360', access: 'Repositorio descargable', type: 'CAD', description: 'Placas, sensores, conectores y piezas para construir explicaciones de hardware.', conditions: 'Repositorio bajo MIT. Conserva los avisos de licencia del activo.', catalogUrl: 'https://github.com/adafruit/Adafruit_CAD_Parts', informationUrl: 'https://github.com/adafruit/Adafruit_CAD_Parts/blob/main/LICENSE', informationLabel: 'Licencia' },
  { id: 'snapeda', name: 'SnapMagic / SnapEDA', initials: 'Sm', area: 'Electrónica', formats: 'STEP · símbolos · huellas PCB', access: 'Consulta condiciones de descarga', type: 'CAD', description: 'Busca componentes electrónicos por fabricante o número de parte.', conditions: 'Licencia y excepciones propias. Comprueba los permisos antes de redistribuir modelos.', catalogUrl: 'https://www.snapeda.com/', informationUrl: 'https://www.snapeda.com/about/terms/', informationLabel: 'Condiciones de uso' },
  { id: 'ultra-librarian', name: 'Ultra Librarian', initials: 'Ul', area: 'Electrónica', formats: 'STEP · símbolos · huellas PCB', access: 'Cuenta gratuita disponible', type: 'CAD', description: 'Modelos de componentes electrónicos para acompañar documentación técnica.', conditions: 'Una descarga gratuita no equivale a permiso de redistribución. Revisa cada activo.', catalogUrl: 'https://app.ultralibrarian.com/', informationUrl: 'https://www.ultralibrarian.com/legal', informationLabel: 'Condiciones de uso' },
  { id: 'traceparts', name: 'TraceParts', initials: 'Tp', area: 'Mecánica y electrónica', formats: 'Múltiples formatos CAD', access: 'Registro gratuito', type: 'CAD', description: 'Piezas industriales y catálogos de fabricantes para explicar sistemas y mecanismos.', conditions: 'Los formatos y condiciones dependen de la pieza y del fabricante.', catalogUrl: 'https://www.traceparts.com/es', informationUrl: 'https://info.traceparts.com/legal/general-gtu/', informationLabel: 'Condiciones de uso' },
  { id: 'grabcad', name: 'GrabCAD', initials: 'Gc', area: 'Ensambles y mecanismos', formats: 'Según el autor', access: 'Cuenta para descargar', type: 'CAD', description: 'Equipos completos y ensambles aportados por una comunidad de diseñadores.', conditions: 'Revisa las pautas de uso y atribución. El uso comercial puede requerir permiso del autor.', catalogUrl: 'https://grabcad.com/library', informationUrl: 'https://help.grabcad.com/article/246-how-can-models-be-used-and-shared', informationLabel: 'Uso y atribución' },
  { id: '3d-contentcentral', name: '3D ContentCentral', initials: '3D', area: 'Piezas y ensambles', formats: 'Formatos CAD seleccionables', access: 'Registro gratuito', type: 'CAD', description: 'Componentes de proveedores y usuarios para organizar bibliotecas técnicas.', conditions: 'Las condiciones dependen del proveedor o del autor; no hay una licencia abierta universal.', catalogUrl: 'https://www.3dcontentcentral.com/', informationUrl: 'https://contentmanager.3dpublisher.net/WebHelp/ContentCentral/3dcontentcentral.htm', informationLabel: 'Ayuda de uso' },
  { id: 'sketchfab', name: 'Sketchfab', initials: 'Sf', area: 'Modelos visuales', formats: 'glTF · GLB · USDZ por API', access: 'Cuenta y modelo descargable', type: 'Web', description: 'Modelos de hardware, objetos, anatomía y patrimonio para escenas explicativas.', conditions: 'La descarga y la licencia se revisan por modelo. Hay distintas licencias y algunas piezas necesitan preparación.', catalogUrl: 'https://sketchfab.com/3d-models?features=downloadable', informationUrl: 'https://sketchfab.com/terms', informationLabel: 'Condiciones de uso' },
  { id: 'poly-haven', name: 'Poly Haven', initials: 'Ph', area: 'Objetos y entornos', formats: 'Modelos · texturas · HDRI', access: 'Descarga de activos', type: 'Escenas', description: 'Materiales, objetos y entornos para completar la presentación visual de una escena.', conditions: 'Activos CC0; las condiciones de la API son independientes. Comprueba el formato al descargar.', catalogUrl: 'https://polyhaven.com/models', informationUrl: 'https://polyhaven.com/license', informationLabel: 'Licencia' },
] as const;

export const VISUAL_STARTERS: { id: string; title: string; description: string; kind: VisualProjectKind; tag: string }[] = [
  { id: 'hardware', title: 'Dentro de una computadora', description: 'Prepara una explicación de CPU, RAM y almacenamiento: reúne modelos y define qué quieres enseñar.', kind: '3d', tag: 'Hardware' },
  { id: 'redes', title: 'El viaje de un paquete', description: 'Reúne referencias del recorrido entre equipos, switches y routers para preparar una futura simulación.', kind: 'simulation', tag: 'Redes' },
  { id: 'diagrama', title: 'Una idea, paso a paso', description: 'Reúne flechas, diagramas y referencias para convertir un tema en una explicación visual.', kind: 'graphic', tag: 'Diseño explicativo' },
];

export type VisualProvider = typeof VISUAL_PROVIDERS[number];

/** A library reference carries provenance, never an assumed asset author or license. */
export function visualProviderResource(provider: VisualProvider): VisualProjectResource {
  return { label: `Biblioteca de modelos · ${provider.name}`, url: provider.catalogUrl, provider: provider.name };
}

export function visualResourceUrlKey(url: string): string {
  const clean = cleanVisualProjectUrl(url);
  try { return new URL(clean).href; }
  catch { throw new Error('Usa un enlace HTTPS válido, sin credenciales.'); }
}

export function visualProviderDirectoryUrl(projectId?: string): string {
  const params = new URLSearchParams({ pestana: 'proveedores' });
  if (projectId) params.set('proyecto', projectId);
  return `${VISUAL_PROJECT_PATH}?${params}`;
}
