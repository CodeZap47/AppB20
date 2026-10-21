import { describe, expect, it } from 'vitest';
import { AI_LIMITS, aiHash, aiSourceFingerprint, buildAiPreparation, sanitizeAiText,
  validateAiPrepareInput, type AiSourceSnapshot, type AiPrepareInput } from './ai';
import { validateAiQuestionDraft } from './exam';

const id = 'd2efcc50-310e-4711-8a5e-57fe49b2a70a';
const input: AiPrepareInput = { subjectId: '1', termId: '2', topics: ['Ciclos'],
  sources: [{ kind: 'note', refId: '3', topics: ['Ciclos'], includeUnplaced: false }] };
const source: AiSourceSnapshot = { kind: 'note', refId: '3', subjectId: '1', termId: '2', version: 1,
  title: 'Ciclos', visibility: 'group', fields: [{ name: 'body', text: 'Un ciclo repite instrucciones.' }] };
const prepare = (data = input, material = [source]) => buildAiPreparation(data, material, { id, model: 'test-model', now: 1000 });

describe('preparación IA de contenido académico autorizado', () => {
  it('conserva IDs grandes y produce huellas canónicas y vencimiento estable', () => {
    expect(validateAiPrepareInput({ ...input, subjectId: '18446744073709551615' }).subjectId).toBe('18446744073709551615');
    expect(() => validateAiPrepareInput({ ...input, subjectId: '18446744073709551616' })).toThrow();
    expect(aiHash({ a: 1, b: 2 })).toBe(aiHash({ b: 2, a: 1 }));
    const result = prepare();
    expect(result.canGenerate).toBe(true);
    expect(result.expiresAt).toBe(1000 + AI_LIMITS.preparationTtlMs);
    expect(result.fragments[0]?.origins[0]).toMatchObject({ kind: 'note', refId: '3', field: 'body', startLine: 1, endLine: 1 });
    expect(prepare().fingerprint).toBe(result.fingerprint);
  });
  it('rechaza fuentes duplicadas, temas inválidos e IDs del cliente', () => {
    expect(() => prepare({ ...input, sources: [...input.sources, ...input.sources] })).toThrow('No repitas fuentes');
    expect(() => prepare({ ...input, sources: [{ ...input.sources[0]!, refId: '-1' }] })).toThrow();
    expect(() => prepare({ ...input, sources: [{ ...input.sources[0]!, topics: ['Otro'] }] })).toThrow();
    expect(() => prepare(input, [])).toThrow('no está disponible');
  });
  it('no asigna parcial automáticamente ni cubre temas sin contenido', () => {
    const unplaced = { ...source, termId: undefined };
    expect(prepare(input, [unplaced]).sources[0]?.status).toBe('pending');
    expect(prepare(input, [unplaced]).canGenerate).toBe(false);
    expect(prepare({ ...input, sources: [{ ...input.sources[0]!, includeUnplaced: true }] }, [unplaced]).canGenerate).toBe(true);
    expect(prepare({ ...input, topics: ['Ciclos', 'Objetos'] }).canGenerate).toBe(false);
    expect(prepare(input, [{ ...source, fields: [] }]).sources[0]?.status).toBe('failed');
  });
  it('rechaza otra materia o parcial, y huella incluye contexto y clasificación del padre', () => {
    expect(() => prepare(input, [{ ...source, subjectId: '9' }])).toThrow('cambió');
    expect(() => prepare(input, [{ ...source, termId: '9' }])).toThrow('cambió');
    expect(aiSourceFingerprint({ ...source, context: 'parent-version:1' })).not.toBe(aiSourceFingerprint({ ...source, context: 'parent-version:2' }));
    expect(aiSourceFingerprint(source)).not.toBe(aiSourceFingerprint({ ...source, visibility: 'personal' }));
  });
  it('redacta datos evidentes sin alterar texto académico ni enviarlo a un servicio', () => {
    const text = 'Escribe a persona@example.test; api_key=secret-value; for (let i=0;i<3;i++)';
    const result = prepare(input, [{ ...source, fields: [{ name: 'body', text }] }]);
    expect(result.fragments[0]?.text).not.toContain('persona@example.test');
    expect(result.fragments[0]?.text).not.toContain('secret-value');
    expect(result.fragments[0]?.text).toContain('for (let i=0;i<3;i++)');
    expect(sanitizeAiText('-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----')).toBe('[clave retirada]');
  });
  it('deduplica texto exacto manteniendo ambas procedencias y cobertura', () => {
    const second: AiSourceSnapshot = { ...source, kind: 'guide', refId: '8', origins: [{ kind: 'note', refId: '3', version: 1 }] };
    const result = prepare({ ...input, sources: [...input.sources, { kind: 'guide', refId: '8', topics: ['Ciclos'], includeUnplaced: false }] }, [source, second]);
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0]?.origins).toHaveLength(2);
    expect(result.coverage[0]?.sourceIds).toEqual(['note:3', 'guide:8']);
    expect(result.sources[1]?.origins).toEqual(second.origins);
  });
  it('limita tamaño y expone omisiones sin truncamiento silencioso', () => {
    expect(() => prepare(input, [{ ...source, fields: [{ name: 'body', text: 'a'.repeat(40001) }] }])).toThrow('no se ha truncado');
    const result = prepare(input, [{ ...source, omissions: ['Adjuntos omitidos en EX-1.'] }]);
    expect(result.omissions).toContain('note:3: Adjuntos omitidos en EX-1.');
  });
  it('fija modelo y configuración de preguntas en la huella de la vista previa', () => {
    expect(prepare().config.questionCount).toBe(10);
    const next = prepare({ ...input, config: { questionCount: 1, types: ['single'], difficulty: 'basic' } });
    expect(next.fingerprint).not.toBe(prepare().fingerprint);
    expect(buildAiPreparation(input, [source], { id, model: 'other-model', now: 1000 }).fingerprint).not.toBe(prepare().fingerprint);
  });
});

