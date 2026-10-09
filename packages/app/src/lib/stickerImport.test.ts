import { describe, expect, it } from 'vitest';
import { prepareStickers, readZip } from './stickerImport';

const webp = (extra = 0) =>
  new Uint8Array(
    [...'RIFF']
      .map((c) => c.charCodeAt(0))
      .concat(
        [0, 0, 0, 0],
        [...'WEBPVP8 '].map((c) => c.charCodeAt(0)),
        new Array(20 + extra).fill(7),
      ),
  );

/** Arma un ZIP real (con deflate) para probar el lector sin depender de archivos externos. */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function zip(files: Record<string, Uint8Array | string>): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const locals: number[] = [];
  const central: number[] = [];
  let offset = 0;
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  for (const [name, value] of Object.entries(files)) {
    const raw = typeof value === 'string' ? encoder.encode(value) : value;
    const data = await deflateRaw(raw);
    const nameBytes = [...encoder.encode(name)];
    const header = [
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(8),
      ...u32(0),
      ...u32(0),
      ...u32(data.length),
      ...u32(raw.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes,
    ];
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(8),
      ...u32(0),
      ...u32(0),
      ...u32(data.length),
      ...u32(raw.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...nameBytes,
    );
    locals.push(...header, ...data);
    offset += header.length + data.length;
  }
  const count = Object.keys(files).length;
  const end = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(count),
    ...u16(count),
    ...u32(central.length),
    ...u32(offset),
    ...u16(0),
  ];
  return new Uint8Array([...locals, ...central, ...end]).buffer;
}

describe('importar stickers', () => {
  it('lee un ZIP con deflate', async () => {
    const entries = await readZip(await zip({ 'a.txt': 'hola', 'b.webp': webp() }));
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'b.webp']);
    expect(new TextDecoder().decode(entries[0]?.bytes)).toBe('hola');
  });

  it('saca las imágenes y el nombre de un .wastickers, sin el ícono de la bandeja', async () => {
    const pack = new File(
      [
        await zip({
          'title.txt': 'Mis stickers\n',
          'author.txt': 'x',
          'tray.png': webp(),
          '1.webp': webp(),
          '2.webp': webp(1),
        }),
      ],
      'pack.wastickers',
    );
    const result = await prepareStickers([pack]);
    expect(result.packName).toBe('Mis stickers');
    expect(result.files.map((f) => f.name)).toEqual(['1.webp', '2.webp']);
    expect(result.files[0]?.type).toBe('image/webp');
    expect(result.skipped).toEqual([]);
  });

  it('acepta imágenes sueltas y explica las que no sirven', async () => {
    const good = new File([webp() as BlobPart], 'sticker.webp');
    const bad = new File(['<svg></svg>'], 'dibujo.svg');
    const broken = new File(['no es zip'], 'roto.wastickers');
    const result = await prepareStickers([good, bad, broken]);
    expect(result.files.map((f) => f.name)).toEqual(['sticker.webp']);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped[0]).toContain('dibujo.svg');
    expect(result.skipped[1]).toContain('roto.wastickers');
  });

  it('corta en 30 por paquete', async () => {
    const many = Array.from({ length: 32 }, (_, i) => new File([webp() as BlobPart], `${i}.webp`));
    const result = await prepareStickers(many);
    expect(result.files).toHaveLength(30);
    expect(result.skipped[0]).toContain('se dejaron fuera 2');
  });
});
