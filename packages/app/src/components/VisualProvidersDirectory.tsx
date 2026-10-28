import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowUpRight, Cube01, SearchLg } from '@untitledui/icons';
import { cleanVisualProjectInput, VISUAL_PROJECT_LIMITS, type VisualProject, type VisualProjectResource } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { matches } from '../lib/search';
import { VISUAL_PROVIDERS, VISUAL_PROJECT_PATH, visualProviderResource, visualResourceUrlKey, type VisualProvider } from '../lib/visualProjects';
import { Empty } from './Empty';

export function VisualProvidersDirectory() {
  const data = useSnapshot();
  const [params] = useSearchParams();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [selected, setSelected] = useState<{ provider: VisualProvider; actor: string }>();
  const providers = VISUAL_PROVIDERS.filter(provider => (!type || provider.type === type)
    && matches(query, provider.name, provider.area, provider.description, provider.formats));
  const context = data.visualProjects.find(project => project.id === params.get('proyecto')
    && project.authorId === data.me?.id && !project.archived);
  return <section className="visual-providers">
    <div className="visual-provider-intro"><div><p className="visual-eyebrow">Una biblioteca de puntos de partida</p><h2>Encuentra las piezas de tu proyecto</h2>
      <p>Busca modelos en sus bibliotecas originales y guarda la referencia en una ficha, con su procedencia.</p></div><span className="visual-badge">8 proveedores</span></div>
    {context && <p className="visual-provider-context">Buscando recursos para <Link to={`${VISUAL_PROJECT_PATH}/${context.id}`}>{context.title}</Link>.</p>}
    <div className="visual-provider-note"><Cube01 aria-hidden="true" /><p><strong>Un modelo es el punto de partida.</strong> Los archivos CAD requieren conversión para usarlos en web. Descargarlos no garantiza piezas separadas, animaciones ni comportamiento de simulación.</p></div>
    <div className="visual-toolbar"><label className="visual-search"><SearchLg aria-hidden="true" /><input type="search" aria-label="Buscar proveedores" value={query} onChange={event => setQuery(event.target.value)} placeholder="Busca hardware, formatos o proveedores…" /></label>
      <select value={type} onChange={event => setType(event.target.value)} aria-label="Filtrar proveedores"><option value="">Todas las bibliotecas</option><option value="CAD">CAD · requiere conversión</option><option value="Web">Formatos para web</option><option value="Escenas">Objetos y entornos</option></select></div>
    <div className="visual-provider-grid">{providers.map(provider => <article className="visual-provider-card" key={provider.id} aria-label={provider.name}>
      <div className="visual-provider-top"><span className="visual-provider-monogram">{provider.initials}</span><span className="visual-badge">{provider.type === 'CAD' ? 'CAD · conversión' : provider.type === 'Web' ? 'Formatos web' : 'Objetos y entornos'}</span></div>
      <h3>{provider.name}</h3><span className="visual-provider-area">{provider.area}</span><p>{provider.description}</p>
      <dl><div><dt>Formatos</dt><dd>{provider.formats}</dd></div><div><dt>Acceso</dt><dd>{provider.access}</dd></div></dl><p className="visual-provider-conditions">{provider.conditions}</p>
      <div className="visual-provider-links"><a href={provider.catalogUrl} target="_blank" rel="noopener noreferrer">Buscar modelos <ArrowUpRight aria-hidden="true" /></a>
        <a href={provider.informationUrl} target="_blank" rel="noopener noreferrer">{provider.informationLabel} <ArrowUpRight aria-hidden="true" /></a></div>
      <button type="button" className="secondary visual-add-provider" onClick={() => setSelected({ provider, actor: data.me!.id })}>Añadir referencia a un proyecto</button>
    </article>)}</div>
    {!providers.length && <Empty icon="search" title="No encontramos proveedores con esos filtros">Prueba otro formato o especialidad.</Empty>}
    <p className="visual-small">Guardar una biblioteca registra su procedencia. La autoría, el formato y la licencia de un modelo concreto se completan al elegir ese activo.</p>
    {selected && selected.actor === data.me?.id && <ProviderReferenceDialog key={`${selected.actor}:${selected.provider.id}`} provider={selected.provider} context={context} onClose={() => setSelected(undefined)} />}
  </section>;
}

