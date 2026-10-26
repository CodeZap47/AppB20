import { AiClient } from './aiClient';
import type { DocumentActions } from './documentTypes';

export function createDocumentActions(client: AiClient): DocumentActions {
  const path = (id: string) => `/ai/documents/ocr/${encodeURIComponent(id)}`;
  return {
    getDocumentFile: (id) => client.request(`/ai/documents/files/${encodeURIComponent(id)}`),
    saveDocumentTranscription: (input) => client.request('/ai/documents/transcriptions', 'POST', input),
    getDocumentTranscription: (id) => client.request(`/ai/documents/transcriptions/${encodeURIComponent(id)}`),
    listDocumentTranscriptions: (fileId) => client.request(`/ai/documents/transcriptions${fileId ? `?fileId=${encodeURIComponent(fileId)}` : ''}`),
    prepareDocumentOcr: (input) => client.request('/ai/documents/ocr/prepare', 'POST', input),
    getDocumentOcr: (id) => client.request(path(id)),
    runDocumentOcr: (id, input) => client.request(`${path(id)}/run`, 'POST', input),
    cancelDocumentOcr: (id, expectedRevision) => client.request(`${path(id)}/cancel`, 'POST', { expectedRevision }),
  };
}
