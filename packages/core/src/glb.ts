import { identityVisualTransform, VISUAL_SCENE_LIMITS, type VisualTransform } from './visualScenes';

export interface GlbNode { index: number; name: string; children: number[]; mesh?: number; transform: VisualTransform }
export interface GlbManifest {
  byteLength: number; nodes: GlbNode[]; roots: number[]; nodeCount: number; primitiveCount: number;
  triangleCount: number; geometryBytes: number; texturePixels: number; extensions: string[];
}
export type GlbRangeReader = (offset: number, length: number) => Uint8Array;
export const GLB_SUPPORTED_EXTENSIONS = [
  'KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_basisu',
  'KHR_materials_clearcoat', 'KHR_materials_dispersion', 'KHR_materials_ior', 'KHR_materials_iridescence',
  'KHR_materials_sheen', 'KHR_materials_specular', 'KHR_materials_transmission', 'KHR_materials_unlit',
  'KHR_materials_volume', 'KHR_materials_anisotropy', 'KHR_materials_emissive_strength',
  'KHR_texture_transform', 'KHR_lights_punctual', 'EXT_mesh_gpu_instancing',
] as const;
type Obj = Record<string, unknown>;
function fail(message: string): never { throw new Error(message); }
function object(value: unknown, name = 'El modelo'): Obj { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} no es válido.`); return value as Obj; }
function array(value: unknown, name: string, max = 100_000): unknown[] { if (value === undefined) return []; if (!Array.isArray(value) || value.length > max) fail(`${name} excede el límite del modelo.`); return value; }
function int(value: unknown, name: string, max = VISUAL_SCENE_LIMITS.geometryBytes, min = 0): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(`${name} no es válido.`); return value; }
function finite(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9) fail('El modelo contiene una transformación no válida.'); return value; }
function vector(value: unknown, size: number, fallback: number[]): number[] { if (value === undefined) return [...fallback]; if (!Array.isArray(value) || value.length !== size) fail('El modelo contiene una transformación no válida.'); return value.map(finite); }
function index(value: unknown, items: readonly unknown[], name: string): number { const result = int(value, name, items.length - 1); if (!items[result]) fail(`${name} no existe.`); return result; }
function depth(json: string) {
  let nesting = 0, quoted = false, escaped = false;
  for (const char of json) { if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true; else if (char === '[' || char === '{') { if (++nesting > 128) fail('La estructura del modelo es demasiado profunda.'); } else if (char === ']' || char === '}') nesting--; }
}
function decodeData(uri: string, allowed: readonly string[]): Uint8Array {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(uri);
  if (!match || !allowed.includes(match[1]!) || match[2]!.length % 4 !== 0) fail('El GLB debe incluir sus datos e imágenes; no se admiten archivos ni enlaces externos.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const encoded = match[2]!;
  const length = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0); const bytes = new Uint8Array(length);
  for (let i = 0, out = 0; i < encoded.length; i += 4) { const a = alphabet.indexOf(encoded[i]!), b = alphabet.indexOf(encoded[i + 1]!), c = alphabet.indexOf(encoded[i + 2]!), d = alphabet.indexOf(encoded[i + 3]!); const bits = a << 18 | b << 12 | Math.max(c, 0) << 6 | Math.max(d, 0); if (out < length) bytes[out++] = bits >>> 16; if (out < length) bytes[out++] = bits >>> 8 & 255; if (out < length) bytes[out++] = bits & 255; }
  return bytes;
}
function transform(node: Obj): VisualTransform {
  const out = identityVisualTransform();
  if (node.matrix === undefined) {
    out.position = vector(node.translation, 3, [0, 0, 0]) as VisualTransform['position'];
    out.quaternion = vector(node.rotation, 4, [0, 0, 0, 1]) as VisualTransform['quaternion'];
    const length = Math.hypot(...out.quaternion); if (length < 1e-8) fail('La rotación de una pieza no es válida.'); out.quaternion = out.quaternion.map(value => value / length) as VisualTransform['quaternion'];
    out.scale = vector(node.scale, 3, [1, 1, 1]) as VisualTransform['scale']; return out;
  }
  if (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined) fail('Una pieza no puede combinar matriz y transformación TRS.');
  const m = vector(node.matrix, 16, []); if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) fail('La matriz de una pieza no es afín.');
  let sx = Math.hypot(m[0]!, m[1]!, m[2]!); const sy = Math.hypot(m[4]!, m[5]!, m[6]!), sz = Math.hypot(m[8]!, m[9]!, m[10]!);
  const determinant = m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) - m[4]! * (m[1]! * m[10]! - m[2]! * m[9]!) + m[8]! * (m[1]! * m[6]! - m[2]! * m[5]!); if (determinant < 0) sx = -sx;
  out.position = [m[12]!, m[13]!, m[14]!]; out.scale = [sx, sy, sz];
  if (!sx || !sy || !sz) return out;
  const a = m[0]! / sx, b = m[4]! / sy, c = m[8]! / sz, d = m[1]! / sx, e = m[5]! / sy, f = m[9]! / sz, g = m[2]! / sx, h = m[6]! / sy, i = m[10]! / sz; const trace = a + e + i;
  if (Math.abs(a * b + d * e + g * h) > 1e-4 || Math.abs(a * c + d * f + g * i) > 1e-4 || Math.abs(b * c + e * f + h * i) > 1e-4) fail('La matriz de una pieza contiene una deformación no compatible.');
  let x, y, z, w;
  if (trace > 0) { const s = .5 / Math.sqrt(trace + 1); w = .25 / s; x = (h - f) * s; y = (c - g) * s; z = (d - b) * s; }
  else if (a > e && a > i) { const s = 2 * Math.sqrt(1 + a - e - i); w = (h - f) / s; x = .25 * s; y = (b + d) / s; z = (c + g) / s; }
  else if (e > i) { const s = 2 * Math.sqrt(1 + e - a - i); w = (c - g) / s; x = (b + d) / s; y = .25 * s; z = (f + h) / s; }
  else { const s = 2 * Math.sqrt(1 + i - a - e); w = (d - b) / s; x = (c + g) / s; y = (f + h) / s; z = .25 * s; }
  if (![x, y, z, w].every(Number.isFinite)) fail('La rotación de una pieza no es válida.');
  out.quaternion = [x, y, z, w]; return out;
}
/** Reads bounded ranges. The server can validate chunked native uploads without concatenating the entire file. */
export function readGlbManifest(reader: GlbRangeReader, byteLength: number): GlbManifest {
  int(byteLength, 'El tamaño del GLB', VISUAL_SCENE_LIMITS.modelBytes, 20);
  const read = (offset: number, length: number) => { if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > byteLength) fail('Un bloque del GLB queda fuera del archivo.'); const bytes = reader(offset, length); if (bytes.length !== length) fail('El GLB está incompleto.'); return bytes; };
  const words = (offset: number, length: number) => { const bytes = read(offset, length); return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); };
  const header = words(0, 12); if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== byteLength) fail('Usa un archivo GLB 2.0 válido; su cabecera o longitud no coincide.');
  let json: Obj | undefined, binOffset = -1, binLength = 0;
  for (let offset = 12; offset < byteLength;) {
    const block = words(offset, 8), length = block.getUint32(0, true), type = block.getUint32(4, true); if (length % 4 || offset + 8 + length > byteLength) fail('La longitud de un bloque GLB no es válida.');
    if (type === 0x4e4f534a) {
      if (json || offset !== 12 || length > VISUAL_SCENE_LIMITS.jsonBytes || !length) fail('El bloque JSON del GLB no es válido o supera 4 MiB.');
      try { const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(read(offset + 8, length)); depth(source); json = object(JSON.parse(source)); } catch (error) { if (error instanceof Error && /profunda/.test(error.message)) throw error; fail('El JSON del GLB no es válido.'); }
    } else if (type === 0x004e4942) { if (!json || binOffset !== -1) fail('El bloque binario del GLB no es válido.'); binOffset = offset + 8; binLength = length; }
    else if (!json) fail('El primer bloque del GLB debe ser JSON.');
    offset += 8 + length;
  }
  if (!json || object(json.asset).version !== '2.0') fail('El modelo debe utilizar glTF 2.0.');
  const used = array(json.extensionsUsed, 'Las extensiones', 100).map(value => { if (typeof value !== 'string') fail('Las extensiones no son válidas.'); return value; });
  const required = array(json.extensionsRequired, 'Las extensiones requeridas', 100).map(value => { if (typeof value !== 'string' || !used.includes(value) || !(GLB_SUPPORTED_EXTENSIONS as readonly string[]).includes(value)) fail(`La extensión ${String(value)} no es compatible con este visor.`); return value; });
  const buffers = array(json.buffers, 'Los buffers', 10_000).map(value => object(value));
  const views = array(json.bufferViews, 'Los bloques de geometría', 30_000).map(value => object(value));
  const accessors = array(json.accessors, 'Los atributos', 30_000).map(value => object(value));
  const physical = new Map<number, { length: number; read: GlbRangeReader }>();
  buffers.forEach((buffer, i) => {
    const length = int(buffer.byteLength, 'El tamaño del buffer', VISUAL_SCENE_LIMITS.geometryBytes);
    if (buffer.uri !== undefined) { if (typeof buffer.uri !== 'string') fail('La URI del buffer no es válida.'); const data = decodeData(buffer.uri, ['application/octet-stream', 'application/gltf-buffer']); if (data.length !== length) fail('El buffer incrustado está incompleto.'); physical.set(i, { length, read: (offset, size) => data.subarray(offset, offset + size) }); }
    else if (i === 0 && binOffset !== -1) { if (length > binLength || binLength - length > 3) fail('El bloque binario no coincide con su buffer.'); physical.set(i, { length, read: (offset, size) => read(binOffset + offset, size) }); }
  });
  const viewSource = (viewIndex: number) => { const view = views[viewIndex]!; const bufferIndex = index(view.buffer, buffers, 'El buffer'); const offset = int(view.byteOffset ?? 0, 'El desplazamiento del buffer'); const length = int(view.byteLength, 'El tamaño de geometría'); return { view, bufferIndex, offset, length }; };
  views.forEach((view, i) => {
    const source = viewSource(i); if (source.offset + source.length > int(buffers[source.bufferIndex]!.byteLength, 'El buffer')) fail('Un bloque de geometría excede su buffer.');
    if (view.byteStride !== undefined) int(view.byteStride, 'El paso del atributo', 252, 4);
    const compressed = view.extensions && object(view.extensions).EXT_meshopt_compression;
    if (compressed !== undefined) {
      if (!used.includes('EXT_meshopt_compression')) fail('Falta la extensión Meshopt declarada.'); const ext = object(compressed); const buffer = index(ext.buffer, buffers, 'El buffer comprimido'); const stored = physical.get(buffer); const offset = int(ext.byteOffset ?? 0, 'El desplazamiento comprimido'); const size = int(ext.byteLength, 'El tamaño comprimido', VISUAL_SCENE_LIMITS.modelBytes, 1); const stride = int(ext.byteStride, 'El paso Meshopt', 256, 1); const count = int(ext.count, 'La cantidad Meshopt', VISUAL_SCENE_LIMITS.geometryBytes, 1);
      if (!stored || offset + size > stored.length || stride * count !== source.length || !['ATTRIBUTES', 'TRIANGLES', 'INDICES'].includes(String(ext.mode)) || ext.filter !== undefined && !['NONE', 'OCTAHEDRAL', 'QUATERNION', 'EXPONENTIAL'].includes(String(ext.filter))) fail('La geometría Meshopt no es válida.');
      if (!physical.has(source.bufferIndex) && !required.includes('EXT_meshopt_compression')) fail('Un buffer de reserva Meshopt requiere su decodificador.');
    } else if (!physical.has(source.bufferIndex)) fail('El GLB depende de un buffer externo o ausente.');
  });
  const componentBytes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const sizes: Record<string, [number, number]> = { SCALAR: [1, 1], VEC2: [2, 1], VEC3: [3, 1], VEC4: [4, 1], MAT2: [2, 2], MAT3: [3, 3], MAT4: [4, 4] };
  let geometryBytes = 0;
  accessors.forEach(accessor => {
    const component = componentBytes[int(accessor.componentType, 'El tipo de atributo', 5126)]; const shape = sizes[String(accessor.type)]; if (!component || !shape) fail('El tipo de atributo no es compatible.');
    const count = int(accessor.count, 'La cantidad de vértices', VISUAL_SCENE_LIMITS.triangles * 3, 1); const elementBytes = shape[1] > 1 ? Math.ceil(shape[0] * component / 4) * 4 * shape[1] : shape[0] * component; geometryBytes += count * elementBytes;
    if (geometryBytes > VISUAL_SCENE_LIMITS.geometryBytes) fail('La geometría decodificada supera 256 MiB.');
    const offset = int(accessor.byteOffset ?? 0, 'El desplazamiento del atributo'); if (offset % component) fail('El atributo no está alineado.');
    if (accessor.bufferView !== undefined) { const source = viewSource(index(accessor.bufferView, views, 'El bloque del atributo')); const stride = int(source.view.byteStride ?? elementBytes, 'El paso del atributo', 256, elementBytes); if (source.offset % component || stride % component || offset + (count - 1) * stride + elementBytes > source.length) fail('Un atributo excede su bloque de geometría.'); }
    if (accessor.sparse !== undefined) {
      const sparse = object(accessor.sparse), sparseCount = int(sparse.count, 'Los atributos dispersos', count, 1); const indices = object(sparse.indices), values = object(sparse.values); const indexBytes = componentBytes[int(indices.componentType, 'El índice disperso', 5125)]; if (![5121, 5123, 5125].includes(Number(indices.componentType)) || !indexBytes) fail('Los índices dispersos no son válidos.');
      for (const [entry, size] of [[indices, indexBytes], [values, elementBytes]] as [Obj, number][]) { const source = viewSource(index(entry.bufferView, views, 'El bloque disperso')); if (int(entry.byteOffset ?? 0, 'El desplazamiento disperso') + sparseCount * size > source.length) fail('El atributo disperso excede su bloque.'); }
    }
  });
  const images = array(json.images, 'Las texturas', 2_000).map(value => object(value));
  const samplers = array(json.samplers, 'Los filtros de textura', 2_000).map(value => object(value));
  const textures = array(json.textures, 'Los materiales de textura', 2_000).map(value => object(value));
  for (const texture of textures) {
    if (texture.sampler !== undefined) index(texture.sampler, samplers, 'El filtro de textura');
    const basis = texture.extensions && object(texture.extensions).KHR_texture_basisu;
    if (texture.source !== undefined) index(texture.source, images, 'La imagen de textura');
    if (basis !== undefined) { if (!used.includes('KHR_texture_basisu')) fail('Falta la extensión KTX2 declarada.'); index(object(basis).source, images, 'La imagen KTX2'); }
    else if (texture.source === undefined) fail('La textura no contiene una imagen compatible.');
  }
  const materials = array(json.materials, 'Los materiales', 2_000).map(value => object(value));
  const checkTextureInfos = (value: Obj, nesting = 0) => { if (nesting > 16) fail('El material es demasiado profundo.'); for (const [key, entry] of Object.entries(value)) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry) && key !== 'extras') { const info = object(entry); if (/Texture$/.test(key)) index(info.index, textures, 'La textura del material'); else checkTextureInfos(info, nesting + 1); }
  } };
  materials.forEach(material => checkTextureInfos(material));
  const meshes = array(json.meshes, 'Las mallas', VISUAL_SCENE_LIMITS.primitives).map(value => object(value)); let primitiveCount = 0;
  const meshTriangles = meshes.map(mesh => array(mesh.primitives, 'Las primitivas', VISUAL_SCENE_LIMITS.primitives).reduce<number>((sum, value) => {
    if (++primitiveCount > VISUAL_SCENE_LIMITS.primitives) fail('El modelo supera 2000 primitivas.'); const primitive = object(value), attributes = object(primitive.attributes, 'Los atributos'); const positions = accessors[index(attributes.POSITION, accessors, 'Las posiciones')]!; const positionCount = int(positions.count, 'Los vértices'); if (positions.type !== 'VEC3') fail('Las posiciones requieren tres coordenadas.');
    for (const value of Object.values(attributes)) { const accessor = accessors[index(value, accessors, 'El atributo')]!; if (accessor.count !== positionCount) fail('Los atributos no tienen el mismo número de vértices.'); }
    let count = positionCount; if (primitive.indices !== undefined) { const accessor = accessors[index(primitive.indices, accessors, 'Los índices')]!; if (accessor.type !== 'SCALAR' || ![5121, 5123, 5125].includes(Number(accessor.componentType))) fail('Los índices no son válidos.'); count = int(accessor.count, 'Los índices'); }
    const draco = primitive.extensions && object(primitive.extensions).KHR_draco_mesh_compression;
    if (draco !== undefined) { if (!used.includes('KHR_draco_mesh_compression')) fail('Falta la extensión Draco declarada.'); const ext = object(draco), source = viewSource(index(ext.bufferView, views, 'El bloque Draco')); if (!physical.has(source.bufferIndex)) fail('El bloque Draco debe estar incrustado.'); for (const value of Object.values(object(ext.attributes))) int(value, 'El atributo Draco', 65_535); }
    if (primitive.material !== undefined) index(primitive.material, materials, 'El material');
    for (const target of array(primitive.targets, 'Las variaciones de geometría', 100)) for (const value of Object.values(object(target))) if (accessors[index(value, accessors, 'La variación')]!.count !== positionCount) fail('La variación no coincide con sus vértices.');
    const mode = int(primitive.mode ?? 4, 'El modo de geometría', 6); return sum + (mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0);
  }, 0));
  const rawNodes = array(json.nodes, 'Las piezas', VISUAL_SCENE_LIMITS.nodes).map(value => object(value));
  const skins = array(json.skins, 'Las estructuras de articulación', VISUAL_SCENE_LIMITS.nodes).map(value => object(value));
  for (const skin of skins) { const joints = array(skin.joints, 'Las articulaciones', VISUAL_SCENE_LIMITS.nodes); if (!joints.length) fail('La estructura de articulación está vacía.'); joints.forEach(value => index(value, rawNodes, 'La articulación')); if (skin.skeleton !== undefined) index(skin.skeleton, rawNodes, 'La raíz articulada'); if (skin.inverseBindMatrices !== undefined) { const accessor = accessors[index(skin.inverseBindMatrices, accessors, 'La matriz articulada')]!; if (accessor.type !== 'MAT4' || accessor.componentType !== 5126 || Number(accessor.count) < joints.length) fail('Las matrices de articulación no son válidas.'); } }
  for (const node of rawNodes) if (node.skin !== undefined) index(node.skin, skins, 'La estructura articulada');
  // Clips remain stopped, but malformed references must not reach a browser decoder.
  for (const value of array(json.animations, 'Las animaciones', 100)) { const animation = object(value), animationSamplers = array(animation.samplers, 'Los canales de animación', 10_000).map(value => object(value)); for (const sampler of animationSamplers) { const input = accessors[index(sampler.input, accessors, 'La entrada de animación')]!; index(sampler.output, accessors, 'La salida de animación'); if (input.type !== 'SCALAR' || input.componentType !== 5126 || sampler.interpolation !== undefined && !['LINEAR', 'STEP', 'CUBICSPLINE'].includes(String(sampler.interpolation))) fail('La animación no es válida.'); } for (const value of array(animation.channels, 'Los destinos de animación', 10_000)) { const channel = object(value); index(channel.sampler, animationSamplers, 'El canal de animación'); const target = object(channel.target); if (target.node !== undefined) index(target.node, rawNodes, 'La pieza animada'); if (!['translation', 'rotation', 'scale', 'weights'].includes(String(target.path))) fail('La animación utiliza un destino no compatible.'); } }
  const nodes = rawNodes.map((node, i): GlbNode => ({ index: i, name: typeof node.name === 'string' ? node.name.slice(0, 200) : `Pieza ${i + 1}`, children: array(node.children, 'Las piezas hijas', VISUAL_SCENE_LIMITS.nodes).map(value => index(value, rawNodes, 'La pieza hija')), ...(node.mesh === undefined ? {} : { mesh: index(node.mesh, meshes, 'La malla') }), transform: transform(node) }));
  const parents = new Map<number, number>(); for (const node of nodes) for (const child of node.children) { if (parents.has(child)) fail('Una pieza no puede tener dos padres.'); parents.set(child, node.index); }
  const seen = new Set<number>(), visiting = new Set<number>(); const visit = (id: number, nesting = 0) => { if (visiting.has(id) || nesting > 128) fail('La jerarquía de piezas contiene un ciclo o es demasiado profunda.'); if (seen.has(id)) return; visiting.add(id); nodes[id]!.children.forEach(child => visit(child, nesting + 1)); visiting.delete(id); seen.add(id); }; nodes.forEach(node => visit(node.index));
  const scenes = array(json.scenes, 'Las escenas', 100).map(value => object(value)); if (!scenes.length) fail('El GLB no contiene una escena.');
  const scene = scenes[index(json.scene ?? 0, scenes, 'La escena predeterminada')]!; const roots = array(scene.nodes, 'Las piezas raíz', VISUAL_SCENE_LIMITS.nodes).map(value => index(value, nodes, 'La pieza raíz'));
  if (new Set(roots).size !== roots.length || roots.some(id => parents.has(id))) fail('La raíz de la escena no es válida.');
  const active = new Set<number>(); const include = (id: number) => { if (active.has(id)) return; active.add(id); nodes[id]!.children.forEach(include); }; roots.forEach(include);
  let triangleCount = 0, renderedPrimitives = 0; for (const id of active) { const node = nodes[id]!; if (node.mesh === undefined) continue; let instances = 1; const ext = rawNodes[id]!.extensions && object(rawNodes[id]!.extensions).EXT_mesh_gpu_instancing; if (ext) { if (!used.includes('EXT_mesh_gpu_instancing')) fail('Falta la extensión de instancias.'); const values = Object.values(object(object(ext).attributes)); const counts = values.map(value => int(accessors[index(value, accessors, 'La instancia GPU')]!.count, 'Las instancias')); if (!counts.length || counts.some(value => value !== counts[0])) fail('Las instancias GPU no son válidas.'); instances = counts[0]!; } triangleCount += meshTriangles[node.mesh]! * instances; renderedPrimitives += array(meshes[node.mesh]!.primitives, 'Las primitivas').length; }
  if (!active.size || !renderedPrimitives) fail('El GLB no contiene piezas visibles en su escena predeterminada.');
  if (triangleCount > VISUAL_SCENE_LIMITS.triangles || renderedPrimitives > VISUAL_SCENE_LIMITS.primitives) fail('El modelo excede el presupuesto de triángulos o primitivas.');
  let texturePixels = 0;
  for (const value of images) {
    const image = object(value); let imageLength: number; let imageRead: GlbRangeReader; let mime: string;
    if (image.uri !== undefined) { if (typeof image.uri !== 'string' || image.bufferView !== undefined) fail('La imagen del GLB no es válida.'); const data = decodeData(image.uri, ['image/png', 'image/jpeg', 'image/ktx2']); imageLength = data.length; imageRead = (offset, length) => data.subarray(offset, offset + length); mime = /^data:([^;,]+)/.exec(image.uri)![1]!; }
    else { const source = viewSource(index(image.bufferView, views, 'El bloque de imagen')); const buffer = physical.get(source.bufferIndex); if (!buffer) fail('La imagen debe estar incrustada en el GLB.'); imageLength = source.length; imageRead = (offset, length) => buffer.read(source.offset + offset, length); mime = String(image.mimeType); }
    const dimensions = glbImageDimensions(imageRead, imageLength, mime); texturePixels += dimensions.width * dimensions.height;
    if (texturePixels > VISUAL_SCENE_LIMITS.texturePixels) fail('Las texturas del modelo superan 32 megapíxeles.');
  }
  return { byteLength, nodes: nodes.filter(node => active.has(node.index)), roots, nodeCount: active.size, primitiveCount: renderedPrimitives, triangleCount, geometryBytes, texturePixels, extensions: used };
}
export function glbImageDimensions(reader: GlbRangeReader, byteLength: number, mime: string): { width: number; height: number } {
  const read = (offset: number, length: number) => { if (offset < 0 || offset + length > byteLength) fail('La textura está incompleta.'); const data = reader(offset, length); if (data.length !== length) fail('La textura está incompleta.'); return data; };
  let width = 0, height = 0;
  if (mime === 'image/png') { const b = read(0, 24); if (![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v) || String.fromCharCode(...b.subarray(12, 16)) !== 'IHDR') fail('La textura PNG no es válida.'); const view = new DataView(b.buffer, b.byteOffset, b.byteLength); width = view.getUint32(16); height = view.getUint32(20); }
  else if (mime === 'image/jpeg') { const magic = read(0, 2); if (magic[0] !== 255 || magic[1] !== 216) fail('La textura JPEG no es válida.'); let offset = 2;
    for (let i = 0; i < 4096 && offset + 4 <= byteLength; i++) { const head = read(offset, 4); if (head[0] !== 255) fail('La textura JPEG no es válida.'); const marker = head[1]!; if (marker === 255) { offset++; continue; } if (marker === 0xda || marker === 0xd9) break; if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd8) { offset += 2; continue; } const size = head[2]! * 256 + head[3]!; if (size < 2 || offset + 2 + size > byteLength) fail('La textura JPEG está incompleta.'); if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) { const frame = read(offset, 9); height = frame[5]! * 256 + frame[6]!; width = frame[7]! * 256 + frame[8]!; break; } offset += size + 2; }
  } else if (mime === 'image/ktx2') { const b = read(0, 80); if (![171, 75, 84, 88, 32, 50, 48, 187, 13, 10, 26, 10].every((v, i) => b[i] === v)) fail('La textura KTX2 no es válida.'); const view = new DataView(b.buffer, b.byteOffset, b.byteLength); width = view.getUint32(20, true); height = view.getUint32(24, true); const levels = view.getUint32(40, true); if (view.getUint32(28, true) > 1 || view.getUint32(32, true) > 1 || view.getUint32(36, true) !== 1 || levels < 1 || levels > 13 || view.getUint32(44, true) > 3) fail('La textura KTX2 no es una imagen 2D compatible.'); const levelBytes = read(80, levels * 24), levelView = new DataView(levelBytes.buffer, levelBytes.byteOffset, levelBytes.byteLength); for (let i = 0; i < levels; i++) { const offset = Number(levelView.getBigUint64(i * 24, true)), size = Number(levelView.getBigUint64(i * 24 + 8, true)), expanded = Number(levelView.getBigUint64(i * 24 + 16, true)); if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 80 + levels * 24 || offset + size > byteLength || expanded > VISUAL_SCENE_LIMITS.geometryBytes) fail('Un nivel de la textura KTX2 no es válido.'); }
  } else fail('Usa texturas PNG, JPEG o KTX2 incrustadas en el GLB.');
  int(width, 'El ancho de textura', VISUAL_SCENE_LIMITS.textureEdge, 1); int(height, 'El alto de textura', VISUAL_SCENE_LIMITS.textureEdge, 1); return { width, height };
}
export function parseGlbManifest(bytes: Uint8Array): GlbManifest { return readGlbManifest((offset, length) => bytes.subarray(offset, offset + length), bytes.length); }
export const parseGlb = parseGlbManifest;
export const validateGlb = readGlbManifest;
