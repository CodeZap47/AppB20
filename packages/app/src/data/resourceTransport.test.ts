import { describe, expect, it, vi } from 'vitest';
import { MAX_FILE_BYTES } from '@b20/core';
import { ResourceTransport } from './resourceTransport';

describe('transferencia privada de recursos', () => {
  it('envía bytes y usa el token actual, sin URLs públicas ni metadatos en el cuerpo', async () => {
    let token = 'first';
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ fileId: 'file-id' })));
    const transport = new ResourceTransport({ apiUrl: 'https://api.example/', getToken: () => token, fetch: request });
    const file = new File(['contenido'], 'Guía 1.txt', { type: 'text/plain' });
    token = 'renewed';
    expect(await transport.upload('assignment', '17', file, 4)).toBe('file-id');
    const [url, options] = request.mock.calls[0]!;
    expect(String(url)).toContain('targetKind=assignment&targetId=17&expectedVersion=4');
    expect(options).toMatchObject({ method: 'PUT', body: file, headers: {
      Authorization: 'Bearer renewed', 'X-File-Name': encodeURIComponent(file.name), 'X-File-Size': String(file.size),
    } });
  });

  it('reintenta con el mismo ID después de una respuesta perdida', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ fileId: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ fileId: 'same' })));
    const transport = new ResourceTransport({ apiUrl: '', getToken: () => 'token', fetch: request });
    const file = new File(['bytes'], 'codigo.txt');
    await expect(transport.upload('work', '3', file, 1)).rejects.toThrow();
    expect(await transport.upload('work', '3', file, 1)).toBe('same');
    expect(request.mock.calls[0]?.[0]).toBe(request.mock.calls[2]?.[0]);
    expect(request.mock.calls[1]?.[1]?.method).toBeUndefined();
  });

  it.each(['network', 'server', 'invalid'] as const)('recupera el commit antes de reportar fallo %s', async (failure) => {
    const request = vi.fn<typeof fetch>();
    if (failure === 'network') request.mockRejectedValueOnce(new Error('Respuesta perdida'));
    else request.mockResolvedValueOnce(failure === 'server' ? new Response('No disponible', { status: 503 }) : new Response('truncado'));
    request.mockResolvedValueOnce(new Response(JSON.stringify({ fileId: 'committed-file' })));
    const transport = new ResourceTransport({ apiUrl: '', getToken: () => 'current', fetch: request });
    expect(await transport.upload('work', '3', new File(['datos'], 'datos.txt'), 2)).toBe('committed-file');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0]).toBe(request.mock.calls[1]?.[0]);
    expect(request.mock.calls[1]?.[1]).toEqual({ headers: { Authorization: 'Bearer current' } });
  });

  it('rechaza sesión ausente y tamaños inválidos antes de enviar', async () => {
    const request = vi.fn<typeof fetch>();
    const transport = new ResourceTransport({ apiUrl: '', getToken: () => undefined, fetch: request });
    await expect(transport.upload('evidence', '1', new File([], 'vacio.txt'), 1)).rejects.toThrow('vacío');
    await expect(transport.download('legacy:3')).rejects.toThrow('Inicia sesión');
    const huge = { name: 'grande.bin', size: MAX_FILE_BYTES + 1 } as File;
    await expect(transport.upload('work', '1', huge, 1)).rejects.toThrow('50 MB');
    expect(request).not.toHaveBeenCalled();
  });

  it('descarga referencias heredadas con autenticación y conserva los bytes', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('contenido', { headers: { 'Content-Type': 'text/plain' } }));
    const transport = new ResourceTransport({ apiUrl: '', getToken: () => 'token', fetch: request });
    expect(await (await transport.download('legacy:42')).text()).toBe('contenido');
    expect(request).toHaveBeenCalledWith('/files/legacy%3A42', { headers: { Authorization: 'Bearer token' } });
  });
});

async function sha(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
    (value) => value.toString(16).padStart(2, '0')).join('');
}