function ProviderReferenceDialog({ provider, context, onClose }: { provider: VisualProvider; context?: VisualProject; onClose(): void }) {
  const data = useSnapshot();
  const source = useDataSource();
  const navigate = useNavigate();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const live = useRef(true);
  const actor = useRef(data.me?.id);
  const submitting = useRef(false);
  const [selection, setSelection] = useState(context?.id ?? '');
  const [base, setBase] = useState<VisualProject | undefined>(context);
  const [resource, setResource] = useState<VisualProjectResource>(() => visualProviderResource(provider));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ id: string; duplicate: boolean }>();
  const projects = data.visualProjects.filter(project => project.authorId === actor.current && !project.archived);
  const current = projects.find(project => project.id === selection);
  useEffect(() => {
    live.current = true;
    const node = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    if (node && typeof node.showModal === 'function') node.showModal();
    else node?.setAttribute('open', '');
    return () => { live.current = false; if (node?.open && typeof node.close === 'function') node.close(); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  function choose(value: string) {
    setSelection(value); setBase(projects.find(project => project.id === value)); setSuccess(undefined); setError('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    let cleaned: VisualProjectResource;
    let url: string;
    try {
      cleaned = cleanVisualProjectInput({ title: 'Referencia', kind: '3d', resources: [resource] }).resources[0]!;
      url = visualResourceUrlKey(cleaned.url);
    }
    catch (error) { setError(error instanceof Error ? error.message : 'Revisa la referencia.'); return; }
    if (source.getSnapshot().me?.id !== actor.current) { onClose(); return; }
    if (selection === 'new') {
      navigate(`${VISUAL_PROJECT_PATH}/nuevo?proveedor=${provider.id}`, { state: { visualProviderResource: cleaned, visualProviderId: provider.id } });
      onClose(); return;
    }
    if (!base || !current) { setError('Selecciona un proyecto propio disponible o crea uno nuevo.'); return; }
    if (current.resources.some(value => {
      try { return visualResourceUrlKey(value.url) === url; } catch { return false; }
    })) { setSuccess({ id: current.id, duplicate: true }); return; }
    submitting.current = true; setPending(true);
    try {
      const links = [...new Map([...base.links, ...(base.unavailableLinks ?? [])].map(link => [`${link.kind}:${link.id}`, link])).values()];
      const metadata = cleanVisualProjectInput({ ...base, links, resources: [...base.resources, cleaned] });
      await source.saveVisualProject({ ...metadata, id: base.id, expectedVersion: base.version });
      if (live.current && source.getSnapshot().me?.id === actor.current) setSuccess({ id: base.id, duplicate: false });
    } catch (error) {
      if (live.current && source.getSnapshot().me?.id === actor.current) setError(error instanceof Error ? error.message : 'No se pudo guardar la referencia.');
    } finally { submitting.current = false; if (live.current) setPending(false); }
  }
  const fieldNames = { label: 'Nombre de la referencia', url: 'Enlace HTTPS de la referencia', author: 'Autor del modelo', format: 'Formato del modelo', license: 'Licencia del modelo' } as const;
  return <dialog ref={dialog} className="visual-provider-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="visual-dialog-heading"><div><p className="visual-eyebrow">{provider.name}</p><h2 id={titleId}>Añadir referencia a un proyecto</h2></div><button type="button" className="link-button" onClick={onClose} aria-label="Cerrar referencia de proveedor">Cerrar</button></div>
    <p className="visual-small">Esta referencia guarda una biblioteca o la página de un modelo. Los archivos se consultan en el sitio original.</p>
    <form onSubmit={submit} aria-label="Referencia del proveedor"><fieldset disabled={pending || Boolean(success)}>
      <label className="field"><span className="field__label">Proyecto de destino</span><select required value={selection} onChange={event => choose(event.target.value)}><option value="">Selecciona un proyecto</option>{projects.map(project => <option value={project.id} key={project.id}>{project.title}</option>)}<option value="new">Crear un proyecto nuevo</option></select></label>
      {Object.entries(fieldNames).map(([field, label]) => <label className="field" key={field}><span className="field__label">{label}</span><input value={resource[field as keyof typeof fieldNames] ?? ''} required={field === 'label' || field === 'url'} type={field === 'url' ? 'url' : 'text'} maxLength={field === 'url' ? VISUAL_PROJECT_LIMITS.url : field === 'label' ? 180 : 300}
        onChange={event => setResource(previous => ({ ...previous, [field]: event.target.value }))} /></label>)}
      <p className="visual-small">Autor, formato y licencia son opcionales. No se deducen de las condiciones generales del proveedor.</p>
    </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      {base && current && base.version !== current.version && !success && <button className="link-button" type="button" disabled={pending} onClick={() => { setBase(current); setError(''); }}>Usar la versión actual del proyecto</button>}
      {success ? <div className="visual-provider-success" role="status"><p>{success.duplicate ? 'Esta referencia ya está guardada en el proyecto.' : 'Referencia guardada en el proyecto.'}</p><Link className="button" to={`${VISUAL_PROJECT_PATH}/${success.id}`} onClick={onClose}>Volver al proyecto</Link></div>
        : <div className="visual-dialog-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button type="submit" disabled={pending || !selection}>{pending ? 'Guardando…' : selection === 'new' ? 'Continuar a la nueva ficha' : 'Guardar referencia'}</button></div>}
    </form>
  </dialog>;
}
