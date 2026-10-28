import type { GuideExamMaterial, GuideExamMaterialDetail, GuideMaterialSelection, GuideMaterialSelectionInput, GuideMaterialSelectionSummary } from '@b20/core';
export type { GuideExamMaterial, GuideExamMaterialDetail, GuideMaterialSelection, GuideMaterialSelectionInput, GuideMaterialSelectionSummary } from '@b20/core';
export interface GuideMaterialsActions {
  listGuideExamMaterials(subjectId: string): Promise<GuideExamMaterial[]>;
  getGuideExamMaterial(examId: string, version: number, includeSolutions?: boolean): Promise<GuideExamMaterialDetail>;
  getGuideMaterialSelection(id: string): Promise<GuideMaterialSelection | null>;
  saveGuideMaterialSelection(input: GuideMaterialSelectionInput): Promise<GuideMaterialSelection>;
  listGuideMaterialSelections(): Promise<GuideMaterialSelectionSummary[]>;
}
