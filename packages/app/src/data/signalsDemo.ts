import { applySignalCommand, emptySignalsState, projectSignals, purgeSignals, SIGNAL_LIMITS, type SignalCommand, type SignalContext, type SignalState } from '@b20/core';
import type { Snapshot } from './types';

const stores = new WeakMap<object, SignalState>();
interface Context {
  state(): object;
  snapshot(): Snapshot;
  now(): Date;
  emit(): void;
}

/** The same transactional engine as the server, shared only by sessions of this demo. */
export class DemoSignalsStore {
  constructor(private ctx: Context) {}
  private state() {
    const key = this.ctx.state();
    const state = stores.get(key) ?? emptySignalsState();
    stores.set(key, state);
    return state;
  }
  private context(snapshot: Snapshot): SignalContext {
    const me = snapshot.me;
    return {
      actor: me?.id ?? '', now: this.ctx.now().getTime(),
      activeMembers: snapshot.members.filter((member) => member.status === 'active').map((member) => member.id),
      subjects: snapshot.subjects.map((subject) => subject.id), isAdmin: Boolean(me?.isCreator),
      source: (kind, id) => {
        if (me?.status !== 'active') return undefined;
        if (kind === 'note') {
          const note = snapshot.notes.find((item) => item.id === id && !item.withdrawnAt && (item.visibility === 'group' || item.authorId === me.id));
          return note ? { subjectId: note.subjectId, version: note.version } : undefined;
        }
        const work = snapshot.works.find((item) => item.id === id && !item.withdrawnAt);
        const assignment = work && snapshot.assignments.find((item) => item.id === work.assignmentId);
        return work && assignment ? { subjectId: assignment.subjectId, version: work.version } : undefined;
      },
    };
  }
  snapshot(base: Snapshot) {
    return projectSignals(this.state(), this.context(base));
  }
  purgeDue(): boolean {
    const state = this.state();
    const at = this.ctx.now().getTime();
    const due = [...state.messages, ...state.attempts, ...state.cards].some((row) => row.deletedAt !== undefined && row.deletedAt + SIGNAL_LIMITS.retentionMs <= at)
      || state.sessions.some((row) => row.status === 'pending' && row.expiresAt <= at || Object.values(row.removedBy).some((removed) => removed + SIGNAL_LIMITS.retentionMs <= at));
    if (!due) return false;
    const next = purgeSignals(state, at);
    if (JSON.stringify(next) === JSON.stringify(state)) return false;
    stores.set(this.ctx.state(), next);
    return true;
  }
  action(command: SignalCommand) {
    const result = applySignalCommand(this.state(), command, this.context(this.ctx.snapshot()));
    stores.set(this.ctx.state(), result.state);
    this.ctx.emit();
    return result.id;
  }
}
