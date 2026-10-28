// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, forwardRef, useEffect, useImperativeHandle } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyVisualFrame, identityVisualTransform, parseGlbManifest, type VisualModelAsset, type VisualScene, type VisualSceneInput } from '@b20/core';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { clearVisualSceneDrafts, writeVisualSceneDraft } from '../lib/visualSceneDrafts';
import type { VisualSceneCanvasHandle, VisualSceneCanvasProps } from '../components/visual3d/types';
import { VisualScenePage } from './VisualScenePage';

vi.mock('../components/visual3d/VisualSceneCanvas', () => ({ default: forwardRef<VisualSceneCanvasHandle, VisualSceneCanvasProps>((props, ref) => {
  useImperativeHandle(ref, () => ({ fit() {}, centerSelection() {}, resetCamera() {} }));
  useEffect(() => { props.onStatus?.({ loading: false }); }, [props.onStatus]);
  return <div data-canvas><output data-frame>{JSON.stringify(props.frame)}</output><button onClick={() => props.onPick?.({ instanceId: 'board', nodeIndex: 1 }, [.1, .2, .3])}>Seleccionar pieza en el visor</button><button onClick={() => { const frame = structuredClone(props.frame); frame.camera.position = [9, 8, 7]; props.onFrameChange?.(frame); }}>Girar cámara de prueba</button></div>;
}) }));

