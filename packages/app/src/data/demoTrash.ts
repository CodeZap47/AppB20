import { contributionFingerprint } from '@b20/core';
import { collectDemoContributionInputs, computeDemoContributionOrigins, buildDemoContributionOrigins, type ContributionState, type DemoContributionTombstone } from './demoContributionOrigins';
import type { WithdrawableKind } from './delivery2Types';
import type { Id, Member, ResourceFile, Snapshot } from './types';
import type { TrashEntry } from './trashTypes';

type TrashState = ContributionState & Pick<Snapshot, 'questions' | 'noteComments' | 'guideSources' | 'guideReviews' | 'teachingPersonal' | 'spacedCards' | 'roomMaterials' | 'roomSummaries'>;
interface Context {
  state(): TrashState; active(): Member; now(): Date; emit(): void; resources(): ResourceFile[];
  purgePrivate(targets: ReadonlySet<string>): void;
}
interface Metadata { kind: WithdrawableKind; targetId: Id; withdrawnAt: Date; expiresAt: Date; state: TrashEntry['state']; moderation: boolean }
interface Store { entries: Map<string, Metadata>; tombstones: Map<string, DemoContributionTombstone> }
const stores = new WeakMap<TrashState, Store>();
const targetKind = { trabajo: 'work', apunte: 'note', evidencia: 'evidence', guia: 'guide', respuesta: 'answer' };
const keyOf = (kind: string, id: Id) => `${kind}:${id}`;
const days30 = 30 * 86_400_000;

