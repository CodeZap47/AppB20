import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  AmbientLight, Box3, BoxHelper, Color, DirectionalLight, GridHelper, Group, HemisphereLight, Object3D,
  PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { VisualFrame, VisualModelAsset, VisualNodeRef, VisualTransform } from '@b20/core';
import {
  applyTransform, cloneModel, frameBudgetError, lowMemoryProfile, NODE_INDEX_KEY, projectedLabel,
  readTransform, visibleBounds, visibleInHierarchy, VisualModelLoader, type LoadedModel,
} from './sceneRuntime';
import type { VisualSceneCanvasHandle, VisualSceneCanvasProps } from './types';
import './visual3d.css';
export type { VisualSceneCanvasHandle, VisualSceneCanvasProps } from './types';

interface ModelInstance {
  group: Group; nodes: Map<number, Object3D>; originals: Map<number, VisualTransform>; assetId: string;
}
interface Runtime {
  fit(): void; centerSelection(): void; resetCamera(): void;
  sync(frame: VisualFrame): void;
  load(frame: VisualFrame, assets: readonly VisualModelAsset[], signal: AbortSignal, individual: boolean): Promise<void>;
  updateSelection(): void;
  dispose(): void;
}
function sameNode(a: VisualNodeRef | undefined, b: VisualNodeRef | undefined) { return a?.instanceId === b?.instanceId && a?.nodeIndex === b?.nodeIndex; }

