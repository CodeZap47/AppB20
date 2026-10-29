import { describe, expect, it } from 'vitest';
import { availableFeedCreateActions, MODULES, type ModuleInfo } from './modules';

describe('Creaciones del feed declaradas por módulo', () => {
  it('ofrece catorce acciones únicas y conserva Tarea, Nota y Pregunta al principio', () => {
    const actions = availableFeedCreateActions();
    expect(actions.map((action) => action.id)).toEqual([
      'task', 'note', 'question', 'activity', 'guide', 'exam', 'poll', 'room', 'help', 'challenge', 'review', 'museum', 'collection', 'opportunity',
    ]);
    expect(new Set(actions.map((action) => action.id)).size).toBe(14);
    expect(actions.filter((action) => action.moduleId === 'tareas').map((action) => action.id)).toEqual(['task', 'activity']);
    expect(actions.slice(0, 3).map((action) => action.label)).toEqual(['Crear tarea', 'Compartir apunte', 'Hacer pregunta']);
    for (const action of actions) expect(MODULES.some((module) => module.id === action.moduleId)).toBe(true);
  });

  it('apunta a las creaciones públicas previstas, sin entradas personales ni eventos automáticos', () => {
    expect(Object.fromEntries(availableFeedCreateActions().map((action) => [action.id, action.path]))).toEqual({
      task: '/m/tareas/nueva', activity: '/m/actividades/nueva', note: '/m/notas/nueva?visibilidad=grupo', question: '/m/preguntas/nueva',
      guide: '/m/guias/nueva', exam: '/m/examenes/nuevo', poll: '/m/votaciones/nueva', room: '/m/salas/nueva', help: '/m/ayuda/nueva',
      challenge: '/m/retos/nuevo', review: '/m/revision-codigo/nueva', museum: '/m/museo-bugs?crear=1', collection: '/m/repaso/nueva?visibilidad=grupo', opportunity: '/m/oportunidades?crear=1',
    });
    expect(availableFeedCreateActions().some((action) => ['leaderboard', 'mensajes', 'cumpleanos', 'agente', 'senales', 'aprende-ensenando', 'exposiciones'].includes(action.moduleId))).toBe(false);
  });

  it('incorpora una acción futura solo cuando su módulo queda disponible', () => {
    const future: ModuleInfo = { id: 'futuro', title: 'Futuro', section: '9', summary: '', stage: 3, worksWithoutAi: true,
      feedCreateActions: [{ id: 'future-action', label: 'Crear futuro', path: '/m/futuro/nuevo' }] };
    expect(availableFeedCreateActions([future])).toEqual([]);
    expect(availableFeedCreateActions([{ ...future, ready: true }])).toEqual([{ ...future.feedCreateActions![0], moduleId: 'futuro' }]);
    expect(availableFeedCreateActions([{ ...future, stage: 1, ready: false }])).toHaveLength(1);
    expect(availableFeedCreateActions([{ ...future, ready: true, feedCreateActions: undefined }])).toEqual([]);
  });

  it('lee entradas readonly sin mutar ni reordenar el catálogo o sus acciones', () => {
    const modules: readonly ModuleInfo[] = Object.freeze([
      Object.freeze({ id: 'one', title: 'Uno', section: '1', summary: '', stage: 1 as const, worksWithoutAi: true,
        feedCreateActions: Object.freeze([Object.freeze({ id: 'later', label: 'Después', path: '/later' }), Object.freeze({ id: 'first', label: 'Primero', path: '/first', priority: 0 })]) }),
      Object.freeze({ id: 'two', title: 'Dos', section: '2', summary: '', stage: 1 as const, worksWithoutAi: true,
        feedCreateActions: Object.freeze([Object.freeze({ id: 'last', label: 'Último', path: '/last' })]) }),
    ]);
    const before = JSON.stringify(modules); const first = availableFeedCreateActions(modules); const second = availableFeedCreateActions(modules);
    expect(first.map((action) => action.id)).toEqual(['first', 'later', 'last']);
    expect(first).toEqual(second); expect(first).not.toBe(second); expect(first[0]).not.toBe(modules[0]!.feedCreateActions![1]);
    expect(JSON.stringify(modules)).toBe(before);
  });
});
