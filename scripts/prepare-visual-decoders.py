"""Regenerate pinned static worker adapters; run from the repository root after npm ci."""
from pathlib import Path
import shutil,json,hashlib
root=Path.cwd(); assert json.loads((root/'node_modules/three/package.json').read_text())['version']=='0.186.1', 'Review adapters before changing Three'; src=root/'node_modules/three/examples/jsm'; dest=root/'packages/app/src/components/visual3d'; vendor=dest/'vendor';vendor.mkdir(exist_ok=True)
license='// Adapted from Three.js 0.186.1 (MIT). See vendor/THREE-LICENSE.txt.\n'
# Static Draco worker, retaining upstream decoder implementation and attribute handling.
s=(src/'loaders/DRACOLoader.js').read_text(); worker=s.split('function DRACOWorker() {',1)[1].split('\n}\n\nexport { DRACOLoader',1)[0]
worker=worker.replace('onmessage = function', 'self.onmessage = function')
worker=worker.replace('const geometry = { index: null, attributes: [] };', "if (dracoGeometry.num_points() > 6000000 || (geometryType === draco.TRIANGULAR_MESH && dracoGeometry.num_faces() > 2000000)) { draco.destroy(dracoGeometry); throw new Error('El modelo supera el límite de geometría.'); }\n\t\tconst geometry = { index: null, attributes: [] };")
worker=worker.replace('const srcByteLength = count * srcByteStride;', "const srcByteLength = count * srcByteStride;\n\t\tif (srcByteLength > 256 * 1024 * 1024) throw new Error('El atributo excede el límite de memoria.');")
(dest/'draco.worker.js').write_text(license+"import DracoDecoderModule from './vendor/draco-gltf.mjs';\n"+worker)
# Replace dynamic factory with a static Vite worker entry and fetch only local WASM.
a=s.index('\n\t_initDecoder() {'); b=s.index('\n\t_getWorker(',a)
s=s[:a]+"""
\t_initDecoder() {
\t\tif (!this.decoderPending) this.decoderPending = fetch(WASM_BIN_URL).then(response => {
\t\t\tif (!response.ok) throw new Error('No se pudo cargar el decodificador Draco.');
\t\t\treturn response.arrayBuffer();
\t\t}).then(bytes => { this.decoderConfig.wasmBinary = bytes; });
\t\treturn this.decoderPending;
\t}
"""+s[b:]
s=s.replace("const WASM_BIN_URL = new URL( '../libs/draco/draco_decoder.wasm', import.meta.url ).toString();", "const WASM_BIN_URL = new URL('./vendor/draco_decoder.wasm', import.meta.url).href;")
s=s.replace("const WASM_JS_URL = new URL( '../libs/draco/draco_wasm_wrapper.js', import.meta.url ).toString();", "const WASM_JS_URL = '';")
s=s.replace("const JS_URL = new URL( '../libs/draco/draco_decoder.js', import.meta.url ).toString();", "const JS_URL = '';")
s=s.replace("new URL( '../libs/draco/gltf/draco_wasm_wrapper.js', import.meta.url ).toString()", "''").replace("new URL( '../libs/draco/gltf/draco_decoder.wasm', import.meta.url ).toString()",'WASM_BIN_URL')
s=s.replace('new Worker( this.workerSourceURL )', "new Worker(new URL('./draco.worker.js', import.meta.url), { type: 'module' })")
s=s[:s.index('/* WEB WORKER */')]+"export { DRACOLoader, DRACO_GLTF_CONFIG };\n"
s=s.replace('worker._callbacks = {};', "worker._callbacks = {};\n\t\t\t\tworker.onerror = event => { for (const callback of Object.values(worker._callbacks)) callback.reject(new Error(event.message || 'Falló el decodificador Draco.')); };")
s=s.replace('return this._initDecoder().then( () => {', "return this._initDecoder().then( () => {\n\t\t\tif (this._disposed) throw new Error('La carga se canceló.');")
s=s.replace('\tdispose() {', '\tdispose() {\n\t\tthis._disposed = true;')
s=s.replace('this.workerPool[ i ].terminate();', "for (const callback of Object.values(this.workerPool[i]._callbacks)) callback.reject(new Error('La carga se canceló.'));\n\t\t\tthis.workerPool[ i ].terminate();")
(dest/'StaticDRACOLoader.js').write_text(license+s)
shutil.copyfile(src/'libs/draco/gltf/draco_decoder.wasm',vendor/'draco_decoder.wasm')
w=(src/'libs/draco/gltf/draco_wasm_wrapper.js').read_text();(vendor/'draco-gltf.mjs').write_text(w+'\nexport default DracoDecoderModule;\n')
# The Basis worker is also emitted as a static module; constants remain upstream-compatible.
s=(src/'loaders/KTX2Loader.js').read_text()
constants=s.split('/* CONSTANTS */',1)[1].split('/* WEB WORKER */',1)[0]
constants=constants.replace('KTX2Loader.', 'WorkerConstants.')
imports=s[:s.index("import { WorkerPool")]
worker=s.split('KTX2Loader.BasisWorker = function () {',1)[1].split('\n};\n\n// Parsing for non-Basis',1)[0]
worker=worker.replace('const EngineFormat = _EngineFormat;', 'const EngineFormat = WorkerConstants.EngineFormat;').replace('const EngineType = _EngineType;', 'const EngineType = WorkerConstants.EngineType;').replace('const TranscoderFormat = _TranscoderFormat;', 'const TranscoderFormat = WorkerConstants.TranscoderFormat;').replace('const BasisFormat = _BasisFormat;', 'const BasisFormat = WorkerConstants.BasisFormat;')
worker=worker.replace('const height = ktx2File.getHeight();', "const height = ktx2File.getHeight();\n\t\tif (width > 4096 || height > 4096 || width * height > 32000000) { cleanup(); throw new Error('La textura supera el límite permitido.'); }")
(dest/'basis.worker.js').write_text(license+imports+"\nimport BASIS from './vendor/basis_transcoder.mjs';\nconst WorkerConstants = {};\n"+constants+worker)
# Patch the loader rather than evaluating generated worker strings.
a=s.index('\n\tinit() {');b=s.index('\n\t/**',a)
s=s[:a]+"""
\tinit() {
\t\tif (!this.transcoderPending) {
\t\t\tthis.transcoderPending = fetch(WASM_BIN_URL).then(response => {
\t\t\t\tif (!response.ok) throw new Error('No se pudo cargar el decodificador KTX2.');
\t\t\t\treturn response.arrayBuffer();
\t\t\t}).then(bytes => {
\t\t\t\tthis.transcoderBinary = bytes;
\t\t\t\tthis.workerPool.setWorkerCreator(() => {
\t\t\t\t\tconst worker = new Worker(new URL('./basis.worker.js', import.meta.url), { type: 'module' });
\t\t\t\t\tconst transcoderBinary = bytes.slice(0);
\t\t\t\t\tworker.postMessage({ type: 'init', config: this.workerConfig, transcoderBinary }, [transcoderBinary]);
\t\t\t\t\treturn worker;
\t\t\t\t});
\t\t\t});
\t\t\t_activeLoaders++;
\t\t}
\t\treturn this.transcoderPending;
\t}
"""+s[b:]
s=s.replace("from '../utils/WorkerPool.js'", "from './StaticWorkerPool.js'").replace("from '../libs/ktx-parse.module.js'", "from 'three/addons/libs/ktx-parse.module.js'").replace("from '../libs/zstddec.module.js'", "from 'three/addons/libs/zstddec.module.js'").replace("from '../math/ColorSpaces.js'", "from 'three/addons/math/ColorSpaces.js'")
s=s.replace("const WASM_BIN_URL = new URL( '../libs/basis/basis_transcoder.wasm', import.meta.url ).toString();", "const WASM_BIN_URL = new URL('./vendor/basis_transcoder.wasm', import.meta.url).href;")
s=s.replace("const WASM_JS_URL = new URL( '../libs/basis/basis_transcoder.js', import.meta.url ).toString();", '')
# Worker function is no longer needed on the main thread.
a=s.index('/* WEB WORKER */');b=s.index('// Parsing for non-Basis',a);s=s[:a]+s[b:]
s=s.replace('.catch( onError );', ".catch( error => { this.manager.itemError('embedded-ktx2'); if (onError) onError(error); } );")
(dest/'StaticKTX2Loader.js').write_text(license+s)
# Strip Meshopt's unused dynamic pool from the vendored module. It only runs in our static worker.
s=(src/'libs/meshopt_decoder.module.js').read_text();a=s.index('\tvar workers = []');b=s.index('\n\treturn {\n\t\tready:',a);s=s[:a]+s[b:]
s=s.replace('\t\tuseWorkers: function (count) {\n\t\t\tinitWorkers(count);\n\t\t},\n','')
s=s.replace('\t\t\tif (workers.length > 0) {\n\t\t\t\treturn decodeWorker(count, size, source, decoders[mode], filters[filter]);\n\t\t\t}\n','')
(vendor/'meshopt.mjs').write_text(s)
shutil.copyfile(root/'node_modules/three/LICENSE',vendor/'THREE-LICENSE.txt')
basis=Path(__import__('os').environ.get('B20_BASIS_SOURCE',str(root/'artifacts/visual3d-toolchain/basis')))
shutil.copyfile(basis/'LICENSE',vendor/'BASIS-LICENSE.txt')
(dest/'StaticDRACOLoader.d.ts').write_text("export { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';\n")
(dest/'StaticKTX2Loader.d.ts').write_text("export { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';\n")