function createRuntime(
  host: HTMLDivElement,
  latest: { current: VisualSceneCanvasProps },
  labels: Map<string, HTMLButtonElement>,
  onContextLost: (error: string) => void,
): Runtime {
  const lowMemory = lowMemoryProfile();
  const renderer = new WebGLRenderer({ antialias: !lowMemory, alpha: false, powerPreference: lowMemory ? 'low-power' : 'default' });
  renderer.setPixelRatio(lowMemory ? 1 : Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0xf5f7fc, 1);
  renderer.domElement.setAttribute('aria-label', 'Escena 3D. Arrastra para girar la cámara, usa dos dedos para acercarte y toca una pieza para seleccionarla.');
  renderer.domElement.setAttribute('role', 'img'); renderer.domElement.tabIndex = 0;
  host.append(renderer.domElement);
  const scene = new Scene(); scene.background = new Color(0xf5f7fc);
  scene.add(new AmbientLight(0xffffff, .8), new HemisphereLight(0xe7efff, 0x8b8f99, 2));
  const key = new DirectionalLight(0xffffff, 3); key.position.set(4, 8, 5); scene.add(key);
  const fill = new DirectionalLight(0xe0e8ff, 1.2); fill.position.set(-5, 3, -4); scene.add(fill);
  const grid = new GridHelper(20, 20, 0xc4cddd, 0xe0e6ef); grid.position.y = -.01; scene.add(grid);
  const world = new Group(); scene.add(world);
  const camera = new PerspectiveCamera(45, 1, .001, 1e8);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = false; orbit.screenSpacePanning = true;
  const transform = new TransformControls(camera, renderer.domElement); transform.setSpace('local');
  const transformHelper = transform.getHelper(); scene.add(transformHelper);
  const selectionBox = new BoxHelper(new Object3D(), 0x4169d4); selectionBox.visible = false; scene.add(selectionBox);
  let loader = new VisualModelLoader(renderer);
  const templates = new Map<string, LoadedModel>(); const instances = new Map<string, ModelInstance>();
  let cameraSource: VisualFrame['camera'] | undefined;
  let disposed = false, drawing = 0, applying = false, dragging = false, individual = false;
  let width = 1, height = 1;
  const raycaster = new Raycaster(); const pointer = new Vector2(); let pointerDown: { x: number; y: number; moved: boolean } | undefined;
  const labelPosition = () => {
    for (const annotation of latest.current.frame.annotations) {
      const element = labels.get(annotation.id); if (!element) continue;
      const object = instances.get(annotation.node.instanceId)?.nodes.get(annotation.node.nodeIndex);
      if (!object || !annotation.visible) { element.hidden = true; continue; }
      const point = projectedLabel(object, annotation.anchor, camera, width, height);
      element.hidden = !point.visible;
      element.style.left = `${point.x}px`; element.style.top = `${point.y}px`;
    }
  };
  const draw = () => {
    drawing = 0; if (disposed) return;
    scene.updateMatrixWorld(true);
    if (selectionBox.visible) selectionBox.update();
    try { renderer.render(scene, camera); labelPosition(); }
    catch { onContextLost('El dispositivo no pudo dibujar la escena. El documento y el borrador se conservan; reintenta el visor o usa un modelo más ligero.'); }
  };
  const invalidate = () => { if (!disposed && !drawing) drawing = requestAnimationFrame(draw); };
  const cameraSnapshot = () => ({ position: camera.position.toArray(), target: orbit.target.toArray(), up: camera.up.toArray(), fov: camera.fov });
  const commitCamera = () => {
    if (!applying && latest.current.editable && !individual) latest.current.onFrameChange?.({ ...latest.current.frame, camera: cameraSnapshot() });
  };
  orbit.addEventListener('change', invalidate); orbit.addEventListener('end', commitCamera);
  const selectionObject = () => {
    const selected = latest.current.selected ?? latest.current.frame.selection;
    return selected ? instances.get(selected.instanceId)?.nodes.get(selected.nodeIndex)
      : latest.current.selectedInstanceId ? instances.get(latest.current.selectedInstanceId)?.group : undefined;
  };
  const updateSelection = () => {
    const selected = selectionObject();
    if (selected && visibleInHierarchy(selected)) { selectionBox.setFromObject(selected); selectionBox.visible = true; }
    else selectionBox.visible = false;
    if (selected && latest.current.editable && !individual && latest.current.mode && latest.current.mode !== 'orbit') {
      transform.setMode(latest.current.mode); transform.attach(selected);
    } else transform.detach();
    invalidate();
  };
  const sync = (frame: VisualFrame) => {
    if (disposed) return;
    applying = true;
    if (cameraSource !== frame.camera && !dragging) {
      camera.position.fromArray(frame.camera.position); camera.up.fromArray(frame.camera.up); camera.fov = frame.camera.fov;
      camera.updateProjectionMatrix(); orbit.target.fromArray(frame.camera.target); orbit.update(); cameraSource = frame.camera;
    }
    if (!dragging) for (const instance of frame.instances) {
      const model = instances.get(instance.id); if (!model) continue;
      model.group.visible = instance.visible; applyTransform(model.group, instance.transform);
      for (const [index, object] of model.nodes) {
        const original = model.originals.get(index); if (original) applyTransform(object, original);
        object.visible = true;
      }
      for (const component of instance.components) {
        const object = model.nodes.get(component.nodeIndex); if (!object) continue;
        if (component.transform) applyTransform(object, component.transform);
        if (component.visible !== undefined) object.visible = component.visible;
      }
    }
    updateSelection(); applying = false; invalidate();
  };
  const frameBox = (box: Box3) => {
    if (box.isEmpty()) return;
    const center = box.getCenter(new Vector3()), size = box.getSize(new Vector3());
    const radius = Math.max(size.x, size.y, size.z, .01) / 2;
    const distance = radius / Math.sin(camera.fov * Math.PI / 360) * 1.35 / Math.min(1, camera.aspect);
    let direction = camera.position.clone().sub(orbit.target); if (direction.lengthSq() < 1e-8) direction = new Vector3(1, .7, 1);
    camera.position.copy(center).add(direction.normalize().multiplyScalar(distance)); orbit.target.copy(center);
    camera.near = Math.max(distance / 10000, .0001); camera.far = Math.max(distance * 1000, 100); camera.updateProjectionMatrix(); orbit.update();
    commitCamera(); invalidate();
  };
  const fit = () => frameBox(visibleBounds(world));
  const centerSelection = () => { const object = selectionObject(); if (object) frameBox(new Box3().setFromObject(object, true)); else fit(); };
  const resetCamera = () => { applying = true; camera.position.set(4, 3, 6); camera.up.set(0, 1, 0); camera.fov = 45; camera.updateProjectionMatrix(); orbit.target.set(0, 0, 0); orbit.update(); applying = false; fit(); };
  const persistObject = () => {
    dragging = false; orbit.enabled = true;
    if (!latest.current.editable || individual) return;
    const object = transform.object; if (!object) return;
    const selected = latest.current.selected ?? latest.current.frame.selection;
    const frame = latest.current.frame;
    const next = { ...frame, instances: frame.instances.map(instance => {
      if (selected && instance.id === selected.instanceId) {
        const previous = instance.components.find(value => value.nodeIndex === selected.nodeIndex);
        return { ...instance, components: [...instance.components.filter(value => value.nodeIndex !== selected.nodeIndex), { ...previous, nodeIndex: selected.nodeIndex, transform: readTransform(object) }] };
      }
      if (!selected && instance.id === latest.current.selectedInstanceId) return { ...instance, transform: readTransform(object) };
      return instance;
    }) };
    latest.current.onFrameChange?.(next); invalidate();
  };
  transform.addEventListener('change', invalidate);
  transform.addEventListener('mouseDown', () => { dragging = true; orbit.enabled = false; });
  transform.addEventListener('mouseUp', persistObject);
  const down = (event: PointerEvent) => { if (event.button === 0) pointerDown = { x: event.clientX, y: event.clientY, moved: false }; };
  const move = (event: PointerEvent) => { if (pointerDown && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6) pointerDown.moved = true; };
  const up = (event: PointerEvent) => {
    const start = pointerDown; pointerDown = undefined;
    if (!start || start.moved || dragging || (transform.axis !== null && latest.current.mode !== 'orbit')) return;
    const rect = renderer.domElement.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([...instances.values()].map(model => model.group), true).filter(hit => visibleInHierarchy(hit.object));
    const hit = hits[0]; if (!hit) { latest.current.onSelect?.(undefined); return; }
    let object: Object3D | null = hit.object;
    while (object && typeof object.userData[NODE_INDEX_KEY] !== 'number') object = object.parent;
    if (!object) return;
    const modelEntry = [...instances].find(([, value]) => [...value.nodes.values()].includes(object!)); if (!modelEntry) return;
    const node = { instanceId: modelEntry[0], nodeIndex: object.userData[NODE_INDEX_KEY] as number };
    latest.current.onSelect?.(node);
    latest.current.onPick?.(node, object.worldToLocal(hit.point.clone()).toArray());
    invalidate();
  };
  renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointermove', move); renderer.domElement.addEventListener('pointerup', up);
  const keyboard = (event: KeyboardEvent) => {
    const direction = camera.position.clone().sub(orbit.target);
    if (event.key === '+' || event.key === '=') direction.multiplyScalar(.85);
    else if (event.key === '-') direction.multiplyScalar(1.18);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') direction.applyAxisAngle(camera.up, event.key === 'ArrowLeft' ? -.12 : .12);
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const right = new Vector3().crossVectors(direction, camera.up).normalize();
      direction.applyAxisAngle(right, event.key === 'ArrowUp' ? -.1 : .1);
    } else return;
    event.preventDefault(); camera.position.copy(orbit.target).add(direction); orbit.update(); commitCamera(); invalidate();
  };
  renderer.domElement.addEventListener('keydown', keyboard);
  const lost = (event: Event) => { event.preventDefault(); onContextLost('Se perdió la conexión con el procesador gráfico. El borrador y los pasos se conservan; vuelve a abrir la escena.'); };
  renderer.domElement.addEventListener('webglcontextlost', lost);
  const resize = () => {
    width = Math.max(host.clientWidth, 1); height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); invalidate();
  };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  const clearModels = () => {
    transform.detach(); world.clear(); instances.clear();
    for (const template of templates.values()) template.dispose(); templates.clear(); selectionBox.visible = false;
  };
  return {
    fit, centerSelection, resetCamera, sync, updateSelection,
    async load(frame, assets, signal, preview) {
      individual = preview;
      clearModels(); loader.dispose(); loader = new VisualModelLoader(renderer);
      let residentBytes = 0;
      for (const instance of frame.instances) {
        if (signal.aborted || disposed) throw new DOMException('La carga se canceló.', 'AbortError');
        const asset = assets.find(value => value.id === instance.assetId);
        if (!asset || asset.state !== 'ready' || !asset.fileId) throw new Error('Uno de los archivos ya no está disponible.');
        let template = templates.get(asset.id);
        if (!template) {
          const blob = await latest.current.loadAsset(asset, { signal });
          if (signal.aborted || disposed) throw new DOMException('La carga se canceló.', 'AbortError');
          template = await loader.load(blob, signal);
          residentBytes += template.geometryBytes + template.textureBytes;
          if (residentBytes > (lowMemory ? 192 : 384) * 1024 * 1024) { template.dispose(); throw new Error('La escena necesita más memoria de la disponible en este dispositivo. Puedes revisar sus modelos por separado.'); }
          templates.set(asset.id, template);
        }
        const cloned = cloneModel(template); const group = new Group(); group.add(cloned.root); world.add(group);
        instances.set(instance.id, { group, nodes: cloned.nodes, originals: cloned.originals, assetId: asset.id });
      }
      sync(latest.current.frame); if (preview) fit();
    },
    dispose() {
      disposed = true; if (drawing) cancelAnimationFrame(drawing); observer.disconnect(); clearModels(); loader.dispose();
      orbit.dispose(); transform.dispose(); selectionBox.geometry.dispose(); (selectionBox.material as import('three').Material).dispose();
      grid.geometry.dispose(); for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) material.dispose();
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointermove', move); renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('keydown', keyboard);
      renderer.domElement.removeEventListener('webglcontextlost', lost); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}