/** La simulación usa el mismo plazo y firmas SHA256 sin conservar cuerpos tras la purga. */
export class DemoTrashStore {
  private store: Store;
  constructor(private ctx: Context) {
    this.store = stores.get(ctx.state()) ?? { entries: new Map(), tombstones: new Map() };
    stores.set(ctx.state(), this.store);
  }
  private row(kind: WithdrawableKind, id: Id) {
    const s = this.ctx.state();
    return kind === 'note' ? s.notes.find((row) => row.id === id) : kind === 'guide' ? s.guides.find((row) => row.id === id)
      : kind === 'question' ? s.questions.find((row) => row.id === id) : kind === 'answer' ? s.answers.find((row) => row.id === id)
        : kind === 'work' ? s.works.find((row) => row.id === id) : s.evidences.find((row) => row.id === id);
  }
  private authors(kind: WithdrawableKind, id: Id) {
    const row = this.row(kind, id);
    return !row ? [] : 'authorIds' in row ? row.authorIds : ['authorId' in row ? row.authorId : row.createdBy];
  }
  record(kind: WithdrawableKind, id: Id, withdrawn: boolean) {
    const key = keyOf(kind, id);
    if (!withdrawn) { const prior = this.store.entries.get(key); if (prior) this.store.entries.set(key, { ...prior, state: 'restored' }); return; }
    const at = this.ctx.now();
    this.store.entries.set(key, { kind, targetId: id, withdrawnAt: at, expiresAt: new Date(at.getTime() + days30), state: 'pending', moderation: !this.authors(kind, id).includes(this.ctx.active().id) });
  }
  blocksRead(kind: string, id: Id) {
    const entry = this.store.entries.get(keyOf(kind, id));
    return !!entry && (entry.state === 'purged' || entry.state === 'purging' || entry.state === 'pending' && this.ctx.now() >= entry.expiresAt);
  }
  assertRestorable(kind: WithdrawableKind, id: Id) {
    if (this.blocksRead(kind, id)) throw new Error('El plazo de recuperación de 30 días terminó.');
  }
  snapshot(viewerId: Id): TrashEntry[] {
    const me = this.ctx.active(); if (me.id !== viewerId) return [];
    return [...this.store.entries.values()].flatMap((entry) => {
      if (entry.state !== 'pending') return [];
      const row = this.row(entry.kind, entry.targetId); const own = this.authors(entry.kind, entry.targetId).includes(me.id);
      if (!row || !own && (!me.isCreator || 'visibility' in row && row.visibility === 'personal')) return [];
      return [{ ...entry, canRestore: !this.blocksRead(entry.kind, entry.targetId) && (entry.moderation ? me.isCreator : own), version: row.version ?? 1 }];
    });
  }
  purgedKeys(): string[] { return [...this.store.entries.entries()].filter(([, entry]) => entry.state === 'purged').map(([key]) => key); }
  contributionOrigins(resources: ResourceFile[], visible: Snapshot) {
    return buildDemoContributionOrigins(this.ctx.state(), resources, visible, this.store.tombstones);
  }
  purgeDue(): boolean {
    const s = this.ctx.state(); const due = [...this.store.entries.entries()].filter(([, entry]) => entry.state === 'pending' && this.ctx.now() >= entry.expiresAt);
    if (!due.length) return false;
    const targets = new Set(due.map(([key]) => key));
    for (const [, entry] of due) if (entry.kind === 'question') for (const answer of s.answers.filter((row) => row.questionId === entry.targetId)) targets.add(keyOf('answer', answer.id));
    const inputs = collectDemoContributionInputs(s, this.ctx.resources());
    const origins = computeDemoContributionOrigins(inputs, this.store.tombstones);
    for (let index = 0; index < inputs.length; index++) {
      const input = inputs[index]!; if (!targets.has(keyOf(targetKind[input.kind], input.refId))) continue;
      const origin = origins[index]!;
      this.store.tombstones.set(contributionFingerprint(input), { canonicalId: origin.duplicateOf ?? origin.refId, creditedAt: origin.creditedAt });
    }
    const keep = (kind: string, id: Id) => !targets.has(keyOf(kind, id));
    s.notes = s.notes.filter((row) => keep('note', row.id)); s.guides = s.guides.filter((row) => keep('guide', row.id));
    s.questions = s.questions.filter((row) => keep('question', row.id)).map((row) => row.acceptedAnswerId && !keep('answer', row.acceptedAnswerId) ? { ...row, acceptedAnswerId: undefined, status: 'open', resolvedAt: undefined } : row);
    s.answers = s.answers.filter((row) => keep('answer', row.id)); s.works = s.works.filter((row) => keep('work', row.id)); s.evidences = s.evidences.filter((row) => keep('evidence', row.id));
    s.noteComments = s.noteComments.filter((row) => keep('note', row.noteId));
    const sourceKinds: Record<string, string> = { nota: 'note', pregunta: 'question', trabajo: 'work', guia: 'guide', evidencia: 'evidence' };
    s.guideSources = s.guideSources.filter((row) => keep('guide', row.guideId) && keep(sourceKinds[row.kind] ?? row.kind, row.refId));
    s.guideReviews = s.guideReviews.filter((row) => keep('guide', row.guideId));
    s.roomMaterials = s.roomMaterials.filter((row) => keep(row.kind, row.sourceId));
    s.roomSummaries = s.roomSummaries.map((row) => row.publishedNoteId && !keep('note', row.publishedNoteId) ? { ...row, publishedNoteId: undefined } : row);
    s.spacedCards = s.spacedCards.map((row) => !keep(row.sourceKind, row.sourceId) ? { ...row, question: '', explanation: '', hint: '', archived: true, version: row.version + 1 } : row);
    s.teachingPersonal = s.teachingPersonal.map((row) => ({ ...row, ...(!keep(row.sourceKind ?? '', row.sourceId ?? '') ? { sourceKind: undefined, sourceId: undefined, sourceVersion: undefined } : {}), ...(row.publishedNoteId && !keep('note', row.publishedNoteId) ? { publishedNoteId: undefined } : {}) }));
    for (const note of s.notes) { if (note.publishedFromId && !keep('note', note.publishedFromId)) { note.publishedFromId = undefined; note.publishedFromVersion = undefined; } note.questionIds = note.questionIds?.filter((id) => keep('question', id)); }
    this.ctx.purgePrivate(targets);
    for (const [key, entry] of this.store.entries) if (targets.has(key)) this.store.entries.set(key, { ...entry, state: 'purged' });
    return true;
  }
}
