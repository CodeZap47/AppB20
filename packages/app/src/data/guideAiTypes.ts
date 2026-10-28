import type { AiKeyStatus, AiStatus, GuideAiDraft, GuideAiDraftSummary, GuideAiPrepareInput,
  GuideAiProvenance, GuideAiPublishInput, GuideAiResult, GuideAiSourceKind, GuideAiTranscription,
  GuideAiTranscriptionInput } from '@b20/core';

export interface GuideAiFileMetadata {
  fileId: string; fileHash: string; targetKind: GuideAiSourceKind; targetId: string; targetVersion: number;
  name: string; size: number; contentType: string;
}
export interface GuideAiStepInput {
  expectedRevision: number; fingerprint: string; generationId: string; confirmed: true; acknowledgeUnknown?: true;
}
/** Private details are read on demand and never included in a group subscription. */
export interface GuideAiActions {
  createGuideFromMaterials(input: { subjectId: string; termId?: string; guideType: 'partial' | 'quarter'; period: string; title: string; topics: string[]; sources: import('@b20/core').GuideAiSourceRef[]; sections: string[]; requestId: string }): Promise<{ id: string; version: number }>;
  getGuideAiStatus(): Promise<{ status: AiStatus; key: AiKeyStatus }>;
  prepareGuideAiDraft(input: { id: string; input: GuideAiPrepareInput }): Promise<GuideAiDraft>;
  refreshGuideAiDraft(input: { id: string; expectedRevision: number; requestId: string; input: GuideAiPrepareInput }): Promise<GuideAiDraft>;
  listGuideAiDrafts(): Promise<GuideAiDraftSummary[]>;
  getGuideAiDraft(id: string): Promise<GuideAiDraft>;
  getGuideAiFile(fileId: string): Promise<GuideAiFileMetadata>;
  saveGuideAiTranscription(input: GuideAiTranscriptionInput): Promise<GuideAiTranscription>;
  runGuideAiStep(id: string, input: GuideAiStepInput): Promise<GuideAiDraft>;
  reviewGuideAiTopics(id: string, input: { expectedRevision: number; answers: { questionId: string; answer: string }[]; acknowledgeGaps: boolean }): Promise<GuideAiDraft>;
  updateGuideAiDraft(id: string, input: { expectedRevision: number; result: GuideAiResult }): Promise<GuideAiDraft>;
  cancelGuideAiDraft(id: string, expectedRevision: number): Promise<GuideAiDraft>;
  publishGuideAiDraft(input: GuideAiPublishInput): Promise<GuideAiDraft>;
  getGuideAiProvenance(guideId: string, version: number): Promise<GuideAiProvenance | null>;
}
