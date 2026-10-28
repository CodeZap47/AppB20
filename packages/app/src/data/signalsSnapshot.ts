import { emptySignalsSnapshot, type SignalsSnapshot } from '@b20/core';
import type { DbConnection } from '../module_bindings';
import type { Member } from './types';

export function readSignalsSnapshot(connection: Pick<DbConnection, 'db'>, identity: string, members: Member[]): SignalsSnapshot {
  if (!members.some((member) => member.id === identity && member.status === 'active')) return emptySignalsSnapshot();
  const row = [...(connection.db.signalSnapshot?.iter() ?? [])].find((entry) => entry.id === identity);
  if (!row) return emptySignalsSnapshot();
  try {
    const value: unknown = JSON.parse(row.json);
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(emptySignalsSnapshot()).some((key) => !Array.isArray((value as Record<string, unknown>)[key]))) throw new Error();
    return value as SignalsSnapshot;
  } catch { throw new Error('No se pudo leer Lenguaje de señales. Vuelve a conectar con el grupo.'); }
}
