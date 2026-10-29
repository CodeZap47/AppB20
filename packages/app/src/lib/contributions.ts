import { breakdown, countLabel, rankMembers, recognitionsFor, contributionEntries, scoreEntries, type ContributionWindow, type RankedMember, type RecognitionId, type ScoredEntry } from '@b20/core';
import type { Id, Snapshot } from '../data/types';
export { contributionEntries, scoreEntries, leaderboardPeriods, leaderChanges } from '@b20/core';
export type { ContributionEntry, ScoredEntry, PeriodId, LeaderboardPeriod, LeaderChange } from '@b20/core';

export interface MemberStanding extends RankedMember {
  events: ScoredEntry[];
  recognitions: RecognitionId[];
}

/** Leaderboard del periodo con los aportes de cada quien, para verificar cada punto. */
export function buildLeaderboard(data: Snapshot, window: ContributionWindow): MemberStanding[] {
  const active = data.members.filter((m) => m.status === 'active');
  const scored = scoreEntries(contributionEntries(data), window);
  const nameOf = (id: Id) => active.find((m) => m.id === id)?.displayName ?? '';
  return rankMembers(
    active.map((m) => m.id),
    scored,
    nameOf,
  ).map((entry) => {
    const events = scored.filter((e) => e.memberId === entry.memberId);
    return { ...entry, events, recognitions: recognitionsFor(events) };
  });
}

/** Lo que más aportó alguien, en una línea: «2 trabajos · 1 apunte». */
export function standingSummary(standing: MemberStanding, max = 2): string {
  return breakdown(standing.events)
    .filter((row) => row.counted)
    .sort((a, b) => b.points - a.points)
    .slice(0, max)
    .map((row) => countLabel(row.kind, row.counted))
    .join(' · ');
}
