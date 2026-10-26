import { AiApiError } from './database.ts';
import { PRESENTATION_AUDIO_LIMITS } from '@b20/core';

// Matroska block timestamps: https://www.matroska.org/technical/notes.html#cluster-blocks
// Opus packet duration/framing: RFC 6716 sections 3.1–3.2. No client duration is used.
const IDS = { segment: 0x18538067, info: 0x1549a966, tracks: 0x1654ae6b, track: 0xae, cluster: 0x1f43b675,
  timestamp: 0xe7, simpleBlock: 0xa3, blockGroup: 0xa0, block: 0xa1, blockDuration: 0x9b };
const SEGMENT_CHILDREN = new Set([IDS.info, IDS.tracks, IDS.cluster, 0x114d9b74, 0x1c53bb6b, 0x1254c367, 0x1941a469, 0x1043a770]);
const MAX_ELEMENTS = 1_200_000;
function invalid(): never { throw new AiApiError(400, 'invalid', 'No pudimos verificar la duración del audio WebM. Usa una grabación WebM/Opus válida o un archivo M4A, MP3 o WAV.'); }
interface Element { id: number; start: number; end: number; unknown: boolean }
interface Track { number: number; codec: string; type: number; scale: number }
interface PacketBlock { track: number; timestamp: number; seconds: number; durationTicks?: number }

