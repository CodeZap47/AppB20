import type { WithdrawableKind } from './delivery2Types';
import type { Id } from './types';

export interface TrashEntry {
  kind: WithdrawableKind;
  targetId: Id;
  withdrawnAt: Date;
  expiresAt: Date;
  state: 'pending' | 'purging' | 'purged' | 'restored';
  canRestore: boolean;
  version: number;
}
export interface TrashActions { getTrashClock(): Promise<Date>; }
