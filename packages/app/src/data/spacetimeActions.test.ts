import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import type { DbConnection } from '../module_bindings';
import { createSpacetimeActions } from './spacetimeActions';
import { ResourceTransport } from './resourceTransport';

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
  it('manda versiones esperadas y referencias académicas al servidor sin convertir u64 a Number', async () => {
    const saveWorkVersion = vi.fn(async () => {});
    const reviewWork = vi.fn(async () => {});
    const restorePageSnapshot = vi.fn(async () => {});
    const saveActivityLinks = vi.fn(async () => {});
    const setProgress = vi.fn(async () => {});
    const { actions } = setup({ saveWorkVersion, reviewWork, restorePageSnapshot, saveActivityLinks, setProgress });
    await actions.saveWorkVersion('18446744073709551614', { title: 'Final', description: 'Explicación', topic: 'Tema', status: 'final' }, 7);
    expect(saveWorkVersion).toHaveBeenCalledWith({ workId: 18446744073709551614n,
      title: 'Final', description: 'Explicación', topic: 'Tema', status: 'final', expectedVersion: 7 });
    await actions.reviewWork('12', 7, 'Revisado con ejemplos');
    expect(reviewWork).toHaveBeenCalledWith({ workId: 12n, expectedVersion: 7, comment: 'Revisado con ejemplos' });
    await actions.restorePageSnapshot('activity', '5', 2, 4);
    expect(restorePageSnapshot).toHaveBeenCalledWith({ page: 'activity', pageId: 5n, version: 2, expectedVersion: 4 });
    await actions.saveActivityLinks('5', ['9007199254740993'], ['6'], 4);
    expect(saveActivityLinks).toHaveBeenCalledWith({ activityId: 5n, assignmentIds: [9007199254740993n], noteIds: [6n], expectedVersion: 4 });
    await actions.setProgress('assignment', '5', 'done');
    expect(setProgress).toHaveBeenCalledWith({ targetKind: 'assignment', targetId: 5n, status: 'done' });
  });

  it('sube por HTTP real y elimina mediante reducer; el wrapper heredado conserva la referencia', async () => {
    const removeResourceFile = vi.fn(async () => {});
    const { connection } = setup({ removeResourceFile }, { works: [{ id: 9n, version: 3 }],
      workFiles: [{ id: 2n, workId: 9n }] });
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ fileId: 'new-file' })));
    const transport = new ResourceTransport({ apiUrl: '', getToken: () => 'current-token', fetch: request });
    const actions = createSpacetimeActions(() => connection, () => SELF, transport);
    expect(await actions.attachWorkFile('9', new File(['bytes'], 'prueba.txt'))).toBe('new-file');
    expect(String(request.mock.calls[0]?.[0])).toContain('expectedVersion=3');
    await actions.removeWorkFile('2');
    expect(removeResourceFile).toHaveBeenCalledWith({ fileId: 'legacy:2', expectedVersion: 3 });
  });

  it('convierte IDs u64 sin perder precisión y manda la invitación al reducer real', async () => {
    const updateAssignmentV2 = vi.fn(async () => {});
    const inviteMember = vi.fn(async () => {});
    const removeMember = vi.fn(async () => {});
    const { actions } = setup({ updateAssignmentV2, inviteMember, removeMember });
    await actions.updateAssignment('18446744073709551614', { subjectId: '9007199254740993', termId: '7',
      kind: 'tarea', title: 'Tarea', instructions: 'Resolver' }, 4);
    expect(updateAssignmentV2).toHaveBeenCalledWith({ assignmentId: 18446744073709551614n,
      subjectId: 9007199254740993n, termId: 7n, kind: 'tarea', title: 'Tarea', instructions: 'Resolver',
      dueDate: '', topic: '', expectedVersion: 4 });
    await actions.inviteMember('alumno@example.com', false);
    expect(inviteMember).toHaveBeenCalledWith({ email: 'alumno@example.com', isCreator: false });
    await actions.removeMember(OTHER);
    expect(removeMember).toHaveBeenCalledWith({ identity: person(OTHER) });
  });

  it('usa la versión disponible para llamadas sin versión y nunca recurre a los reducers antiguos', async () => {
    const updateAssignmentV2 = vi.fn(async () => {});
    const updateActivityV2 = vi.fn(async () => {});
    const updateAssignment = vi.fn();
    const updateActivity = vi.fn();
    const { actions } = setup({ updateAssignmentV2, updateActivityV2, updateAssignment, updateActivity }, {
      assignments: [{ id: 5n, version: 6 }], assignmentDetails: [{ assignmentId: 5n, topic: 'Tema existente' }],
      activities: [{ id: 8n, version: 9 }],
    });
    const assignment = { subjectId: '7', kind: 'tarea' as const, title: 'Tarea', instructions: 'Resolver' };
    const activity = { subjectId: '7', topic: 'Tema', date: '2026-10-21', title: 'Actividad', objective: '', instructions: '' };
    await actions.updateAssignment('5', assignment);
    expect(updateAssignmentV2).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 6, topic: 'Tema existente' }));
    await actions.updateActivity('8', activity);
    expect(updateActivityV2).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 9 }));
    // La versión capturada por un formulario prevalece sobre una caché más reciente.
    await actions.updateAssignment('5', assignment, 3);
    expect(updateAssignmentV2).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 3 }));
    await actions.updateActivity('8', activity, 4);
    expect(updateActivityV2).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 4 }));
    expect(updateAssignment).not.toHaveBeenCalled();
    expect(updateActivity).not.toHaveBeenCalled();
  });

  it('pide recargar si una llamada sin versión no puede comprobar la publicación', () => {
    const updateAssignmentV2 = vi.fn();
    const updateActivityV2 = vi.fn();
    const { actions } = setup({ updateAssignmentV2, updateActivityV2 });
    expect(() => actions.updateAssignment('5', { subjectId: '7', kind: 'tarea', title: 'Tarea', instructions: '' }))
      .toThrow('Actualiza la página');
    expect(() => actions.updateActivity('8', { subjectId: '7', topic: '', date: '2026-10-21', title: 'Actividad', objective: '', instructions: '' }))
      .toThrow('Actualiza la página');
    expect(updateAssignmentV2).not.toHaveBeenCalled();
    expect(updateActivityV2).not.toHaveBeenCalled();
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

  it('no simula subidas ni registra archivos inválidos como stickers', async () => {
    const attachWorkFile = vi.fn(async () => {});
    const createStickerPack = vi.fn(async () => {});
    const { actions } = setup({ attachWorkFile, createStickerPack });
    const file = new File(['contenido PDF'], 'tarea.pdf', { type: 'application/pdf' });
    await expect(actions.attachWorkFile('1', file)).rejects.toThrow('almacenamiento');
    await expect(actions.importStickers('Paquete', [file])).rejects.toThrow('no es una imagen');
    expect(attachWorkFile).not.toHaveBeenCalled();
    expect(createStickerPack).not.toHaveBeenCalled();
  });

  it('envía prácticas, fuentes privadas y explicaciones con tipos nativos del servidor', async () => {
    const createTeachingPractice = vi.fn(async () => {
      rows.teachingPractices!.push({ id: 91n, owner: person(OTHER), subjectId: 7n, topic: 'Tema' });
      rows.teachingPractices!.push({ id: 92n, owner: person(), subjectId: 7n, topic: 'Tema' });
    });
    const saveTeachingPractice = vi.fn(async () => {});
    const setTeachingReviewer = vi.fn(async () => {});
    const { actions, rows } = setup({ createTeachingPractice, saveTeachingPractice, setTeachingReviewer }, { teachingPractices: [] });
    const initial = { concept: 'Concepto', example: 'Ejemplo', limits: 'Límites' };
    await expect(actions.createTeachingPractice({ subjectId: '7', topic: ' Tema ', initial,
      source: { kind: 'note', id: '9007199254740993' } })).resolves.toBe('92');
    expect(createTeachingPractice).toHaveBeenCalledWith({ subjectId: 7n, topic: ' Tema ', ...initial,
      sourceKind: 'note', sourceId: 9007199254740993n });
    await actions.saveTeachingPractice('92', { initial, revised: initial, reflection: 'Privado', topicsToReview: 'Privados' });
    expect(saveTeachingPractice).toHaveBeenCalledWith({ practiceId: 92n, ...initial,
      revisedConcept: 'Concepto', revisedExample: 'Ejemplo', revisedLimits: 'Límites', reflection: 'Privado', topicsToReview: 'Privados' });
    await actions.setTeachingReviewer('92', OTHER);
    expect(setTeachingReviewer).toHaveBeenLastCalledWith({ practiceId: 92n, reviewer: person(OTHER) });
    await actions.setTeachingReviewer('92');
    expect(setTeachingReviewer).toHaveBeenLastCalledWith({ practiceId: 92n, reviewer: undefined });
  });

  it('asocia preguntas al autor y práctica correctos y devuelve la nota registrada sin crear duplicados', async () => {
    const askTeachingQuestion = vi.fn(async () => {
      rows.teachingQuestions!.push({ id: 1n, practiceId: 9n, author: person(), kind: 'guided', text: 'Pregunta' });
      rows.teachingQuestions!.push({ id: 2n, practiceId: 9n, author: person(), kind: 'peer', text: 'Pregunta' });
    });
    const answerTeachingQuestion = vi.fn(async () => {});
    const publishTeachingExplanation = vi.fn(async () => {});
    const { actions, rows } = setup({ askTeachingQuestion, answerTeachingQuestion, publishTeachingExplanation }, {
      teachingQuestions: [], myTeachingPersonal: [{ practiceId: 9n, publishedNoteId: 9007199254740993n }],
    });
    await expect(actions.askTeachingQuestion('9', ' Pregunta ')).resolves.toBe('2');
    await actions.answerTeachingQuestion('2', 'Respuesta privada');
    expect(answerTeachingQuestion).toHaveBeenCalledWith({ questionId: 2n, answer: 'Respuesta privada' });
    await expect(actions.publishTeachingExplanation('9')).resolves.toBe('9007199254740993');
    await expect(actions.publishTeachingExplanation('9')).resolves.toBe('9007199254740993');
    expect(publishTeachingExplanation).toHaveBeenCalledTimes(2);
    expect(publishTeachingExplanation).toHaveBeenLastCalledWith({ practiceId: 9n });
  });
});
