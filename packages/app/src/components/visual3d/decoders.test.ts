/// <reference types="node" />
// @vitest-environment node
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Object3D } from 'three';
import { parseGlbManifest } from '@b20/core';
import Basis from './vendor/basis_transcoder.mjs';

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url));
function imageFromGlb(bytes: Uint8Array): Uint8Array {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), jsonSize = data.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonSize)));
  const binOffset = 20 + jsonSize + 8;
  const view = json.bufferViews[json.images[0].bufferView];
  return bytes.subarray(binOffset + (view.byteOffset ?? 0), binOffset + (view.byteOffset ?? 0) + view.byteLength);
}

describe('packaged visual decoders', () => {
  it('accepts the original plain and compressed fixtures, including Meshopt placeholder buffers', async () => {
    for (const name of ['hardware.glb', 'hardware-draco.glb', 'hardware-meshopt.glb', 'hardware-ktx2.glb', 'hardware-ktx2-etc1s.glb', 'hardware-ktx2-uastc-raw.glb']) {
      const manifest = parseGlbManifest(await fixture(name));
      expect(manifest.nodes.map(node => node.index)).toEqual([0, 1, 2]);
      expect(manifest.roots).toEqual([0, 1, 2]);
      expect(manifest.triangleCount).toBeGreaterThan(0);
    }
  });
  it('maps actual GLTFLoader objects to source node indices when names are repeated', async () => {
    const bytes = await fixture('hardware.glb');
    const gltf = await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '');
    const nodeIndices: number[] = [];
    for (const [object, association] of gltf.parser.associations) if (object instanceof Object3D && association.nodes !== undefined) nodeIndices.push(association.nodes);
    expect(nodeIndices.sort()).toEqual([0, 1, 2]);
  });
  it('transcodes ETC1S, UASTC and Zstandard without dynamic Function or eval', async () => {
    const forbidden = () => { throw new Error('Dynamic JavaScript execution is forbidden by extension CSP'); };
    const functionSpy = vi.spyOn(globalThis, 'Function').mockImplementation(forbidden as unknown as typeof Function);
    const evalSpy = vi.spyOn(globalThis, 'eval').mockImplementation(forbidden);
    try {
      const module = await Basis({ wasmBinary: await readFile(new URL('./vendor/basis_transcoder.wasm', import.meta.url)) });
      module.initializeBasis();
      for (const name of ['hardware-ktx2.glb', 'hardware-ktx2-etc1s.glb', 'hardware-ktx2-uastc-raw.glb']) {
        const file = new module.KTX2File(imageFromGlb(await fixture(name)));
        try {
          expect(file.isValid()).toBe(true); expect(file.getWidth()).toBe(16); expect(file.getHeight()).toBe(16);
          expect(file.startTranscoding()).toBeTruthy();
          const rgba32 = 13, output = new Uint8Array(file.getImageTranscodedSizeInBytes(0, 0, 0, rgba32));
          expect(file.transcodeImage(output, 0, 0, 0, rgba32, 0, -1, -1)).toBeTruthy();
          expect(output.some(value => value > 0)).toBe(true);
        } finally { file.close(); file.delete(); }
      }
    } finally { functionSpy.mockRestore(); evalSpy.mockRestore(); }
  });
  it('initializes the packaged Draco decoder with string code generation disabled', async () => {
    const source = (await readFile(new URL('./vendor/draco-gltf.mjs', import.meta.url), 'utf8')).replace('export default DracoDecoderModule;', '');
    const context = vm.createContext({ WebAssembly, Uint8Array, Int8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, ArrayBuffer, Promise, console, setTimeout, clearTimeout }, { codeGeneration: { strings: false, wasm: true } });
    const factory = new vm.Script(`${source}; DracoDecoderModule;`).runInContext(context) as (config: Record<string, unknown>) => unknown;
    const wasmBinary = await readFile(new URL('./vendor/draco_decoder.wasm', import.meta.url));
    await new Promise<void>((resolve, reject) => {
      factory({ wasmBinary, onAbort: reject, onModuleLoaded: (module: { Decoder: unknown }) => { expect(typeof module.Decoder).toBe('function'); resolve(); } });
    });
  });
});
