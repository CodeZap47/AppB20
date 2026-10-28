import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Link, useParams } from 'react-router';
import { cleanVisualSceneDocument, emptyVisualFrame, identityVisualTransform, parseGlbManifest, validateVisualSceneAssets,
  visualSceneAssetIds, VISUAL_SCENE_LIMITS, formatBytes, type VisualAnnotation, type VisualFrame, type VisualModelAsset,
  type VisualModelInstance, type VisualNodeRef, type VisualQuaternion, type VisualScene, type VisualSceneDocument,
  type VisualTransform, type VisualVec3 } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { VisualJourney } from '../components/VisualJourney';
import { deleteVisualSceneDraft, readVisualSceneDraft, writeVisualSceneDraft, type VisualSceneDraft } from '../lib/visualSceneDrafts';
import type { VisualSceneCanvasHandle } from '../components/visual3d/VisualSceneCanvas';
import type { VisualSceneRuntimeStatus } from '../components/visual3d/types';
import './VisualProjectsPage.css';
import './VisualScenePage.css';

const VisualSceneCanvas = lazy(() => import('../components/visual3d/VisualSceneCanvas'));
const BASE = '/m/laboratorio-visual';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sameNode = (a: VisualNodeRef | undefined, b: VisualNodeRef | undefined) => a?.instanceId === b?.instanceId && a?.nodeIndex === b?.nodeIndex;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación. Reintenta.';
const uuid = () => crypto.randomUUID();
type Capture = { kind: 'base' } | { kind: 'view' | 'step'; id: string };
type ImportItem = { id: string; file: File; state: 'queued' | 'validating' | 'uploading' | 'ready' | 'error' | 'cancelled'; progress: number; error?: string };

export function VisualScenePage({ editing = false }: { editing?: boolean }) {
  const data = useSnapshot(); const { projectId } = useParams();
  const project = data.visualProjects.find(row => row.id === projectId);
  if (data.connection !== 'ready' || data.me?.status !== 'active') return <Empty icon="lock" title="Conecta con el grupo para abrir la escena">Tus modelos requieren una sesión activa.</Empty>;
  if (!project) return <Empty icon="lock" title="Esta escena no está disponible" action={<Link to={BASE}>Volver al laboratorio</Link>}>El proyecto puede ser privado o haber cambiado de disponibilidad.</Empty>;
  if (editing && (project.authorId !== data.me.id || project.archived)) return <Empty icon="lock" title="Esta escena solo se puede consultar" action={<Link to={`${BASE}/${project.id}/escena`}>Explorar escena</Link>}>Solo su autor puede editarla. Un proyecto archivado debe restaurarse primero.</Empty>;
  return <SceneWorkspace key={`${data.me.id}:${project.id}:${editing}`} projectId={project.id} editing={editing} />;
}

