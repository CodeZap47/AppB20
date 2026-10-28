import { describe, expect, it, vi } from 'vitest';
import { emptySignalsSnapshot, type SignalCommand } from '@b20/core';
import type { DbConnection } from '../module_bindings';
import type { Member } from './types';
import { readSignalsSnapshot } from './signalsSnapshot';
import { createSignalsActions } from './signalsActions';

const member = (id: string, status: Member['status'] = 'active'): Member => ({ id, status, displayName: id, isCreator: false, joinedAt: new Date() });
const command: SignalCommand = { action: 'publishDictionary', dictionaryId: 'dictionary', expectedVersion: 1, requestId: 'publish' };
function fixture() {
  const snapshot = { ...emptySignalsSnapshot(), receipts: [{ requestId: 'publish', id: 'published-id' }] };
  const rows = [{ id: 'owner', json: JSON.stringify(snapshot) }];
  const reducer = vi.fn(async (_input: { payload: string }) => {});
  const connection = { db: { signalSnapshot: { iter: () => rows.values() } }, reducers: { signalAction: reducer } } as unknown as DbConnection;
  return { rows, reducer, connection };
}
describe('Transporte de Lenguaje de señales', () => {
  it('solo lee la proyección del integrante activo y vacía el módulo al perder acceso', () => {
    const { connection } = fixture();
    expect(readSignalsSnapshot(connection, 'owner', [member('owner')]).receipts).toHaveLength(1);
    expect(readSignalsSnapshot(connection, 'other', [member('other')]).receipts).toEqual([]);
    expect(readSignalsSnapshot(connection, 'owner', [member('owner', 'removed')])).toEqual(emptySignalsSnapshot());
  });
  it('tolera una caché aún vacía, pero rechaza una respuesta corrupta', () => {
    const { connection, rows } = fixture();
    rows[0]!.json = 'malformed';
    expect(() => readSignalsSnapshot(connection, 'owner', [member('owner')])).toThrow(/Vuelve a conectar/);
    rows[0]!.json = '{}';
    expect(() => readSignalsSnapshot(connection, 'owner', [member('owner')])).toThrow(/Vuelve a conectar/);
    rows.length = 0;
    expect(readSignalsSnapshot(connection, 'owner', [member('owner')])).toEqual(emptySignalsSnapshot());
  });
  it('espera confirmación y recupera el identificador desde el recibo del mismo envío', async () => {
    const s = fixture();
    const actions = createSignalsActions(() => s.connection, () => 'owner');
    await expect(actions.signalAction(command)).resolves.toBe('published-id');
    expect(s.reducer).toHaveBeenCalledWith({ payload: JSON.stringify(command) });
  });
  it('conserva el identificador de solicitud al faltar la confirmación o fallar la red', async () => {
    const s = fixture(); const actions = createSignalsActions(() => s.connection, () => 'owner');
    s.rows.length = 0;
    await expect(actions.signalAction(command)).rejects.toThrow(/Reintenta el mismo envío/);
    s.reducer.mockRejectedValueOnce(new Error('Sin conexión'));
    await expect(actions.signalAction(command)).rejects.toThrow('Sin conexión');
    expect(s.reducer.mock.calls.map((call) => call[0])).toEqual([{ payload: JSON.stringify(command) }, { payload: JSON.stringify(command) }]);
  });
  it('no acepta una confirmación que llegó después de cambiar de cuenta', async () => {
    const s = fixture(); let actor = 'owner';
    s.reducer.mockImplementationOnce(async () => { actor = 'other'; });
    await expect(createSignalsActions(() => s.connection, () => actor).signalAction(command)).rejects.toThrow(/sesión cambió/);
  });
});
