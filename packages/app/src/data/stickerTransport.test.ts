import { describe, expect, it, vi } from 'vitest';
import { StickerTransport, type StickerConnection } from './stickerTransport';

const png = (size = 12) => { const bytes = new Uint8Array(size); bytes.set([137,80,78,71,13,10,26,10]); return bytes; };
const image = (name = 'sticker.png', size = 12) => new File([png(size)], name, { type: 'image/png' });
function setup() {
  const procedures = {
    createStickerPackNative: vi.fn(async () => 7n),
    addStickerNative: vi.fn(async () => 8n),
    readStickerBytes: vi.fn(async () => ({ bytes: png(), contentType: 'image/png' })),
  };
  let visible = true; let actor = 'member';
  const connection: StickerConnection = { db: { stickers: { iter: () => visible ? [{ id: 8n }] : [] } }, procedures };
  const transport = new StickerTransport(() => connection, () => actor);
  return { transport, procedures, connection, hide: () => { visible = false; }, changeActor: () => { actor = 'other'; } };
}

describe('stickers nativos del adaptador', () => {
  it('acepta exactamente 1 MiB y rechaza tamaños mayores o contenido malicioso antes de crear el paquete', async () => {
    const { transport, procedures } = setup();
    await expect(transport.import('Reacciones', [image('grande.png', 1024 * 1024)])).resolves.toBe('7');
    expect(procedures.addStickerNative).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'image/png', animated: false, bytes: expect.any(Uint8Array) }));
    procedures.createStickerPackNative.mockClear();
    await expect(transport.import('Reacciones', [image('demasiado.png', 1024 * 1024 + 1)])).rejects.toThrow(/1 MB/);
    await expect(transport.import('Reacciones', [new File(['<script>robar()</script>'], 'disfraz.png', { type: 'image/png' })])).rejects.toThrow(/no es una imagen/);
    expect(procedures.createStickerPackNative).not.toHaveBeenCalled();
    await expect(transport.import('Demasiados', Array.from({ length: 31 }, () => image()))).rejects.toThrow(/30/);
  });
  it('reintenta el mismo paquete y cada sticker con sus IDs, sin reenviar una intención nueva', async () => {
    const { transport, procedures } = setup();
    procedures.addStickerNative.mockResolvedValueOnce(8n).mockRejectedValueOnce(new Error('No confirmado')).mockResolvedValue(8n);
    const files = [image('uno.png'), image('dos.png')];
    await expect(transport.import('Reacciones', files)).rejects.toThrow('No confirmado');
    await expect(transport.import('Reacciones', [...files])).resolves.toBe('7');
    expect(procedures.createStickerPackNative.mock.calls[0]).toEqual(procedures.createStickerPackNative.mock.calls[1]);
    expect(procedures.addStickerNative.mock.calls[0]).toEqual(procedures.addStickerNative.mock.calls[2]);
    expect(procedures.addStickerNative.mock.calls[1]).toEqual(procedures.addStickerNative.mock.calls[3]);
  });
  it('descarta una importación si la cuenta cambia mientras se lee el archivo', async () => {
    const { transport, procedures, changeActor } = setup(); const file = image();
    vi.spyOn(file, 'arrayBuffer').mockImplementation(async () => { changeActor(); return png().buffer; });
    await expect(transport.import('Privado', [file])).rejects.toThrow(/sesión cambió/);
    expect(procedures.createStickerPackNative).not.toHaveBeenCalled();
  });
  it('descarta bytes si cambian la sesión o los permisos antes de terminar la descarga', async () => {
    const session = setup();
    session.procedures.readStickerBytes.mockImplementationOnce(async () => { session.changeActor(); return { bytes: png(), contentType: 'image/png' }; });
    await expect(session.transport.download('8')).rejects.toThrow(/sesión cambió/);
    const permission = setup();
    permission.procedures.readStickerBytes.mockImplementationOnce(async () => { permission.hide(); return { bytes: png(), contentType: 'image/png' }; });
    await expect(permission.transport.download('8')).rejects.toThrow(/ya no está disponible/);
    await expect(permission.transport.download('8')).rejects.toThrow(/no está disponible/);
    expect(permission.procedures.readStickerBytes).toHaveBeenCalledTimes(1);
  });
  it('solo construye imágenes del formato real autorizado', async () => {
    const { transport, procedures } = setup();
    expect((await transport.download('8')).type).toBe('image/png');
    procedures.readStickerBytes.mockResolvedValueOnce({ bytes: png(), contentType: 'image/jpeg' });
    await expect(transport.download('8')).rejects.toThrow(/formato/);
  });
});
