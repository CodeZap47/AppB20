import { MAX_FILE_BYTES } from '@b20/core';
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

describe('notas, actividades y preguntas', () => {
  it('las notas personales solo las ve su autor', () => {
    const data = source('demo-1');
    expect(data.getSnapshot().notes.map((n) => n.id)).toEqual(['n1']);
    expect(() => data.commentNote('n2', 'hola')).toThrow('no existe');
    data.setViewer('demo-3');
    expect(data.getSnapshot().notes.map((n) => n.id)).toContain('n2');
  });

  it('solo el autor edita su nota; los demás comentan', () => {
    const data = source('demo-1');
    const input = {
      id: 'n1',
      subjectId: 's1',
      topic: '',
      title: 'Cambio',
      body: 'x',
      tags: [],
      visibility: 'group' as const,
      source: 'student' as const,
    };
    expect(() => data.saveNote(input)).toThrow('Solo su autor');
    data.commentNote('n1', 'Propongo corregir algo');
    expect(data.getSnapshot().noteComments).toHaveLength(1);
    data.setViewer('demo-2');
    data.saveNote(input);
    expect(data.getSnapshot().notes.find((n) => n.id === 'n1')?.version).toBe(2);
  });

  it('las evidencias de cada equipo se agregan sin sobrescribirse', () => {
    const data = source('demo-1');
    data.addEvidence('a1', 'Nuestra solución', ['demo-4']);
    const evidences = data.getSnapshot().evidences.filter((e) => e.activityId === 'a1');
    expect(evidences).toHaveLength(2);
    expect(evidences[1]?.participantIds).toEqual(['demo-1', 'demo-4']);
  });

  it('solo quien preguntó acepta una respuesta y puede reabrir', () => {
    const data = source('demo-1');
    expect(() => data.acceptAnswer('q1', 'r1')).toThrow('Solo quien preguntó');
    data.setViewer('demo-3');
    data.acceptAnswer('q1', 'r1');
    expect(data.getSnapshot().questions[0]?.status).toBe('resolved');
    data.reopenQuestion('q1');
    expect(data.getSnapshot().questions[0]?.acceptedAnswerId).toBeUndefined();
  });

  describe('archivos de un trabajo', () => {
    /** Archivo del tamaño indicado sin reservar esa memoria. */
    const fileOf = (name: string, size: number) => {
      const file = new File(['x'], name, { type: 'text/plain' });
      Object.defineProperty(file, 'size', { value: size });
      return file;
    };

    it('un autor adjunta hasta 50 MB exactos y el archivo queda en el trabajo', async () => {
      const data = source('demo-1');
      const id = await data.attachWorkFile('w1', fileOf('reporte.pdf', MAX_FILE_BYTES));
      expect(data.getSnapshot().workFiles.find((f) => f.id === id)).toMatchObject({
        workId: 'w1',
        name: 'reporte.pdf',
        size: MAX_FILE_BYTES,
        uploadedBy: 'demo-1',
      });
    });

    it('rechaza archivos de más de 50 MB y archivos vacíos', async () => {
      const data = source('demo-1');
      const before = data.getSnapshot().workFiles.length;
      await expect(data.attachWorkFile('w1', fileOf('video.mp4', MAX_FILE_BYTES + 1))).rejects.toThrow(
        'el límite es de 50 MB por archivo',
      );
      await expect(data.attachWorkFile('w1', fileOf('vacio.txt', 0))).rejects.toThrow('está vacío');
      expect(data.getSnapshot().workFiles).toHaveLength(before);
    });

    it('solo los autores adjuntan y quitan archivos', async () => {
      const data = source('demo-3');
      await expect(data.attachWorkFile('w1', fileOf('a.txt', 10))).rejects.toThrow('Solo el autor');
      data.setViewer('demo-1');
      const id = await data.attachWorkFile('w1', fileOf('a.txt', 10));
      data.setViewer('demo-3');
      expect(() => data.removeWorkFile(id)).toThrow('Solo el autor');
      data.setViewer('demo-2');
      data.removeWorkFile(id);
      expect(data.getSnapshot().workFiles.some((f) => f.id === id)).toBe(false);
    });
  });
});
