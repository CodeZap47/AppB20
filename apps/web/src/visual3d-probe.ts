/** Development acceptance harness. It is not an entry point in production builds. */
import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { VisualModelLoader, NODE_INDEX_KEY } from '../../../packages/app/src/components/visual3d/sceneRuntime';
import plain from '../../../packages/app/src/components/visual3d/fixtures/hardware.glb?url';
import draco from '../../../packages/app/src/components/visual3d/fixtures/hardware-draco.glb?url';
import meshopt from '../../../packages/app/src/components/visual3d/fixtures/hardware-meshopt.glb?url';
import etc1s from '../../../packages/app/src/components/visual3d/fixtures/hardware-ktx2-etc1s.glb?url';
import uastc from '../../../packages/app/src/components/visual3d/fixtures/hardware-ktx2-uastc-raw.glb?url';
import ktx2 from '../../../packages/app/src/components/visual3d/fixtures/hardware-ktx2.glb?url';

const main = document.querySelector<HTMLElement>('#root')!;
main.innerHTML = '<h1>Laboratorio visual · GLB y compresión</h1><p>Prueba del motor real con Workers estáticos y archivos locales.</p><button id="run" type="button">Probar decodificadores</button><ul id="results"></ul><div id="viewport"></div>';
const style = document.createElement('style'); style.textContent = 'body{font:16px system-ui;background:#f5f7fc;color:#28374e;padding:25px}#viewport canvas{max-width:100%;border-radius:12px}li{margin:12px 0}button{padding:10px 18px;background:#3152a0;color:white;border:0;border-radius:8px}'; document.head.append(style);
const renderer = new WebGLRenderer({ antialias: true }); renderer.setSize(680, 440); renderer.setClearColor(0xf5f7fc); document.querySelector('#viewport')!.append(renderer.domElement);
const scene = new Scene(); scene.add(new AmbientLight(0xffffff, 2)); const light = new DirectionalLight(0xffffff, 3); light.position.set(3, 5, 4); scene.add(light);
const camera = new PerspectiveCamera(45, 680 / 440, .1, 100); camera.position.set(4, 3, 5); camera.lookAt(0, 0, 0);
const loader = new VisualModelLoader(renderer);
const cases = [['GLB', plain], ['Draco', draco], ['Meshopt', meshopt], ['KTX2 UASTC + Zstandard', ktx2], ['KTX2 ETC1S', etc1s], ['KTX2 UASTC', uastc]] as const;
document.querySelector<HTMLButtonElement>('#run')!.onclick = async event => {
  const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
  const results = document.querySelector('#results')!; results.replaceChildren();
  let previous: Awaited<ReturnType<VisualModelLoader['load']>> | undefined;
  for (const [name, url] of cases) {
    const row = document.createElement('li'); row.dataset.codec = name; row.textContent = `${name}: abriendo…`; results.append(row);
    try {
      const response = await fetch(url); if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const model = await loader.load(await response.blob());
      const nodes: number[] = []; model.source.traverse(object => { const index: unknown = object.userData[NODE_INDEX_KEY]; if (typeof index === 'number') nodes.push(index); });
      if (name.startsWith('KTX2') && model.textureBytes === 0) throw new Error('La textura KTX2 no se decodificó.');
      if (nodes.length !== 3 || new Set(nodes).size !== 3) throw new Error('No se conservaron los índices de las tres piezas.');
      if (previous) { scene.remove(previous.source); previous.dispose(); }
      scene.add(model.source); renderer.render(scene, camera); previous = model;
      row.dataset.result = 'passed'; row.textContent = `${name}: correcto · ${model.triangles} triángulos · ${nodes.length} piezas`;
    } catch (error) { row.dataset.result = 'failed'; row.textContent = `${name}: ${error instanceof Error ? error.message : String(error)}`; }
  }
  button.disabled = false;
};
