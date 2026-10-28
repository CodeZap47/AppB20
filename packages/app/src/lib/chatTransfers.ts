import type { UploadFileItem } from '../components/uploads/UploadFileList';

export interface ChatUpload { id: string; files: File[]; next: number; version: number }
interface TransferSnapshot { items: UploadFileItem[]; retrying: boolean; busy: boolean }
/** One in-memory transfer per account/conversation, including after its panel unmounts. */
export class ChatTransfer {
  active = true;
  upload: { current: ChatUpload | null } = { current: null };
  controller: { current: AbortController | null } = { current: null };
  sending = { current: false };
  private snapshot: TransferSnapshot = { items: [], retrying: false, busy: false };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private change(value: Partial<TransferSnapshot>) { if (!this.active) return; this.snapshot = { ...this.snapshot, ...value }; this.listeners.forEach(listener => listener()); }
  setItems = (value: UploadFileItem[] | ((current: UploadFileItem[]) => UploadFileItem[])) => this.change({ items: typeof value === 'function' ? value(this.snapshot.items) : value });
  setRetrying = (retrying: boolean) => this.change({ retrying });
  setBusy = (busy: boolean) => this.change({ busy });
  dispose() {
    this.active = false; this.controller.current?.abort(); this.upload.current = null;
    this.snapshot = { items: [], retrying: false, busy: false };
    this.listeners.forEach(listener => listener()); this.listeners.clear();
  }
}
const transfers = new Map<string, ChatTransfer>();
export function getChatTransfer(key: string) { let transfer = transfers.get(key); if (!transfer) { transfer = new ChatTransfer(); transfers.set(key, transfer); } return transfer; }
export function clearChatTransfers() { const previous = [...transfers.values()]; transfers.clear(); previous.forEach(transfer => transfer.dispose()); }