function native() {
  type Begin = Parameters<import('./resourceTransport').ResourceConnection['reducers']['beginResourceUpload']>[0];
  const uploads = new Map<string, { input: Begin; state: string; parts: Map<number, { bytes: Uint8Array; sha256: string }> }>();
  const receipts = new Map<string, string>();
  const storage = { getItem: (key: string) => receipts.get(key) ?? null,
    setItem: (key: string, value: string) => { receipts.set(key, value); }, removeItem: (key: string) => { receipts.delete(key); } };
  let actor = 'member-1';
  const reducers = {
    beginResourceUpload: vi.fn(async (input: Begin) => {
      if (!uploads.has(input.uploadId)) uploads.set(input.uploadId, { input, state: 'pending', parts: new Map() });
    }),
    putResourceChunk: vi.fn(async (input: { uploadId: string; index: number; bytes: Uint8Array; sha256: string }) => {
      uploads.get(input.uploadId)!.parts.set(input.index, { bytes: input.bytes, sha256: input.sha256 });
    }),
    finalizeResourceUpload: vi.fn(async ({ uploadId }: { uploadId: string }) => { uploads.get(uploadId)!.state = 'ready'; }),
    cancelResourceUpload: vi.fn(async ({ uploadId }: { uploadId: string }) => { uploads.get(uploadId)!.state = 'cancelled'; }),
  };
  const procedures = {
    getResourceUploadStatus: vi.fn(async ({ uploadId }: { uploadId: string }) => {
      const upload = uploads.get(uploadId);
      if (!upload) return 'null';
      return JSON.stringify({ uploadId, state: upload.state, fileId: upload.state === 'ready' ? uploadId : undefined,
        receivedIndexes: [...upload.parts.keys()], sha256: upload.input.sha256 });
    }),
    getResourceManifest: vi.fn(async ({ fileId }: { fileId: string }) => {
      const upload = uploads.get(fileId)!;
      return JSON.stringify({ storageKind: 'spacetime', fileId, name: upload.input.name, mime: upload.input.mime,
        bytes: String(upload.input.bytes), chunkCount: upload.parts.size, sha256: upload.input.sha256 });
    }),
    readResourceChunk: vi.fn(async ({ fileId, index }: { fileId: string; index: number }) => {
      const part = uploads.get(fileId)!.parts.get(index)!;
      return { index, bytes: part.bytes, sha256: part.sha256 };
    }),
  };
  const getConnection = vi.fn(() => ({ reducers, procedures }));
  const options = { getConnection, getIdentity: () => actor, receiptStorage: storage };
  return { options, uploads, receipts, reducers, procedures, getConnection, setActor: (value: string) => { actor = value; },
    transport: new ResourceTransport(options) };
}

