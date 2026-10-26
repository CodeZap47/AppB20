import { PRESENTATION_AUDIO_LIMITS, validatePresentationAudioSize, presentationAudioMime, type PresentationAiDraft, type PresentationAiDraftSummary, type PresentationAiPurpose, type PresentationAiResult, type PresentationAudio } from '@b20/core';
import { AiClient } from './aiClient';
export interface PresentationFeatureActions {
  listDrafts(attemptId: string): Promise<PresentationAiDraftSummary[]>;
  prepare(input: { id: string; attemptId: string; expectedVersion: number; purpose: PresentationAiPurpose }): Promise<PresentationAiDraft>;
  get(id: string): Promise<PresentationAiDraft>;
  generate(draft: PresentationAiDraft, generationId: string, acknowledgeUnknown: boolean): Promise<PresentationAiDraft>;
  accept(draft: PresentationAiDraft, result: PresentationAiResult): Promise<PresentationAiDraft>;
  cancel(draft: PresentationAiDraft): Promise<PresentationAiDraft>;
  listAudio(attemptId: string): Promise<PresentationAudio[]>;
  upload(attemptId: string, expectedVersion: number, file: File, requestId: string, onProgress?: (percent: number) => void): Promise<PresentationAudio>;
  audioBlob(audio: PresentationAudio): Promise<Blob>;
  shareAudio(audio: PresentationAudio, shared: boolean): Promise<PresentationAudio>;
  deleteAudio(audio: PresentationAudio): Promise<PresentationAudio>;
  cancelAudio(audio: PresentationAudio): Promise<PresentationAudio>;
}
export async function presentationByteHash(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>); return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function fileMime(file: File) {
  const byName: Record<string, string> = { m4a: 'audio/mp4', mp4: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm' };
  return presentationAudioMime(file.type || byName[file.name.split('.').pop()?.toLowerCase() ?? ''] || '');
}
/** Binary transfer shares the same cancellable authenticated client as the existing BYOK workflow. */
export function createPresentationFeatureActions(client: AiClient): PresentationFeatureActions {
  const base = '/ai/presentations'; const draft = (id: string) => `${base}/drafts/${encodeURIComponent(id)}`;
  const audio = (id: string) => `${base}/audio/${encodeURIComponent(id)}`;
  return {
    listDrafts: (id) => client.request(`${base}/attempts/${encodeURIComponent(id)}/drafts`),
    prepare: (input) => client.request(`${base}/prepare`, 'POST', input),
    get: (id) => client.request(draft(id)),
    generate: (value, generationId, acknowledgeUnknown) => client.request(`${draft(value.id)}/generate`, 'POST', { generationId, fingerprint: value.fingerprint, expectedRevision: value.revision, confirmed: true, acknowledgeUnknown }),
    accept: (value, result) => client.request(`${draft(value.id)}/accept`, 'POST', { expectedRevision: value.revision, result, reviewed: true }),
    cancel: (value) => client.request(`${draft(value.id)}/cancel`, 'POST', { expectedRevision: value.revision }),
    listAudio: (id) => client.request(`${base}/attempts/${encodeURIComponent(id)}/audio`),
    upload: async (attemptId, expectedVersion, file, id, onProgress) => {
      validatePresentationAudioSize(file.size); const bytes = new Uint8Array(await file.arrayBuffer()); const sha256 = await presentationByteHash(bytes);
      let value = await client.request<PresentationAudio>(`${base}/audio`, 'POST', { id, attemptId, expectedVersion, name: file.name, bytes: file.size, mime: fileMime(file), sha256 });
      if (value.state === 'ready') return value;
      if (value.state !== 'pending') throw new Error('La subida ya fue cancelada; elige el archivo de nuevo.');
      for (let index = 0; index < value.chunkCount; index++) {
        if (!value.received.includes(index)) {
          const chunk = bytes.subarray(index * PRESENTATION_AUDIO_LIMITS.chunkBytes, Math.min(bytes.length, (index + 1) * PRESENTATION_AUDIO_LIMITS.chunkBytes));
          value = await client.request<PresentationAudio>(`${audio(id)}/chunks/${index}`, 'PUT', { bytes: Array.from(chunk), sha256: await presentationByteHash(chunk) });
        }
        onProgress?.(Math.round((index + 1) / value.chunkCount * 100));
      }
      return client.request(`${audio(id)}/confirm`, 'POST', {});
    },
    audioBlob: async (value) => {
      validatePresentationAudioSize(value.bytes); const bytes = new Uint8Array(value.bytes); let offset = 0;
      for (let index = 0; index < value.chunkCount; index++) {
        const chunk = await client.request<{ bytes: number[]; sha256: string }>(`${audio(value.id)}/chunks/${index}`);
        const expected = Math.min(PRESENTATION_AUDIO_LIMITS.chunkBytes, bytes.length - offset);
        if (!Array.isArray(chunk.bytes) || chunk.bytes.length !== expected) throw new Error('El audio está incompleto.');
        const data = Uint8Array.from(chunk.bytes); if (await presentationByteHash(data) !== chunk.sha256) throw new Error('El audio está corrupto.');
        bytes.set(data, offset); offset += data.length;
      }
      if (await presentationByteHash(bytes) !== value.sha256) throw new Error('El audio está corrupto.');
      return new Blob([bytes], { type: value.mime });
    },
    shareAudio: (value, shared) => client.request(`${audio(value.id)}/share`, 'POST', { shared }),
    deleteAudio: (value) => client.request(`${audio(value.id)}/delete`, 'POST', {}),
    cancelAudio: (value) => client.request(`${audio(value.id)}/cancel`, 'POST', {}),
  };
}
