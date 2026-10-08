import { describe, expect, it } from 'vitest';
import { isWorkKind, WORK_KIND_GROUPS, WORK_KINDS, workKindGroup } from './workKinds';

describe('tipos de trabajo', () => {
  it('cada tipo pertenece a una sola familia', () => {
    const grouped = WORK_KIND_GROUPS.flatMap((g) => [...g.kinds]);
    expect([...grouped].sort()).toEqual([...WORK_KINDS].sort());
  });

  it('separa tareas y actividades de exposiciones y exámenes', () => {
    expect(WORK_KINDS.map(workKindGroup)).toEqual([
      'tareas-actividades',
      'tareas-actividades',
      'exposiciones-examenes',
      'exposiciones-examenes',
    ]);
  });

  it('rechaza tipos desconocidos', () => {
    expect(isWorkKind('examen')).toBe(true);
    expect(isWorkKind('proyecto')).toBe(false);
  });
});
