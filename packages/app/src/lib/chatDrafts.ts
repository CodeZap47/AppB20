import type { Reference } from './references';
import { clearChatTransfers } from './chatTransfers';

export interface ChatDraft { text: string; refs: Reference[]; files: File[]; }
const drafts = new Map<string, ChatDraft>();
const consumed = new Set<string>();
const sendingDrafts = new Map<string, ChatDraft>();
const listeners = new Map<string, Set<(draft: ChatDraft) => void>>();
export function getChatDraft(key: string): ChatDraft { return drafts.get(key) ?? { text: '', refs: [], files: [] }; }
export function saveChatDraft(key: string, draft: ChatDraft) {
  if (draft.text || draft.refs.length || draft.files.length) drafts.set(key, { text: draft.text, refs: [...draft.refs], files: [...draft.files] });
  else drafts.delete(key);
}
/** A late confirmation consumes only the original send, preserving newer additions. */
export function confirmChatDraft(key: string, sent: ChatDraft): ChatDraft {
  const current = getChatDraft(key);
  const next = {
    text: current.text === sent.text ? '' : current.text,
    refs: current.refs.filter(ref => !sent.refs.some(item => item.kind === ref.kind && item.id === ref.id)),
    files: current.files.filter(file => !sent.files.includes(file)),
  };
  saveChatDraft(key, next);
  sendingDrafts.delete(key);
  listeners.get(key)?.forEach(listener => listener(next));
  return next;
}
export function rememberChatSend(key: string, draft: ChatDraft, retry: boolean): ChatDraft {
  const original = retry ? sendingDrafts.get(key) : undefined;
  if (original) return original;
  const sent = { text: draft.text, refs: [...draft.refs], files: [...draft.files] };
  sendingDrafts.set(key, sent);
  return sent;
}
export function subscribeChatDraft(key: string, listener: (draft: ChatDraft) => void) {
  let group = listeners.get(key); if (!group) { group = new Set(); listeners.set(key, group); }
  group.add(listener);
  return () => { group.delete(listener); if (!group.size) listeners.delete(key); };
}
export function consumeChatShareIntent(memberId: string, id: string): boolean {
  const key = `${memberId}:${id}`;
  if (consumed.has(key)) return false;
  consumed.add(key);
  if (consumed.size > 512) consumed.delete(consumed.values().next().value!);
  return true;
}
/** Files and references remain in memory only, and leave with the authenticated session. */
export function clearChatDrafts() { drafts.clear(); consumed.clear(); sendingDrafts.clear(); clearChatTransfers(); }
