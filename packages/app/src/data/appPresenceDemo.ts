import type { Id, Member } from './types';
import { AppPresenceController, browserAppPresenceEnvironment, type AppPresenceEnvironment } from './appPresenceStore';

interface Context { state: object; member(): Member | undefined; members(): Member[]; now(): Date; emit(): void }
interface Row { memberId: Id; active: boolean; revision: bigint; expiresAt: number }
interface Shared { rows: Map<object, Row>; stores: Set<DemoAppPresenceStore>; expiry?: ReturnType<typeof setTimeout>; now(): number }
const sharedByState = new WeakMap<object, Shared>();
const TTL_MS = 15000;

/** Independent synthetic sessions use the same leases and one-person projection as the server. */
export class DemoAppPresenceStore {
  private shared: Shared;
  private controller: AppPresenceController;
  private key = {};
  private disposed = false;
  private foregroundOverride?: boolean;
  constructor(private ctx: Context, environment: AppPresenceEnvironment = browserAppPresenceEnvironment()) {
    this.shared = sharedByState.get(ctx.state) ?? { rows: new Map(), stores: new Set(), now: () => ctx.now().getTime() };
    sharedByState.set(ctx.state, this.shared); this.shared.stores.add(this);
    this.controller = new AppPresenceController({ isForeground: () => this.foregroundOverride ?? environment.isForeground(), subscribe: listener => environment.subscribe(listener) });
  }
  connect() { this.controller.connect(input => this.publish(input), this.activeMember()); }
  private activeMember() { const member = this.ctx.member(); return member?.status === 'active' ? member.id : undefined; }
  refreshMember() { if (!this.disposed) this.controller.setMember(this.activeMember()); }
  /** Design fixtures can represent another device without changing the real window focus. */
  setForeground(active: boolean) { this.foregroundOverride = active; this.controller.refresh(); }
  onlineMemberIds(): Id[] {
    if (this.disposed || !this.activeMember()) return [];
    const members = new Set(this.ctx.members().filter(row => row.status === 'active').map(row => row.id));
    return [...new Set([...this.shared.rows.values()].filter(row => row.active && row.expiresAt > this.shared.now() && members.has(row.memberId)).map(row => row.memberId))].sort();
  }
  private publish(input: { active: boolean; revision: bigint }) {
    if (this.disposed) return;
    const previous = this.shared.rows.get(this.key);
    if (previous && previous.revision >= input.revision) return;
    const memberId = this.activeMember() ?? previous?.memberId;
    if (!memberId || input.active && !this.activeMember()) return;
    const before = this.onlineMemberIds().join(',');
    this.shared.rows.set(this.key, { memberId, ...input, expiresAt: this.shared.now() + TTL_MS });
    this.schedule();
    if (before !== this.onlineMemberIds().join(',')) this.ctx.emit();
  }
  private schedule() {
    clearTimeout(this.shared.expiry);
    const next = Math.min(Infinity, ...[...this.shared.rows.values()].map(row => row.expiresAt));
    if (next === Infinity || !this.shared.stores.size) return;
    this.shared.expiry = setTimeout(() => {
      const now = this.shared.now(); let changed = false;
      for (const [key, row] of this.shared.rows) if (row.expiresAt <= now) { this.shared.rows.delete(key); changed ||= row.active; }
      const alive = this.shared.stores.values().next().value;
      alive?.schedule(); if (changed) alive?.ctx.emit();
    }, Math.max(1, next - this.shared.now()));
  }
  dispose() {
    if (this.disposed) return;
    this.controller.disconnect();
    this.disposed = true;
    const changed = this.shared.rows.delete(this.key);
    this.shared.stores.delete(this); this.schedule();
    if (changed) this.shared.stores.values().next().value?.ctx.emit();
  }
}
