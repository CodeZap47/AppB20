import { MeshoptDecoder } from './vendor/meshopt.mjs';

self.onmessage = async event => {
  const { id, count, size, source, mode, filter } = event.data;
  try {
    if (!Number.isSafeInteger(count) || !Number.isSafeInteger(size) || count <= 0 || size <= 0 || count * size > 256 * 1024 * 1024) {
      throw new Error('El modelo excede el límite de geometría.');
    }
    await MeshoptDecoder.ready;
    const result = await MeshoptDecoder.decodeGltfBufferAsync(count, size, source, mode, filter);
    self.postMessage({ id, result }, [result.buffer]);
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : 'No se pudo decodificar el modelo.' }); }
};
