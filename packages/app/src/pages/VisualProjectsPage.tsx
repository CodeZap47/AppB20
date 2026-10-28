import { ShareToChatButton } from '../components/messaging/SharePostDialog';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from 'react-router';
import { Cube01, ArrowUpRight, LayersTwo01, Plus, SearchLg } from '@untitledui/icons';
import { cleanVisualProjectInput, visualProjectCoverError, VISUAL_PROJECT_LIMITS, type VisualProject, type VisualProjectInput, type VisualProjectKind, type VisualProjectLink, type VisualProjectResource } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Snapshot } from '../data/types';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { useAction } from '../components/useAction';
import { VisualJourney } from '../components/VisualJourney';
import { VisualProvidersDirectory } from '../components/VisualProvidersDirectory';
import { useResourceUploadQueue } from '../components/uploads/ResourceUploader';
import { UploadFileList } from '../components/uploads/UploadFileList';
import { matches } from '../lib/search';
import { VISUAL_KIND_LABEL, VISUAL_LINK_LABEL, VISUAL_PROJECT_PATH as BASE, VISUAL_PROVIDERS, VISUAL_STARTERS, visualAcademicOptions, visualProjectSubjects, visualSourceKey, visualProviderDirectoryUrl, visualProviderResource } from '../lib/visualProjects';
import './VisualProjectsPage.css';

const date = (value: number) => new Date(value).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
const authorName = (data: Snapshot, id: string) => id === data.me?.id ? 'Tú' : data.members.find(row => row.id === id)?.displayName ?? 'Integrante del grupo';

function WorkspaceGate({ children }: { children: ReactNode }) {
  const data = useSnapshot();
  return data.connection !== 'ready' || data.me?.status !== 'active'
    ? <Empty icon="lock" title="Conecta con el grupo para abrir el laboratorio">Tus proyectos requieren una sesión activa.</Empty> : <>{children}</>;
}
function LabMark({ kind = '3d' }: { kind?: VisualProjectKind }) {
  return <svg className="visual-mark" width="132" height="132" viewBox="0 0 132 132" fill="none" aria-hidden="true">
    {kind === 'graphic' ? <><rect x="24" y="25" width="68" height="68" rx="5" stroke="currentColor" strokeWidth="1.5" transform="rotate(-9 24 25)" /><rect x="43" y="44" width="64" height="64" rx="5" fill="currentColor" fillOpacity=".09" stroke="currentColor" strokeWidth="1.5" /><circle cx="75" cy="75" r="18" stroke="currentColor" strokeWidth="1.5" /><path d="M75 51v48M51 75h48" stroke="currentColor" strokeOpacity=".3" /></>
      : kind === 'simulation' ? <><circle cx="66" cy="66" r="40" stroke="currentColor" strokeWidth="1.5" /><ellipse cx="66" cy="66" rx="22" ry="40" stroke="currentColor" strokeWidth="1.5" transform="rotate(38 66 66)" /><ellipse cx="66" cy="66" rx="40" ry="16" stroke="currentColor" strokeWidth="1.5" transform="rotate(38 66 66)" /><circle cx="66" cy="66" r="5" fill="currentColor" /><circle cx="97" cy="41" r="5" fill="currentColor" /></>
      : <><path d="m66 20 43 25v50l-43 25-43-25V45l43-25Z" fill="currentColor" fillOpacity=".05" stroke="currentColor" strokeWidth="1.5" /><path d="m23 45 43 25 43-25M66 70v50M44 33l44 25v50M88 33 44 58v50M23 70l43 25 43-25" stroke="currentColor" strokeWidth="1.1" strokeOpacity=".55" /><circle cx="66" cy="70" r="4" fill="currentColor" /></>}
  </svg>;
}

