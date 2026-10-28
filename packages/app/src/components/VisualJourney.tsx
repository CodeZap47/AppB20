import { Link } from 'react-router';
import { VISUAL_PROJECT_PATH, visualProviderDirectoryUrl } from '../lib/visualProjects';

/** Available actions are derived from this stage, never from a fabricated progress meter. */
export function VisualJourney({ projectId, canEdit = false, compact = false }: {
  projectId?: string; canEdit?: boolean; compact?: boolean;
}) {
  return <section className={`visual-journey${compact ? ' visual-journey--compact' : ''}`} aria-label="Crear, explorar, comprender y practicar">
    <div className="visual-journey-heading"><span className="visual-eyebrow">De una idea al aprendizaje</span><p>Reúne tus modelos, explora sus piezas y construye una explicación por pasos.</p></div>
    <ol>
      <li><span className="visual-journey-number" aria-hidden="true">01</span><div><h2>Crear</h2><span className="visual-journey-status">Disponible</span><p>Define tu idea, reúne recursos e importa modelos GLB.</p>
        <Link to={projectId && canEdit ? `${VISUAL_PROJECT_PATH}/${projectId}/escena/editar` : `${VISUAL_PROJECT_PATH}/nuevo`}>{projectId && canEdit ? 'Preparar escena' : 'Nuevo proyecto'}</Link></div></li>
      <li><span className="visual-journey-number" aria-hidden="true">02</span><div><h2>Explorar</h2><span className="visual-journey-status">Disponible</span><p>Gira los modelos, selecciona sus piezas y observa sus detalles.</p><div className="visual-journey-links"><Link to={projectId ? `${VISUAL_PROJECT_PATH}/${projectId}/escena` : VISUAL_PROJECT_PATH}>{projectId ? 'Explorar escena' : 'Ver proyectos'}</Link><Link to={visualProviderDirectoryUrl(projectId)}>Buscar modelos</Link></div></div></li>
      <li><span className="visual-journey-number" aria-hidden="true">03</span><div><h2>Comprender</h2><span className="visual-journey-status">Disponible</span><p>Conecta etiquetas, vistas y pasos para explicar una idea. El audio llegará después.</p>{projectId && <Link to={`${VISUAL_PROJECT_PATH}/${projectId}/escena`}>Recorrer explicación</Link>}</div></li>
      <li className="visual-journey-future"><span className="visual-journey-number" aria-hidden="true">04</span><div><h2>Practicar</h2><span className="visual-journey-status">Próxima etapa</span><p>Ejercicios, simulaciones y retroalimentación.</p></div></li>
    </ol>
  </section>;
}
