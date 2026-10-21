import { describe, expect, it } from 'vitest';
import { AGENT_ORIGINALITY_DEFAULTS, compareWithPublished, describeStyle, originalityThresholds, proseSentences, similarity, splitProse, styleFeatures } from './agentStyle';

const essay = 'Un ciclo while repite instrucciones mientras su condición sea verdadera. Si el índice nunca cambia, el ciclo no termina y el programa se queda congelado. Por eso conviene revisar el incremento antes de ejecutar. En mi práctica aprendí a imprimir el índice para ver cómo avanza.';
const other = 'Las listas enlazadas guardan nodos con una referencia al siguiente elemento. Insertar al inicio es rápido porque solo se cambia la cabeza. Buscar un valor obliga a recorrer los nodos uno por uno hasta encontrarlo.';

describe('métricas de estilo', () => {
  it('mide oraciones, primera persona, listas y vocabulario conservando acentos', () => {
    const f = styleFeatures([essay, '- Paso uno de prueba\n- Paso dos de prueba']);
    expect(f.sentences).toBe(6); expect(f.firstPerson).toBeCloseTo(1 / 6);
    expect(f.listLines).toBe(2); expect(f.codeLines).toBe(0);
    expect(f.vocabulary).toContain('índice'); expect(f.vocabulary).not.toContain('indice');
    expect(describeStyle(f)).toEqual({ tone: 'Impersonal y descriptivo', structure: 'Usa listas y pasos numerados', technical: 'Explica con lenguaje cotidiano' });
  });
  it('separa el código de la prosa para que no altere el largo de frase', () => {
    const text = 'Mi solución usa un ciclo for sencillo.\n```js\nfor (let i = 0; i < 3; i++) {\n  console.log(i);\n}\n```\nconst total = suma(a, b);\nTambién probé con `while (true)` y no terminaba.';
    const { prose, code } = splitProse(text);
    expect(code).toHaveLength(4); expect(prose).not.toContain('console'); expect(prose).not.toContain('while (true)');
    const f = styleFeatures([text]);
    expect(f.codeLines).toBe(4); expect(f.sentences).toBe(2); expect(describeStyle(f).technical).toBe('Incluye código o notación técnica');
    expect(describeStyle(f).tone).toBe('Cercano, en primera persona');
  });
  it('no cuenta fragmentos de menos de tres palabras como oraciones', () => {
    expect(proseSentences('Hola. Muy bien. Esta sí es una oración completa.')).toEqual(['Esta sí es una oración completa.']);
    expect(styleFeatures([]).sentenceLength).toBe(0);
  });
});

describe('umbrales de originalidad', () => {
  it('usa valores por omisión y valida combinaciones', () => {
    expect(originalityThresholds()).toEqual(AGENT_ORIGINALITY_DEFAULTS);
    expect(originalityThresholds({ warn: 10 }).warn).toBe(10);
    expect(() => originalityThresholds({ warn: 60, block: 60 })).toThrow();
    expect(() => originalityThresholds({ shingleSize: 2 })).toThrow();
    expect(() => originalityThresholds({ minWords: 3 })).toThrow();
    expect(() => originalityThresholds({ warn: 12.5 })).toThrow();
  });
});

describe('comparación de parecido', () => {
  it('da 100 % a una copia aunque cambien mayúsculas, acentos y puntuación', () => {
    const r = similarity(essay, essay.toUpperCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('.', ';'));
    expect(r).toMatchObject({ status: 'compared', score: 100, level: 'block' });
  });
  it('no confunde prosa que termina en punto y coma con código', () => {
    expect(splitProse('Primero revisé el índice; después cambié la condición;').code).toEqual([]);
  });
  it('no alerta entre textos de temas distintos', () => {
    expect(similarity(essay, other)).toMatchObject({ status: 'compared', score: 0, jaccard: 0, level: 'ok', pairs: [] });
  });
  it('detecta una oración copiada dentro de un texto propio y la empareja', () => {
    const copied = `${other} Si el índice nunca cambia, el ciclo no termina y el programa se queda congelado.`;
    const r = similarity(copied, essay);
    expect(r.level).toBe('warn'); expect(r.score).toBeLessThan(AGENT_ORIGINALITY_DEFAULTS.warn);
    expect(r.pairs).toEqual([{ mine: 'Si el índice nunca cambia, el ciclo no termina y el programa se queda congelado.', theirs: 'Si el índice nunca cambia, el ciclo no termina y el programa se queda congelado.', ratio: 1 }]);
  });
  it('ignora el texto de la consigna que ambos citan', () => {
    const instructions = 'Explica qué pasa cuando la condición de un ciclo while nunca deja de cumplirse en un programa.';
    const a = `${instructions} Yo lo comprobé con un contador que olvidé incrementar y la consola se llenó de mensajes repetidos sin parar nunca.`;
    const b = `${instructions} Para mí el problema aparece cuando el valor que controla la condición se queda fijo durante toda la ejecución del programa.`;
    expect(similarity(a, b).score).toBeGreaterThan(30);
    const r = similarity(a, b, { ignore: [instructions] });
    expect(r).toMatchObject({ score: 0, level: 'ok' }); expect(r.excluded.instructionGroups).toBeGreaterThan(0);
  });
  it('ignora citas entre comillas y código idéntico', () => {
    const quote = '«Un algoritmo es una secuencia finita de pasos bien definidos que resuelve un problema»';
    const code = '```\nwhile (i < 10) {\n  i++;\n}\n```';
    const a = `Según el libro, ${quote}. Yo lo entiendo como una receta que siempre termina y que cualquiera puede seguir sin adivinar nada, igual que las instrucciones para armar un mueble en casa.\n${code}`;
    const b = `El profesor citó ${quote}. Para mí significa que cada instrucción debe ser clara y que el proceso tiene un final conocido de antemano, aunque los datos de entrada cambien cada vez.\n${code}`;
    const r = similarity(a, b);
    expect(r).toMatchObject({ score: 0, level: 'ok', excluded: { codeLines: 3, quotes: 1 } });
  });
  it('en textos muy cortos no da porcentaje, pero sí señala una oración copiada', () => {
    const r = similarity('El ciclo no termina porque el índice nunca cambia.', 'Creo que el ciclo no termina porque el índice nunca cambia.');
    expect(r).toMatchObject({ status: 'too_short', score: null, level: 'warn' }); expect(r.pairs).toHaveLength(1);
    expect(similarity('El ciclo termina pronto aquí.', other)).toMatchObject({ status: 'too_short', level: 'ok', pairs: [] });
    expect(similarity('Sí, claro.', essay)).toMatchObject({ status: 'nothing_to_compare', level: 'ok' });
  });
  it('respeta umbrales configurados y ordena los resultados por nivel y porcentaje', () => {
    const half = `${essay} ${other}`;
    expect(similarity(half, essay).level).toBe('warn');
    expect(similarity(half, essay, { thresholds: { warn: 20, block: 40 } }).level).toBe('block');
    const ranked = compareWithPublished(essay, [{ id: 'otro', text: other }, { id: 'mitad', text: `${essay.slice(0, 120)} ${other}` }, { id: 'copia', text: essay }]);
    expect(ranked.map((r) => r.id)).toEqual(['copia', 'mitad']);
  });
});
