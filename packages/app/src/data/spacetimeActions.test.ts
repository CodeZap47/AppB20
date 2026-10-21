import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import type { DbConnection } from '../module_bindings';
import { createSpacetimeActions } from './spacetimeActions';

const SELF = '00000000000000000000000000000000000000000000000000000000000000aa';
const OTHER = '00000000000000000000000000000000000000000000000000000000000000bb';
const person = (value = SELF) => Identity.fromString(value);

function setup(reducers: Record<string, unknown>, initial: Record<string, unknown[]> = {}) {
  const rows = { ...initial };
  const db = new Proxy({}, { get: (_target, key: string) => ({ iter: () => (rows[key] ?? []).values() }) });
  const connection = { db, reducers } as unknown as DbConnection;
  return { rows, connection, actions: createSpacetimeActions(() => connection, () => SELF) };
}

describe('acciones conectadas a SpacetimeDB', () => {
  it('convierte IDs u64 sin perder precisión y manda la invitación al reducer real', async () => {
    const updateAssignment = vi.fn(async () => {});
    const inviteMember = vi.fn(async () => {});
    const removeMember = vi.fn(async () => {});
    const { actions } = setup({ updateAssignment, inviteMember, removeMember });
    await actions.updateAssignment('18446744073709551614', { subjectId: '9007199254740993', termId: '7',
      kind: 'tarea', title: 'Tarea', instructions: 'Resolver' });
    expect(updateAssignment).toHaveBeenCalledWith({ assignmentId: 18446744073709551614n,
      subjectId: 9007199254740993n, termId: 7n, kind: 'tarea', title: 'Tarea', instructions: 'Resolver', dueDate: '' });
    await actions.inviteMember('alumno@example.com', false);
    expect(inviteMember).toHaveBeenCalledWith({ email: 'alumno@example.com', isCreator: false });
    await actions.removeMember(OTHER);
    expect(removeMember).toHaveBeenCalledWith({ identity: person(OTHER) });
  });

  it('manda fechas y participantes como tipos nativos del SDK', async () => {
    const updatePoll = vi.fn(async () => {});
    const { actions } = setup({ updatePoll });
    const closesAt = new Date('2026-10-21T12:00:00Z');
    await actions.updatePoll('12', { title: 'Encuesta', description: '', options: ['A', 'B'], multiple: false,
      allowChange: true, eligibleIds: [SELF, OTHER], closesAt });
    expect(updatePoll).toHaveBeenCalledWith({ pollId: 12n, title: 'Encuesta', description: '', options: ['A', 'B'],
      multiple: false, allowChange: true, eligible: [person(), person(OTHER)], closesAt: Timestamp.fromDate(closesAt) });
  });

  it('devuelve el ID del alta propia aunque otra persona publique durante la petición', async () => {
    const createAssignment = vi.fn(async () => {
      rows.assignments!.push({ id: 1n, createdBy: person(OTHER), subjectId: 7n, title: 'Tarea' });
      rows.assignments!.push({ id: 2n, createdBy: person(), subjectId: 7n, title: 'Tarea' });
    });
    const { actions, rows } = setup({ createAssignment }, { assignments: [] });
    await expect(actions.createAssignment({ subjectId: '7', kind: 'tarea', title: ' Tarea ', instructions: '' })).resolves.toBe('2');
  });

  it('serializa las creaciones y la cola sigue sirviendo después de un error', async () => {
    let finishFirst: (() => void) | undefined;
    const sendGroupMessage = vi.fn(async ({ text }: { text: string }) => {
      if (text === 'primero') await new Promise<void>((resolve) => { finishFirst = resolve; });
      if (text === 'fallido') throw new Error('No estás invitado');
      rows.groupMessages!.push({ id: BigInt(rows.groupMessages!.length + 1), sender: person(), text });
    });
    const { actions, rows } = setup({ sendGroupMessage }, { groupMessages: [] });
    const first = actions.sendGroupMessage('primero');
    const second = actions.sendGroupMessage('segundo');
    await vi.waitFor(() => expect(sendGroupMessage).toHaveBeenCalledTimes(1));
    finishFirst?.();
    await expect(first).resolves.toBe('1');
    await expect(second).resolves.toBe('2');
    await expect(actions.sendGroupMessage('fallido')).rejects.toThrow('No estás invitado');
    await expect(actions.sendGroupMessage('tercero')).resolves.toBe('3');
  });

  it('no devuelve un ID ajeno si no hay una única creación atribuible a la petición', async () => {
    const askQuestion = vi.fn(async () => { rows.questions!.push({ id: 1n, author: person(OTHER), subjectId: 7n, title: 'Pregunta' }); });
    const { actions, rows } = setup({ askQuestion }, { questions: [] });
    await expect(actions.askQuestion({ subjectId: '7', topic: '', title: 'Pregunta', body: '' })).rejects.toThrow('identificar');
  });

  it('recupera el 1 a 1 existente solo con el compañero elegido', async () => {
    const openDirectConversation = vi.fn(async () => {});
    const { actions } = setup({ openDirectConversation }, { myDirectConversations: [
      { id: 1n, userA: person(), userB: person('00000000000000000000000000000000000000000000000000000000000000cc') },
      { id: 2n, userA: person(OTHER), userB: person() },
    ] });
    await expect(actions.openDirectConversation(OTHER)).resolves.toBe('2');
    expect(openDirectConversation).toHaveBeenCalledWith({ other: person(OTHER) });
  });

  it('no simula subidas ni registra archivos o stickers sin almacenamiento', async () => {
    const attachWorkFile = vi.fn(async () => {});
    const createStickerPack = vi.fn(async () => {});
    const { actions } = setup({ attachWorkFile, createStickerPack });
    const file = { name: 'tarea.pdf', size: 120 } as File;
    await expect(actions.attachWorkFile('1', file)).rejects.toThrow('almacenamiento');
    await expect(actions.importStickers('Paquete', [file])).rejects.toThrow('almacenamiento');
    expect(attachWorkFile).not.toHaveBeenCalled();
    expect(createStickerPack).not.toHaveBeenCalled();
  });
});