function SceneWorkspace({ projectId, editing }: { projectId: string; editing: boolean }) {
  const source = useDataSource(); const data = useSnapshot(); const identity = data.me!.id;
  const project = data.visualProjects.find(row => row.id === projectId)!;
  const [loaded, setLoaded] = useState<VisualScene>();
  const [document, setDocument] = useState<VisualSceneDocument>();
  const documentRef = useRef(document); documentRef.current = document;
  const [loadError, setLoadError] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [retry, setRetry] = useState(0);
  const [capture, setCapture] = useState<Capture>({ kind: 'base' });
  const [exploration, setExploration] = useState<VisualFrame>();
  const [selected, setSelected] = useState<VisualNodeRef>(); const [selectedInstance, setSelectedInstance] = useState<string>();
  const [anchor, setAnchor] = useState<{ node: VisualNodeRef; point: VisualVec3 }>();
  const [mode, setMode] = useState<'orbit' | 'translate' | 'rotate' | 'scale'>('orbit');
  const [undo, setUndo] = useState<VisualSceneDocument[]>([]); const [redo, setRedo] = useState<VisualSceneDocument[]>([]);
  const [recovered, setRecovered] = useState<VisualSceneDraft>(); const [draftUnavailable, setDraftUnavailable] = useState(false);
  const [conflict, setConflict] = useState<VisualScene>(); const [reviewing, setReviewing] = useState(false);
  const [label, setLabel] = useState(''); const [viewName, setViewName] = useState(''); const [stepTitle, setStepTitle] = useState('');
  const [imports, setImports] = useState<ImportItem[]>([]); const importsRef = useRef(imports); importsRef.current = imports;
  const importRunning = useRef(false); const activeImport = useRef<{ id: string; controller: AbortController } | undefined>(undefined);
  const [cleanupOpen, setCleanupOpen] = useState(false); const [cleaning, setCleaning] = useState(false);
  const [runtime, setRuntime] = useState<VisualSceneRuntimeStatus>({ loading: false });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const alive = useRef(true); const renderer = useRef<VisualSceneCanvasHandle>(null); const fileInput = useRef<HTMLInputElement>(null);
  const fitAfterImport = useRef(false); const saveRequest = useRef<{ key: string; id: string } | undefined>(undefined);
  const gesture = useRef<boolean | undefined>(undefined);
  const baseline = JSON.stringify(loaded?.document);
  const dirty = Boolean(document && JSON.stringify(document) !== baseline);
  const draftRef = useRef<{ dirty: boolean; value?: VisualSceneDraft }>({ dirty: false });
  draftRef.current = { dirty, value: document && loaded ? { ownerId: identity, projectId, version: loaded.version, document, savedAt: Date.now() } : undefined };
  const importBusy = imports.some(item => ['queued', 'validating', 'uploading'].includes(item.state));
  const canEdit = editing && !reviewing && !runtime.individualPreview;

  useEffect(() => {
    alive.current = true; let cancelled = false;
    setLoading(true); setLoadError('');
    void source.getVisualScene(projectId).then(async scene => {
      if (cancelled || source.getSnapshot().me?.id !== identity) return;
      setLoaded(scene); setDocument(clone(scene.document)); setSelected(scene.document.frame.selection); setLoading(false);
      if (editing) { const draft = await readVisualSceneDraft(identity, projectId); if (!cancelled && draft && JSON.stringify(draft.document) !== JSON.stringify(scene.document)) setRecovered(draft); }
    }, reason => { if (!cancelled) { setLoadError(errorText(reason)); setLoading(false); } });
    return () => { cancelled = true; alive.current = false; activeImport.current?.controller.abort(); };
  }, [source, projectId, identity, editing, retry]);

  useEffect(() => {
    if (!loaded || !project.sceneVersion || project.sceneVersion <= loaded.version || saving) return;
    let cancelled = false;
    void source.getVisualScene(projectId).then(scene => {
      if (cancelled || scene.version <= loaded.version) return;
      if (dirty) { setConflict(scene); setNotice('La escena guardada cambió. Conservamos tu borrador.'); }
      else { setLoaded(scene); setDocument(clone(scene.document)); setExploration(undefined); setSelected(undefined); setSelectedInstance(undefined); }
    }, () => { /* Existing scene stays available; the next save rechecks its version. */ });
    return () => { cancelled = true; };
  }, [source, projectId, project.sceneVersion, loaded?.version, saving, dirty]);

  useEffect(() => {
    if (!editing || !dirty || !document || !loaded) return;
    const timer = setTimeout(() => { void writeVisualSceneDraft({ ownerId: identity, projectId, version: loaded.version, document, savedAt: Date.now() }).then(persisted => { if (alive.current) setDraftUnavailable(!persisted); }, () => { if (alive.current) setDraftUnavailable(true); }); }, 250);
    return () => clearTimeout(timer);
  }, [editing, dirty, document, loaded?.version, identity, projectId]);
  useEffect(() => {
    const preserve = () => { const current = draftRef.current; if (editing && current.dirty && current.value && source.getSnapshot().me?.id === identity) void writeVisualSceneDraft(current.value).catch(() => undefined); };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (editing && draftRef.current.dirty) { preserve(); event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('beforeunload', beforeUnload); preserve(); };
  }, [editing, identity, projectId, source]);

  function commit(change: (draft: VisualSceneDocument) => void, grouped = false) {
    if (!canEdit || !documentRef.current) return;
    const previous = documentRef.current; const next = clone(previous); change(next);
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    if (!grouped || gesture.current !== true) setUndo(history => [...history.slice(-(VISUAL_SCENE_LIMITS.history - 1)), clone(previous)]);
    if (grouped && gesture.current !== undefined) gesture.current = true;
    setRedo([]); documentRef.current = next; setDocument(next); setError(''); setNotice('');
  }
  const frameFrom = (value: VisualSceneDocument, which = capture) => which.kind === 'view' ? value.views.find(row => row.id === which.id)?.frame ?? value.frame
    : which.kind === 'step' ? value.steps.find(row => row.id === which.id)?.frame ?? value.frame : value.frame;
  const shownDocument = reviewing && conflict ? conflict.document : document;
  const storedFrame = shownDocument ? frameFrom(shownDocument) : emptyVisualFrame();
  const frame = !editing && exploration ? exploration : storedFrame;
  function changeFrame(next: VisualFrame, grouped = false) {
    if (!editing) { setExploration(next); return; }
    commit(value => {
      if (capture.kind === 'base') value.frame = clone(next);
      else if (capture.kind === 'view') { const view = value.views.find(row => row.id === capture.id); if (view) view.frame = clone(next); }
      else { const step = value.steps.find(row => row.id === capture.id); if (step) step.frame = clone(next); }
    }, grouped);
  }
  function editFrame(change: (draft: VisualFrame) => void) { const next = clone(frame); change(next); changeFrame(next); }
  function chooseCapture(next: Capture) {
    const target = shownDocument ? frameFrom(shownDocument, next) : undefined;
    setCapture(next); setExploration(undefined); setSelected(target?.selection); setSelectedInstance(target?.selection?.instanceId); setAnchor(undefined);
  }
  const chooseNode = (node: VisualNodeRef | undefined) => {
    setSelected(node); setSelectedInstance(node?.instanceId); setAnchor(undefined);
    const next = clone(frame); if (node) next.selection = clone(node); else delete next.selection;
    if (canEdit) changeFrame(next); else if (!editing) setExploration(next);
  };
  const selectedModel = frame.instances.find(row => row.id === (selected?.instanceId ?? selectedInstance));
  const selectedAsset = loaded?.assets.find(row => row.id === selectedModel?.assetId);
  const selectedPart = selected && selectedAsset?.manifest?.nodes.find(row => row.index === selected.nodeIndex);
  const override = selected && selectedModel?.components.find(row => row.nodeIndex === selected.nodeIndex);
  const selectedTransform = selected ? override?.transform ?? selectedPart?.transform : selectedModel?.transform;
  const targetName = selected ? override?.alias || selectedPart?.name || `Pieza ${selected.nodeIndex + 1}` : selectedModel?.name;
  function updateTarget(change: (value: { transform: VisualTransform; visible: boolean; alias: string }) => void) {
    if (!selectedModel || !selectedTransform) return;
    editFrame(next => {
      const model = next.instances.find(row => row.id === selectedModel.id)!;
      const state = { transform: clone(selectedTransform), visible: selected ? override?.visible !== false : model.visible, alias: selected ? override?.alias ?? selectedPart?.name ?? '' : model.name };
      change(state);
      if (selected) {
        const part = model.components.find(row => row.nodeIndex === selected.nodeIndex) ?? { nodeIndex: selected.nodeIndex };
        Object.assign(part, state); if (!model.components.includes(part)) model.components.push(part);
      } else { model.transform = state.transform; model.visible = state.visible; model.name = state.alias; }
    });
  }
  function travelHistory(direction: 'undo' | 'redo') {
    const history = direction === 'undo' ? undo : redo; const next = history.at(-1);
    if (!next || !documentRef.current) return;
    const current = clone(documentRef.current);
    if (direction === 'undo') { setUndo(history.slice(0, -1)); setRedo(values => [...values, current]); }
    else { setRedo(history.slice(0, -1)); setUndo(values => [...values, current]); }
    documentRef.current = clone(next); setDocument(clone(next)); setError('');
  }
  async function save() {
    if (!documentRef.current || !loaded) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const clean = cleanVisualSceneDocument(documentRef.current); validateVisualSceneAssets(clean, loaded.assets);
      const key = `${loaded.version}:${JSON.stringify(clean)}`;
      if (saveRequest.current?.key !== key) saveRequest.current = { key, id: uuid() };
      const result = await source.saveVisualScene({ projectId, expectedVersion: loaded.version, document: clean, requestId: saveRequest.current.id });
      if (!alive.current || source.getSnapshot().me?.id !== identity) return;
      draftRef.current.dirty = false; setLoaded(result); setDocument(clone(result.document)); documentRef.current = clone(result.document);
      saveRequest.current = undefined; setUndo([]); setRedo([]); setConflict(undefined); setRecovered(undefined); setNotice('Escena guardada. Sus vistas y pasos ya están disponibles.');
      await deleteVisualSceneDraft(identity, projectId);
    } catch (reason) {
      if (!alive.current) return; const message = errorText(reason); setError(message);
      if (/versi[oó]n|cambi[oó]|conflict/i.test(message)) {
        try { const latest = await source.getVisualScene(projectId); if (alive.current) setConflict(latest); } catch { /* The draft remains available if access or connection changed. */ }
      }
    } finally { if (alive.current) setSaving(false); }
  }
  function downloadDraft() {
    if (!document) return; const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }));
    const link = window.document.createElement('a'); link.href = url; link.download = `borrador-escena-${projectId}.json`; link.click(); URL.revokeObjectURL(url);
  }
  function useSavedVersion() {
    if (!conflict || !window.confirm('¿Cargar la escena guardada? Tu borrador actual dejará de estar en el editor. Puedes descargarlo primero.')) return;
    draftRef.current.dirty = false; setLoaded(conflict); setDocument(clone(conflict.document)); documentRef.current = clone(conflict.document);
    setConflict(undefined); setReviewing(false); setUndo([]); setRedo([]); setCapture({ kind: 'base' }); setExploration(undefined);
    setSelected(conflict.document.frame.selection); setSelectedInstance(conflict.document.frame.selection?.instanceId); setAnchor(undefined); setError('');
    void deleteVisualSceneDraft(identity, projectId);
  }
  function toggleReview() {
    const next = !reviewing;
    const target = next ? conflict?.document : documentRef.current;
    setReviewing(next); setCapture({ kind: 'base' }); setExploration(undefined);
    setSelected(target?.frame.selection); setSelectedInstance(target?.frame.selection?.instanceId); setAnchor(undefined);
  }
  function recoverDraft() {
    if (!recovered || !loaded) return;
    documentRef.current = clone(recovered.document); setDocument(clone(recovered.document));
    setCapture({ kind: 'base' }); setExploration(undefined); setSelected(recovered.document.frame.selection); setSelectedInstance(recovered.document.frame.selection?.instanceId); setAnchor(undefined);
    if (recovered.version !== loaded.version) setConflict(loaded);
    setRecovered(undefined); setNotice('Borrador recuperado. Revisa la escena antes de guardarla.');
  }

  const loadAsset = useCallback(async (asset: VisualModelAsset, options?: { signal?: AbortSignal }) => {
    if (!asset.fileId) throw new Error('El modelo todavía no terminó de importarse.');
    return source.downloadResourceFile(asset.fileId, { signal: options?.signal });
  }, [source]);
  const runtimeStatus = useCallback((status: VisualSceneRuntimeStatus) => {
    setRuntime(status);
    if (fitAfterImport.current && !status.loading && !status.error && !status.individualPreview) {
      fitAfterImport.current = false; requestAnimationFrame(() => renderer.current?.fit());
    }
  }, []);
  const updateImport = (id: string, patch: Partial<ImportItem>) => setImports(values => values.map(item => item.id === id ? { ...item, ...patch } : item));
  function addInstance(asset: VisualModelAsset) {
    if (!documentRef.current) return;
    const current = frameFrom(documentRef.current);
    if (current.instances.length >= VISUAL_SCENE_LIMITS.instances) throw new Error('Esta captura admite hasta veinte instancias.');
    const ids = visualSceneAssetIds(documentRef.current);
    if (!ids.includes(asset.id) && ids.length >= VISUAL_SCENE_LIMITS.assets) throw new Error('La escena admite hasta diez archivos de modelos.');
    const bytes = ids.reduce((sum, id) => sum + (loaded?.assets.find(row => row.id === id)?.bytes ?? 0), 0) + (ids.includes(asset.id) ? 0 : asset.bytes ?? 0);
    if (bytes > VISUAL_SCENE_LIMITS.sceneBytes) throw new Error('Los archivos de la escena superarían 150 MiB.');
    const next = clone(current); const instance: VisualModelInstance = { id: uuid(), assetId: asset.id, name: asset.name.replace(/\.glb$/i, '').trim() || 'Modelo sin nombre', transform: identityVisualTransform(), visible: true, components: [] };
    next.instances.push(instance); delete next.selection; fitAfterImport.current = true; changeFrame(next); setSelected(undefined); setSelectedInstance(instance.id);
    setExpanded(values => new Set(values).add(instance.id));
  }
  async function runImport(item: ImportItem) {
    const controller = new AbortController(); activeImport.current = { id: item.id, controller };
    let asset: VisualModelAsset | undefined;
    updateImport(item.id, { state: 'validating', error: undefined, progress: 0 });
    try {
      if (!/\.glb$/i.test(item.file.name) || item.file.size <= 0 || item.file.size > VISUAL_SCENE_LIMITS.modelBytes) throw new Error('Selecciona un archivo GLB de hasta 50 MiB.');
      const bytes = new Uint8Array(await item.file.arrayBuffer()); if (controller.signal.aborted) throw new DOMException('Importación cancelada.', 'AbortError');
      parseGlbManifest(bytes);
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const seed = new TextEncoder().encode(`${projectId}:${item.file.name}:${Array.from(hash, v => v.toString(16).padStart(2, '0')).join('')}`);
      const requestHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', seed)), v => v.toString(16).padStart(2, '0')).join('');
      asset = await source.createVisualModelAsset(projectId, `import_${requestHash}`, item.file.name);
      if (asset.state === 'purged') asset = await source.createVisualModelAsset(projectId, uuid(), item.file.name);
      if (controller.signal.aborted) throw new DOMException('Importación cancelada.', 'AbortError');
      const linked = documentRef.current ? visualSceneAssetIds(documentRef.current) : [];
      if (!linked.includes(asset.id) && linked.length >= VISUAL_SCENE_LIMITS.assets) throw new Error('La escena admite hasta diez archivos de modelos.');
      const linkedBytes = linked.reduce((sum, id) => sum + (loaded?.assets.find(row => row.id === id)?.bytes ?? 0), 0);
      if (!linked.includes(asset.id) && linkedBytes + item.file.size > VISUAL_SCENE_LIMITS.sceneBytes) throw new Error('Los archivos de la escena superarían 150 MiB.');
      if (asset.state !== 'ready') {
        updateImport(item.id, { state: 'uploading' });
        await source.attachResourceFile('visual_model', asset.id, item.file, asset.version, { signal: controller.signal,
          onProgress: (received, total) => { if (alive.current) updateImport(item.id, { progress: total ? Math.round(received / total * 100) : 0 }); } });
      }
      const refreshed = await source.getVisualScene(projectId);
      if (!alive.current || source.getSnapshot().me?.id !== identity) return;
      setLoaded(previous => previous ? { ...previous, assets: refreshed.assets, capacity: refreshed.capacity } : refreshed);
      const ready = refreshed.assets.find(row => row.id === asset!.id);
      if (!ready || ready.state !== 'ready') throw new Error('El servidor todavía no confirmó el modelo. Reintenta con el mismo archivo.');
      if (controller.signal.aborted) throw new DOMException('Importación cancelada.', 'AbortError');
      addInstance(ready); updateImport(item.id, { state: 'ready', progress: 100 });
    } catch (reason) {
      if (!alive.current) return;
      if (asset && asset.state !== 'ready') { try { await source.discardResourceUpload('visual_model', asset.id, item.file); } catch { /* A later retry recovers the native upload receipt. */ } }
      updateImport(item.id, { state: controller.signal.aborted ? 'cancelled' : 'error', error: errorText(reason) });
    } finally { if (activeImport.current?.id === item.id) activeImport.current = undefined; }
  }
  function enqueue(files: File[]) {
    if (!canEdit || saving) return;
    const accepted = files.slice(0, VISUAL_SCENE_LIMITS.assets);
    if (accepted.length !== files.length) setError('Importa como máximo diez archivos a la vez.');
    setImports(values => [...values, ...accepted.map(file => ({ id: uuid(), file, state: 'queued' as const, progress: 0 }))]);
  }
  useEffect(() => {
    if (importRunning.current || !editing || !loaded || !document || reviewing) return;
    const next = imports.find(item => item.state === 'queued'); if (!next) return;
    importRunning.current = true;
    void runImport(next).finally(() => { importRunning.current = false; if (alive.current) setImports(values => [...values]); });
  }, [imports, editing, Boolean(loaded), Boolean(document), reviewing]);
  function cancelImport(id: string) {
    if (activeImport.current?.id === id) activeImport.current.controller.abort();
    else updateImport(id, { state: 'cancelled', error: 'Importación cancelada.' });
  }
  function drop(event: DragEvent) { event.preventDefault(); enqueue([...event.dataTransfer.files]); }
  const currentIds = document ? visualSceneAssetIds(document) : [];
  const savedIds = loaded ? visualSceneAssetIds(loaded.document) : [];
  const unused = loaded?.assets.filter(asset => asset.state === 'ready' && !currentIds.includes(asset.id) && !savedIds.includes(asset.id)) ?? [];
  async function cleanup() {
    if (!unused.length) return; setCleaning(true); setError('');
    try {
      await source.discardVisualModelAssets(projectId, unused.map(asset => ({ id: asset.id, expectedVersion: asset.version })));
      const refreshed = await source.getVisualScene(projectId); if (!alive.current) return;
      setLoaded(previous => previous ? { ...previous, assets: refreshed.assets, capacity: refreshed.capacity } : refreshed);
      setCleanupOpen(false); setNotice('Se liberó el espacio de los modelos sin uso.');
    } catch (reason) { if (alive.current) setError(errorText(reason)); }
    finally { if (alive.current) setCleaning(false); }
  }
  function removeInstance(id: string) {
    editFrame(next => { next.instances = next.instances.filter(instance => instance.id !== id); next.annotations = next.annotations.filter(annotation => annotation.node.instanceId !== id); if (next.selection?.instanceId === id) delete next.selection; });
    setSelected(undefined); setSelectedInstance(undefined);
  }
  function addAnnotation() {
    if (!selected || !label.trim()) return;
    if (frame.annotations.length >= VISUAL_SCENE_LIMITS.annotations) { setError('Esta captura admite hasta cien etiquetas.'); return; }
    const annotation: VisualAnnotation = { id: uuid(), text: label.trim(), node: clone(selected), anchor: sameNode(anchor?.node, selected) ? clone(anchor!.point) : [0, 0, 0], visible: true };
    editFrame(next => { next.annotations.push(annotation); }); setLabel('');
  }
  function saveCapture(kind: 'view' | 'step') {
    const title = (kind === 'view' ? viewName : stepTitle).trim(); if (!title) return;
    const snapshot = clone(frame); if (selected) snapshot.selection = clone(selected); else delete snapshot.selection;
    const id = uuid();
    commit(next => {
      if (kind === 'view') { if (next.views.length >= VISUAL_SCENE_LIMITS.views) throw new Error('La escena admite hasta cincuenta vistas.'); next.views.push({ id, name: title, frame: snapshot }); }
      else { if (next.steps.length >= VISUAL_SCENE_LIMITS.steps) throw new Error('La escena admite hasta cien pasos.'); next.steps.push({ id, title, description: '', frame: snapshot }); }
    });
    if (kind === 'view') setViewName(''); else setStepTitle('');
    setCapture({ kind, id }); setNotice(kind === 'view' ? 'Vista añadida al borrador.' : 'Paso añadido al borrador. Completa su explicación y guarda la escena.');
  }
  const selectedStep = document?.steps.find(row => capture.kind === 'step' && row.id === capture.id);
  const selectedView = document?.views.find(row => capture.kind === 'view' && row.id === capture.id);
  useEffect(() => {
    if (!shownDocument || capture.kind === 'base') return;
    const exists = capture.kind === 'view' ? shownDocument.views.some(row => row.id === capture.id) : shownDocument.steps.some(row => row.id === capture.id);
    if (!exists) { setCapture({ kind: 'base' }); setExploration(undefined); setSelected(shownDocument.frame.selection); setSelectedInstance(shownDocument.frame.selection?.instanceId); setAnchor(undefined); }
  }, [shownDocument, capture]);
  const stepIndex = shownDocument?.steps.findIndex(row => capture.kind === 'step' && row.id === capture.id) ?? -1;
  function changeStep(offset: number) { const step = shownDocument?.steps[stepIndex + offset]; if (step) chooseCapture({ kind: 'step', id: step.id }); }
  function duplicateCapture(kind: 'view' | 'step', id: string) {
    commit(next => {
      if (kind === 'view') { const value = next.views.find(row => row.id === id); if (value && next.views.length < VISUAL_SCENE_LIMITS.views) next.views.push({ ...clone(value), id: uuid(), name: `${value.name} (copia)`.slice(0, 180) }); }
      else { const value = next.steps.find(row => row.id === id); if (value && next.steps.length < VISUAL_SCENE_LIMITS.steps) next.steps.splice(next.steps.indexOf(value) + 1, 0, { ...clone(value), id: uuid(), title: `${value.title} (copia)`.slice(0, 180) }); }
    });
  }
  function reorderStep(id: string, offset: number) {
    commit(next => { const index = next.steps.findIndex(step => step.id === id); if (index < 0 || index + offset < 0 || index + offset >= next.steps.length) return; const [step] = next.steps.splice(index, 1); next.steps.splice(index + offset, 0, step!); });
  }
  function deleteCapture(kind: 'view' | 'step', id: string) {
    commit(next => { if (kind === 'view') next.views = next.views.filter(value => value.id !== id); else next.steps = next.steps.filter(value => value.id !== id); });
    if (capture.kind === kind && capture.id === id) chooseCapture({ kind: 'base' });
  }
  const safely = (action: () => void) => { try { action(); setError(''); } catch (reason) { setError(errorText(reason)); } };

  if (loading) return <section className="visual-page scene-loading" role="status"><h1>Abriendo escena 3D</h1><p>Preparando tus modelos, vistas y pasos…</p></section>;
  if (loadError || !loaded || !document) return <Empty icon="folder" title="No pudimos abrir la escena" action={<button onClick={() => setRetry(value => value + 1)}>Reintentar</button>}>{loadError || 'Vuelve a intentarlo.'}</Empty>;
  const selectedCaptureName = capture.kind === 'base' ? 'Escena principal' : capture.kind === 'view' ? shownDocument?.views.find(row => row.id === capture.id)?.name : shownDocument?.steps.find(row => row.id === capture.id)?.title;
  const freeBytes = Math.max(0, loaded.capacity.limitBytes - loaded.capacity.reservedBytes);

  return <article className="visual-page scene-page">
    <Link to={`${BASE}/${projectId}`} className="visual-back"><Icon name="back" size={15} /> Volver a la ficha</Link>
    <header className="scene-header"><div><p className="visual-eyebrow">Laboratorio visual · Escena 3D</p><h1>{project.title}</h1><p>{editing ? 'Importa, explora y prepara una explicación que puedas recorrer paso a paso.' : 'Explora las piezas, sus etiquetas y las capturas de esta explicación.'}</p></div>
      <div className="scene-header-actions">{editing ? <><span className="scene-save-status" role="status">{saving ? 'Guardando…' : dirty ? 'Cambios sin guardar' : loaded.version ? 'Escena guardada' : 'Sin cambios'}</span><button className="secondary" disabled={!canEdit || saving} onClick={() => fileInput.current?.click()}>Importar modelos</button><button onClick={() => void save()} disabled={!dirty || saving || importBusy || Boolean(conflict) || runtime.loading || Boolean(runtime.error) || runtime.individualPreview}>{saving ? 'Guardando…' : 'Guardar escena'}</button></> : project.authorId === identity && !project.archived && <Link className="button" to={`${BASE}/${projectId}/escena/editar`}>Editar escena</Link>}</div>
    </header>
    <nav className="scene-project-tabs" aria-label="Secciones del proyecto"><Link to={`${BASE}/${projectId}`}>Ficha</Link><Link to={`${BASE}/${projectId}/escena`} aria-current="page">Escena 3D</Link></nav>
    {project.archived && <p className="scene-notice">Proyecto archivado. Puedes consultar sus modelos; restáuralo para editar.</p>}
    {editing && project.visibility === 'group' && <p className="scene-notice">Al guardar, los cambios de la escena estarán disponibles para el grupo.</p>}
    {recovered && <section className="scene-notice" role="status"><strong>Hay un borrador de esta escena.</strong><p>Guardado en este dispositivo el {new Date(recovered.savedAt).toLocaleString('es-MX')}. Puedes recuperarlo antes de continuar.</p><div className="scene-inline-actions"><button onClick={recoverDraft}>Recuperar borrador</button><button className="secondary" onClick={() => { setRecovered(undefined); void deleteVisualSceneDraft(identity, projectId); }}>Descartar borrador</button></div></section>}
    {conflict && <section className="scene-conflict" role="alert"><strong>La escena guardada cambió.</strong><p>Tu borrador se conserva. Revisa la versión {conflict.version} antes de decidir qué recuperar.</p><div className="scene-inline-actions"><button className="secondary" onClick={toggleReview}>{reviewing ? 'Volver a mi borrador' : 'Revisar versión guardada'}</button><button className="secondary" onClick={downloadDraft}>Descargar mi borrador</button><button className="secondary" onClick={useSavedVersion}>Cargar versión guardada</button></div></section>}
    {draftUnavailable && dirty && <p className="scene-notice" role="status">El navegador no pudo conservar el borrador de forma permanente. Guarda la escena antes de cerrar esta página.</p>}
    {error && <p className="error scene-notice" role="alert">{error}</p>}{notice && <p className="scene-notice" role="status">{notice}</p>}
    <div className="scene-workspace">
      <aside className="scene-panel scene-model-panel" aria-label="Modelos y componentes">
        <div className="scene-panel-heading"><h2>Modelos y piezas</h2><span>{frame.instances.length}/20</span></div>
        {editing && <div className="scene-import"><input ref={fileInput} type="file" accept=".glb,model/gltf-binary" multiple hidden onChange={(event: ChangeEvent<HTMLInputElement>) => { enqueue([...(event.target.files ?? [])]); event.target.value = ''; }} /><button disabled={!canEdit || saving} onClick={() => fileInput.current?.click()}>Importar GLB</button><p>Hasta 50 MiB por archivo · 150 MiB por escena. Puedes arrastrarlos al visor.</p><p className="scene-capacity">Espacio compartido disponible: <strong>{formatBytes(freeBytes)}</strong></p></div>}
        {imports.length > 0 && <ul className="scene-transfer-list" aria-label="Importaciones">{imports.map(item => <li key={item.id}><strong>{item.file.name}</strong><span>{item.state === 'queued' ? 'En espera' : item.state === 'validating' ? 'Validando archivo…' : item.state === 'uploading' ? `Importando ${item.progress}%` : item.state === 'ready' ? 'Modelo preparado' : item.state === 'cancelled' ? 'Cancelado' : 'No se pudo importar'}</span>{item.state === 'uploading' && <progress value={item.progress} max={100} aria-label={`Progreso de ${item.file.name}`} />}{item.error && <p role="status">{item.error}</p>}<div>{['queued', 'validating', 'uploading'].includes(item.state) && <button className="link-button" onClick={() => cancelImport(item.id)}>Cancelar importación</button>}{['error', 'cancelled'].includes(item.state) && <button className="link-button" onClick={() => updateImport(item.id, { state: 'queued', error: undefined })}>Reintentar importación</button>}</div></li>)}</ul>}
        <div className="scene-tree" role="tree" aria-label="Componentes de la escena" onKeyDown={event => {
          const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.scene-tree-select')];
          const current = controls.indexOf(window.document.activeElement as HTMLButtonElement);
          const destination = event.key === 'ArrowDown' ? Math.min(controls.length - 1, current + 1) : event.key === 'ArrowUp' ? Math.max(0, current - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : -1;
          if (destination >= 0) { event.preventDefault(); controls[destination]?.focus(); }
          else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            const item = (event.target as HTMLElement).closest<HTMLElement>('[role=treeitem]');
            const toggle = item?.querySelector<HTMLButtonElement>(':scope > .scene-tree-row > .scene-tree-toggle');
            if (toggle && item?.getAttribute('aria-expanded') === (event.key === 'ArrowRight' ? 'false' : 'true')) { event.preventDefault(); toggle.click(); }
          }
        }}>{frame.instances.map(instance => {
          const asset = loaded.assets.find(row => row.id === instance.assetId); const open = expanded.has(instance.id);
          return <div className="scene-tree-model" key={instance.id} role="treeitem" aria-expanded={open}>
            <div className="scene-tree-row"><button className="scene-tree-toggle" aria-label={`${open ? 'Contraer' : 'Expandir'} ${instance.name}`} onClick={() => setExpanded(values => { const next = new Set(values); if (open) next.delete(instance.id); else next.add(instance.id); return next; })}>{open ? '−' : '+'}</button><button className="scene-tree-select" aria-pressed={!selected && selectedInstance === instance.id} onClick={() => { chooseNode(undefined); setSelectedInstance(instance.id); setAnchor(undefined); }}>{instance.name}</button>{!instance.visible && <span className="scene-tree-hidden">Oculto</span>}</div>
            {open && asset?.manifest && <div role="group">{asset.manifest.roots.map(index => <ComponentNode key={index} instance={instance} asset={asset} index={index} selected={selected} onSelect={chooseNode} expanded={expanded} setExpanded={setExpanded} depth={0} ancestors={[]} />)}</div>}
          </div>;
        })}</div>
        {!frame.instances.length && <p className="scene-muted">{editing ? 'Importa un modelo o añade uno de los archivos preparados.' : 'Esta captura todavía no contiene modelos.'}</p>}
        {editing && loaded.assets.some(asset => asset.state === 'ready') && <details className="scene-assets"><summary>Archivos preparados</summary>{loaded.assets.filter(asset => asset.state === 'ready').map(asset => <div key={asset.id}><span>{asset.name}<small>{formatBytes(asset.bytes ?? 0)}</small></span><button className="secondary" disabled={!canEdit} onClick={() => safely(() => addInstance(asset))}>Añadir instancia</button></div>)}</details>}
        {editing && <button className="scene-cleanup-button secondary" disabled={!unused.length || !canEdit || importBusy} onClick={() => { setError(''); setCleanupOpen(true); }}>Liberar modelos sin uso{unused.length ? ` (${unused.length})` : ''}</button>}
        {editing && <p className="scene-muted scene-footnote">Los archivos sin referencias guardadas se conservan siete días. Quitar un modelo de esta captura no elimina archivos utilizados por otras vistas o pasos.</p>}
      </aside>
      <main className="scene-stage">
        <div className="scene-stage-toolbar"><div className="scene-mode-buttons" role="group" aria-label="Herramienta del visor">{(['orbit', 'translate', 'rotate', 'scale'] as const).map(value => <button key={value} className="secondary" aria-pressed={mode === value} disabled={value !== 'orbit' && (!canEdit || !selectedModel)} onClick={() => setMode(value)}>{({ orbit: 'Cámara', translate: 'Mover', rotate: 'Girar pieza', scale: 'Escalar' })[value]}</button>)}</div><div className="scene-inline-actions"><button className="secondary" onClick={() => renderer.current?.fit()}>Encuadrar todo</button><button className="secondary" disabled={!selectedModel} onClick={() => renderer.current?.centerSelection()}>Centrar selección</button><button className="secondary" onClick={() => renderer.current?.resetCamera()}>Restaurar cámara</button></div></div>
        <div className="scene-canvas-shell" onDragOver={event => { if (canEdit) event.preventDefault(); }} onDrop={canEdit ? drop : undefined} onPointerDown={() => { gesture.current = false; }} onPointerUp={() => { gesture.current = undefined; }} onPointerCancel={() => { gesture.current = undefined; }}>
          <Suspense fallback={<div className="scene-canvas-placeholder" role="status">Preparando el visor 3D…</div>}><VisualSceneCanvas ref={renderer} frame={frame} assets={loaded.assets} loadAsset={loadAsset} editable={canEdit} selected={selected} selectedInstanceId={selected ? undefined : selectedInstance} mode={mode} onSelect={chooseNode} onPick={(node, point) => { chooseNode(node); setAnchor({ node, point }); }} onFrameChange={next => changeFrame(next, true)} onStatus={runtimeStatus} /></Suspense>
        </div>
        <div className="scene-stage-footer"><span>{reviewing ? 'Versión guardada · solo consulta' : selectedCaptureName}</span><span>Arrastra para girar · rueda o pellizco para acercar · toca una pieza para seleccionarla.</span>{editing && <div className="scene-inline-actions"><button className="secondary" disabled={!canEdit || !undo.length} onClick={() => travelHistory('undo')}>Deshacer</button><button className="secondary" disabled={!canEdit || !redo.length} onClick={() => travelHistory('redo')}>Rehacer</button></div>}</div>
        {capture.kind === 'step' && <section className="scene-current-step"><div className="scene-step-navigation"><button className="secondary" disabled={stepIndex <= 0} onClick={() => changeStep(-1)}>Anterior</button><span>Paso {stepIndex + 1} de {shownDocument?.steps.length}</span><button className="secondary" disabled={stepIndex < 0 || stepIndex >= (shownDocument?.steps.length ?? 0) - 1} onClick={() => changeStep(1)}>Siguiente</button></div>{canEdit && selectedStep ? <><label className="field"><span className="field__label">Título del paso</span><input value={selectedStep.title} maxLength={180} onChange={event => commit(value => { value.steps.find(step => step.id === selectedStep.id)!.title = event.target.value; })} /></label><label className="field"><span className="field__label">Explicación del paso</span><textarea value={selectedStep.description} rows={3} maxLength={6000} onChange={event => commit(value => { value.steps.find(step => step.id === selectedStep.id)!.description = event.target.value; })} placeholder="Explica qué observar en esta captura." /></label></> : <><h2>{shownDocument?.steps[stepIndex]?.title}</h2><p>{shownDocument?.steps[stepIndex]?.description || 'Observa los modelos y sus etiquetas.'}</p></>}</section>}
        {editing && <p className="scene-muted scene-capture-note">Estás editando {capture.kind === 'base' ? 'la escena principal' : capture.kind === 'view' ? 'una vista independiente' : 'un paso independiente'}. Sus cambios no alteran las demás capturas.</p>}
      </main>
      <aside className="scene-panel scene-inspector" aria-label="Detalles y capturas">
        <section><div className="scene-panel-heading"><h2>{targetName ? 'Selección' : 'Inspector'}</h2></div>{selectedModel && selectedTransform ? <><p className="scene-selection-title">{targetName}</p>{selected ? <p className="scene-muted">Pieza del archivo original · {selectedModel.name}</p> : <p className="scene-muted">Modelo completo · sus piezas conservarán su posición relativa.</p>}<label className="field"><span className="field__label">{selected ? 'Nombre de la pieza' : 'Nombre del modelo'}</span><input value={targetName ?? ''} maxLength={selected ? 180 : 200} disabled={!canEdit} onChange={event => updateTarget(value => { value.alias = event.target.value; })} /></label><label className="scene-check"><input type="checkbox" checked={selected ? override?.visible !== false : selectedModel.visible} disabled={!canEdit} onChange={event => updateTarget(value => { value.visible = event.target.checked; })} />Visible en esta captura</label><TransformFields value={selectedTransform} disabled={!canEdit} onChange={transform => updateTarget(value => { value.transform = transform; })} /><div className="scene-inline-actions"><button className="secondary" disabled={!canEdit} onClick={() => { if (selected) editFrame(next => { const model = next.instances.find(row => row.id === selected.instanceId)!; const component = model.components.find(row => row.nodeIndex === selected.nodeIndex); if (component) { delete component.transform; delete component.visible; } }); else updateTarget(value => { value.transform = identityVisualTransform(); value.visible = true; }); }}>Restaurar posición</button>{!selected && <><button className="secondary" disabled={!canEdit || frame.instances.length >= VISUAL_SCENE_LIMITS.instances} onClick={() => editFrame(next => { next.instances.push({ ...clone(selectedModel), id: uuid(), name: `${selectedModel.name} (copia)`.slice(0, 200) }); })}>Duplicar modelo</button><button className="secondary" disabled={!canEdit} onClick={() => removeInstance(selectedModel.id)}>Quitar de esta captura</button></>}</div></> : <p className="scene-muted">Selecciona un modelo o una pieza para ver sus detalles. Las piezas disponibles dependen de cómo se preparó el archivo.</p>}</section>
        <section><div className="scene-panel-heading"><h2>Etiquetas</h2><span>{frame.annotations.length}/100</span></div>{canEdit && <div className="scene-new-label"><label className="field"><span className="field__label">Nueva etiqueta</span><input value={label} maxLength={500} onChange={event => setLabel(event.target.value)} placeholder="Por ejemplo: memoria RAM" disabled={!selected} /></label><button disabled={!selected || !label.trim() || frame.annotations.length >= 100} onClick={addAnnotation}>Añadir etiqueta</button><p className="scene-muted">{selected ? 'La etiqueta se ancla al punto que tocaste. Desde el árbol se coloca en el origen de la pieza.' : 'Selecciona primero una pieza del modelo.'}</p></div>}<ul className="scene-label-list">{frame.annotations.map(annotation => <li key={annotation.id}><button className="scene-label-focus" onClick={() => chooseNode(annotation.node)} aria-label={`Seleccionar pieza de ${annotation.text}`}>↗</button>{canEdit ? <input aria-label={`Texto de etiqueta ${annotation.text}`} value={annotation.text} maxLength={500} onChange={event => editFrame(next => { next.annotations.find(row => row.id === annotation.id)!.text = event.target.value; })} /> : <span>{annotation.text}</span>}<label className="scene-label-visible"><input type="checkbox" aria-label={`Mostrar etiqueta ${annotation.text}`} checked={annotation.visible} disabled={!canEdit} onChange={event => editFrame(next => { next.annotations.find(row => row.id === annotation.id)!.visible = event.target.checked; })} /><span className="sr-only">Visible</span></label>{canEdit && <button className="link-button" aria-label={`Eliminar etiqueta ${annotation.text}`} onClick={() => editFrame(next => { next.annotations = next.annotations.filter(row => row.id !== annotation.id); })}>×</button>}</li>)}</ul>{!frame.annotations.length && <p className="scene-muted">Esta captura todavía no tiene etiquetas.</p>}</section>
        <section><div className="scene-panel-heading"><h2>Vistas</h2><span>{shownDocument?.views.length}/50</span></div><button className={`scene-capture-button${capture.kind === 'base' ? ' is-active' : ''}`} onClick={() => chooseCapture({ kind: 'base' })}>Escena principal</button>{shownDocument?.views.map(view => <div className="scene-capture-row" key={view.id}><button className={`scene-capture-button${capture.kind === 'view' && capture.id === view.id ? ' is-active' : ''}`} onClick={() => chooseCapture({ kind: 'view', id: view.id })}>{view.name}</button>{canEdit && <div className="scene-small-actions"><button aria-label={`Duplicar vista ${view.name}`} onClick={() => duplicateCapture('view', view.id)}>Duplicar</button><button aria-label={`Eliminar vista ${view.name}`} onClick={() => deleteCapture('view', view.id)}>Quitar</button></div>}</div>)}{canEdit && selectedView && <label className="field"><span className="field__label">Nombre de esta vista</span><input value={selectedView.name} maxLength={180} onChange={event => commit(value => { value.views.find(view => view.id === selectedView.id)!.name = event.target.value; })} /></label>}{canEdit && <div className="scene-new-capture"><label className="field"><span className="field__label">Nombre de la vista</span><input value={viewName} maxLength={180} onChange={event => setViewName(event.target.value)} placeholder="Por ejemplo: vista superior" /></label><button className="secondary" disabled={!viewName.trim() || document.views.length >= 50} onClick={() => safely(() => saveCapture('view'))}>Guardar vista actual</button></div>}</section>
        <section><div className="scene-panel-heading"><h2>Pasos</h2><span>{shownDocument?.steps.length}/100</span></div><ol className="scene-step-list">{shownDocument?.steps.map((step, index) => <li key={step.id}><button className={`scene-capture-button${capture.kind === 'step' && capture.id === step.id ? ' is-active' : ''}`} onClick={() => chooseCapture({ kind: 'step', id: step.id })}><span>{String(index + 1).padStart(2, '0')}</span>{step.title}</button>{canEdit && <div className="scene-small-actions"><button aria-label={`Subir paso ${step.title}`} disabled={!index} onClick={() => reorderStep(step.id, -1)}>↑</button><button aria-label={`Bajar paso ${step.title}`} disabled={index === document.steps.length - 1} onClick={() => reorderStep(step.id, 1)}>↓</button><button aria-label={`Duplicar paso ${step.title}`} disabled={document.steps.length >= 100} onClick={() => duplicateCapture('step', step.id)}>Duplicar</button><button aria-label={`Eliminar paso ${step.title}`} onClick={() => deleteCapture('step', step.id)}>Quitar</button></div>}</li>)}</ol>{canEdit && <div className="scene-new-capture"><label className="field"><span className="field__label">Título del nuevo paso</span><input value={stepTitle} maxLength={180} onChange={event => setStepTitle(event.target.value)} placeholder="Por ejemplo: identifica la CPU" /></label><button className="secondary" disabled={!stepTitle.trim() || document.steps.length >= 100} onClick={() => safely(() => saveCapture('step'))}>Añadir paso con esta captura</button></div>}<p className="scene-muted">Cada paso conserva su propia cámara, piezas y etiquetas. El audio y las simulaciones se incorporarán después.</p></section>
      </aside>
    </div>
    <VisualJourney projectId={projectId} canEdit={editing} compact />
    {cleanupOpen && <SceneCleanupDialog assets={unused} pending={cleaning} error={error} onClose={() => setCleanupOpen(false)} onConfirm={() => void cleanup()} />}
  </article>;
}

