import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import type { DbConnection } from '../module_bindings';
import { createSpacetimeActions } from './spacetimeActions';

describe('adaptador real de comandos', () => {
  it('identifica el id recién creado con la misma normalización del servidor', async () => {
    const owner = Identity.fromString('b'.repeat(64));
    const rows: { id: bigint; owner: Identity; name: string; description: string; text: string; createdAt: Timestamp }[] = [];
    const save = vi.fn(async (input: { name: string; description: string; text: string }) => { rows.push({ ...input, id: 50n, owner, createdAt: new Timestamp(1n) }); });
    const connection = { db: { availableChatCommands: { iter: () => rows.values() } }, reducers: { saveChatCommandV2: save } } as unknown as DbConnection;
    const actions = createSpacetimeActions(() => connection, () => owner.toHexString());
    await expect(actions.saveChatCommand({ name: '/Saludó', description: '', text: 'Hola' })).resolves.toBe('50');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'saludo', visibility: 'personal', actionKind: 'text' }));
  });
});
