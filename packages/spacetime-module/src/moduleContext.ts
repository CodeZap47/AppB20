import type { Ctx, ViewDb } from './index';
export type { Ctx, ViewDb } from './index';
type Row<T extends keyof Ctx['db'], K extends keyof Ctx['db'][T]> = Ctx['db'][T][K] extends { find(...args: never[]): infer R } ? NonNullable<R> : never;
type ReadableMessage = { scope: 'group'; row: Row<'groupMessage', 'id'> } | { scope: 'direct'; row: Row<'directMessage', 'id'> } | { scope: 'channel'; row: Row<'channelMessage', 'id'> };
interface ModuleHelpers {
  activeMember(ctx: Ctx): Row<'member', 'identity'>;
  attachmentIds(ctx: Ctx, kind: string, id: bigint): string[];
  expectVersion(actual: number, expected: number): void;
  isActive(db: ViewDb, sender: Ctx['sender']): boolean;
  log(ctx: Ctx, action: string, entity: string, id: string | bigint): void;
  messageText(ctx: Ctx, text: string): string;
  readableMessage(ctx: Ctx, scope: string, id: bigint): ReadableMessage;
  requireGuide(ctx: Ctx, id: bigint): Row<'studyGuide', 'id'>;
  requireSubject(ctx: Ctx, id: bigint): void;
  requireText(value: string, field: string, max?: number): string;
  restoreAttachments(ctx: Ctx, kind: string, id: bigint, ids: string[]): void;
  sourceVersion(ctx: Ctx, kind: string, id: bigint, subjectId: bigint): number;
  targetVersion(ctx: Ctx, kind: string, id: bigint): number;
  saveTargetBaseline(ctx: Ctx, kind: string, id: bigint): void;
  bumpMaterial(ctx: Ctx, kind: string, id: bigint, actor?: Ctx['sender'], restoredFrom?: number): void;
}
let helpers: ModuleHelpers;
export function configureModuleHelpers(value: ModuleHelpers) { helpers = value; }
export const activeMember: ModuleHelpers['activeMember'] = (...args) => helpers.activeMember(...args);
export const attachmentIds: ModuleHelpers['attachmentIds'] = (...args) => helpers.attachmentIds(...args);
export const expectVersion: ModuleHelpers['expectVersion'] = (...args) => helpers.expectVersion(...args);
export const isActive: ModuleHelpers['isActive'] = (...args) => helpers.isActive(...args);
export const log: ModuleHelpers['log'] = (...args) => helpers.log(...args);
export const messageText: ModuleHelpers['messageText'] = (...args) => helpers.messageText(...args);
export const readableMessage: ModuleHelpers['readableMessage'] = (...args) => helpers.readableMessage(...args);
export const requireGuide: ModuleHelpers['requireGuide'] = (...args) => helpers.requireGuide(...args);
export const requireSubject: ModuleHelpers['requireSubject'] = (...args) => helpers.requireSubject(...args);
export const requireText: ModuleHelpers['requireText'] = (...args) => helpers.requireText(...args);
export const restoreAttachments: ModuleHelpers['restoreAttachments'] = (...args) => helpers.restoreAttachments(...args);
export const sourceVersion: ModuleHelpers['sourceVersion'] = (...args) => helpers.sourceVersion(...args);
export const targetVersion: ModuleHelpers['targetVersion'] = (...args) => helpers.targetVersion(...args);
export const saveTargetBaseline: ModuleHelpers['saveTargetBaseline'] = (...args) => helpers.saveTargetBaseline(...args);
export const bumpMaterial: ModuleHelpers['bumpMaterial'] = (...args) => helpers.bumpMaterial(...args);