describe('contrato de preguntas cerradas generadas', () => {
  const config = { questionCount: 1, types: ['single' as const], difficulty: 'basic' as const };
  const draft = () => ({ questions: [{ id: 'q1', type: 'single', text: '¿Qué hace un ciclo?',
    options: [{ id: 'a', text: 'Repetir' }, { id: 'b', text: 'Borrar' }, { id: 'c', text: 'Cerrar' }, { id: 'd', text: 'Enviar' }],
    correctOptionId: 'a', explanation: 'Repite instrucciones.', topic: 'Ciclos', citations: [prepare().fragments[0]!.id] }] });
  it('acepta una pregunta con respuesta y evidencia seleccionada', () => {
    expect(validateAiQuestionDraft(draft(), prepare(), config).questions[0]?.correctOptionId).toBe('a');
  });
  it('rechaza citas inventadas, opciones repetidas, conteos y temas fuera del alcance', () => {
    const invalidCitation = draft(); invalidCitation.questions[0]!.citations = ['inventado'];
    expect(() => validateAiQuestionDraft(invalidCitation, prepare(), config)).toThrow();
    const repeated = draft(); repeated.questions[0]!.options[1]!.id = 'a';
    expect(() => validateAiQuestionDraft(repeated, prepare(), config)).toThrow();
    const outside = draft(); outside.questions[0]!.topic = 'Objetos';
    expect(() => validateAiQuestionDraft(outside, prepare(), config)).toThrow();
    expect(() => validateAiQuestionDraft({ questions: [] }, prepare(), config)).toThrow();
  });
  it('verdadero/falso exige dos opciones correspondientes a sus valores', () => {
    const question = { ...draft().questions[0]!, type: 'boolean', options: [{ id: 'yes', text: 'Verdadero' }, { id: 'no', text: 'Falso' }], correctOptionId: 'yes' };
    const booleanConfig = { ...config, types: ['boolean' as const] };
    expect(validateAiQuestionDraft({ questions: [question] }, prepare(), booleanConfig).questions[0]?.type).toBe('boolean');
    expect(() => validateAiQuestionDraft({ questions: [{ ...question, options: [{ id: 'yes', text: 'Manzana' }, { id: 'no', text: 'Pera' }] }] }, prepare(), booleanConfig)).toThrow();
  });
});
