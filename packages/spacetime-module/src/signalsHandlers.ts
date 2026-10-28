import { ScheduleAt } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { applySignalCommand, emptySignalsState, projectSignals, purgeSignals, SIGNAL_LIMITS,
  type SignalContext, type SignalState } from '../../core/src/signals';
import { memberIdentityFor } from './authIdentity';
import { canReadTarget, withdrawn } from './delivery2Handlers';
import { activeMember, isActive, type Ctx, type ViewDb } from './moduleContext';

const CLOCK = '_clock';
const collections = Object.keys(emptySignalsState()) as (keyof SignalState)[];
const now = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);

/** Stored records never enter the client cache; projection is the only readable surface. */
export function readSignalState(db: ViewDb): SignalState {
  const state = emptySignalsState();
  for (const row of db.signalRecord.iter()) {
    if (!collections.includes(row.collection as keyof SignalState)) continue;
    (state[row.collection as keyof SignalState] as unknown[]).push(JSON.parse(row.json));
  }
  return state;
}

function context(db: ViewDb, person: Ctx['sender'], at: number): SignalContext {
  return {
    actor: person.toHexString(), now: at,
    activeMembers: [...db.member.iter()].filter(row => row.status === 'active').map(row => row.identity.toHexString()),
    subjects: [...db.subject.iter()].map(row => String(row.id)),
    isAdmin: db.member.identity.find(person)?.isCreator === true,
    source(kind, value) {
      if (!/^[1-9]\d{0,19}$/.test(value)) return undefined;
      const id = BigInt(value);
      if (id > 18_446_744_073_709_551_615n || !canReadTarget(db, person, kind, id) || withdrawn(db, kind, id)) return undefined;
      if (kind === 'note') {
        const note = db.note.id.find(id);
        return note ? { subjectId: String(note.subjectId), version: note.version } : undefined;
      }
      const work = db.work.id.find(id);
      const assignment = work && db.assignment.id.find(work.assignmentId);
      if (!work || !assignment || withdrawn(db, 'assignment', assignment.id)) return undefined;
      return { subjectId: String(assignment.subjectId), version: work.version };
    },
  };
}

function persist(ctx: Ctx, state: SignalState, at: number) {
  const next = new Map<string, { key: string; collection: string; json: string }>();
  for (const collection of collections) {
    for (const value of state[collection]) {
      const key = `${collection}:${value.id}`;
      next.set(key, { key, collection, json: JSON.stringify(value) });
    }
  }
  next.set(CLOCK, { key: CLOCK, collection: CLOCK, json: String(at) });
  for (const old of ctx.db.signalRecord.iter()) {
    const value = next.get(old.key);
    if (!value) ctx.db.signalRecord.key.delete(old.key);
    else {
      if (old.json !== value.json) ctx.db.signalRecord.key.update(value);
      next.delete(old.key);
    }
  }
  for (const value of next.values()) ctx.db.signalRecord.insert(value);
}

/** Scheduled expiry keeps the view deterministic without a wall-clock dependency. */
function schedule(ctx: Ctx, state: SignalState, at: number) {
  const deadlines: number[] = [];
  for (const row of [...state.messages, ...state.attempts, ...state.cards]) {
    if (row.deletedAt !== undefined) deadlines.push(row.deletedAt + SIGNAL_LIMITS.retentionMs);
  }
  for (const row of state.sessions) {
    if (row.status === 'pending') deadlines.push(row.expiresAt);
    for (const deletedAt of Object.values(row.removedBy)) deadlines.push(deletedAt + SIGNAL_LIMITS.retentionMs);
  }
  const earliest = deadlines.filter(deadline => deadline > at).sort((a, b) => a - b)[0];
  const pending = [...ctx.db.signalExpiry.iter()];
  if (pending.length === 1 && pending[0]!.at === BigInt(earliest ?? 0)) return;
  for (const entry of pending) ctx.db.signalExpiry.id.delete(entry.id);
  if (earliest !== undefined) ctx.db.signalExpiry.insert({ id: 0n, at: BigInt(earliest), scheduledAt: ScheduleAt.time(BigInt(earliest) * 1000n) });
}

export function signalAction(ctx: Ctx, { payload }: { payload: string }) {
  activeMember(ctx);
  if (typeof payload !== 'string' || payload.length > 700_000) throw new SenderError('La solicitud de señales excede el límite.');
  try {
    const command: unknown = JSON.parse(payload);
    const at = now(ctx);
    const result = applySignalCommand(readSignalState(ctx.db), command, context(ctx.db, memberIdentityFor(ctx), at));
    persist(ctx, result.state, at);
    schedule(ctx, result.state, at);
  } catch (error) {
    throw new SenderError(error instanceof Error && !(error instanceof SyntaxError) ? error.message : 'La solicitud de señales no es válida.');
  }
}

export function signalSnapshot(db: ViewDb, person: Ctx['sender']) {
  if (!isActive(db, person)) return [];
  const at = Number(db.signalRecord.key.find(CLOCK)?.json ?? '0');
  return [{ id: person.toHexString(), json: JSON.stringify(projectSignals(readSignalState(db), context(db, person, at))) }];
}

export function expireSignals(ctx: Ctx, event: { id: bigint; at: bigint }) {
  if (!ctx.sender.isEqual(ctx.identity)) throw new SenderError('Solo el programador interno puede limpiar señales vencidas.');
  const pending = ctx.db.signalExpiry.id.find(event.id);
  if (!pending || pending.at !== event.at) return;
  ctx.db.signalExpiry.id.delete(event.id);
  const at = now(ctx);
  const state = purgeSignals(readSignalState(ctx.db), at);
  persist(ctx, state, at);
  schedule(ctx, state, at);
}