function SceneCleanupDialog({ assets, pending, error, onClose, onConfirm }: { assets: VisualModelAsset[]; pending: boolean; error: string; onClose(): void; onConfirm(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current; const previous = window.document.activeElement as HTMLElement | null;
    if (typeof node?.showModal === 'function') node.showModal(); else node?.setAttribute('open', '');
    return () => { if (node?.open && typeof node.close === 'function') node.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="scene-dialog" aria-labelledby="scene-cleanup-title" onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}><h2 id="scene-cleanup-title">Liberar modelos sin uso</h2><p>Estos archivos no aparecen en ninguna captura guardada ni en tu borrador. Se eliminarán de forma permanente.</p><ul>{assets.map(asset => <li key={asset.id}><span>{asset.name}</span><strong>{formatBytes(asset.bytes ?? 0)}</strong></li>)}</ul><p>Espacio que se recuperará: <strong>{formatBytes(assets.reduce((sum, asset) => sum + (asset.bytes ?? 0), 0))}</strong>.</p>{error && <p role="alert" className="error">{error}</p>}<div className="scene-inline-actions"><button className="secondary" disabled={pending} onClick={onClose}>Cancelar</button><button disabled={pending || !assets.length} onClick={onConfirm}>{pending ? 'Liberando…' : 'Eliminar archivos y liberar espacio'}</button></div></dialog>;
}

function ComponentNode({ instance, asset, index, selected, onSelect, expanded, setExpanded, depth, ancestors }: {
  instance: VisualModelInstance; asset: VisualModelAsset; index: number; selected?: VisualNodeRef; onSelect(node: VisualNodeRef): void;
  expanded: Set<string>; setExpanded: (change: (values: Set<string>) => Set<string>) => void; depth: number; ancestors: number[];
}) {
  const node = asset.manifest?.nodes.find(value => value.index === index); if (!node || ancestors.includes(index) || depth > 100) return null;
  const part = instance.components.find(value => value.nodeIndex === index); const key = `${instance.id}:${index}`; const open = expanded.has(key);
  return <div role="treeitem" aria-selected={sameNode(selected, { instanceId: instance.id, nodeIndex: index })} aria-expanded={node.children.length ? open : undefined} className="scene-tree-node"><div className="scene-tree-row">{node.children.length ? <button className="scene-tree-toggle" aria-label={`${open ? 'Contraer' : 'Expandir'} ${part?.alias || node.name || `Pieza ${index + 1}`}`} onClick={() => setExpanded(values => { const next = new Set(values); if (open) next.delete(key); else next.add(key); return next; })}>{open ? '−' : '+'}</button> : <span className="scene-tree-spacer" />}<button className="scene-tree-select" aria-pressed={sameNode(selected, { instanceId: instance.id, nodeIndex: index })} onClick={() => onSelect({ instanceId: instance.id, nodeIndex: index })}>{part?.alias || node.name || `Pieza ${index + 1}`}</button>{part?.visible === false && <span className="scene-tree-hidden">Oculta</span>}</div>{open && <div role="group">{node.children.map(child => <ComponentNode key={child} instance={instance} asset={asset} index={child} selected={selected} onSelect={onSelect} expanded={expanded} setExpanded={setExpanded} depth={depth + 1} ancestors={[...ancestors, index]} />)}</div>}</div>;
}

function euler(quaternion: VisualQuaternion): VisualVec3 {
  const [x, y, z, w] = quaternion; const clamp = (value: number) => Math.max(-1, Math.min(1, value)); const degrees = (value: number) => Math.round(value * 180 / Math.PI * 100) / 100;
  return [degrees(Math.atan2(2 * (w * x - y * z), 1 - 2 * (x * x + y * y))), degrees(Math.asin(clamp(2 * (w * y + x * z)))), degrees(Math.atan2(2 * (w * z - x * y), 1 - 2 * (y * y + z * z)))];
}
function quaternion(angles: VisualVec3): VisualQuaternion {
  const [x, y, z] = angles.map(value => value * Math.PI / 360) as VisualVec3;
  const c1 = Math.cos(x), c2 = Math.cos(y), c3 = Math.cos(z), s1 = Math.sin(x), s2 = Math.sin(y), s3 = Math.sin(z);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
function TransformFields({ value, disabled, onChange }: { value: VisualTransform; disabled: boolean; onChange(value: VisualTransform): void }) {
  const rotation = euler(value.quaternion);
  return <div className="scene-transforms">{(['position', 'rotation', 'scale'] as const).map(kind => <fieldset key={kind} disabled={disabled}><legend>{({ position: 'Posición', rotation: 'Giro (grados)', scale: 'Escala' })[kind]}</legend><div>{(['X', 'Y', 'Z'] as const).map((axis, index) => <label key={axis}><span>{axis}</span><input aria-label={`${({ position: 'Posición', rotation: 'Giro', scale: 'Escala' })[kind]} ${axis}`} type="number" step={kind === 'rotation' ? 1 : .1} value={kind === 'rotation' ? rotation[index] : value[kind][index]} onChange={event => {
    const number = Number(event.target.value); if (!Number.isFinite(number)) return;
    const next = clone(value); if (kind === 'rotation') { const angles = [...rotation] as VisualVec3; angles[index] = number; next.quaternion = quaternion(angles); } else next[kind][index] = number;
    onChange(next);
  }} /></label>)}</div></fieldset>)}</div>;
}