describe('archivos nativos de SpacetimeDB', () => {
  it('descarta un intento fallido y libera su reserva sin iniciar otra subida', async () => {
    const wire = native();
    const file = new File(['datos'], 'datos.txt');
    wire.reducers.putResourceChunk.mockRejectedValueOnce(new Error('sin conexión'));
    await expect(wire.transport.upload('assignment', '8', file, 1)).rejects.toThrow();
    expect(wire.receipts.size).toBe(1);
    await expect(wire.transport.discardUpload('assignment', '8', file)).resolves.toBeUndefined();
    expect(wire.reducers.cancelResourceUpload).toHaveBeenCalledOnce();
    expect(wire.reducers.beginResourceUpload).toHaveBeenCalledOnce();
    expect(wire.receipts.size).toBe(0);
  });

  it('devuelve un commit recuperado al descartar para que la interfaz pueda retirarlo', async () => {
    const wire = native();
    const file = new File(['datos'], 'datos.txt');
    wire.reducers.putResourceChunk.mockRejectedValueOnce(new Error('sin conexión'));
    await expect(wire.transport.upload('work', '8', file, 1)).rejects.toThrow();
    const [uploadId, upload] = [...wire.uploads.entries()][0]!;
    upload.state = 'ready';
    await expect(wire.transport.discardUpload('work', '8', file)).resolves.toBe(uploadId);
    expect(wire.reducers.cancelResourceUpload).not.toHaveBeenCalled();
    expect(wire.receipts.size).toBe(0);
  });

  it('informa la versión original al recuperar un archivo ya confirmado', async () => {
    const wire = native(); const file = new File(['datos'], 'datos.txt');
    wire.reducers.putResourceChunk.mockRejectedValueOnce(new Error('offline'));
    await expect(wire.transport.upload('work', '8', file, 1)).rejects.toThrow();
    const [id, pending] = [...wire.uploads.entries()][0]!;
    pending.state = 'ready';
    const onConfirmed = vi.fn();
    expect(await wire.transport.upload('work', '8', file, 2, { onConfirmed })).toBe(id);
    expect(onConfirmed).toHaveBeenCalledExactlyOnceWith(id, 2);
    expect(wire.reducers.beginResourceUpload).toHaveBeenCalledOnce();
  });

  it('conserva el recibo ante una cancelación incierta y permite reintentar el descarte', async () => {
    const wire = native(); const file = new File(['datos'], 'datos.txt');
    wire.reducers.putResourceChunk.mockRejectedValueOnce(new Error('offline'));
    await expect(wire.transport.upload('work', '8', file, 1)).rejects.toThrow();
    wire.reducers.cancelResourceUpload.mockRejectedValueOnce(new Error('sin confirmar'));
    await expect(wire.transport.discardUpload('work', '8', file)).rejects.toThrow('sin confirmar');
    expect(wire.receipts.size).toBe(1);
    await expect(wire.transport.discardUpload('work', '8', file)).resolves.toBeUndefined();
    expect(wire.receipts.size).toBe(0);
  });

  it('reconoce una confirmación que gana la carrera a cancelar', async () => {
    const wire = native(); const file = new File(['datos'], 'datos.txt');
    wire.reducers.putResourceChunk.mockRejectedValueOnce(new Error('offline'));
    await expect(wire.transport.upload('work', '8', file, 1)).rejects.toThrow();
    wire.reducers.cancelResourceUpload.mockImplementationOnce(async ({ uploadId }) => { wire.uploads.get(uploadId)!.state = 'ready'; });
    const id = [...wire.uploads.keys()][0]!;
    await expect(wire.transport.discardUpload('work', '8', file)).resolves.toBe(id);
    expect(wire.receipts.size).toBe(0);
  });

  it('no crea recibos ni cancela archivos ajenos al descartar una selección local', async () => {
    const wire = native();
    await expect(wire.transport.discardUpload('work', '8', new File(['datos'], 'datos.txt'))).resolves.toBeUndefined();
    expect(wire.receipts.size).toBe(0);
    expect(wire.reducers.beginResourceUpload).not.toHaveBeenCalled();
    expect(wire.reducers.cancelResourceUpload).not.toHaveBeenCalled();
  });

  it('fragmenta en 1 MiB, confirma hashes y descarga solamente bajo demanda', async () => {
    const wire = native();
    const bytes = new Uint8Array(1024 * 1024 + 3).fill(71);
    const progress = vi.fn();
    const fileId = await wire.transport.upload('work', '9007199254740993', new File([bytes], 'guia.txt', { type: 'text/plain' }), 4, { onProgress: progress });
    expect(wire.reducers.beginResourceUpload).toHaveBeenCalledWith(expect.objectContaining({ targetId: 9007199254740993n,
      bytes: BigInt(bytes.length), expectedVersion: 4, sha256: await sha(bytes) }));
    expect(wire.reducers.putResourceChunk.mock.calls.map(([chunk]) => chunk.bytes.length)).toEqual([1024 * 1024, 3]);
    expect(wire.procedures.readResourceChunk).not.toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(bytes.length, bytes.length);
    const blob = await wire.transport.download(fileId);
    const downloaded = new Uint8Array(await blob.arrayBuffer());
    expect(downloaded.length).toBe(bytes.length);
    expect(downloaded.every((value, index) => value === bytes[index])).toBe(true);
    expect(blob.type).toBe('text/plain');
    expect(wire.procedures.readResourceChunk).toHaveBeenCalledTimes(2);
    expect([...wire.receipts.values()].join('')).not.toContain('guia.txt');
  });

  it('reanuda tras una respuesta perdida y recarga, sin repetir fragmentos confirmados', async () => {
    const wire = native();
    const bytes = new Uint8Array(1024 * 1024 + 3).fill(4);
    const original = wire.reducers.putResourceChunk.getMockImplementation()!;
    wire.reducers.putResourceChunk.mockImplementationOnce(async (input) => { await original(input); throw new Error('offline'); });
    await expect(wire.transport.upload('work', '8', new File([bytes], 'datos.txt'), 1)).rejects.toThrow('offline');
    const firstId = wire.reducers.beginResourceUpload.mock.calls[0]![0].uploadId;
    const reloaded = new ResourceTransport(wire.options);
    expect(await reloaded.upload('work', '8', new File([bytes], 'datos.txt'), 1)).toBe(firstId);
    expect(wire.reducers.putResourceChunk.mock.calls.map(([chunk]) => chunk.index)).toEqual([0, 1]);
    expect(wire.reducers.beginResourceUpload.mock.calls[1]![0].uploadId).toBe(firstId);
  });

  it('recupera una finalización cuya respuesta se perdió sin crear otro archivo', async () => {
    const wire = native();
    wire.reducers.finalizeResourceUpload.mockImplementationOnce(async ({ uploadId }) => {
      wire.uploads.get(uploadId)!.state = 'ready'; throw new Error('respuesta perdida');
    });
    const file = new File(['datos'], 'datos.txt');
    expect(await wire.transport.upload('assignment', '1', file, 2)).toBe(wire.reducers.beginResourceUpload.mock.calls[0]![0].uploadId);
    expect(wire.reducers.finalizeResourceUpload).toHaveBeenCalledTimes(1);
    expect(wire.receipts.size).toBe(0);
  });

  it('recupera una confirmación incierta tras recargar aunque la página ya haya avanzado de versión', async () => {
    const wire = native();
    wire.reducers.finalizeResourceUpload.mockImplementationOnce(async ({ uploadId }) => {
      wire.uploads.get(uploadId)!.state = 'ready';
      wire.procedures.getResourceUploadStatus.mockRejectedValueOnce(new Error('sin conexión'));
      throw new Error('confirmación perdida');
    });
    await expect(wire.transport.upload('work', '8', new File(['datos'], 'datos.txt'), 3)).rejects.toThrow('confirmación perdida');
    const first = wire.reducers.beginResourceUpload.mock.calls[0]![0];
    expect(wire.receipts.size).toBe(1);
    expect(await new ResourceTransport(wire.options).upload('work', '8', new File(['datos'], 'datos.txt'), 4)).toBe(first.uploadId);
    expect(wire.reducers.beginResourceUpload).toHaveBeenCalledTimes(1);
    expect(wire.reducers.finalizeResourceUpload).toHaveBeenCalledTimes(1);
    expect(wire.receipts.size).toBe(0);
  });

  it('separa recibos de archivos con los mismos bytes y distinto nombre', async () => {
    const wire = native();
    wire.reducers.putResourceChunk.mockRejectedValueOnce(new Error('offline'));
    await expect(wire.transport.upload('work', '8', new File(['datos'], 'primero.txt'), 1)).rejects.toThrow();
    const firstId = wire.reducers.beginResourceUpload.mock.calls[0]![0].uploadId;
    expect(await wire.transport.upload('work', '8', new File(['datos'], 'segundo.txt'), 1)).not.toBe(firstId);
  });

  it('una cancelación posterior al commit confirma el archivo que ya quedó guardado', async () => {
    const wire = native();
    const controller = new AbortController();
    wire.reducers.finalizeResourceUpload.mockImplementationOnce(async ({ uploadId }) => {
      wire.uploads.get(uploadId)!.state = 'ready'; controller.abort();
    });
    const fileId = await wire.transport.upload('work', '8', new File(['datos'], 'datos.txt'), 1, { signal: controller.signal });
    expect(fileId).toBe(wire.reducers.beginResourceUpload.mock.calls[0]![0].uploadId);
    expect(wire.reducers.cancelResourceUpload).not.toHaveBeenCalled();
    expect(wire.receipts.size).toBe(0);
  });

  it('descarta recibos cancelados de forma definitiva aunque el inicio sea rechazado', async () => {
    const wire = native();
    wire.reducers.putResourceChunk.mockRejectedValueOnce(new Error('offline'));
    const file = new File(['datos'], 'datos.txt');
    await expect(wire.transport.upload('work', '8', file, 1)).rejects.toThrow();
    const firstId = wire.reducers.beginResourceUpload.mock.calls[0]![0].uploadId;
    wire.uploads.get(firstId)!.state = 'cancelled';
    wire.reducers.beginResourceUpload.mockRejectedValueOnce(new Error('La subida está cancelada'));
    await expect(new ResourceTransport(wire.options).upload('work', '8', file, 1)).rejects.toThrow('cancelada');
    expect(wire.receipts.size).toBe(0);
    expect(await new ResourceTransport(wire.options).upload('work', '8', file, 1)).not.toBe(firstId);
  });

  it('reconsulta la conexión renovada por operación y corta la subida si cambia la cuenta', async () => {
    const wire = native();
    let current = 0;
    const connections = [wire.getConnection(), wire.getConnection()];
    const renewedPut = vi.fn(async (input: Parameters<typeof wire.reducers.putResourceChunk>[0]) => { await wire.reducers.putResourceChunk(input); });
    connections[1] = { ...connections[1]!, reducers: { ...connections[1]!.reducers, putResourceChunk: renewedPut } };
    wire.getConnection.mockImplementation(() => connections[current]!);
    wire.reducers.beginResourceUpload.mockImplementationOnce(async (input) => {
      wire.uploads.set(input.uploadId, { input, state: 'pending', parts: new Map() }); current = 1;
    });
    await wire.transport.upload('work', '1', new File(['datos'], 'datos.txt'), 1);
    expect(renewedPut).toHaveBeenCalledTimes(1);
    const file = new File([new Uint8Array(1024 * 1024 + 1)], 'otra.txt');
    const original = renewedPut.getMockImplementation()!;
    renewedPut.mockImplementationOnce(async (input) => { await original(input); wire.setActor('member-2'); });
    await expect(wire.transport.upload('work', '2', file, 1)).rejects.toThrow('sesión cambió');
    expect(renewedPut).toHaveBeenCalledTimes(2);
  });

  it('cancela en el servidor y descarta el recibo; el siguiente intento usa otro ID', async () => {
    const wire = native();
    const controller = new AbortController();
    const original = wire.reducers.putResourceChunk.getMockImplementation()!;
    wire.reducers.putResourceChunk.mockImplementationOnce(async (input) => { await original(input); controller.abort(); });
    const file = new File([new Uint8Array(1024 * 1024 + 1)], 'datos.txt');
    await expect(wire.transport.upload('work', '1', file, 1, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(wire.reducers.cancelResourceUpload).toHaveBeenCalledTimes(1);
    expect(wire.receipts.size).toBe(0);
    const firstId = wire.reducers.beginResourceUpload.mock.calls[0]![0].uploadId;
    expect(await wire.transport.upload('work', '1', file, 1)).not.toBe(firstId);
  });

  it('rechaza archivos vacíos, exceso de tamaño y cancelación antes de contactar al servidor', async () => {
    const wire = native();
    await expect(wire.transport.upload('work', '1', new File([], 'vacio.txt'), 1)).rejects.toThrow('vacío');
    await expect(wire.transport.upload('work', '1', { name: 'grande.bin', size: MAX_FILE_BYTES + 1 } as File, 1)).rejects.toThrow('50 MB');
    await expect(wire.transport.upload('work', '1', new File(['datos'], 'datos.txt'), 1,
      { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(wire.getConnection).not.toHaveBeenCalled();
  });

  it('acepta el límite exacto y nunca envía fragmentos mayores a 1 MiB', async () => {
    const wire = native();
    const file = new File([new Uint8Array(MAX_FILE_BYTES)], 'maximo.bin');
    await wire.transport.upload('work', '1', file, 1);
    expect(wire.reducers.putResourceChunk).toHaveBeenCalledTimes(50);
    expect(wire.reducers.putResourceChunk.mock.calls.every(([chunk]) => chunk.bytes.length === 1024 * 1024)).toBe(true);
  });

  it('rechaza bytes truncados, alterados o con orden incorrecto antes de entregar un Blob', async () => {
    const wire = native();
    const fileId = await wire.transport.upload('work', '1', new File(['contenido'], 'datos.txt'), 1);
    const part = wire.uploads.get(fileId)!.parts.get(0)!;
    wire.procedures.readResourceChunk.mockResolvedValueOnce({ index: 0, bytes: part.bytes.slice(0, -1), sha256: part.sha256 });
    await expect(wire.transport.download(fileId)).rejects.toThrow('dañado');
    wire.procedures.readResourceChunk.mockResolvedValueOnce({ index: 0, bytes: new Uint8Array(part.bytes.length), sha256: part.sha256 });
    await expect(wire.transport.download(fileId)).rejects.toThrow('dañado');
    wire.procedures.readResourceChunk.mockResolvedValueOnce({ index: 1, bytes: part.bytes, sha256: part.sha256 });
    await expect(wire.transport.download(fileId)).rejects.toThrow('dañado');
  });

  it('comprueba también el hash completo y permite cancelar una descarga entre fragmentos', async () => {
    const wire = native();
    const fileId = await wire.transport.upload('work', '1', new File([new Uint8Array(1024 * 1024 + 1)], 'datos.txt'), 1);
    const manifest = await wire.procedures.getResourceManifest({ fileId });
    wire.procedures.getResourceManifest.mockResolvedValueOnce(JSON.stringify({ ...JSON.parse(manifest), sha256: 'f'.repeat(64) }));
    await expect(wire.transport.download(fileId)).rejects.toThrow('original');
    const controller = new AbortController();
    const before = wire.procedures.readResourceChunk.mock.calls.length;
    await expect(wire.transport.download(fileId, { signal: controller.signal,
      onProgress: (done) => { if (done) controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(wire.procedures.readResourceChunk.mock.calls.length - before).toBe(1);
  });

  it('vence los recibos a las 24 horas y no los reutiliza entre usuarios', async () => {
    const wire = native();
    const file = new File(['datos'], 'datos.txt');
    wire.reducers.putResourceChunk.mockRejectedValueOnce(new Error('offline'));
    await expect(wire.transport.upload('work', '1', file, 1)).rejects.toThrow();
    const firstId = wire.reducers.beginResourceUpload.mock.calls[0]![0].uploadId;
    for (const [key, value] of wire.receipts) wire.receipts.set(key, JSON.stringify({ ...JSON.parse(value), expiresAt: Date.now() - 1 }));
    expect(await new ResourceTransport(wire.options).upload('work', '1', file, 1)).not.toBe(firstId);
    wire.setActor('member-2');
    await new ResourceTransport(wire.options).upload('work', '1', file, 1);
    expect(new Set(wire.reducers.beginResourceUpload.mock.calls.map(([input]) => input.uploadId)).size).toBe(3);
  });

  it('solo accede al HTTP heredado cuando el manifiesto autorizado lo indica y usa el token actual', async () => {
    const wire = native();
    let token = 'first';
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('anterior'));
    const transport = new ResourceTransport({ ...wire.options, legacy: { apiUrl: 'https://api.example', getToken: () => token, fetch: request } });
    wire.procedures.getResourceManifest.mockRejectedValueOnce(new Error('Sin permiso'));
    await expect(transport.download('legacy:3')).rejects.toThrow('Sin permiso');
    expect(request).not.toHaveBeenCalled();
    wire.procedures.getResourceManifest.mockResolvedValueOnce(JSON.stringify({ storageKind: 'legacy', fileId: 'legacy:3' }));
    token = 'renewed';
    expect(await (await transport.download('legacy:3')).text()).toBe('anterior');
    expect(request).toHaveBeenCalledWith('https://api.example/files/legacy%3A3', { headers: { Authorization: 'Bearer renewed' } });
  });
});


it('desbloquea un recibo rechazado antes de que exista una subida en el servidor', async () => {
  const wire = native();
  wire.reducers.beginResourceUpload.mockRejectedValueOnce(new Error('Esta publicación cambió'));
  const file = new File(['datos'], 'datos.txt');
  await expect(wire.transport.upload('work', '8', file, 1)).rejects.toThrow('cambió');
  expect(wire.receipts.size).toBe(0);
  await new ResourceTransport(wire.options).upload('work', '8', new File(['datos'], 'datos.txt'), 2);
  expect(wire.reducers.beginResourceUpload.mock.calls[1]![0].expectedVersion).toBe(2);
});

it('cancela un intento pendiente antes de adjuntar a una publicación que cambió de versión', async () => {
  const wire = native();
  wire.reducers.putResourceChunk.mockRejectedValueOnce(new Error('offline'));
  const file = new File(['datos'], 'datos.txt');
  await expect(wire.transport.upload('work', '8', file, 1)).rejects.toThrow('offline');
  const reloaded = new ResourceTransport(wire.options);
  await expect(reloaded.upload('work', '8', new File(['datos'], 'datos.txt'), 2)).rejects.toThrow('Se canceló la subida anterior');
  expect(wire.reducers.cancelResourceUpload).toHaveBeenCalledTimes(1);
  expect(wire.receipts.size).toBe(0);
  await reloaded.upload('work', '8', file, 2);
  expect(wire.reducers.beginResourceUpload.mock.calls.at(-1)![0].expectedVersion).toBe(2);
});

it('conserva el recibo incierto si no puede consultar la versión anterior antes de reanudar', async () => {
  const wire = native();
  wire.reducers.putResourceChunk.mockRejectedValueOnce(new Error('offline'));
  await expect(wire.transport.upload('work', '8', new File(['datos'], 'datos.txt'), 1)).rejects.toThrow();
  const originalReceipt = [...wire.receipts.values()];
  wire.procedures.getResourceUploadStatus.mockRejectedValueOnce(new Error('conexión caída'));
  await expect(new ResourceTransport(wire.options).upload('work', '8', new File(['datos'], 'datos.txt'), 2)).rejects.toThrow('conexión caída');
  expect([...wire.receipts.values()]).toEqual(originalReceipt);
  expect(wire.reducers.cancelResourceUpload).not.toHaveBeenCalled();
});

it('descarta bytes heredados si la cuenta cambió mientras esperaba la descarga HTTP', async () => {
  const wire = native();
  const request = vi.fn<typeof fetch>().mockImplementation(async () => { wire.setActor('member-2'); return new Response('privado de member-1'); });
  wire.procedures.getResourceManifest.mockResolvedValueOnce(JSON.stringify({ storageKind: 'legacy', fileId: 'legacy:3' }));
  const transport = new ResourceTransport({ ...wire.options, legacy: { apiUrl: '', getToken: () => 'token', fetch: request } });
  await expect(transport.download('legacy:3')).rejects.toThrow('sesión cambió');
});


it('conserva el recibo si finalizar y cancelar pierden sus respuestas tras pedir cancelación', async () => {
  const wire = native();
  const controller = new AbortController();
  wire.reducers.finalizeResourceUpload.mockImplementationOnce(async ({ uploadId }) => {
    wire.uploads.get(uploadId)!.state = 'ready'; controller.abort();
    wire.procedures.getResourceUploadStatus.mockRejectedValueOnce(new Error('offline'));
    wire.reducers.cancelResourceUpload.mockRejectedValueOnce(new Error('offline'));
    throw new Error('offline');
  });
  await expect(wire.transport.upload('work', '8', new File(['datos'], 'datos.txt'), 1,
    { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(wire.receipts.size).toBe(1);
  const firstId = wire.reducers.beginResourceUpload.mock.calls[0]![0].uploadId;
  expect(await new ResourceTransport(wire.options).upload('work', '8', new File(['datos'], 'datos.txt'), 2)).toBe(firstId);
  expect(wire.reducers.finalizeResourceUpload).toHaveBeenCalledTimes(1);
});

it('comprueba si otra pestaña finalizó antes de que la cancelación llegara al servidor', async () => {
  const wire = native();
  const controller = new AbortController();
  const put = wire.reducers.putResourceChunk.getMockImplementation()!;
  wire.reducers.putResourceChunk.mockImplementationOnce(async (input) => { await put(input); controller.abort(); });
  wire.reducers.cancelResourceUpload.mockImplementationOnce(async ({ uploadId }) => { wire.uploads.get(uploadId)!.state = 'ready'; });
  const fileId = await wire.transport.upload('work', '8', new File(['datos'], 'datos.txt'), 1, { signal: controller.signal });
  expect(fileId).toBe(wire.reducers.beginResourceUpload.mock.calls[0]![0].uploadId);
  expect(wire.receipts.size).toBe(0);
});

it('conserva un recibo si cancelar fue aceptado pero no se puede consultar su resultado', async () => {
  const wire = native();
  const controller = new AbortController();
  const put = wire.reducers.putResourceChunk.getMockImplementation()!;
  wire.reducers.putResourceChunk.mockImplementationOnce(async (input) => { await put(input); controller.abort(); });
  wire.reducers.cancelResourceUpload.mockImplementationOnce(async ({ uploadId }) => {
    wire.uploads.get(uploadId)!.state = 'cancelled';
    wire.procedures.getResourceUploadStatus.mockRejectedValueOnce(new Error('offline'));
  });
  await expect(wire.transport.upload('work', '8', new File(['datos'], 'datos.txt'), 1,
    { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(wire.receipts.size).toBe(1);
});
