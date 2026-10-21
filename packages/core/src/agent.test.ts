import { describe, expect, it } from 'vitest';
import { agentName, agentOwnerName, renderAgentPremises } from './agent';

describe('nombre automático del agente', () => {
  it('usa la primera palabra del nombre de la cuenta', () => {
    expect(agentName({ id: '1', displayName: '  Luis   Flores ' })).toBe('Luis_BOT');
    expect(agentName({ id: '1', displayName: 'Ñandú Pérez' })).toBe('Ñandú_BOT');
    expect(agentName({ id: '1', displayName: 'Ana-María' })).toBe('AnaMaría_BOT');
    expect(agentName({ id: '1', displayName: '' })).toBe('Miembro_BOT');
  });
  it('desempata con iniciales y, si persiste, con el orden de llegada', () => {
    const members = [{ id: '1', displayName: 'Luis Flores', joinedAt: new Date(1) }, { id: '2', displayName: 'Luis García', joinedAt: new Date(2) }, { id: '3', displayName: 'Luis Fuentes', joinedAt: new Date(3) }, { id: '4', displayName: 'Ana' }];
    expect(members.map((m) => agentName(m, members))).toEqual(['Luis_F1_BOT', 'Luis_G_BOT', 'Luis_F2_BOT', 'Ana_BOT']);
    const demo = [1, 2].map((n) => ({ id: `demo-${n}`, displayName: `Alumno de prueba ${n}` }));
    expect(demo.map((m) => agentName(m, demo))).toEqual(['Alumno_DP1_BOT', 'Alumno_DP2_BOT']);
  });
  it('sustituye NOMBRE y NOMBRE_BOT en las trece premisas literales', () => {
    const premises = renderAgentPremises(agentOwnerName('Luis Flores'), 'Luis_BOT');
    expect(premises.does).toHaveLength(7); expect(premises.doesNot).toHaveLength(6);
    expect(premises.does[0]!.text).toBe('Soy Luis_BOT, el agente personal de Luis. Solo trabajo para la persona dueña de esta cuenta y solo con su clave de Gemini.');
    expect(premises.doesNot[0]).toEqual({ number: 8, text: 'No entrego, publico ni subo tareas por mi cuenta. Publicar o entregar siempre es una acción expresa de Luis.' });
    expect(JSON.stringify(premises)).not.toContain('NOMBRE');
  });
});
