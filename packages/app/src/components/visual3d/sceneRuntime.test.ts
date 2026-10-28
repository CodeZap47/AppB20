import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferAttribute, Group, Mesh, MeshStandardMaterial, PerspectiveCamera } from 'three';
import { emptyVisualFrame, identityVisualTransform, type VisualModelAsset } from '@b20/core';
import { applyTransform, cloneModel, frameBudgetError, measureVisualModel, NODE_INDEX_KEY, projectedLabel, visibleBounds } from './sceneRuntime';

describe('visual scene renderer data', () => {
  it('preserves original node indices through cloning, even with repeated names', () => {
    const source = new Group();
    for (const index of [2, 7]) { const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial()); mesh.name = 'chip'; mesh.userData[NODE_INDEX_KEY] = index; mesh.position.x = index; source.add(mesh); }
    const cloned = cloneModel({ source, geometryBytes: 0, textureBytes: 0, triangles: 24, primitives: 2, nodes: 3, dispose() {} });
    expect([...cloned.nodes.keys()]).toEqual([2, 7]);
    expect(cloned.nodes.get(2)).not.toBe(source.children[0]);
    expect(cloned.originals.get(7)?.position).toEqual([7, 0, 0]);
  });
  it('keeps label anchors attached to transformed components and hidden ancestors', () => {
    const group = new Group(); const piece = new Mesh(new BoxGeometry(), new MeshStandardMaterial()); group.add(piece);
    applyTransform(group, { ...identityVisualTransform(), position: [2, 0, 0] });
    applyTransform(piece, { ...identityVisualTransform(), position: [-2, 0, 0] });
    group.updateMatrixWorld(true);
    const camera = new PerspectiveCamera(45, 2, .1, 100); camera.position.set(0, 0, 5); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    expect(projectedLabel(piece, [0, 0, 0], camera, 800, 400)).toMatchObject({ x: 400, y: 200, visible: true });
    group.visible = false;
    expect(projectedLabel(piece, [0, 0, 0], camera, 800, 400).visible).toBe(false);
  });
  it('fits only visible geometry and does not include helpers or hidden parts', () => {
    const group = new Group(), visible = new Mesh(new BoxGeometry(2, 2, 2));
    const hidden = new Mesh(new BoxGeometry(100, 100, 100)); hidden.visible = false; group.add(visible, hidden);
    expect(visibleBounds(group).min.toArray()).toEqual([-1, -1, -1]);
    expect(visibleBounds(group).max.toArray()).toEqual([1, 1, 1]);
  });
  it('counts repeated model instances toward rendering cost and rejects unavailable assets', () => {
    const frame = emptyVisualFrame();
    frame.instances = ['cpu1', 'cpu2'].map(id => ({ id, assetId: 'chip', name: id, visible: true, transform: identityVisualTransform(), components: [] }));
    const asset = { id: 'chip', state: 'ready', fileId: 'file', manifest: { triangleCount: 1_100_000, nodeCount: 2, primitiveCount: 1 } } as VisualModelAsset;
    expect(frameBudgetError(frame, [asset])).toMatch(/complejidad/);
    expect(frameBudgetError(frame, [])).toMatch(/disponible/);
  });
  it('rejects damaged decoded coordinates and out-of-range geometry indices before drawing', () => {
    const geometry = new BoxGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([NaN, 0, 0]), 3));
    expect(() => measureVisualModel(new Mesh(geometry))).toThrow(/coordenadas/);
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3));
    expect(() => measureVisualModel(new Mesh(geometry))).toThrow(/índice/);
  });
});
