import { describe, expect, it } from 'vitest';
import { parseBuffer } from 'music-metadata';
import { webmOpusDuration } from './webmAudioDuration.ts';
import { mediaRecorderWebm } from './webmAudioFixture.ts';
describe('duración de grabaciones WebM/Opus sin Duration', () => {
  it('lee clusters desconocidos de MediaRecorder donde music-metadata no obtiene duración', async () => {
    const bytes = mediaRecorderWebm(); const parsed = await parseBuffer(bytes, undefined, { duration: true, skipCovers: true });
    expect(parsed.format.container).toBe('EBML/webm'); expect(parsed.format.codec).toBe('OPUS'); expect(parsed.format.duration).toBeUndefined();
    expect(webmOpusDuration(bytes)).toBe(1);
  });
  it('no confía en Duration: conserva un final real de 1201 segundos', async () => {
    const bytes = mediaRecorderWebm(1_200_980, { declaredDuration: 1000 });
    expect((await parseBuffer(bytes, undefined, { duration: true })).format.duration).toBe(1);
    expect(webmOpusDuration(bytes)).toBe(1201); expect(webmOpusDuration(mediaRecorderWebm(1_199_980))).toBe(1200);
  });
  it.each(['xiph', 'fixed', 'ebml'] as const)('interpreta lacing %s para contar ambos paquetes Opus', (lacing) => {
    expect(webmOpusDuration(mediaRecorderWebm(960, { lacing }))).toBe(1);
  });
  it('cuenta paquetes superpuestos sin permitir ocultar audio largo reiniciando timestamps', () => {
    expect(webmOpusDuration(mediaRecorderWebm(0, { firstClusterPackets: 60_000 }))).toBeCloseTo(1200.02);
  });
  it('rechaza contenedores que además declaran una pista de video', () => {
    expect(() => webmOpusDuration(mediaRecorderWebm(980, { videoTrack: true }))).toThrow();
  });
  it('incluye BlockGroup y BlockDuration y rechaza estructuras truncadas', () => {
    expect(webmOpusDuration(mediaRecorderWebm(980, { blockGroup: true }))).toBe(1);
    const bytes = mediaRecorderWebm(); expect(() => webmOpusDuration(bytes.subarray(0, bytes.length - 1))).toThrow();
    const broken = Uint8Array.from(bytes); broken[0] = 0; expect(() => webmOpusDuration(broken)).toThrow();
  });
});