const BASE = '/m/laboratorio-visual';
const originalCrypto = globalThis.crypto;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
let container: HTMLDivElement, root: Root, source: DemoDataSource, scene: VisualScene, projectId: string;
let save: ReturnType<typeof vi.spyOn>;
function asset(id: string, name: string, duplicateNames = false): VisualModelAsset {
  return { id, projectId, name, state: 'ready', version: 2, fileId: `${id}-file`, bytes: 100, sha256: 'a'.repeat(64), createdAt: 1,
    manifest: { byteLength: 100, roots: [0], nodes: [{ index: 0, name: duplicateNames ? 'Placa' : name, children: duplicateNames ? [1, 2] : [], mesh: 0, transform: identityVisualTransform() },
      ...(duplicateNames ? [1, 2].map(index => ({ index, name: 'Chip', children: [], mesh: 0, transform: identityVisualTransform() })) : [])],
    nodeCount: duplicateNames ? 3 : 1, primitiveCount: 1, triangleCount: 1, geometryBytes: 36, texturePixels: 0, extensions: [] } };
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('crypto', { randomUUID: () => originalCrypto.randomUUID(), subtle: { digest: async () => new Uint8Array(32).fill(1).buffer } }); vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:scene-test'); static revokeObjectURL = vi.fn(); });
  await clearVisualSceneDrafts();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  source = new DemoDataSource(createDemoState(), 'demo-1');
  projectId = await source.saveVisualProject({ title: 'Arquitectura en 3D', kind: '3d' });
  const frame = emptyVisualFrame(); frame.instances.push({ id: 'board', assetId: 'board-asset', name: 'Placa', transform: identityVisualTransform(), visible: true, components: [] });
  scene = { projectId, version: 1, document: { schemaVersion: 1, frame, views: [], steps: [] },
    assets: [asset('board-asset', 'placa.glb', true), asset('cpu-asset', 'cpu.glb')], capacity: { limitBytes: 256 * 1024 * 1024, reservedBytes: 200 }, updatedAt: 1 };
  vi.spyOn(source, 'getVisualScene').mockImplementation(async () => copy(scene));
  save = vi.spyOn(source, 'saveVisualScene').mockImplementation(async (input: VisualSceneInput) => {
    if (input.expectedVersion !== scene.version) throw new Error('La escena cambió. Revisa su versión.');
    scene = { ...scene, version: scene.version + 1, document: copy(input.document) }; return copy(scene);
  });
});
afterEach(async () => {
  await act(async () => root.unmount()); source.dispose(); container.remove(); await clearVisualSceneDrafts();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function show(editing = true) {
  await act(async () => root.render(<DataProvider source={source}><MemoryRouter initialEntries={[`${BASE}/${projectId}/escena${editing ? '/editar' : ''}`]}><Routes><Route path={`${BASE}/:projectId/escena/editar`} element={<VisualScenePage editing />} /><Route path={`${BASE}/:projectId/escena`} element={<VisualScenePage />} /></Routes></MemoryRouter></DataProvider>));
  await settle();
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); }
function buttons(label: string) { return [...container.querySelectorAll<HTMLButtonElement>('button')].filter(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label); }
async function click(label: string, index = 0) { const button = buttons(label)[index]; if (!button) throw new Error(`No existe el botón ${label}`); await act(async () => button.click()); await settle(); }
function field(label: string) {
  const aria = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`); if (aria) return aria;
  const row = [...container.querySelectorAll('label')].find(node => node.querySelector('.field__label')?.textContent === label);
  const input = row?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea'); if (!input) throw new Error(`No existe el campo ${label}`); return input;
}
async function change(label: string, value: string) {
  const input = field(label); const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
const frame = () => JSON.parse(container.querySelector('[data-frame]')!.textContent!) as VisualScene['document']['frame'];

describe('Editor de escenas visuales', () => {
  it('distingue componentes con nombres duplicados mediante su índice original y guarda las transformaciones', async () => {
    await show(); await click('Expandir Placa'); await click('Expandir Placa'); await click('Chip', 1);
    expect(frame().selection).toEqual({ instanceId: 'board', nodeIndex: 2 });
    await change('Nombre de la pieza', 'Memoria RAM'); await change('Posición X', '2.5');
    await click('Guardar escena');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ projectId, expectedVersion: 1 }));
    expect(scene.document.frame.instances[0]!.components).toContainEqual(expect.objectContaining({ nodeIndex: 2, alias: 'Memoria RAM', transform: expect.objectContaining({ position: [2.5, 0, 0] }) }));
    expect(container.textContent).toContain('Escena guardada. Sus vistas y pasos ya están disponibles.');
  });

  it('ancla etiquetas en coordenadas locales y mantiene vistas y pasos independientes de la escena principal', async () => {
    await show(); await click('Seleccionar pieza en el visor'); await change('Nueva etiqueta', 'CPU'); await click('Añadir etiqueta');
    expect(frame().annotations[0]).toMatchObject({ text: 'CPU', node: { instanceId: 'board', nodeIndex: 1 }, anchor: [.1, .2, .3] });
    await change('Nombre de la vista', 'Vista general'); await click('Guardar vista actual');
    await change('Título del nuevo paso', 'Identifica la CPU'); await click('Añadir paso con esta captura');
    await change('Texto de etiqueta CPU', 'Procesador'); await change('Explicación del paso', 'Coordina la ejecución de instrucciones.');
    await click('Girar cámara de prueba'); await click('Guardar escena');
    expect(scene.document.frame.annotations[0]!.text).toBe('CPU');
    expect(scene.document.views[0]!.frame.annotations[0]!.text).toBe('CPU');
    expect(scene.document.steps[0]!.frame.annotations[0]!.text).toBe('Procesador');
    expect(scene.document.steps[0]!.frame.camera.position).toEqual([9, 8, 7]);
    expect(scene.document.views[0]!.frame.camera.position).not.toEqual([9, 8, 7]);
    expect(scene.document.steps[0]!.description).toBe('Coordina la ejecución de instrucciones.');
  });

  it('duplica y reordena pasos, permite recorrerlos y deshace cambios sin alterar otras capturas', async () => {
    await show(); await change('Título del nuevo paso', 'Primero'); await click('Añadir paso con esta captura');
    await change('Título del nuevo paso', 'Segundo'); await click('Añadir paso con esta captura');
    await click('Duplicar paso Primero'); await click('Subir paso Segundo');
    await click('Guardar escena'); expect(scene.document.steps.map(row => row.title)).toEqual(['Primero', 'Segundo', 'Primero (copia)']);
    await click('Siguiente'); expect(container.textContent).toContain('Paso 3 de 3');
    await change('Título del paso', 'Cambio temporal'); await click('Deshacer'); expect(field('Título del paso').value).toBe('Primero (copia)');
    await click('Rehacer'); expect(field('Título del paso').value).toBe('Cambio temporal');
    await click('Anterior'); expect(field('Título del paso').value).toBe('Segundo');
  });

  it('reutiliza los archivos preparados sin duplicar bytes y permite restaurar la posición del modelo completo', async () => {
    await show(); const cpu = [...container.querySelectorAll('.scene-assets > div')].find(node => node.textContent?.includes('cpu.glb'))!;
    await act(async () => cpu.querySelector<HTMLButtonElement>('button')!.click());
    expect(frame().instances).toHaveLength(2); expect(frame().instances[1]!.assetId).toBe('cpu-asset');
    await change('Posición Y', '3'); await click('Duplicar modelo'); expect(frame().instances).toHaveLength(3);
    expect(new Set(frame().instances.map(instance => instance.assetId)).size).toBe(2);
    await click('Restaurar posición'); await click('Guardar escena');
    expect(scene.document.frame.instances.find(instance => instance.name === 'cpu')!.transform.position).toEqual([0, 0, 0]);
    expect(scene.assets).toHaveLength(2);
  });

  it('conserva el borrador en un conflicto y muestra la versión guardada sin sobrescribirla', async () => {
    await show(); await click('Seleccionar pieza en el visor'); await change('Nombre de la pieza', 'Mi borrador');
    scene = { ...scene, version: 2, document: { ...scene.document, steps: [{ id: 'new-step', title: 'Paso guardado por otra pestaña', description: '', frame: copy(scene.document.frame) }] } };
    await click('Guardar escena'); expect(scene.document.steps[0]!.title).toBe('Paso guardado por otra pestaña');
    expect(field('Nombre de la pieza').value).toBe('Mi borrador'); expect(buttons('Guardar escena')[0]!.disabled).toBe(true);
    await click('Revisar versión guardada'); expect(container.textContent).toContain('Paso guardado por otra pestaña');
    await click('Volver a mi borrador'); expect(field('Nombre de la pieza').value).toBe('Mi borrador');
    expect(save).toHaveBeenCalledTimes(1);
    vi.spyOn(window, 'confirm').mockReturnValue(true); await click('Cargar versión guardada');
    expect(container.textContent).toContain('Paso guardado por otra pestaña'); expect(container.textContent).not.toContain('Mi borrador');
    expect(buttons('Guardar escena')[0]!.disabled).toBe(true); expect(save).toHaveBeenCalledTimes(1);
  });

  it('recupera un borrador del usuario y proyecto actuales y exige revisar si su versión quedó atrás', async () => {
    const document = copy(scene.document); document.steps.push({ id: 'draft-step', title: 'Paso recuperado', description: '', frame: copy(document.frame) });
    await writeVisualSceneDraft({ ownerId: 'demo-1', projectId, version: 0, document, savedAt: Date.now() });
    await show(); expect(container.textContent).toContain('Hay un borrador de esta escena.');
    await click('Recuperar borrador'); expect(container.textContent).toContain('Paso recuperado');
    expect(buttons('Guardar escena')[0]!.disabled).toBe(true); expect(save).not.toHaveBeenCalled();
  });

  it('no incorpora un borrador que pertenece a otra identidad', async () => {
    const document = copy(scene.document); document.steps.push({ id: 'private-step', title: 'Borrador ajeno', description: '', frame: copy(document.frame) });
    await writeVisualSceneDraft({ ownerId: 'demo-2', projectId, version: 1, document, savedAt: Date.now() });
    await show(); expect(container.textContent).not.toContain('Borrador ajeno'); expect(container.textContent).not.toContain('Hay un borrador de esta escena.');
  });

  it('libera únicamente archivos sin uso después de confirmar la lista concreta y sus versiones', async () => {
    const discard = vi.spyOn(source, 'discardVisualModelAssets').mockImplementation(async (_project, items) => { scene.assets = scene.assets.filter(asset => !items.some(item => item.id === asset.id)); });
    await show(); await click('Liberar modelos sin uso (1)');
    const dialog = container.querySelector('dialog')!; expect(dialog.textContent).toContain('cpu.glb'); expect(dialog.textContent).not.toContain('placa.glb');
    expect(discard).not.toHaveBeenCalled(); await click('Cancelar'); expect(discard).not.toHaveBeenCalled();
    await click('Liberar modelos sin uso (1)'); await click('Eliminar archivos y liberar espacio');
    expect(discard).toHaveBeenCalledWith(projectId, [{ id: 'cpu-asset', expectedVersion: 2 }]);
    expect(scene.assets[0]!.name).toBe('placa.glb'); expect(container.textContent).toContain('Se liberó el espacio');
  });

  it('la consulta permite explorar cámara y piezas sin guardar ni mostrar herramientas de edición', async () => {
    await show(false); await click('Seleccionar pieza en el visor'); await click('Girar cámara de prueba');
    expect(frame().camera.position).toEqual([9, 8, 7]); expect(buttons('Guardar escena')).toHaveLength(0);
    expect(buttons('Importar GLB')).toHaveLength(0); expect(buttons('Añadir etiqueta')).toHaveLength(0);
    expect(field('Nombre de la pieza').disabled).toBe(true); expect(save).not.toHaveBeenCalled();
    expect(scene.document.frame.camera.position).not.toEqual([9, 8, 7]);
  });

  it('rechaza un archivo dañado antes de registrarlo y permite reintentar sin perder el proyecto', async () => {
    const create = vi.spyOn(source, 'createVisualModelAsset'); await show();
    const file = new File([new Uint8Array([1, 2, 3])], 'modelo.glb'); Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer });
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!; Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true }))); await settle();
    expect(create).not.toHaveBeenCalled(); expect(container.textContent).toContain('No se pudo importar');
    expect(buttons('Reintentar importación')).toHaveLength(1); expect(frame().instances[0]!.name).toBe('Placa');
  });

  it('recupera una importación interrumpida con la misma solicitud y conserva los campos existentes', async () => {
    const bytes = triangleGlb(); const file = new File([new Uint8Array(bytes).buffer], 'cpu-nueva.glb', { type: 'model/gltf-binary' }); Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    const pending: VisualModelAsset = { id: 'new-asset', projectId, name: file.name, state: 'pending', version: 1, createdAt: 1 };
    const create = vi.spyOn(source, 'createVisualModelAsset').mockResolvedValue(pending);
    vi.spyOn(source, 'discardResourceUpload').mockResolvedValue(undefined);
    let attempts = 0;
    vi.spyOn(source, 'attachResourceFile').mockImplementation(async (_kind, _id, _file, _version, transfer) => {
      attempts++; if (attempts === 1) throw new Error('Se interrumpió la conexión.');
      scene.assets.push({ ...pending, state: 'ready', version: 2, fileId: 'new-model-file', bytes: file.size, sha256: 'b'.repeat(64), manifest: parseGlbManifest(bytes) }); transfer?.onProgress?.(file.size, file.size); return 'new-model-file';
    });
    await show(); await click('Seleccionar pieza en el visor'); await change('Nombre de la pieza', 'Nombre que conservo');
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!; Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true }))); for (let index = 0; index < 10 && !buttons('Reintentar importación').length; index++) await settle();
    await click('Reintentar importación'); for (let index = 0; index < 10 && frame().instances.length < 2; index++) await settle();
    expect(attempts).toBe(2); expect(create.mock.calls[0]![1]).toBe(create.mock.calls[1]![1]);
    expect(frame().instances).toHaveLength(2); expect(frame().instances[0]!.components[0]!.alias).toBe('Nombre que conservo');
    expect(save).not.toHaveBeenCalled();
  });
});

function triangleGlb(): Uint8Array {
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'CPU', mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }] };
  const encoded = new TextEncoder().encode(JSON.stringify(json)); const jsonLength = Math.ceil(encoded.length / 4) * 4; const result = new Uint8Array(12 + 8 + jsonLength + 8 + 36);
  const header = new DataView(result.buffer); header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, result.length, true); header.setUint32(12, jsonLength, true); header.setUint32(16, 0x4e4f534a, true);
  result.fill(32, 20, 20 + jsonLength); result.set(encoded, 20); header.setUint32(20 + jsonLength, 36, true); header.setUint32(24 + jsonLength, 0x004e4942, true); result.set(new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer), 28 + jsonLength); return result;
}
