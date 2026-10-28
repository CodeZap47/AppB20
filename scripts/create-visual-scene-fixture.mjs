/** Synthetic hardware only: reproducible, tiny GLB for browser/SDK acceptance tests. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { void blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.(); }); }
};
const scene = new Scene(); scene.name = 'Hardware de demostración';
function box(parent, name, size, position, color) {
  const mesh = new Mesh(new BoxGeometry(...size), new MeshStandardMaterial({ color, roughness: .65 }));
  mesh.name = name; mesh.position.set(...position); parent.add(mesh); return mesh;
}
const assembly = new Group(); assembly.name = 'Computadora de demostración'; scene.add(assembly);
box(assembly, 'Placa base', [5, .18, 3.5], [0, 0, 0], 0x1f806c);
const cpu = new Group(); cpu.name = 'CPU'; cpu.position.set(-.6, .5, .1); assembly.add(cpu);
box(cpu, 'Procesador', [1.35, .25, 1.35], [0, 0, 0], 0xc3cbd6);
box(cpu, 'Zócalo', [1.6, .15, 1.6], [0, -.2, 0], 0x30384d);
for (let index = 0; index < 5; index++) box(cpu, 'Aleta del disipador', [.12, .45, 1.15], [-.5 + index * .25, .35, 0], 0x8396b2);
const ram = new Group(); ram.name = 'Memoria RAM'; ram.position.set(1.45, .55, -.1); assembly.add(ram);
box(ram, 'Tarjeta RAM', [.12, .8, 2.6], [0, 0, 0], 0x267cb3);
for (let index = 0; index < 6; index++) box(ram, 'Chip de memoria', [.08, .4, .25], [-.1, .05, -1 + index * .4], 0x253344);
box(assembly, 'Almacenamiento SSD', [1.7, .2, .7], [-.6, .25, -1.1], 0xdca64a);
box(assembly, 'Puertos', [.4, .5, 2], [-2.2, .35, 0], 0x8ca1b6);
const bytes = await new GLTFExporter().parseAsync(scene, { binary: true });
const path = resolve(process.argv[2] ?? 'artifacts/laboratorio-visual-editor-3d/hardware.glb');
await mkdir(dirname(path), { recursive: true }); await writeFile(path, new Uint8Array(bytes));
console.log(JSON.stringify({ path, bytes: bytes.byteLength, synthetic: true }));
