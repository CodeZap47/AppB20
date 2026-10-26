import type { DocumentFileMetadata, DocumentOcrDraft, DocumentOcrInput, DocumentTranscription, DocumentTranscriptionInput } from '@b20/core';

export interface DocumentActions {
  getDocumentFile(fileId: string): Promise<DocumentFileMetadata>;
  saveDocumentTranscription(input: DocumentTranscriptionInput): Promise<DocumentTranscription>;
  getDocumentTranscription(id: string): Promise<DocumentTranscription>;
  listDocumentTranscriptions(fileId?: string): Promise<{ id: string; fileId: string; createdAt: number; targetKind: string; targetId: string; characters: number }[]>;
  prepareDocumentOcr(input: { id: string; input: DocumentOcrInput }): Promise<DocumentOcrDraft>;
  getDocumentOcr(id: string): Promise<DocumentOcrDraft>;
  runDocumentOcr(id: string, input: { expectedRevision: number; generationId: string; fingerprint: string; confirmed: true; acknowledgeUnknown?: true }): Promise<DocumentOcrDraft>;
  cancelDocumentOcr(id: string, expectedRevision: number): Promise<DocumentOcrDraft>;
}
