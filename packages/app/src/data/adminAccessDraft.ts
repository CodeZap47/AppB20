import { config } from '../config';
import type { AdminContentEntry, InvitationLink } from './membershipTypes';

/** Solo decisiones e identificadores; no conserva correos, títulos, archivos ni secretos. */
export interface AdminAccessDraft {
  actor: string; operationId: string; contentOperationId: string; expiresAt: number; mode: string;
  link?: InvitationLink; revoked: boolean; action: 'remove' | 'block'; reason: string; policy: string;
  people: { identity: string; generation: number }[];
  subjects?: string[];
  content: Pick<AdminContentEntry, 'kind' | 'targetId' | 'version' | 'collaborative' | 'foreignDependencies' | 'sharedFiles' | 'reportReferences' | 'safeForBulk'>[];
  acknowledge: string[]; accessOperations: Record<string, string>;
}
const key = (actor: string) => `b20.admin.access-draft.${config.dataMode}.${config.spacetimeDb}.${actor}`;
export function readAdminAccessDraft(actor: string): AdminAccessDraft | undefined {
  try {
    const value = sessionStorage.getItem(key(actor)); if (!value) return undefined;
    const data = JSON.parse(value) as AdminAccessDraft;
    if (data.actor !== actor || data.expiresAt <= Date.now() || !Array.isArray(data.people) || !Array.isArray(data.content) || typeof data.operationId !== 'string') { sessionStorage.removeItem(key(actor)); return undefined; }
    return data;
  } catch { return undefined; }
}
export function writeAdminAccessDraft(draft: AdminAccessDraft): void { try { sessionStorage.setItem(key(draft.actor), JSON.stringify(draft)); } catch {} }
export function clearAdminAccessDraft(actor: string): void { try { sessionStorage.removeItem(key(actor)); } catch {} }
