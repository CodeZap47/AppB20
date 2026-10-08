import { describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';

function source(viewer = 'demo-1') {
  return new DemoDataSource(createDemoState(new Date(2026, 9, 8)), viewer);
}

describe('DemoDataSource', () => {
  it('un tercero no ve una conversación 1 a 1 ajena', () => {
    const data = source('demo-1');
    const snap = data.getSnapshot();
    expect(snap.directConversations).toHaveLength(0);
    expect(snap.directMessages).toHaveLength(0);
    expect(() => data.sendDirectMessage('c1', 'hola')).toThrow('No participas');
  });

  it('los participantes sí ven su conversación', () => {
    const data = source('demo-2');
    expect(data.getSnapshot().directMessages).toHaveLength(1);
  });

  it('abrir dos veces la misma conversación devuelve la existente', () => {
    const data = source('demo-1');
    const first = data.openDirectConversation('demo-4');
    expect(data.openDirectConversation('demo-4')).toBe(first);
    data.setViewer('demo-4');
    expect(data.openDirectConversation('demo-1')).toBe(first);
  });

  it('un no miembro no ve nada ni puede escribir', () => {
    const data = source('externo');
    const snap = data.getSnapshot();
    expect(snap.members).toHaveLength(0);
    expect(snap.groupMessages).toHaveLength(0);
    expect(() => data.sendGroupMessage('hola')).toThrow('miembro activo');
  });

  it('publica un trabajo con coautores y conserva la autoría', () => {
    const data = source('demo-1');
    const id = data.publishWork({
      subjectId: 's1',
      termId: 't2',
      title: 'Nuevo',
      assignment: '',
      description: '',
      coauthorIds: ['demo-4'],
    });
    const work = data.getSnapshot().works.find((w) => w.id === id);
    expect(work?.authorIds).toEqual(['demo-1', 'demo-4']);
  });

  it('rechaza un parcial de otra materia', () => {
    const data = source('demo-1');
    expect(() =>
      data.publishWork({ subjectId: 's2', termId: 't1', title: 'X', assignment: '', description: '', coauthorIds: [] }),
    ).toThrow('no pertenece');
  });

  it('solo autores editan un trabajo', () => {
    const data = source('demo-4');
    expect(() => data.updateWork('w1', 'Otro', '')).toThrow('Solo el autor');
    data.setViewer('demo-2');
    data.updateWork('w1', 'Otro', '');
    expect(data.getSnapshot().works.find((w) => w.id === 'w1')?.version).toBe(2);
  });

  it('comparte y retira el cumpleaños propio', () => {
    const data = source('demo-1');
    expect(() => data.shareBirthday(31, 4, true)).toThrow('Fecha inválida');
    data.shareBirthday(29, 2, true);
    expect(data.getSnapshot().birthdays.some((b) => b.memberId === 'demo-1')).toBe(true);
    data.withdrawBirthday();
    expect(data.getSnapshot().birthdays.some((b) => b.memberId === 'demo-1')).toBe(false);
  });

  it('notifica a los suscriptores y entrega un snapshot nuevo', () => {
    const data = source('demo-1');
    const before = data.getSnapshot();
    let calls = 0;
    data.subscribe(() => calls++);
    data.sendGroupMessage('hola');
    expect(calls).toBe(1);
    expect(data.getSnapshot()).not.toBe(before);
    expect(data.getSnapshot()).toBe(data.getSnapshot());
  });
});
