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

  it('sube un trabajo con coautores a una tarea y conserva la autoría', () => {
    const data = source('demo-1');
    const id = data.publishWork({ assignmentId: 't4', title: '', description: 'Nuevo', coauthorIds: ['demo-4'] });
    expect(data.getSnapshot().works.find((w) => w.id === id)).toMatchObject({
      assignmentId: 't4',
      authorIds: ['demo-1', 'demo-4'],
    });
    expect(() =>
      data.publishWork({ assignmentId: 'no-existe', title: '', description: 'x', coauthorIds: [] }),
    ).toThrow('La tarea no existe');
  });

  it('solo autores editan un trabajo', () => {
    const data = source('demo-4');
    expect(() => data.updateWork('w1', 'Otro', '')).toThrow('Solo el autor');
    data.setViewer('demo-2');
    data.updateWork('w1', 'Otro', '');
    expect(data.getSnapshot().works.find((w) => w.id === 'w1')).toMatchObject({ version: 2, title: 'Otro' });
  });

  describe('página principal de una tarea', () => {
    const input = {
      subjectId: 'IDSE-05010103',
      termId: 'IDSE-05010103-p2',
      kind: 'examen' as const,
      title: 'Examen parcial',
      instructions: 'Temas 1 a 3.',
      dueDate: '2026-10-20',
    };

    it('se crea con su primera versión en el historial', () => {
      const data = source('demo-1');
      const id = data.createAssignment(input);
      const snap = data.getSnapshot();
      expect(snap.assignments.find((a) => a.id === id)).toMatchObject({ ...input, version: 1, createdBy: 'demo-1' });
      expect(snap.revisions.filter((r) => r.pageId === id)).toMatchObject([
        { page: 'assignment', version: 1, editedBy: 'demo-1', body: 'Temas 1 a 3.' },
      ]);
    });

    it('rechaza un parcial de otra materia y una fecha mal escrita', () => {
      const data = source('demo-1');
      expect(() => data.createAssignment({ ...input, subjectId: 'IDSE-05010104' })).toThrow('no pertenece');
      expect(() => data.createAssignment({ ...input, dueDate: '20/10/2026' })).toThrow('Fecha de entrega');
    });

    it('cualquier integrante la edita, como un wiki, y queda quién cambió cada versión', () => {
      const data = source('demo-1');
      const id = data.createAssignment(input);
      data.setViewer('demo-4');
      data.updateAssignment(id, { ...input, instructions: 'Temas 1 a 4.' });
      const snap = data.getSnapshot();
      expect(snap.assignments.find((a) => a.id === id)).toMatchObject({
        version: 2,
        instructions: 'Temas 1 a 4.',
        createdBy: 'demo-1',
        updatedBy: 'demo-4',
      });
      expect(snap.revisions.filter((r) => r.pageId === id).map((r) => [r.version, r.editedBy, r.body])).toEqual([
        [1, 'demo-1', 'Temas 1 a 3.'],
        [2, 'demo-4', 'Temas 1 a 4.'],
      ]);
    });

    it('quien no es miembro no puede editarla', () => {
      const data = source('externo');
      expect(() => data.updateAssignment('t1', input)).toThrow('miembro activo');
    });
  });

  it('una actividad de clase también se edita entre todos y guarda su historial', () => {
    const data = source('demo-4');
    const before = data.getSnapshot().activities.find((a) => a.id === 'a1')!;
    data.updateActivity('a1', { ...before, objective: 'Objetivo corregido.' });
    const snap = data.getSnapshot();
    expect(snap.activities.find((a) => a.id === 'a1')).toMatchObject({
      version: 2,
      objective: 'Objetivo corregido.',
      updatedBy: 'demo-4',
    });
    expect(snap.revisions.filter((r) => r.page === 'activity' && r.pageId === 'a1').at(-1)).toMatchObject({
      version: 2,
      editedBy: 'demo-4',
      summary: 'Objetivo corregido.',
    });
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
    expect(data.getSnapshot().notes.map((n) => n.id)).not.toContain('n2');
    expect(() => data.commentNote('n2', 'hola')).toThrow('no existe');
    data.setViewer('demo-3');
    expect(data.getSnapshot().notes.map((n) => n.id)).toContain('n2');
  });

  it('solo el autor edita su nota; los demás comentan', () => {
    const data = source('demo-1');
    const input = {
      id: 'n1',
      subjectId: 'IDSE-05010103',
      topic: '',
      title: 'Cambio',
      body: 'x',
      tags: [],
      visibility: 'group' as const,
      source: 'student' as const,
    };
    expect(() => data.saveNote(input)).toThrow('Solo su autor');
    data.commentNote('n1', 'Propongo corregir algo');
    expect(data.getSnapshot().noteComments.filter((c) => c.noteId === 'n1')).toHaveLength(1);
    data.setViewer('demo-2');
    data.saveNote(input);
    expect(data.getSnapshot().notes.find((n) => n.id === 'n1')?.version).toBe(2);
  });

  it('las evidencias de cada equipo se agregan sin sobrescribirse', () => {
    const data = source('demo-1');
    data.addEvidence('a1', 'Nuestra solución', ['demo-4']);
    const evidences = data.getSnapshot().evidences.filter((e) => e.activityId === 'a1');
    expect(evidences).toHaveLength(3);
    expect(evidences.at(-1)?.participantIds).toEqual(['demo-1', 'demo-4']);
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

  it('trae el plan de estudios: 45 materias con tres parciales cada una', () => {
    const { subjects, terms } = source('demo-1').getSnapshot();
    expect(subjects).toHaveLength(45);
    expect(subjects.filter((s) => s.period === 1).map((s) => s.name)).toContain('Lógica de Programación');
    expect(subjects.every((s) => terms.filter((t) => t.subjectId === s.id).length === 3)).toBe(true);
  });

  it('una materia nueva necesita un cuatrimestre válido', () => {
    const data = source('demo-1');
    expect(() => data.createSubject('Optativa', 12)).toThrow('cuatrimestre');
    const id = data.createSubject('Optativa', 3);
    expect(data.getSnapshot().subjects.find((s) => s.id === id)?.period).toBe(3);
  });

  describe('calendario de parciales', () => {
    const terms = [
      { startDate: '2027-01-11', endDate: '2027-02-12' },
      { startDate: '2027-02-15', endDate: '2027-03-19' },
      { startDate: '', endDate: '' },
    ];

    it('trae el primer cuatrimestre configurado con el parcial 2 vigente', () => {
      const { calendar } = source('demo-2').getSnapshot();
      expect(calendar.map((entry) => [entry.period, entry.term])).toEqual([
        [1, 1],
        [1, 2],
        [1, 3],
      ]);
      const today = '2026-10-08';
      expect(calendar.filter((entry) => entry.startDate <= today && today <= entry.endDate)).toMatchObject([
        { period: 1, term: 2 },
      ]);
    });

    it('solo un administrador cambia las fechas', () => {
      const data = source('demo-2');
      expect(() => data.saveCalendar(2, terms)).toThrow('Solo los administradores');
      data.setViewer('demo-1');
      data.saveCalendar(2, terms);
      expect(data.getSnapshot().calendar.filter((entry) => entry.period === 2)).toEqual([
        { period: 2, term: 1, startDate: '2027-01-11', endDate: '2027-02-12' },
        { period: 2, term: 2, startDate: '2027-02-15', endDate: '2027-03-19' },
      ]);
    });

    it('guardar un cuatrimestre reemplaza sus fechas sin tocar los demás', () => {
      const data = source('demo-1');
      data.saveCalendar(2, terms);
      data.saveCalendar(2, [terms[0]!, { startDate: '', endDate: '' }, { startDate: '', endDate: '' }]);
      const { calendar } = data.getSnapshot();
      expect(calendar.filter((entry) => entry.period === 2)).toHaveLength(1);
      expect(calendar.filter((entry) => entry.period === 1)).toHaveLength(3);
    });

    it('rechaza fechas que se enciman con otro cuatrimestre', () => {
      const data = source('demo-1');
      const [first] = data.getSnapshot().calendar;
      expect(() =>
        data.saveCalendar(2, [
          { startDate: first!.startDate, endDate: first!.endDate },
          { startDate: '', endDate: '' },
          { startDate: '', endDate: '' },
        ]),
      ).toThrow('se encima');
    });
  });

  it('una actividad de clase guarda su parcial y rechaza uno de otra materia', () => {
    const data = source('demo-1');
    const input = {
      subjectId: 'IDSE-05010103',
      termId: 'IDSE-05010103-p2',
      topic: '',
      date: '2026-10-08',
      title: 'Práctica',
      objective: '',
      instructions: '',
    };
    const id = data.createActivity(input);
    expect(data.getSnapshot().activities.find((a) => a.id === id)?.termId).toBe('IDSE-05010103-p2');
    expect(() => data.createActivity({ ...input, termId: 'IDSE-05010104-p1' })).toThrow('no pertenece');
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

  describe('mensajes: responder, editar, eliminar y reaccionar', () => {
    const at = (minutes: number) => new Date(2026, 9, 8, 12, minutes);
    function clocked() {
      let now = at(0);
      const data = new DemoDataSource(createDemoState(at(0)), 'demo-2', () => now);
      return { data, tick: (minutes: number) => (now = at(minutes)) };
    }

    it('responde a un mensaje del mismo canal y no a uno de otra conversación', () => {
      const { data } = clocked();
      const id = data.sendGroupMessage('Va', 'g9');
      expect(data.getSnapshot().groupMessages.find((m) => m.id === id)?.replyToId).toBe('g9');
      expect(() => data.sendGroupMessage('x', 'd1')).toThrow('ya no está');
      expect(() => data.sendDirectMessage('c1', 'x', 'g9')).toThrow('ya no está');
    });

    it('edita solo lo propio y durante 15 minutos', () => {
      const { data, tick } = clocked();
      const id = data.sendGroupMessage('Hola');
      data.editMessage('group', id, 'Hola a todos');
      expect(data.getSnapshot().groupMessages.find((m) => m.id === id)).toMatchObject({
        text: 'Hola a todos',
      });
      expect(() => data.editMessage('group', 'g9', 'x')).toThrow('Solo puedes editar');
      tick(16);
      expect(() => data.editMessage('group', id, 'Tarde')).toThrow('15 minutos');
    });

    it('elimina para todos; en un 1 a 1 nadie más puede, en el canal un administrador sí', () => {
      const { data } = clocked();
      data.setViewer('demo-3');
      expect(() => data.deleteMessage('direct', 'd1')).toThrow('Solo quien lo envió');
      expect(() => data.deleteMessage('group', 'g9')).toThrow('Solo quien lo envió');
      data.setViewer('demo-1');
      expect(() => data.deleteMessage('direct', 'd1')).toThrow('no participas');
      data.deleteMessage('group', 'g10');
      const g10 = data.getSnapshot().groupMessages.find((m) => m.id === 'g10');
      expect(g10).toMatchObject({ text: '', deletedBy: 'demo-1' });
      expect(data.getSnapshot().reactions.some((r) => r.messageId === 'g10')).toBe(false);
      expect(() => data.toggleReaction('group', 'g10', '👍')).toThrow('eliminado');
    });

    it('una reacción por persona: la misma la quita y otra la cambia', () => {
      const { data } = clocked();
      const mine = () =>
        data.getSnapshot().reactions.filter((r) => r.messageId === 'g9' && r.memberId === 'demo-2');
      data.toggleReaction('group', 'g9', '👍');
      data.toggleReaction('group', 'g9', '😂');
      expect(mine().map((r) => r.emoji)).toEqual(['😂']);
      data.toggleReaction('group', 'g9', '😂');
      expect(mine()).toHaveLength(0);
      expect(() => data.toggleReaction('group', 'g9', '🍕')).toThrow('no está disponible');
    });

    it('las reacciones de un 1 a 1 solo las ven sus participantes', () => {
      const { data } = clocked();
      data.toggleReaction('direct', 'd1', '❤️');
      expect(data.getSnapshot().reactions.some((r) => r.messageId === 'd1')).toBe(true);
      data.setViewer('demo-1');
      expect(data.getSnapshot().reactions.some((r) => r.messageId === 'd1')).toBe(false);
    });
  });

  describe('stickers y comandos', () => {
    const png = () =>
      new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
        'a.png',
      );

    it('un paquete importado es privado hasta compartirlo', async () => {
      const data = source('demo-1');
      const packId = await data.importStickers('Mío', [png()]);
      const sticker = data.getSnapshot().stickers.find((s) => s.packId === packId);
      expect(sticker).toMatchObject({ contentType: 'image/png' });
      data.setViewer('demo-3');
      expect(data.getSnapshot().stickerPacks.some((p) => p.id === packId)).toBe(false);
      expect(() => data.sendGroupMessage(`[[sticker:${sticker?.id}]]`)).toThrow(
        'no está disponible',
      );
      expect(() => data.setStickerPackShared(packId, true)).toThrow('Solo quien importó');
      data.setViewer('demo-1');
      data.setStickerPackShared(packId, true);
      data.setViewer('demo-3');
      data.sendGroupMessage(`[[sticker:${sticker?.id}]]`);
      // Quitado el paquete, el sticker enviado se sigue viendo en el canal.
      data.setViewer('demo-1');
      data.removeStickerPack(packId);
      expect(data.getSnapshot().stickerPacks.some((p) => p.id === packId)).toBe(false);
      expect(data.getSnapshot().stickers.some((s) => s.id === sticker?.id)).toBe(true);
    });

    it('rechaza archivos que no son imágenes', async () => {
      const data = source('demo-1');
      await expect(data.importStickers('X', [new File(['<svg/>'], 'a.svg')])).rejects.toThrow(
        'no es una imagen',
      );
      await expect(data.importStickers('X', [])).rejects.toThrow('al menos un sticker');
    });

    it('los comandos propios son privados y no repiten nombre', () => {
      const data = source('demo-1');
      expect(data.getSnapshot().chatCommands.map((c) => c.name)).toEqual(['repo']);
      expect(() => data.saveChatCommand({ name: 'Repo', description: '', text: 'x' })).toThrow(
        'Ya tienes',
      );
      expect(() => data.saveChatCommand({ name: 'tarea', description: '', text: 'x' })).toThrow(
        'ya es un comando',
      );
      const id = data.saveChatCommand({ name: '/Saludo', description: 'Hola', text: '¡Hola!' });
      expect(data.getSnapshot().chatCommands.find((c) => c.id === id)?.name).toBe('saludo');
      data.setViewer('demo-2');
      expect(data.getSnapshot().chatCommands).toHaveLength(0);
      expect(() => data.removeChatCommand(id)).toThrow('no existe');
    });
  });
});

describe('guías de estudio', () => {
  const LOGICA = 'IDSE-05010103';
  const input = {
    subjectId: LOGICA,
    termId: `${LOGICA}-p1`,
    title: 'Guía nueva de prueba',
    topicsText: 'Tema A\nTema B',
    sections: ['Objetivo de prueba'],
  };

  it('crea la guía con sus fuentes pendientes y sin repetirlas', () => {
    const data = source('demo-1');
    const id = data.createGuide(input, [
      { kind: 'tarea', refId: 't1' },
      { kind: 'trabajo', refId: 'w1' },
      { kind: 'tarea', refId: 't1' },
    ]);
    const snap = data.getSnapshot();
    const guide = snap.guides.find((g) => g.id === id)!;
    expect(guide.topics).toEqual(['Tema A', 'Tema B']);
    expect(guide.sections).toHaveLength(8);
    const sources = snap.guideSources.filter((s) => s.guideId === id);
    expect(sources).toHaveLength(2);
    expect(sources.every((s) => s.status === 'pending' && s.reason)).toBe(true);
    expect(sources.find((s) => s.refId === 't1')?.sourceVersion).toBe(3);
  });

  it('rechaza fuentes de otra materia y notas personales', () => {
    const data = source('demo-1');
    expect(() => data.createGuide(input, [{ kind: 'tarea', refId: 't2' }])).toThrow('misma materia');
    expect(() => data.createGuide(input, [{ kind: 'nota', refId: 'n2' }])).toThrow('no es del grupo');
  });

  it('una fuente pendiente dice por qué y solo cubre temas del temario', () => {
    const data = source('demo-1');
    expect(() =>
      data.updateGuideSource('gs5', { status: 'pending', reason: ' ', topics: [] }),
    ).toThrow('Di por qué');
    expect(() =>
      data.updateGuideSource('gs5', { status: 'processed', reason: '', topics: ['Otro tema'] }),
    ).toThrow('temario');
    data.updateGuideSource('gs5', {
      status: 'processed',
      reason: 'queda vacía',
      topics: ['Tema de prueba 3'],
    });
    const updated = data.getSnapshot().guideSources.find((s) => s.id === 'gs5')!;
    expect(updated).toMatchObject({ status: 'processed', reason: '', topics: ['Tema de prueba 3'] });
  });

  it('toma la versión nueva de una fuente que cambió', () => {
    const data = source('demo-1');
    data.refreshGuideSource('gs1');
    expect(data.getSnapshot().guideSources.find((s) => s.id === 'gs1')?.sourceVersion).toBe(3);
  });

  it('al quitar un tema del temario deja de contar en las fuentes', () => {
    const data = source('demo-3');
    const guide = data.getSnapshot().guides.find((g) => g.id === 'gd1')!;
    data.updateGuide('gd1', {
      subjectId: guide.subjectId,
      termId: guide.termId,
      title: guide.title,
      topicsText: 'Tema de prueba 1',
      sections: guide.sections,
    });
    const snap = data.getSnapshot();
    expect(snap.guides.find((g) => g.id === 'gd1')).toMatchObject({ version: 3, updatedBy: 'demo-3' });
    expect(snap.guideSources.find((s) => s.id === 'gs2')?.topics).toEqual(['Tema de prueba 1']);
  });

  it('la revisa un compañero, no quien guardó la versión', () => {
    const data = source('demo-2');
    expect(() => data.reviewGuide('gd1', 'approved', '')).toThrow('otro compañero');
    data.setViewer('demo-4');
    expect(() => data.reviewGuide('gd1', 'changes', '')).toThrow('Di qué cambios');
    data.reviewGuide('gd1', 'approved', '');
    data.reviewGuide('gd1', 'changes', 'Falta un ejemplo.');
    const mine = data
      .getSnapshot()
      .guideReviews.filter((r) => r.reviewerId === 'demo-4' && r.guideVersion === 2);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.verdict).toBe('changes');
  });
});
