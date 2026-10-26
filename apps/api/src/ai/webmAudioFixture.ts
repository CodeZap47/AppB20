/** Synthetic MediaRecorder-shaped WebM: live unknown sizes, A_OPUS and no Info.Duration. No recorded media. */
export function mediaRecorderWebm(lastTimestampMs = 980, options: { declaredDuration?: number; blockGroup?: boolean; lacing?: 'xiph' | 'fixed' | 'ebml'; videoTrack?: boolean; firstClusterPackets?: number } = {}): Uint8Array {
  const join = (...parts: Uint8Array[]) => { const value = new Uint8Array(parts.reduce((total, part) => total + part.length, 0)); let at = 0; for (const part of parts) { value.set(part, at); at += part.length; } return value; };
  const unsigned = (value: number) => { const output: number[] = []; do { output.unshift(value % 256); value = Math.floor(value / 256); } while (value); return Uint8Array.from(output); };
  const size = (value: number): Uint8Array => { for (let length = 1; length <= 6; length++) { if (value < 2 ** (7 * length) - 1) { const output = new Uint8Array(length); let remaining = value; for (let at = length - 1; at >= 0; at--) { output[at] = remaining % 256; remaining = Math.floor(remaining / 256); } output[0] = output[0]! | (1 << (8 - length)); return output; } } throw new Error('Fixture too large'); };
  const tag = (id: number, value: Uint8Array) => join(unsigned(id), size(value.length), value);
  const number = (id: number, value: number) => tag(id, unsigned(value));
  const string = (id: number, value: string) => tag(id, new TextEncoder().encode(value));
  const float = (id: number, value: number) => { const data = new Uint8Array(8); new DataView(data.buffer).setFloat64(0, value); return tag(id, data); };
  const live = (id: number, ...parts: Uint8Array[]) => join(unsigned(id), Uint8Array.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), ...parts);
  const header = tag(0x1a45dfa3, join(number(0x4286, 1), number(0x42f7, 1), number(0x42f2, 4), number(0x42f3, 8), string(0x4282, 'webm'), number(0x4287, 4), number(0x4285, 2)));
  const opusHead = join(new TextEncoder().encode('OpusHead'), Uint8Array.from([1, 1, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0]));
  const audioTrack = tag(0xae, join(number(0xd7, 1), number(0x73c5, 1), number(0x83, 2), string(0x86, 'A_OPUS'), tag(0x63a2, opusHead), number(0x56aa, 6_500_000), number(0x56bb, 80_000_000), tag(0xe1, join(float(0xb5, 48000), number(0x9f, 1)))));
  const videoTrack = tag(0xae, join(number(0xd7, 2), number(0x73c5, 2), number(0x83, 1), string(0x86, 'V_VP8'), tag(0xe0, join(number(0xb0, 16), number(0xba, 16)))));
  const track = tag(0x1654ae6b, join(audioTrack, ...(options.videoTrack ? [videoTrack] : [])));
  // RFC 6716 CELT 20 ms single-frame packet; ff fe is the conventional Opus silence payload.
  const silence = Uint8Array.from([0xf8, 0xff, 0xfe]);
  const frame = () => {
    let payload: Uint8Array;
    if (options.lacing) { const flag = options.lacing === 'xiph' ? 0x82 : options.lacing === 'fixed' ? 0x84 : 0x86;
      const laceHeader = options.lacing === 'xiph' ? [1, 3] : options.lacing === 'ebml' ? [1, 0x83] : [1];
      payload = join(Uint8Array.from([0x81, 0, 0, flag, ...laceHeader]), silence, silence);
    } else payload = join(Uint8Array.from([0x81, 0, 0, 0x80]), silence);
    return options.blockGroup ? tag(0xa0, join(tag(0xa1, payload), number(0x9b, options.lacing ? 40 : 20))) : tag(0xa3, payload);
  };
  const info = tag(0x1549a966, join(number(0x2ad7b1, 1_000_000), string(0x4d80, 'Chrome'), string(0x5741, 'Chrome'), ...(options.declaredDuration === undefined ? [] : [float(0x4489, options.declaredDuration)])));
  const firstFrame = frame(); const count = options.firstClusterPackets ?? 1;
  const repeated = new Uint8Array(firstFrame.length * count); for (let index = 0; index < count; index++) repeated.set(firstFrame, index * firstFrame.length);
  return join(header, live(0x18538067, info, track, live(0x1f43b675, number(0xe7, 0), repeated), live(0x1f43b675, number(0xe7, lastTimestampMs), frame())));
}