/** A private image is fetched only near the viewport and is revoked on account/file changes. */
function ProjectCover({ project, localFile, large = false, retry = true }: { project: Pick<VisualProject, 'id' | 'kind' | 'coverFileId'>; localFile?: File; large?: boolean; retry?: boolean }) {
  const source = useDataSource();
  const identity = useSnapshot().me?.id;
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; url: string }>();
  const [error, setError] = useState(false);
  const key = `${identity}:${project.id}:${project.coverFileId ?? ''}:${attempt}`;
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '240px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!localFile && (!visible || !project.coverFileId)) return;
    let cancelled = false;
    let url: string | undefined;
    setError(false);
    if (localFile) { url = URL.createObjectURL(localFile); setLoaded({ key, url }); }
    else source.downloadResourceFile(project.coverFileId!).then(blob => {
      if (cancelled || source.getSnapshot().me?.id !== identity) return;
      url = URL.createObjectURL(blob); setLoaded({ key, url });
    }, () => { if (!cancelled) setError(true); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [source, identity, visible, project.coverFileId, localFile, key]);
  return <div ref={element} className={`visual-cover visual-cover--${project.kind}${large ? ' visual-cover--large' : ''}`}>
    {loaded?.key === key ? <img src={loaded.url} alt="" onError={() => { setLoaded(undefined); setError(true); }} /> : <><span className="visual-cover-grid" /><LabMark kind={project.kind} /><span className="visual-cover-caption">{VISUAL_KIND_LABEL[project.kind]}</span></>}
    {error && retry && <button type="button" className="visual-cover-retry" onClick={event => { event.preventDefault(); event.stopPropagation(); setAttempt(value => value + 1); }}>Reintentar portada</button>}
  </div>;
}
function VisibilityBadge({ project }: { project: Pick<VisualProject, 'visibility' | 'archived'> }) {
  return <span className="visual-badge"><Icon name={project.visibility === 'personal' ? 'lock' : 'users'} size={12} />{project.archived ? 'Archivado' : project.visibility === 'personal' ? 'Privado' : 'Del grupo'}</span>;
}
function ProjectCard({ project, data }: { project: VisualProject; data: Snapshot }) {
  const subjects = visualProjectSubjects(project, visualAcademicOptions(data)).map(id => data.subjects.find(row => row.id === id)?.name).filter(Boolean);
  return <li className="visual-project-card"><Link to={`${BASE}/${project.id}`} className="visual-card-main">
    <ProjectCover project={project} retry={false} />
    <div className="visual-card-body"><div className="visual-card-meta"><span>{VISUAL_KIND_LABEL[project.kind]}</span><VisibilityBadge project={project} /></div>
      <span className="visual-preparation">{project.hasScene ? 'Escena 3D disponible' : 'Ficha en preparación'}</span><h2>{project.title}<ArrowUpRight aria-hidden="true" /></h2><p className="visual-excerpt">{project.description || 'Una nueva idea lista para tomar forma.'}</p>
      <div className="visual-subjects">{subjects.length ? subjects.map(subject => <span key={subject}>{subject}</span>) : <span>Sin materia asignada</span>}</div>
      <div className="visual-card-footer"><span>{authorName(data, project.authorId)}</span><time dateTime={new Date(project.updatedAt).toISOString()}>{date(project.updatedAt)}</time></div>
    </div></Link>{project.visibility === 'group' && !project.archived && <ShareToChatButton target={{ kind: 'visual-project', id: project.id }} />}</li>;
}
export function VisualProjectsPage() { return <WorkspaceGate><VisualCatalog /></WorkspaceGate>; }
function VisualCatalog() {
  const data = useSnapshot();
  const [params, setParams] = useSearchParams();
  const providers = params.get('pestana') === 'proveedores';
  const options = visualAcademicOptions(data);
  const patch = (values: Record<string, string>) => setParams(previous => { const next = new URLSearchParams(previous); for (const [key, value] of Object.entries(values)) if (value) next.set(key, value); else next.delete(key); return next; }, { replace: true });
  const urlQuery = params.get('q') ?? '';
  const location = useLocation();
  const navigationType = useNavigationType();
  const [query, setQuery] = useState(urlQuery);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ownQuery = useRef<string | undefined>(undefined);
  const observedQuery = useRef(urlQuery);
  const observedLocation = useRef(location.key);
  useEffect(() => {
    const popped = navigationType === 'POP' && observedLocation.current !== location.key;
    const changed = observedQuery.current !== urlQuery;
    if (popped || changed && ownQuery.current !== urlQuery) {
      clearTimeout(searchTimer.current); ownQuery.current = undefined; setQuery(urlQuery);
    } else if (changed) ownQuery.current = undefined;
    observedQuery.current = urlQuery; observedLocation.current = location.key;
  }, [urlQuery, location.key, navigationType]);
  useEffect(() => () => clearTimeout(searchTimer.current), []);
  function changeQuery(value: string) {
    setQuery(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      ownQuery.current = value;
      setParams(previous => { const next = new URLSearchParams(previous); if (value) next.set('q', value); else next.delete('q'); return next; }, { replace: true });
    }, 180);
  }
  function clearFilters() {
    clearTimeout(searchTimer.current); ownQuery.current = undefined; setQuery(''); setParams(previous => { const next = new URLSearchParams(previous); for (const key of ['q', 'materia', 'parcial', 'tipo', 'recurso', 'vista']) next.delete(key); return next; }, { replace: true });
  }
  const subjectId = params.get('materia') ?? '';
  const termId = params.get('parcial') ?? '';
  const kind = params.get('tipo') ?? '';
  const resource = params.get('recurso') ?? '';
  const view = params.get('vista') ?? '';
  const normalized = new URLSearchParams(params);
  const validSubject = data.subjects.some(subject => subject.id === subjectId) ? subjectId : '';
  if (subjectId && !validSubject) normalized.delete('materia');
  if (termId && !data.terms.some(term => term.id === termId && (!validSubject || term.subjectId === validSubject))) normalized.delete('parcial');
  if (kind && !Object.prototype.hasOwnProperty.call(VISUAL_KIND_LABEL, kind)) normalized.delete('tipo');
  if (resource && !options.some(option => visualSourceKey(option) === resource && (!validSubject || option.subjectId === validSubject))) normalized.delete('recurso');
  if (view && !['mios', 'grupo', 'archivados'].includes(view)) normalized.delete('vista');
  const normalizedSearch = normalized.toString();
  const currentSearch = params.toString();
  useEffect(() => {
    if (data.connection === 'ready' && normalizedSearch !== currentSearch) setParams(normalizedSearch, { replace: true });
  }, [data.connection, normalizedSearch, currentSearch, setParams]);
  function changeSubject(value: string) {
    const selected = options.find(option => visualSourceKey(option) === resource);
    patch({ materia: value, parcial: '', ...(value && selected?.subjectId !== value ? { recurso: '' } : {}) });
  }
  function removeFilter(key: string) {
    if (key === 'q') { clearTimeout(searchTimer.current); ownQuery.current = undefined; setQuery(''); }
    patch({ [key]: '' });
  }
  const activeFilters = [
    ...(query ? [{ key: 'q', label: `Búsqueda: ${query}` }] : []),
    ...(subjectId ? [{ key: 'materia', label: `Materia: ${data.subjects.find(subject => subject.id === subjectId)?.name ?? subjectId}` }] : []),
    ...(termId ? [{ key: 'parcial', label: `Parcial: ${data.terms.find(term => term.id === termId)?.name ?? termId}` }] : []),
    ...(kind && Object.prototype.hasOwnProperty.call(VISUAL_KIND_LABEL, kind) ? [{ key: 'tipo', label: `Contenido: ${VISUAL_KIND_LABEL[kind as VisualProjectKind]}` }] : []),
    ...(resource ? [{ key: 'recurso', label: `Relacionado con: ${options.find(option => visualSourceKey(option) === resource)?.title ?? 'Recurso no disponible'}` }] : []),
    ...(view && ['mios', 'grupo', 'archivados'].includes(view) ? [{ key: 'vista', label: ({ mios: 'Mis proyectos', grupo: 'Del grupo', archivados: 'Mis archivados' } as Record<string, string>)[view]! }] : []),
  ];
  const projects = (data.visualProjects ?? []).filter(project => {
    if (view === 'archivados' ? !project.archived || project.authorId !== data.me?.id : project.archived) return false;
    if (view === 'mios' && project.authorId !== data.me?.id || view === 'grupo' && project.visibility !== 'group') return false;
    if (subjectId && !visualProjectSubjects(project, options).includes(subjectId) || kind && project.kind !== kind) return false;
    if (termId && project.termId !== termId && !project.links.some(link => options.some(option => visualSourceKey(option) === visualSourceKey(link) && option.termId === termId))) return false;
    if (resource && !project.links.some(link => visualSourceKey(link) === resource)) return false;
    return matches(query, project.title, project.description, project.objective, project.topic, ...project.tags);
  }).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const hasFilters = Boolean(query || subjectId || termId || kind || resource || view);
  const total = (data.visualProjects ?? []).filter(project => !project.archived).length;
  return <div className="visual-page">
    <header className="visual-header"><div><p className="visual-eyebrow"><Cube01 aria-hidden="true" /> Un espacio para dar forma a tus ideas</p><h1>Laboratorio visual</h1><p>Transforma lo que estudias en proyectos de 3D, diseño explicativo y simulaciones. Empieza preparando su idea, fuentes y modelos.</p></div><Link className="button visual-primary" to={`${BASE}/nuevo`}><Plus aria-hidden="true" /> Nuevo proyecto</Link></header>
    <VisualJourney />
    <nav className="visual-tabs" aria-label="Laboratorio visual"><button type="button" aria-current={!providers ? 'page' : undefined} onClick={() => patch({ pestana: '' })}><LayersTwo01 aria-hidden="true" /> Proyectos <span>{total}</span></button><button type="button" aria-current={providers ? 'page' : undefined} onClick={() => patch({ pestana: 'proveedores' })}><Cube01 aria-hidden="true" /> Proveedores</button></nav>
    {providers ? <VisualProvidersDirectory /> : <>
      <div className="visual-toolbar"><label className="visual-search"><SearchLg aria-hidden="true" /><input type="search" aria-label="Buscar proyectos" placeholder="Busca una idea, un tema o una etiqueta…" value={query} onChange={event => changeQuery(event.target.value)} /></label><select aria-label="Mostrar proyectos" value={view} onChange={event => patch({ vista: event.target.value })}><option value="">Todos los proyectos</option><option value="mios">Mis proyectos</option><option value="grupo">Del grupo</option><option value="archivados">Mis archivados</option></select></div>
      <div className="visual-filters"><label>Materia<select aria-label="Filtrar por materia" value={subjectId} onChange={event => changeSubject(event.target.value)}><option value="">Todas las materias</option>{data.subjects.map(subject => <option value={subject.id} key={subject.id}>{subject.name}</option>)}</select></label><label>Parcial<select aria-label="Filtrar por parcial" value={termId} onChange={event => patch({ parcial: event.target.value })}><option value="">Todos los parciales</option>{data.terms.filter(term => !subjectId || term.subjectId === subjectId).map(term => <option value={term.id} key={term.id}>{subjectId ? term.name : `${data.subjects.find(subject => subject.id === term.subjectId)?.name ?? ''} · ${term.name}`}</option>)}</select></label><label>Contenido<select aria-label="Filtrar por tipo" value={kind} onChange={event => patch({ tipo: event.target.value })}><option value="">Todos los tipos</option>{Object.entries(VISUAL_KIND_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Relacionado con<select aria-label="Filtrar por recurso" value={resource} onChange={event => patch({ recurso: event.target.value })}><option value="">Cualquier recurso</option>{options.filter(option => !subjectId || option.subjectId === subjectId).map(option => <option value={visualSourceKey(option)} key={visualSourceKey(option)}>{VISUAL_LINK_LABEL[option.kind]} · {option.title}</option>)}</select></label></div>
      {activeFilters.length > 0 && <div className="visual-filter-chips" aria-label="Filtros activos">{activeFilters.map(filter => <button type="button" key={filter.key} className="visual-filter-chip" aria-label={`Quitar filtro ${filter.label}`} onClick={() => removeFilter(filter.key)}>{filter.label}<Icon name="close" size={12} /></button>)}</div>}
      <div className="visual-results-line"><p>{projects.length} {projects.length === 1 ? 'proyecto' : 'proyectos'}{hasFilters ? ' encontrados' : ' para explorar'}</p>{hasFilters && <button type="button" className="link-button" onClick={clearFilters}>Limpiar filtros</button>}</div>
      {projects.length ? <ul className="visual-project-grid" aria-label="Proyectos visuales">{projects.map(project => <ProjectCard key={project.id} project={project} data={data} />)}</ul> : <div className="visual-empty"><span className="visual-empty-symbol"><Cube01 aria-hidden="true" /></span><h2>{hasFilters ? 'No hay proyectos con estos filtros' : 'Tu próxima explicación empieza aquí'}</h2><p>{hasFilters ? 'Prueba con otra materia o limpia los filtros para explorar el catálogo.' : 'Guarda una idea, reúne sus modelos y relaciónala con lo que estás estudiando.'}</p>{hasFilters ? <button type="button" className="secondary" onClick={clearFilters}>Ver todos los proyectos</button> : <Link to={`${BASE}/nuevo`} className="button">Crear mi primer proyecto</Link>}</div>}
      {!hasFilters && <section className="visual-inspiration"><div className="visual-section-heading"><div><p className="visual-eyebrow">De una idea a una explicación</p><h2>Algunas formas de empezar</h2></div><span className="visual-small">Ideas para preparar tu próxima explicación</span></div><div className="visual-starter-grid">{VISUAL_STARTERS.map(starter => <article key={starter.id}><span className="visual-starter-tag">{starter.tag}</span><h3>{starter.title}</h3><p>{starter.description}</p><Link to={`${BASE}/nuevo?plantilla=${starter.id}`}>Usar esta idea <ArrowUpRight aria-hidden="true" /></Link></article>)}</div></section>}

    </>}
  </div>;
}

export function VisualProjectFormPage() {
  const data = useSnapshot();
  const { projectId } = useParams();
  const project = (data.visualProjects ?? []).find(row => row.id === projectId);
  return <WorkspaceGate>{projectId && (!project || project.authorId !== data.me?.id) ? <Empty icon="lock" title="No puedes editar este proyecto">Puede que no esté disponible o que pertenezca a otra persona.</Empty>
    : project?.archived ? <Empty icon="folder" title="Este proyecto está archivado" action={<Link to={`${BASE}/${project.id}`} className="button">Abrir proyecto</Link>}>Restáuralo desde su ficha para seguir editando.</Empty>
    : <VisualProjectEditor key={`${data.me?.id}:${projectId ?? 'nuevo'}`} project={project} />}</WorkspaceGate>;
}
function VisualProjectEditor({ project }: { project?: VisualProject }) {
  const source = useDataSource();
  const data = useSnapshot();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const location = useLocation();
  const options = visualAcademicOptions(data);
  const origin = options.find(option => visualSourceKey(option) === params.get('origen'));
  const starter = VISUAL_STARTERS.find(row => row.id === params.get('plantilla'));
  const provider = VISUAL_PROVIDERS.find(row => row.id === params.get('proveedor'));
  const savedLinks = [...(project?.links ?? []), ...(project?.unavailableLinks ?? [])];
  const initialSavedLinks = useRef(savedLinks);
  const [title, setTitle] = useState(project?.title ?? starter?.title ?? '');
  const [kind, setKind] = useState<VisualProjectKind>(project?.kind ?? starter?.kind ?? '3d');
  const [description, setDescription] = useState(project?.description ?? starter?.description ?? '');
  const [objective, setObjective] = useState(project?.objective ?? '');
  const [topic, setTopic] = useState(project?.topic ?? origin?.topic ?? '');
  const [tags, setTags] = useState(project?.tags.join(', ') ?? starter?.tag ?? '');
  const [subjectIds, setSubjects] = useState<string[]>(project?.subjectIds ?? (origin ? [origin.subjectId] : data.subjects.some(row => row.id === params.get('materia')) ? [params.get('materia')!] : []));
  const [termId, setTerm] = useState(project?.termId ?? origin?.termId ?? '');
  const [links, setLinks] = useState<VisualProjectLink[]>(project ? savedLinks : (origin ? [{ kind: origin.kind, id: origin.id }] : []));
  const [removedLinks, setRemovedLinks] = useState<VisualProjectLink[]>([]);
  const [replacing, setReplacing] = useState<VisualProjectLink | undefined>(() => {
    const requested = (location.state as { replaceVisualLink?: VisualProjectLink } | null)?.replaceVisualLink;
    return requested && savedLinks.find(link => visualSourceKey(link) === visualSourceKey(requested));
  });
  const [resources, setResources] = useState<VisualProjectResource[]>(() => {
    if (project) return project.resources;
    if (!provider) return [];
    const state = location.state as { visualProviderId?: string; visualProviderResource?: unknown } | null;
    if (state?.visualProviderId === provider.id && state.visualProviderResource) {
      try { return cleanVisualProjectInput({ title: 'Referencia', kind: '3d', resources: [state.visualProviderResource] }).resources; } catch { /* The verified library remains a safe default. */ }
    }
    return [visualProviderResource(provider)];
  });
  const [sourceQuery, setSourceQuery] = useState('');
  const [coverFile, setCoverFile] = useState<File>();
  const [coverError, setCoverError] = useState('');
  const action = useAction();
  const queue = useResourceUploadQueue();
  const requestId = useRef(crypto.randomUUID());
  const saved = useRef<{ id: string; version: number; signature: string } | undefined>(undefined);
  const initialVersion = useRef(project?.version);
  const submitting = useRef(false);
  const alive = useRef(true);
  const actor = useRef(data.me?.id);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [savedId, setSavedId] = useState<string>();
  const [coverInputKey, setCoverInputKey] = useState(0);
  const current = data.visualProjects?.find(row => row.id === (saved.current?.id ?? project?.id));
  const stale = !saved.current && project && current && current.version !== initialVersion.current;
  function toggleSubject(id: string) {
    const next = subjectIds.includes(id) ? subjectIds.filter(value => value !== id) : [...subjectIds, id];
    setSubjects(next);
    if (termId && !next.includes(data.terms.find(term => term.id === termId)?.subjectId ?? '')) setTerm('');
  }
  const removedKeys = new Set(removedLinks.map(visualSourceKey));
  const unavailable = [...new Map([...links, ...(project?.unavailableLinks ?? [])]
    .filter(link => !removedKeys.has(visualSourceKey(link)) && !options.some(option => visualSourceKey(option) === visualSourceKey(link)))
    .map(link => [visualSourceKey(link), link])).values()];
  function removeLink(link: VisualProjectLink) {
    const key = visualSourceKey(link);
    setLinks(previous => previous.filter(value => visualSourceKey(value) !== key));
    if ([...initialSavedLinks.current, ...(project?.unavailableLinks ?? [])].some(value => visualSourceKey(value) === key)) {
      setRemovedLinks(previous => previous.some(value => visualSourceKey(value) === key) ? previous : [...previous, link]);
    }
    setReplacing(previous => previous && visualSourceKey(previous) === key ? undefined : previous);
  }
  function addLink(option: typeof options[number]) {
    const key = visualSourceKey(option);
    setLinks(previous => previous.some(link => visualSourceKey(link) === key) ? previous : [...previous, { kind: option.kind, id: option.id }]);
    setRemovedLinks(previous => previous.filter(link => visualSourceKey(link) !== key));
    setSubjects(previous => [...new Set([...previous, option.subjectId])]);
    if (!termId && option.termId) setTerm(option.termId);
    if (!topic && option.topic) setTopic(option.topic);
  }
  function toggleLink(option: typeof options[number]) {
    if (links.some(link => visualSourceKey(link) === visualSourceKey(option))) removeLink(option);
    else addLink(option);
  }
  function replaceLink(key: string) {
    const option = options.find(value => visualSourceKey(value) === key);
    if (!replacing || !option) return;
    removeLink(replacing); addLink(option); setReplacing(undefined);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || queue.busy) return;
    submitting.current = true;
    await action.run(async () => {
      if (coverError) throw new Error(coverError);
      const metadata = cleanVisualProjectInput({ title, kind, description, objective, topic, tags: tags.split(',').map(value => value.trim()).filter(Boolean), subjectIds, termId: termId || undefined, links, resources });
      const signature = JSON.stringify({ metadata, removedLinks });
      let record = saved.current;
      if (!record || record.signature !== signature) {
        const id = record?.id ?? project?.id;
        const version = record?.version ?? initialVersion.current;
        const input: VisualProjectInput = { ...metadata, id, expectedVersion: version, requestId: requestId.current, ...(removedLinks.length ? { removedLinks } : {}) };
        const resultId = await source.saveVisualProject(input);
        if (!alive.current || source.getSnapshot().me?.id !== actor.current) return;
        record = { id: resultId, version: (version ?? 0) + 1, signature };
        saved.current = record; setSavedId(record.id);
      }
      if (queue.hasFiles && !await queue.upload('visual_project', record.id, record.version)) throw new Error('La ficha está guardada. Reintenta la portada o abre el proyecto para continuar después.');
      if (alive.current && source.getSnapshot().me?.id === actor.current) navigate(`${BASE}/${record.id}`);
    });
    submitting.current = false;
  }
  return <div className="visual-page visual-editor-page"><Link to={project ? `${BASE}/${project.id}` : BASE} className="visual-back"><Icon name="back" size={15} /> {project ? 'Volver al proyecto' : 'Volver al laboratorio'}</Link><header className="visual-header"><div><p className="visual-eyebrow">Dale forma a una explicación</p><h1>{project ? 'Editar proyecto' : 'Nuevo proyecto visual'}</h1><p>{project ? 'Ajusta la ficha y reúne lo que necesitarás para construirla.' : 'Prepara una idea y sus referencias para una futura experiencia visual. La ficha empieza privada.'}</p></div></header>
    <form onSubmit={submit} className="visual-editor" aria-label="Ficha del proyecto"><fieldset className="visual-editor-main visual-editor-fields" aria-label="Datos del proyecto" disabled={action.pending || queue.busy || Boolean(savedId)}><section className="visual-surface"><h2>La idea</h2><label className="field"><span className="field__label">Título del proyecto</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={VISUAL_PROJECT_LIMITS.title} required placeholder="Por ejemplo: cómo funciona la memoria RAM" disabled={action.pending || queue.busy} /></label><div className="visual-two-fields"><label className="field"><span className="field__label">Tipo de contenido</span><select value={kind} onChange={event => setKind(event.target.value as VisualProjectKind)} required disabled={action.pending || queue.busy}>{Object.entries(VISUAL_KIND_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="field"><span className="field__label">Tema</span><input value={topic} onChange={event => setTopic(event.target.value)} maxLength={VISUAL_PROJECT_LIMITS.topic} /></label></div><label className="field"><span className="field__label">Descripción</span><textarea rows={4} value={description} onChange={event => setDescription(event.target.value)} maxLength={VISUAL_PROJECT_LIMITS.description} placeholder="¿Qué quieres mostrar y cómo lo imaginas?" /></label><label className="field"><span className="field__label">Objetivo de aprendizaje</span><textarea rows={3} value={objective} onChange={event => setObjective(event.target.value)} maxLength={VISUAL_PROJECT_LIMITS.objective} placeholder="Al terminar, ¿qué debería poder entender o explicar alguien?" /></label><label className="field"><span className="field__label">Etiquetas</span><input value={tags} onChange={event => setTags(event.target.value)} placeholder="hardware, memoria, arquitectura" /><span className="visual-small">Separa las etiquetas con comas.</span></label></section>
      <section className="visual-surface" id="relaciones"><h2>Conecta con tus materias</h2><p className="visual-small">Un mismo proyecto puede acompañar varias materias y recursos.</p><fieldset className="visual-checklist"><legend>Materias relacionadas</legend>{data.subjects.map(subject => <label className="visual-check" key={subject.id}><input type="checkbox" checked={subjectIds.includes(subject.id)} onChange={() => toggleSubject(subject.id)} /><span>{subject.name}<small>Cuatrimestre {subject.period}</small></span></label>)}</fieldset><label className="field"><span className="field__label">Parcial</span><select value={termId} onChange={event => setTerm(event.target.value)}><option value="">Sin parcial asignado</option>{data.terms.filter(term => subjectIds.includes(term.subjectId)).map(term => <option value={term.id} key={term.id}>{data.subjects.find(subject => subject.id === term.subjectId)?.name} · {term.name}</option>)}</select></label><label className="field"><span className="field__label">Buscar recursos académicos</span><input type="search" value={sourceQuery} onChange={event => setSourceQuery(event.target.value)} placeholder="Encuentra una tarea, actividad, nota o guía" /></label><fieldset className="visual-checklist"><legend>Recursos relacionados</legend>{options.filter(option => matches(sourceQuery, option.title, VISUAL_LINK_LABEL[option.kind])).map(option => <label className="visual-check" key={visualSourceKey(option)}><input type="checkbox" checked={links.some(link => visualSourceKey(link) === visualSourceKey(option))} onChange={() => toggleLink(option)} /><span>{option.title}<small>{VISUAL_LINK_LABEL[option.kind]} · {data.subjects.find(subject => subject.id === option.subjectId)?.name}{option.personal ? ' · Nota personal' : ''}</small></span></label>)}{!options.length && <p className="visual-small">Todavía no hay recursos disponibles para relacionar.</p>}</fieldset>{unavailable.length > 0 && <div className="visual-reference-review" role="status"><p>Hay referencias por revisar. Se conservarán al guardar otros cambios hasta que las quites o reemplaces.</p>{unavailable.map(link => <div className="visual-unavailable" key={visualSourceKey(link)}><span>Recurso relacionado no disponible</span><div><button type="button" className="link-button" onClick={() => removeLink(link)}>Quitar relación</button><button type="button" className="link-button" onClick={() => { setReplacing(link); setSourceQuery(''); }}>Reemplazar</button></div></div>)}</div>}{replacing && <div className="visual-replacement"><label className="field"><span className="field__label">Reemplazar recurso no disponible</span><select value="" onChange={event => replaceLink(event.target.value)}><option value="">Selecciona un recurso disponible</option>{options.map(option => <option value={visualSourceKey(option)} key={visualSourceKey(option)}>{VISUAL_LINK_LABEL[option.kind]} · {option.title}</option>)}</select></label><button type="button" className="link-button" onClick={() => setReplacing(undefined)}>Cancelar reemplazo</button></div>}{links.some(link => options.some(option => visualSourceKey(option) === visualSourceKey(link) && option.personal)) && <p className="visual-small">Una nota personal puede acompañar tu proyecto privado. Para publicar el proyecto, relaciona únicamente recursos accesibles al grupo.</p>}</section>
      <section className="visual-surface"><div className="visual-section-heading"><div><h2>Modelos y referencias</h2><p className="visual-small">Guarda enlaces a modelos, documentación o bibliotecas, junto con su procedencia.</p></div><button type="button" className="secondary" disabled={resources.length >= VISUAL_PROJECT_LIMITS.resources} onClick={() => setResources([...resources, { label: '', url: '' }])}><Icon name="plus" size={15} /> Añadir enlace</button></div>{!resources.length && <p className="visual-small">Puedes añadirlos después. El <Link to={visualProviderDirectoryUrl(project?.id)} target="_blank" rel="noopener noreferrer">directorio de proveedores</Link> te ayudará a encontrarlos.</p>}{resources.map((resource, index) => <fieldset className="visual-resource-editor" key={index}><legend>Recurso {index + 1}</legend><div className="visual-two-fields">{(['label', 'url', 'provider', 'author', 'format', 'license'] as const).map(field => <label className="field" key={field}><span className="field__label">{{ label: 'Nombre del recurso', url: 'Enlace HTTPS', provider: 'Proveedor', author: 'Autor del modelo', format: 'Formato', license: 'Licencia conocida' }[field]}</span><input value={resource[field] ?? ''} type={field === 'url' ? 'url' : 'text'} required={field === 'label' || field === 'url'} maxLength={field === 'url' ? VISUAL_PROJECT_LIMITS.url : field === 'label' ? 180 : 300} placeholder={field === 'url' ? 'https://' : undefined} onChange={event => setResources(resources.map((row, at) => at === index ? { ...row, [field]: event.target.value } : row))} /></label>)}</div><button type="button" className="link-button" onClick={() => setResources(resources.filter((_, at) => at !== index))}>Quitar recurso {index + 1}</button></fieldset>)}</section>
    </fieldset><aside className="visual-editor-aside"><section className="visual-surface visual-cover-editor"><h2>Portada</h2><ProjectCover project={{ id: project?.id ?? 'nuevo', kind, coverFileId: project?.coverFileId }} localFile={coverFile} /><p className="visual-small">Cada tipo incluye una portada. También puedes usar una imagen propia.</p><label className="field"><span className="field__label">Imagen de portada</span><input key={coverInputKey} type="file" accept="image/png,image/jpeg,image/webp" disabled={queue.busy || action.pending} onChange={event => { const file = event.target.files?.[0]; if (!file) return; const error = visualProjectCoverError(file.name, file.type, file.size); setCoverError(error ?? ''); if (error) return; if (queue.items.length) { setCoverError('Quita primero la imagen seleccionada para elegir otra.'); return; } queue.addFiles([file]); setCoverFile(file); }} /><span className="visual-small">PNG, JPEG o WebP · hasta 5 MiB.</span></label>{coverError && <p className="error" role="alert">{coverError}</p>}<UploadFileList items={queue.items} disabled={queue.busy} onRemove={id => { void queue.remove(id).then(() => { setCoverFile(undefined); setCoverError(''); setCoverInputKey(value => value + 1); }); }} onCancel={() => queue.cancel()} />{queue.error && <p className="error" role="alert">{queue.error}</p>}</section><section className="visual-surface visual-save-panel"><div className="visual-privacy"><Icon name={project?.visibility === 'group' ? 'users' : 'lock'} size={17} /><strong>{project?.visibility === 'group' ? 'Visible para el grupo' : 'Solo tú puedes verlo'}</strong></div><p className="visual-small">{project?.visibility === 'group' ? 'Los cambios guardados actualizarán la ficha compartida.' : 'Cuando estés listo, podrás publicar la ficha desde el proyecto.'}</p>{stale && <p className="error" role="alert">La ficha cambió desde que abriste el editor. Conservamos lo que escribiste; revisa la versión guardada antes de reemplazar cambios.</p>}{action.error && <p className="error" role="alert">{action.error}</p>}<button type="submit" className="visual-save" disabled={action.pending || queue.busy || Boolean(stale)}>{queue.busy ? 'Subiendo portada…' : action.pending ? 'Guardando…' : savedId ? queue.pendingCount ? 'Reintentar portada' : 'Abrir proyecto guardado' : project ? 'Guardar cambios' : 'Crear proyecto privado'}</button>{savedId && action.error && <Link to={`${BASE}/${savedId}`} className="visual-small">Abrir la ficha guardada</Link>}<Link to={project ? `${BASE}/${project.id}` : BASE} className="visual-small">Cancelar</Link></section></aside></form></div>;
}

export function VisualProjectPage() {
  return <WorkspaceGate><VisualProjectDetail /></WorkspaceGate>;
}
function VisualProjectDetail() {
  const source = useDataSource();
  const data = useSnapshot();
  const { projectId } = useParams();
  const project = (data.visualProjects ?? []).find(row => row.id === projectId);
  const action = useAction();
  const [notice, setNotice] = useState('');
  if (!project) return <Empty icon="lock" title="Este proyecto no está disponible" action={<Link className="button" to={BASE}>Volver al laboratorio</Link>}>Puede ser privado, estar archivado o haber cambiado de disponibilidad.</Empty>;
  const owner = project.authorId === data.me?.id;
  const options = visualAcademicOptions(data);
  const subjects = visualProjectSubjects(project, options).map(id => data.subjects.find(subject => subject.id === id)).filter(subject => subject !== undefined);
  const term = data.terms.find(row => row.id === project.termId);
  async function visibility() {
    const result = await action.run(async () => { await source.setVisualProjectVisibility(project!.id, project!.visibility === 'personal' ? 'group' : 'personal', project!.version); return true; });
    if (result) setNotice(project!.visibility === 'personal' ? 'Proyecto publicado para el grupo.' : 'El proyecto vuelve a ser privado.');
  }
  async function archive() {
    const result = await action.run(async () => { await source.archiveVisualProject(project!.id, !project!.archived, project!.version); return true; });
    if (result) setNotice(project!.archived ? 'Proyecto restaurado.' : 'Proyecto archivado. Solo tú puedes consultarlo.');
  }
  const unavailable = owner ? [...new Map([...(project.unavailableLinks ?? []), ...project.links.filter(link => !options.some(option => visualSourceKey(option) === visualSourceKey(link)))]
    .map(link => [visualSourceKey(link), link])).values()] : [];
  async function removeUnavailable(link: VisualProjectLink) {
    const result = await action.run(async () => {
      const allLinks = [...new Map([...project!.links, ...(project!.unavailableLinks ?? [])].map(value => [visualSourceKey(value), value])).values()];
      const metadata = cleanVisualProjectInput({ ...project, links: allLinks });
      await source.saveVisualProject({ ...metadata, id: project!.id, expectedVersion: project!.version,
        links: metadata.links.filter(value => visualSourceKey(value) !== visualSourceKey(link)), removedLinks: [link] });
      return true;
    });
    if (result) setNotice('Relación retirada del proyecto.');
  }
  return <article className="visual-page visual-detail">
    <Link className="visual-back" to={BASE}><Icon name="back" size={15} /> Volver al laboratorio</Link>
    <header className="visual-header"><div><p className="visual-eyebrow">{VISUAL_KIND_LABEL[project.kind]}</p><h1>{project.title}</h1>
      <div className="visual-detail-byline"><span className="visual-preparation">{project.hasScene ? 'Escena 3D disponible' : 'Ficha en preparación'}</span><span>{authorName(data, project.authorId)}</span><span>Actualizado el {date(project.updatedAt)}</span><VisibilityBadge project={project} /></div>
    </div>{owner && !project.archived && <Link to={`${BASE}/${project.id}/editar`} className="button secondary"><Icon name="edit" size={16} /> Editar ficha</Link>}</header>
    <nav className="visual-detail-tabs" aria-label="Secciones del proyecto"><Link to={`${BASE}/${project.id}`} aria-current="page">Ficha</Link><Link to={`${BASE}/${project.id}/escena`}>Escena 3D</Link></nav>
    <VisualJourney projectId={project.id} canEdit={owner && !project.archived} compact />
    <div className="visual-detail-layout"><div className="visual-detail-main">
      <ProjectCover project={project} large />
      <section className="visual-surface"><div className="visual-section-heading"><div><p className="visual-eyebrow">Explorar y comprender</p><h2>{project.hasScene ? 'Entra en la explicación' : 'Una escena para tu proyecto'}</h2></div><Link className="button secondary" to={`${BASE}/${project.id}/escena${owner && !project.archived && !project.hasScene ? '/editar' : ''}`}>{project.hasScene ? 'Explorar escena 3D' : owner && !project.archived ? 'Preparar escena 3D' : 'Consultar escena'}</Link></div><p className="visual-small">{project.hasScene ? 'Gira los modelos, consulta sus etiquetas y recorre las vistas y pasos guardados.' : 'Importa modelos GLB, identifica sus piezas y prepara etiquetas, vistas y pasos. La escena se guarda por separado de esta ficha.'}</p></section>
      {project.archived && <p className="visual-archive-notice" role="status">Este proyecto está archivado y solo tú puedes verlo. Restáuralo para continuar.</p>}
      <section className="visual-surface"><h2>Sobre este proyecto</h2><p className="visual-prose">{project.description || 'Este proyecto todavía no tiene descripción.'}</p>
        {project.objective && <><h3>Objetivo de aprendizaje</h3><p className="visual-prose">{project.objective}</p></>}{project.topic && <p><strong>Tema:</strong> {project.topic}</p>}
        {project.tags.length > 0 && <div className="visual-subjects">{project.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
      </section>
      <section className="visual-surface"><div className="visual-section-heading"><h2>Modelos y referencias</h2><Link to={visualProviderDirectoryUrl(project.id)}>Buscar modelos</Link></div>
        {project.resources.length ? <ul className="visual-resource-list">{project.resources.map((resource, index) => <li key={`${resource.url}:${index}`}>
          <a href={resource.url} target="_blank" rel="noopener noreferrer">{resource.label}<ArrowUpRight aria-hidden="true" /></a>
          <div className="visual-small">{[resource.provider, resource.author && `Autor: ${resource.author}`, resource.format].filter(Boolean).join(' · ')}</div>
          <p className="visual-small">{resource.license ? `Licencia: ${resource.license}` : 'Licencia por verificar en el sitio original.'}</p>
        </li>)}</ul> : <p className="visual-small">Todavía no hay enlaces guardados. Consulta el <Link to={visualProviderDirectoryUrl(project.id)}>directorio de proveedores</Link> para encontrar modelos y materiales.</p>}
      </section>
    </div><aside className="visual-detail-aside">
      <section className="visual-surface"><h2>Contexto académico</h2>
        {subjects.length ? <ul className="visual-context-list">{subjects.map(subject => <li key={subject.id}><Link to={`/m/materias/${subject.id}`}>{subject.name}</Link><small>Cuatrimestre {subject.period}</small></li>)}</ul> : <p className="visual-small">Sin materia asignada.</p>}
        {term && <p className="visual-small">{term.name}</p>}
        {project.links.some(link => options.some(option => visualSourceKey(option) === visualSourceKey(link))) && <><h3>Recursos relacionados</h3><ul className="visual-context-list">{project.links.map(link => {
          const option = options.find(row => visualSourceKey(row) === visualSourceKey(link));
          return option ? <li key={visualSourceKey(link)}><Link to={option.href}>{option.title}</Link><small>{VISUAL_LINK_LABEL[option.kind]}</small></li> : null;
        })}</ul></>}
        {unavailable.length > 0 && <div className="visual-reference-review" role="status"><p>Hay referencias por revisar. Sus relaciones se conservan hasta que decidas quitarlas o reemplazarlas.</p>{unavailable.map(link => <div className="visual-unavailable" key={visualSourceKey(link)}><span>Recurso relacionado no disponible</span>{!project.archived && <div><button className="link-button" type="button" disabled={action.pending} onClick={() => void removeUnavailable(link)}>Quitar relación</button><Link to={`${BASE}/${project.id}/editar`} state={{ replaceVisualLink: link }}>Reemplazar</Link></div>}</div>)}</div>}
      </section>
      {owner && <section className="visual-surface"><h2>Disponibilidad</h2><p className="visual-small">{project.archived ? 'El archivo conserva la ficha y sus referencias.' : project.visibility === 'personal' ? 'La ficha y su portada son privadas. Publica cuando quieras compartirlas con el grupo.' : 'El grupo puede consultar esta ficha. Solo tú puedes editarla.'}</p>
        <div className="visual-detail-actions">{!project.archived && <button type="button" disabled={action.pending} onClick={() => void visibility()}>{project.visibility === 'personal' ? 'Publicar para el grupo' : 'Volver a privado'}</button>}
          <button type="button" className="secondary" disabled={action.pending} onClick={() => void archive()}>{project.archived ? 'Restaurar proyecto' : 'Archivar proyecto'}</button></div>
        {action.error && <p className="error" role="alert">{action.error}</p>}{notice && <p className="visual-small" role="status">{notice}</p>}
      </section>}
    </aside></div>
  </article>;
}
