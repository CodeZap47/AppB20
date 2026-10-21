import type { DbConnection } from '../module_bindings';
import type { TrashEntry } from './trashTypes';
import type { WithdrawableKind } from './delivery2Types';

export function readTrashEntries(connection: Pick<DbConnection, 'db'>): TrashEntry[] {
  return [...(connection.db.myTrashEntries?.iter() ?? [])].map((row) => {
    if (!['note', 'question', 'answer', 'guide', 'work', 'evidence'].includes(row.kind) || !['pending', 'purging', 'purged', 'restored'].includes(row.state)) throw new Error('Actualiza la app para consultar la papelera.');
    return { ...row, kind: row.kind as WithdrawableKind, state: row.state as TrashEntry['state'], targetId: row.targetId.toString(), withdrawnAt: row.withdrawnAt.toDate(), expiresAt: row.expiresAt.toDate() };
  });
}
export function createTrashActions(connection: () => DbConnection) {
  return { async getTrashClock() { return (await connection().procedures.getTrashClock({})).toDate(); } };
}
