import { describe, expect, it } from 'vitest';
import { glbImageDimensions, parseGlbManifest, readGlbManifest } from './glb';

function glb(edit: (value: Record<string, any>) => void = () => {}, extraBinary?: Uint8Array) {
  const json: Record<string, any> = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Equipo', children: [1, 2] }, { name: 'Pieza', mesh: 0, translation: [-1, 0, 0] }, { name: 'Pieza', mesh: 0, translation: [1, 0, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }], buffers: [{ byteLength: 44 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }] };
  edit(json); const source = new TextEncoder().encode(JSON.stringify(json)); const jsonSize = Math.ceil(source.length / 4) * 4;
  const bin = extraBinary ?? new Uint8Array(44); const binSize = Math.ceil(bin.length / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + jsonSize + 8 + binSize); const words = new DataView(bytes.buffer);
  words.setUint32(0, 0x46546c67, true); words.setUint32(4, 2, true); words.setUint32(8, bytes.length, true);
  words.setUint32(12, jsonSize, true); words.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + jsonSize); bytes.set(source, 20);
  words.setUint32(20 + jsonSize, binSize, true); words.setUint32(24 + jsonSize, 0x004e4942, true); bytes.set(bin, 28 + jsonSize); return bytes;
}
describe('self-contained GLB manifests', () => {
  it('keeps original node indices and duplicate names, calculating reused mesh cost', () => {
    const manifest = parseGlbManifest(glb());
    expect(manifest).toMatchObject({ roots: [0], nodeCount: 3, triangleCount: 2, primitiveCount: 2, geometryBytes: 42 });
    expect(manifest.nodes.map(node => [node.index, node.name])).toEqual([[0, 'Equipo'], [1, 'Pieza'], [2, 'Pieza']]);
    expect(manifest.nodes[1]!.transform.position).toEqual([-1, 0, 0]);
  });
  it('reads JSON crossing native 1 MiB boundaries without reading the whole binary', () => {
    const bytes = glb(value => { value.extras = { description: 'x'.repeat(1024 * 1024) }; }); const ranges: number[] = [];
    const manifest = readGlbManifest((offset, size) => { ranges.push(size); return bytes.subarray(offset, offset + size); }, bytes.length);
    expect(manifest.nodeCount).toBe(3); expect(Math.max(...ranges)).toBeLessThan(bytes.length);
  });
  it('rejects false headers, incomplete block ranges and oversized JSON', () => {
    const bytes = glb(); bytes[0] = 0; expect(() => parseGlbManifest(bytes)).toThrow(/cabecera/);
    const short = glb(); new DataView(short.buffer).setUint32(12, short.length * 2, true); expect(() => parseGlbManifest(short)).toThrow(/bloque/);
    expect(() => parseGlbManifest(glb(value => { value.extras = 'x'.repeat(4 * 1024 * 1024); }))).toThrow(/4 MiB/);
  });
  it('rejects external buffers/images and unsupported required extensions', () => {
    expect(() => parseGlbManifest(glb(value => { value.buffers[0].uri = 'https://example.invalid/private.bin'; }))).toThrow(/externos/);
    expect(() => parseGlbManifest(glb(value => { value.images = [{ uri: '../texture.png' }]; }))).toThrow(/externos/);
    expect(() => parseGlbManifest(glb(value => { value.extensionsUsed = ['UNKNOWN']; value.extensionsRequired = ['UNKNOWN']; }))).toThrow(/no es compatible/);
  });
  it('rejects cyclic hierarchy and accessor ranges beyond native bytes', () => {
    expect(() => parseGlbManifest(glb(value => { value.nodes[1].children = [0]; }))).toThrow(/ciclo/);
    expect(() => parseGlbManifest(glb(value => { value.accessors[0].count = 100; }))).toThrow(/excede/);
    expect(() => parseGlbManifest(glb(value => { value.nodes[0].children = [1, 1]; }))).toThrow(/dos padres/);
  });
  it('accepts required Meshopt with URI-less decoded fallback buffers', () => {
    const bytes = glb(value => {
      value.extensionsUsed = ['EXT_meshopt_compression']; value.extensionsRequired = ['EXT_meshopt_compression'];
      value.buffers.push({ byteLength: 36 }); value.bufferViews[0] = { buffer: 1, byteLength: 36,
        extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: 20, byteStride: 12, count: 3, mode: 'ATTRIBUTES' } } };
    }); expect(parseGlbManifest(bytes).geometryBytes).toBe(42);
    expect(() => parseGlbManifest(glb(value => {
      value.extensionsUsed = ['EXT_meshopt_compression']; value.buffers.push({ byteLength: 36 });
      value.bufferViews[0] = { buffer: 1, byteLength: 36, extensions: { EXT_meshopt_compression: { buffer: 0, byteLength: 20, byteStride: 12, count: 3, mode: 'ATTRIBUTES' } } };
    }))).toThrow(/requiere/);
  });
  it('checks declared decoded size even for compressed geometry', () => {
    expect(() => parseGlbManifest(glb(value => { value.accessors[0].count = 6_000_000; value.accessors[0].type = 'MAT4'; delete value.accessors[0].bufferView; }))).toThrow(/256 MiB/);
    expect(() => parseGlbManifest(glb(value => { value.extensionsUsed = ['KHR_draco_mesh_compression']; value.meshes[0].primitives[0].extensions = { KHR_draco_mesh_compression: { bufferView: 99, attributes: { POSITION: 0 } } }; }))).toThrow(/no es válido/);
  });
  it('validates texture headers and dimensions independently from file MIME', () => {
    const image = new Uint8Array(24); image.set([137, 80, 78, 71, 13, 10, 26, 10]); image.set([73, 72, 68, 82], 12); const v = new DataView(image.buffer); v.setUint32(16, 10); v.setUint32(20, 20);
    expect(glbImageDimensions((offset, length) => image.subarray(offset, offset + length), image.length, 'image/png')).toEqual({ width: 10, height: 20 });
    v.setUint32(16, 8192); expect(() => glbImageDimensions((o, n) => image.subarray(o, o + n), image.length, 'image/png')).toThrow(/ancho/);
    expect(() => glbImageDimensions((o, n) => image.subarray(o, o + n), image.length, 'image/jpeg')).toThrow(/JPEG/);
  });
  it('honors default-scene original node indices rather than renumbering pieces', () => {
    const manifest = parseGlbManifest(glb(value => { value.nodes = [{ mesh: 0 }, { mesh: 0 }]; value.scenes = [{ nodes: [0] }, { nodes: [1] }]; value.scene = 1; }));
    expect(manifest.nodes.map(node => node.index)).toEqual([1]); expect(manifest.roots).toEqual([1]);
  });
});