/** Small allowlisted EBML reader: finite input, bounded elements and only fixed-depth container traversal. */
export function webmOpusDuration(bytes: Uint8Array): number {
  if (!bytes.length || bytes.length > PRESENTATION_AUDIO_LIMITS.bytes) invalid();
  let elements = 0;
  const vint = (offset: number, end: number, identifier = false): { value: number; length: number; unknown: boolean } => {
    if (offset >= end || !bytes[offset]) invalid();
    const first = bytes[offset]!; let length = 1; let mask = 0x80;
    while (!(first & mask)) { mask >>= 1; length++; }
    if (length > (identifier ? 4 : 8) || offset + length > end) invalid();
    let value = identifier ? first : first & (mask - 1); let unknown = !identifier && value === mask - 1;
    for (let at = 1; at < length; at++) { value = value * 256 + bytes[offset + at]!; unknown &&= bytes[offset + at] === 0xff; }
    if (!unknown && !Number.isSafeInteger(value)) invalid();
    return { value, length, unknown };
  };
  const element = (offset: number, end: number): Element => {
    if (++elements > MAX_ELEMENTS) invalid();
    const id = vint(offset, end, true); const size = vint(offset + id.length, end); const start = offset + id.length + size.length;
    const finish = size.unknown ? end : start + size.value;
    if (finish > end || finish < start || (size.unknown && id.value !== IDS.segment && id.value !== IDS.cluster)) invalid();
    return { id: id.value, start, end: finish, unknown: size.unknown };
  };
  const unsigned = (item: Element): number => {
    if (item.end === item.start || item.end - item.start > 8 || item.unknown) invalid();
    let value = 0; for (let at = item.start; at < item.end; at++) value = value * 256 + bytes[at]!;
    if (!Number.isSafeInteger(value)) invalid(); return value;
  };
  const floating = (item: Element) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset + item.start, item.end - item.start);
    const value = view.byteLength === 4 ? view.getFloat32(0) : view.byteLength === 8 ? view.getFloat64(0) : NaN;
    if (!Number.isFinite(value)) invalid(); return value;
  };
  const children = (parent: Element, callback: (item: Element) => void) => {
    for (let at = parent.start; at < parent.end;) { const child = element(at, parent.end); if (child.unknown) invalid(); callback(child); at = child.end; }
  };
  const ascii = (item: Element) => {
    if (item.end - item.start > 128) invalid(); let value = ''; for (let at = item.start; at < item.end; at++) value += String.fromCharCode(bytes[at]!); return value;
  };
  let scale = 1_000_000; let segment: Element | undefined; let sawHeader = false;
  for (let at = 0; at < bytes.length;) {
    const item = element(at, bytes.length);
    if (item.id === 0x1a45dfa3) { if (sawHeader || segment) invalid(); sawHeader = true;
      let webm = false; children(item, (child) => { if (child.id === 0x4282) webm = ascii(child) === 'webm'; }); if (!webm) invalid();
    } else if (item.id === IDS.segment) { if (!sawHeader || segment) invalid(); segment = item; }
    else if (item.id !== 0xec && item.id !== 0xbf) invalid();
    at = item.end;
  }
  if (!segment) invalid();
  const tracks = new Map<number, Track>(); const clusters: Element[] = []; let sawInfo = false; let sawTracks = false;
  const findClusterEnd = (cluster: Element): number => {
    for (let at = cluster.start; at < cluster.end;) {
      const child = element(at, cluster.end);
      if (SEGMENT_CHILDREN.has(child.id)) { if (!cluster.unknown) invalid(); return at; }
      if (child.unknown) invalid(); at = child.end;
    }
    return cluster.end;
  };
  // Read Info and Tracks before interpreting blocks, regardless of element order.
  for (let at = segment.start; at < segment.end;) {
    const item = element(at, segment.end);
    if (item.id === IDS.cluster) { const end = findClusterEnd(item); clusters.push({ ...item, end, unknown: false }); at = end; continue; }
    if (item.unknown) invalid();
    if (item.id === IDS.info) { if (sawInfo) invalid(); sawInfo = true; children(item, (child) => { if (child.id === 0x2ad7b1) { scale = unsigned(child); if (scale < 1 || scale > 1_000_000_000) invalid(); } }); }
    if (item.id === IDS.tracks) { if (sawTracks) invalid(); sawTracks = true; children(item, (child) => {
      if (child.id !== IDS.track) return;
      const track: Track = { number: 0, type: 0, codec: '', scale: 1 }; let opusHeader = false;
      children(child, (field) => {
        if (field.id === 0xd7) track.number = unsigned(field);
        else if (field.id === 0x83) track.type = unsigned(field);
        else if (field.id === 0x86) track.codec = ascii(field);
        else if (field.id === 0x23314f) track.scale = floating(field);
        else if (field.id === 0x6d80) invalid(); // Encrypted/compressed blocks cannot be interpreted as Opus packets.
        else if (field.id === 0x63a2) { opusHeader = field.end - field.start >= 19 && String.fromCharCode(...bytes.subarray(field.start, field.start + 8)) === 'OpusHead' && bytes[field.start + 8] === 1 && bytes[field.start + 9]! >= 1 && bytes[field.start + 9]! <= 8; }
      });
      if (!track.number || tracks.has(track.number) || track.type !== 2 || track.codec !== 'A_OPUS' || track.scale !== 1 || !opusHeader) invalid();
      tracks.set(track.number, track);
    }); }
    at = item.end;
  }
  if (!tracks.size || !clusters.length) invalid();
  const packetSeconds = (start: number, end: number): number => {
    if (start >= end) invalid(); const toc = bytes[start]!; const code = toc & 3;
    const frameMs = toc & 0x80 ? 2.5 * (1 << ((toc >> 3) & 3)) : (toc & 0x60) === 0x60 ? (toc & 8 ? 20 : 10) : [10, 20, 40, 60][(toc >> 3) & 3]!;
    const count = code === 0 ? 1 : code === 3 ? (bytes[start + 1] ?? 0) & 0x3f : 2;
    if (!count || frameMs * count > 120) invalid();
    let at = start + 1; let payloadEnd = end;
    const frameSize = () => { if (at >= payloadEnd) invalid(); const first = bytes[at++]!; if (first < 252) return first; if (at >= payloadEnd) invalid(); return first + 4 * bytes[at++]!; };
    if (code === 0) { if (payloadEnd - at > 1275) invalid(); }
    else if (code === 1) { if ((payloadEnd - at) % 2 || (payloadEnd - at) / 2 > 1275) invalid(); }
    else if (code === 2) { const first = frameSize(); const second = payloadEnd - at - first; if (first > 1275 || second < 0 || second > 1275) invalid(); }
    else {
      if (at >= end) invalid(); const control = bytes[at++]!;
      if (control & 0x40) { let padding = 0; let value: number; do { if (at >= end) invalid(); value = bytes[at++]!; padding += value === 255 ? 254 : value; } while (value === 255); payloadEnd -= padding; if (payloadEnd < at) invalid(); }
      if (control & 0x80) { let consumed = 0; for (let index = 0; index < count - 1; index++) { const size = frameSize(); if (size > 1275) invalid(); consumed += size; } const last = payloadEnd - at - consumed; if (last < 0 || last > 1275) invalid(); }
      else if ((payloadEnd - at) % count || (payloadEnd - at) / count > 1275) invalid();
    }
    return frameMs * count / 1000;
  };
  const block = (item: Element): PacketBlock => {
    const track = vint(item.start, item.end); if (track.unknown || !tracks.has(track.value) || item.start + track.length + 3 >= item.end) invalid();
    let at = item.start + track.length; const time = bytes[at]! * 256 + bytes[at + 1]!; const timestamp = time >= 0x8000 ? time - 0x10000 : time; at += 2;
    const lace = (bytes[at++]! & 6) >> 1; const sizes: number[] = [];
    if (lace) {
      const count = bytes[at++]! + 1; if (!Number.isInteger(count) || count < 2 || at > item.end) invalid();
      if (lace === 1) { for (let index = 0; index < count - 1; index++) { let size = 0; let value: number; do { if (at >= item.end) invalid(); value = bytes[at++]!; size += value; } while (value === 255); sizes.push(size); } }
      else if (lace === 2) { const size = (item.end - at) / count; if (!Number.isInteger(size)) invalid(); for (let index = 0; index < count - 1; index++) sizes.push(size); }
      else { const first = vint(at, item.end); if (first.unknown) invalid(); at += first.length; sizes.push(first.value);
        for (let index = 1; index < count - 1; index++) { const diff = vint(at, item.end); if (diff.unknown) invalid(); at += diff.length; const size = sizes[index - 1]! + diff.value - (2 ** (7 * diff.length - 1) - 1); if (!Number.isSafeInteger(size) || size < 0) invalid(); sizes.push(size); }
      }
      const remaining = item.end - at - sizes.reduce((sum, size) => sum + size, 0); if (remaining < 0) invalid(); sizes.push(remaining);
    } else sizes.push(item.end - at);
    let seconds = 0; for (const size of sizes) { if (size <= 0 || at + size > item.end) invalid(); seconds += packetSeconds(at, at + size); at += size; }
    if (at !== item.end) invalid(); return { track: track.value, timestamp, seconds };
  };
  let maximumEndNanoseconds = 0; const encodedNanoseconds = new Map<number, number>(); let packets = 0;
  for (const cluster of clusters) {
    // Timestamp need not be the first child. Find it in a bounded pass, then process
    // each block immediately instead of retaining an array proportional to the audio.
    let timestamp: number | undefined;
    children(cluster, (item) => { if (item.id === IDS.timestamp) { if (timestamp !== undefined) invalid(); timestamp = unsigned(item); } });
    if (timestamp === undefined) invalid();
    const clusterTimestamp = timestamp;
    const consume = (entry: PacketBlock) => {
      const start = (clusterTimestamp + entry.timestamp) * scale; const encoded = Math.round(entry.seconds * 1_000_000_000);
      const duration = Math.max(encoded, (entry.durationTicks ?? 0) * scale);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(duration) || start < -120_000_000) invalid();
      maximumEndNanoseconds = Math.max(maximumEndNanoseconds, start + duration); encodedNanoseconds.set(entry.track, (encodedNanoseconds.get(entry.track) ?? 0) + encoded); packets++;
    };
    children(cluster, (item) => {
      if (item.id === IDS.simpleBlock) consume(block(item));
      else if (item.id === IDS.blockGroup) { let entry: PacketBlock | undefined; let durationTicks: number | undefined;
        children(item, (field) => { if (field.id === IDS.block) { if (entry) invalid(); entry = block(field); } else if (field.id === IDS.blockDuration) { if (durationTicks !== undefined) invalid(); durationTicks = unsigned(field); } });
        if (!entry) invalid(); consume({ ...entry, durationTicks });
      }
    });
  }
  if (!packets) invalid();
  // Encoded duration also prevents overlapping/reset timestamps from concealing long audio.
  return Math.max(maximumEndNanoseconds, ...encodedNanoseconds.values()) / 1_000_000_000;
}
