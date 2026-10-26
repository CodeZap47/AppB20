import type { Id, MaybePromise } from './types';
import type { WithdrawableKind } from './delivery2Types';

export interface InvitationLink {
  id: string; name: string; status: 'active' | 'disabled' | 'expired' | 'exhausted' | string;
  createdAt: number; expiresAt: number | null; maxUses: number | null; uses: number; version: number;
}
/** El sistema anterior solo conservaba la huella; su secreto no puede recuperarse. */
export interface LegacyInvitationLink {
  id: string; name: string; status: 'active' | 'inactive' | 'expired' | 'exhausted';
  createdAt: number; expiresAt: number; maxUses: number; usedCount: number; revokedAt: number | null;
}
export interface AdminMember {
  identity: Id; displayName: string; status: string; isCreator: boolean; email: string | null; emails: string[];
  generation: number; origin: string; invitationLinkId: string | null; joinedAt: number; removedAt: number | null;
}
export interface MembershipEvent { id: string; memberIdentity: string | null; email: string | null; action: string; reason: string; at: number }
export interface AdminMembershipSnapshot {
  links: InvitationLink[]; members: AdminMember[];
  legacyLinks?: LegacyInvitationLink[];
  blockedEmails: { email: string; reason: string; blockedAt: number }[];
  admissions: { id: string; memberIdentity: string; generation: number; origin: string; sourceId: string; joinedAt: number }[];
  events: MembershipEvent[];
}
export interface InvitationLinkInput { requestId: string; name: string; expiresAt?: number | null; maxUses?: number | null }
export interface InvitationLinkResult { id: string; url: string }
export interface AdminAccessInput {
  operationId: string; identity: Id; generation: number; action: 'remove' | 'block'; reason: string;
  bulk: boolean; invitationLinkId?: string;
}
export interface AdminAccessResult { operationId: string; status: 'applied' | 'skipped'; message: string; identity: Id; generation: number }
export interface AdminContentEntry {
  kind: WithdrawableKind; targetId: Id; ownerIds: Id[]; title: string; version: number; withdrawn: boolean;
  collaborative: boolean; foreignDependencies: number; sharedFiles: number; reportReferences: number; safeForBulk: boolean;
}
export interface AdminContentResult { operationId: string; kind: string; targetId: Id; status: string; error?: string; message?: string }
export interface ModerateContentInput {
  operationId: string; kind: WithdrawableKind; targetId: Id; expectedVersion: number; withdrawn: boolean;
  reason: string; acknowledgeImpact: boolean; expectedImpact?: string;
}
export const contentImpactSignature = (entry: Pick<AdminContentEntry, 'collaborative' | 'foreignDependencies' | 'sharedFiles' | 'reportReferences'>) =>
  `${Number(entry.collaborative)}:${entry.foreignDependencies}:${entry.sharedFiles}:${entry.reportReferences}`;
export interface MembershipActions {
  getAdminMembership(): Promise<AdminMembershipSnapshot>;
  createInvitationLink(input: InvitationLinkInput): Promise<InvitationLinkResult>;
  copyInvitationLink(id: string): Promise<string>;
  replaceInvitationLink(id: string, input: InvitationLinkInput): Promise<InvitationLinkResult>;
  configureInvitationLink(input: { id: string; name: string; expiresAt: number | null; maxUses: number | null; expectedVersion: number }): MaybePromise<void>;
  revokeInvitationLink(id: string, expectedVersion?: number): MaybePromise<void>;
  revokeLegacyInvitationLink(id: string): MaybePromise<void>;
  joinWithInvitationLink(token: string, displayName: string): MaybePromise<void>;
  manageMemberAccess(input: AdminAccessInput): Promise<AdminAccessResult>;
  blockEmail(email: string, reason: string, operationId: string): MaybePromise<void>;
  unblockEmail(email: string, operationId: string): MaybePromise<void>;
  moderateContentItem(input: ModerateContentInput): MaybePromise<void>;
  getMyMembershipAccess(): Promise<{ blocked: boolean; canRejoin: boolean }>;
}
export const CONTENT_KIND_LABELS: Record<WithdrawableKind, string> = {
  note: 'Nota', guide: 'Guía', question: 'Pregunta', answer: 'Respuesta', work: 'Trabajo', evidence: 'Evidencia',
  feed_post: 'Publicación del feed', feed_comment: 'Comentario del feed', group_message: 'Mensaje general', channel_message: 'Mensaje de canal',
};