const VisualSceneCanvas = forwardRef<VisualSceneCanvasHandle, VisualSceneCanvasProps>(function VisualSceneCanvas(props, ref) {
  const host = useRef<HTMLDivElement>(null); const latest = useRef(props); latest.current = props;
  const labels = useRef(new Map<string, HTMLButtonElement>()); const runtime = useRef<Runtime | undefined>(undefined);
  const [initialization, setInitialization] = useState(0);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false); const [unavailable, setUnavailable] = useState(false);
  const [individualAsset, setIndividualAsset] = useState('');
  const instancesKey = props.frame.instances.map(instance => `${instance.id}:${instance.assetId}:${props.assets.find(asset => asset.id === instance.assetId)?.sha256 ?? ''}`).join('|');
  const preview = Boolean(individualAsset);
  const activeFrame = preview ? { ...props.frame, instances: props.frame.instances.filter(instance => instance.assetId === individualAsset).slice(0, 1) } : props.frame;
  const activeFrameRef = useRef(activeFrame); activeFrameRef.current = activeFrame;
  useImperativeHandle(ref, () => ({ fit: () => runtime.current?.fit(), centerSelection: () => runtime.current?.centerSelection(), resetCamera: () => runtime.current?.resetCamera() }), []);
  useEffect(() => {
    if (!host.current) return;
    let current: Runtime | undefined;
    try {
      current = createRuntime(host.current, latest, labels.current, message => { setError(message); setUnavailable(true); });
      runtime.current = current; setUnavailable(false); setInitialization(value => value + 1);
    } catch { setUnavailable(true); setError('Este dispositivo no pudo iniciar WebGL 2. Puedes consultar las etiquetas y los pasos; la escena y el borrador se conservan.'); }
    return () => { current?.dispose(); if (runtime.current === current) runtime.current = undefined; };
  }, [retry]);
  useEffect(() => {
    const current = runtime.current; if (!current) return;
    const controller = new AbortController();
    const frame = activeFrameRef.current;
    const budgetError = frameBudgetError(frame, latest.current.assets);
    if (budgetError) { setError(budgetError); latest.current.onStatus?.({ loading: false, error: budgetError, individualPreview: preview }); return; }
    setLoading(true); setError(''); latest.current.onStatus?.({ loading: true, individualPreview: preview });
    current.load(frame, latest.current.assets, controller.signal, preview).then(() => {
      if (controller.signal.aborted) return;
      setLoading(false); latest.current.onStatus?.({ loading: false, individualPreview: preview });
    }).catch(reason => {
      if (controller.signal.aborted) return;
      const message = reason instanceof Error ? reason.message : 'No se pudo abrir el modelo.';
      setLoading(false); setError(message); latest.current.onStatus?.({ loading: false, error: message, individualPreview: preview });
    });
    return () => controller.abort();
  }, [instancesKey, initialization, individualAsset, preview]);
  useEffect(() => { runtime.current?.sync(activeFrame); }, [props.frame, props.selected, props.selectedInstanceId, props.mode, props.editable, activeFrame]);
  useEffect(() => {
    if (unavailable) latest.current.onStatus?.({ loading: false, error: error || 'WebGL 2 no está disponible.' });
  }, [unavailable, error]);
  const usedAssets = props.assets.filter(asset => props.frame.instances.some(instance => instance.assetId === asset.id));
  return <div className={`visual3d-canvas ${props.className ?? ''}`}>
    <div className="visual3d-stage" ref={host} aria-busy={loading}>
      <div className="visual3d-label-layer">{props.frame.annotations.map(annotation => <button key={annotation.id} type="button" hidden={!annotation.visible}
        ref={element => { if (element) labels.current.set(annotation.id, element); else labels.current.delete(annotation.id); }}
        className={`visual3d-label ${sameNode(props.selected, annotation.node) ? 'is-selected' : ''}`} onClick={() => props.onSelect?.(annotation.node)}>{annotation.text}</button>)}</div>
      {loading && <div className="visual3d-loading" role="status">Abriendo modelos…</div>}
      {!props.frame.instances.length && !error && <div className="visual3d-empty">{props.editable ? 'Importa un GLB para empezar a construir tu explicación.' : 'La escena todavía no tiene modelos.'}</div>}
    </div>
    <div className="visual3d-camera-tools" aria-label="Controles de cámara"><span>Cámara</span>
      <button type="button" disabled={unavailable || loading} onClick={() => runtime.current?.fit()}>Encuadrar todo</button>
      <button type="button" disabled={unavailable || loading} onClick={() => runtime.current?.centerSelection()}>Centrar selección</button>
      <button type="button" disabled={unavailable || loading} onClick={() => runtime.current?.resetCamera()}>Restaurar vista</button>
    </div>
    {error && <div className="visual3d-runtime-error" role="alert"><strong>No se pudo mostrar la escena completa.</strong><p>{error}</p>
      {unavailable && <button type="button" onClick={() => { setError(''); setRetry(value => value + 1); }}>Reintentar visor</button>}
      {!unavailable && usedAssets.length > 0 && <label>Explorar un modelo por separado<select value={individualAsset} onChange={event => setIndividualAsset(event.target.value)}><option value="">Escena completa</option>{usedAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>}
    </div>}
    {preview && <div className="visual3d-preview-notice" role="status">Vista individual de consulta. La escena completa y sus posiciones se conservan.<button type="button" onClick={() => setIndividualAsset('')}>Volver a la escena completa</button></div>}
    <p className="visual3d-gesture-hint">Arrastra para girar · Rueda o dos dedos para acercar · Toca una pieza para seleccionarla · Teclado: flechas y +/−</p>
  </div>;
});
export default VisualSceneCanvas;
