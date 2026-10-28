import { Link } from 'react-router';
import type { VisualProjectLink } from '@b20/core';
import { useSnapshot } from '../data/DataContext';
import { VISUAL_KIND_LABEL, VISUAL_PROJECT_PATH, visualAcademicOptions, visualProjectSubjects } from '../lib/visualProjects';

/** Only permission-filtered project metadata is used in academic pages. */
export function RelatedVisualProjects({ kind, id, subjectId }: { kind?: VisualProjectLink['kind']; id?: string; subjectId?: string }) {
  const data = useSnapshot();
  const options = visualAcademicOptions(data);
  const projects = (data.visualProjects ?? []).filter(project => !project.archived && (kind && id
    ? project.links.some(link => link.kind === kind && link.id === id)
    : subjectId ? visualProjectSubjects(project, options).includes(subjectId) : false));
  const params = new URLSearchParams();
  if (kind && id) params.set('origen', `${kind}:${id}`);
  if (subjectId) params.set('materia', subjectId);
  return <section className="panel visual-related" aria-label="Proyectos visuales relacionados">
    <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <h2>Proyectos visuales relacionados</h2>
      <Link to={`${VISUAL_PROJECT_PATH}/nuevo?${params}`} className="link-button">Crear proyecto visual</Link>
    </div>
    {projects.length ? <ul>{projects.map(project => <li key={project.id}><Link to={`${VISUAL_PROJECT_PATH}/${project.id}`}>{project.title}</Link> <span className="muted">· {VISUAL_KIND_LABEL[project.kind]}</span></li>)}</ul>
      : <p className="muted">Relaciona una explicación 3D, un diseño o una simulación con este contenido.</p>}
  </section>;
}
