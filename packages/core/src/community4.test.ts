import { describe, expect, it } from 'vitest';
import { cleanMuseum, cleanOpportunity, opportunityExpired } from './community4';
const museum = { intention: 'Crear ciclo', symptom: 'No termina', cause: 'Hipótesis: índice inmóvil', correction: '', learning: 'Revisar la condición', minimalCode: 'while (i < 10) {}', evidence: '', language: 'JavaScript', topic: 'Bucles', bugType: 'Lógico', noteIds: ['1', '1'], questionIds: [] };
const opportunity = { kind: 'event', title: 'Taller', topic: 'Rust', modality: 'online', sourceUrl: 'https://example.com/event', organizer: 'Universidad', requirements: 'Inscripción', costKnown: false, cost: 'No debe guardarse' };
describe('fichas manuales de comunidad', () => {
  it('conserva hipótesis, código y referencias únicas sin requerir una corrección conocida', () => { expect(cleanMuseum(museum)).toMatchObject({ noteIds: ['1'], correction: '', minimalCode: museum.minimalCode }); });
  it('exige intención, síntoma, aprendizaje y clasificación', () => { expect(() => cleanMuseum({ ...museum, learning: '' })).toThrow('aprendizaje'); expect(() => cleanMuseum({ ...museum, language: '' })).toThrow('lenguaje'); });
  it('no acepta referencias excesivas ni código ilimitado', () => { expect(() => cleanMuseum({ ...museum, minimalCode: 'x'.repeat(12001) })).toThrow('12000'); expect(() => cleanMuseum({ ...museum, noteIds: ['-1'] })).toThrow('Referencias'); });
  it('coste desconocido es explícito y no almacena texto contradictorio', () => { expect(cleanOpportunity(opportunity)).toMatchObject({ costKnown: false, cost: '' }); expect(() => cleanOpportunity({ ...opportunity, costKnown: true, cost: '' })).toThrow('costo'); });
  it.each(['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com', 'https://example.com\\@evil.test'])('rechaza fuentes %s', (sourceUrl) => { expect(() => cleanOpportunity({ ...opportunity, sourceUrl })).toThrow('HTTPS'); });
  it('valida modalidad, calendario real y vencimiento por instante', () => { expect(() => cleanOpportunity({ ...opportunity, modality: 'future' })).toThrow('modalidad'); expect(() => cleanOpportunity({ ...opportunity, deadline: '2026-02-30T12:00:00Z' })).toThrow('fecha'); expect(opportunityExpired({ deadline: '2026-10-21T12:00:00Z' }, new Date('2026-10-21T12:00:00Z'))).toBe(true); expect(opportunityExpired({}, new Date())).toBe(false); });
});
