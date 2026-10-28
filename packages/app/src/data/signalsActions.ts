import type { SignalCommand, SignalsSnapshot } from '@b20/core';
import type { DbConnection } from '../module_bindings';

/** Commands carry stable request IDs so a lost acknowledgement can be retried safely. */
export function createSignalsActions(connection: () => DbConnection, identity: () => string) {
  return {
    async signalAction(command: SignalCommand): Promise<string | undefined> {
      const actor = identity();
      const current = connection();
      await current.reducers.signalAction({ payload: JSON.stringify(command) });
      if (identity() !== actor || connection() !== current) throw new Error('La sesión cambió. Vuelve a abrir Lenguaje de señales.');
      const row = [...current.db.signalSnapshot.iter()].find((entry) => entry.id === actor);
      const snapshot = row ? JSON.parse(row.json) as SignalsSnapshot : undefined;
      const receipt = snapshot?.receipts.find((entry) => entry.requestId === command.requestId.trim());
      if (!receipt) throw new Error('El envío terminó, pero falta su confirmación. Reintenta el mismo envío para comprobarlo.');
      return receipt.id;
    },
  };
}
