import type { VisualFrame, VisualModelAsset, VisualNodeRef, VisualVec3 } from '@b20/core';

export type VisualSceneTool = 'orbit' | 'translate' | 'rotate' | 'scale';
export interface VisualSceneCanvasHandle {
  fit(): void;
  centerSelection(): void;
  resetCamera(): void;
}
export interface VisualSceneRuntimeStatus {
  loading: boolean;
  error?: string;
  /** A per-model preview is read only and never changes the saved frame. */
  individualPreview?: boolean;
}
export interface VisualSceneCanvasProps {
  frame: VisualFrame;
  assets: readonly VisualModelAsset[];
  loadAsset(asset: VisualModelAsset, options?: { signal?: AbortSignal }): Promise<Blob>;
  editable: boolean;
  selected?: VisualNodeRef;
  /** Used for a whole model; a selected component takes precedence. */
  selectedInstanceId?: string;
  mode?: VisualSceneTool;
  onSelect?(node: VisualNodeRef | undefined): void;
  onPick?(node: VisualNodeRef, anchor: VisualVec3): void;
  onFrameChange?(frame: VisualFrame): void;
  onStatus?(status: VisualSceneRuntimeStatus): void;
  className?: string;
}
