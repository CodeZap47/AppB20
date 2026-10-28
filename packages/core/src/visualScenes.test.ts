import { describe, expect, it } from 'vitest';
import { cleanVisualSceneDocument, emptyVisualSceneDocument, identityVisualTransform, validateVisualSceneAssets,
  visualSceneAssetIds, type VisualModelAsset, type VisualSceneDocument } from './visualScenes';

const asset: VisualModelAsset = { id: '1', projectId: '1', name: 'equipo.glb', state: 'ready', version: 2,
  fileId: 'file', bytes: 20, sha256: 'a'.repeat(64), createdAt: 1,
  manifest: { nodes: [{ index: 2, name: 'Pieza', children: [], transform: identityVisualTransform() }], roots: [2], byteLength: 20,
    nodeCount: 1, primitiveCount: 1, triangleCount: 10, geometryBytes: 100, texturePixels: 0, extensions: [] } };
function scene(): VisualSceneDocument { const document = emptyVisualSceneDocument(); document.frame.instances.push({ id: 'instance', assetId: '1', name: 'Equipo', visible: true, transform: identityVisualTransform(), components: [] }); return document; }
describe('visual scenes and independent captures', () => {
  it('creates distinct default documents and preserves independent step/view captures', () => {
    const a = scene(); a.views.push({ id: 'view', name: 'General', frame: structuredClone(a.frame) }); a.steps.push({ id: 'step', title: 'Separar', description: '', frame: structuredClone(a.frame) });
    const cleaned = cleanVisualSceneDocument(a); cleaned.frame.instances[0]!.transform.position[0] = 8;
    expect(cleaned.views[0]!.frame.instances[0]!.transform.position[0]).toBe(0); expect(cleaned.steps[0]!.frame.instances[0]!.transform.position[0]).toBe(0);
    expect(emptyVisualSceneDocument().frame.instances).toEqual([]);
  });
  it('collects hidden and step-only assets exactly once', () => {
    const a = scene(); a.frame.instances[0]!.visible = false; a.steps.push({ id: 's', title: 'Paso', description: '', frame: structuredClone(a.frame) }); a.frame.instances = [];
    expect(visualSceneAssetIds(a)).toEqual(['1']); expect(() => validateVisualSceneAssets(a, [asset])).not.toThrow();
  });
  it('rejects duplicate identities, nonfinite transforms, zero scale and dangling labels', () => {
    const a = scene(); a.frame.instances.push(structuredClone(a.frame.instances[0]!)); expect(() => cleanVisualSceneDocument(a)).toThrow(/duplicados/);
    const b = scene(); b.frame.camera.fov = Infinity; expect(() => cleanVisualSceneDocument(b)).toThrow(/campo de visión/);
    const c = scene(); c.frame.instances[0]!.transform.scale[0] = 0; expect(() => cleanVisualSceneDocument(c)).toThrow(/escala/);
    const d = scene(); d.frame.annotations.push({ id: 'label', text: 'CPU', node: { instanceId: 'missing', nodeIndex: 2 }, anchor: [0, 0, 0], visible: true }); expect(() => cleanVisualSceneDocument(d)).toThrow(/ya no está/);
  });
  it('validates component identity against immutable manifest indices, including steps', () => {
    const a = scene(); a.frame.annotations.push({ id: 'label', text: 'CPU', node: { instanceId: 'instance', nodeIndex: 2 }, anchor: [0, 0, 0], visible: true }); expect(() => validateVisualSceneAssets(a, [asset])).not.toThrow();
    a.steps.push({ id: 's', title: 'Paso', description: '', frame: structuredClone(a.frame) }); a.steps[0]!.frame.annotations[0]!.node.nodeIndex = 0;
    expect(() => validateVisualSceneAssets(a, [asset])).toThrow(/pieza referenciada/);
  });
  it('refuses missing assets and enforces total stored bytes across captures', () => {
    const a = scene(); expect(() => validateVisualSceneAssets(a, [])).toThrow(/modelo no está disponible/);
    expect(() => validateVisualSceneAssets(a, [{ ...asset, state: 'purged' }])).toThrow(/modelo no está disponible/);
    expect(() => validateVisualSceneAssets(a, [{ ...asset, bytes: 151 * 1024 * 1024 }])).toThrow(/150 MiB/);
  });
  it('counts repeated visible model instances toward the rendered complexity budget', () => {
    const a = scene(); a.frame.instances.push({ ...structuredClone(a.frame.instances[0]!), id: 'second' });
    expect(() => validateVisualSceneAssets(a, [{ ...asset, manifest: { ...asset.manifest!, triangleCount: 1_000_001 } }])).toThrow(/complejidad/);
  });
  it('bounds serialized scene size in UTF-8, not just JavaScript characters', () => {
    const a = scene(); for (let i = 0; i < 100; i++) a.steps.push({ id: `s${i}`, title: 'Paso', description: '🙂'.repeat(1500), frame: structuredClone(a.frame) });
    expect(() => cleanVisualSceneDocument(a)).not.toThrow();
    for (const step of a.steps) step.description = '🙂'.repeat(3000);
    expect(() => cleanVisualSceneDocument(a)).toThrow(/1 MiB/);
  });
});
