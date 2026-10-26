import { describe, expect, it } from 'vitest';
import { estimatePresentationAiTokens, presentationAiFingerprint, validatePresentationAiResult, type PresentationAiContext } from './presentationAi';
import { presentationAudioMime, validatePresentationAudioDuration, validatePresentationAudioSize, PRESENTATION_AUDIO_LIMITS } from './presentationMedia';
const context: PresentationAiContext = { practiceId: '1', attemptId: '2', attemptVersion: 1, title: 'Funciones', topic: 'Funciones', audience: 'Clase', targetMinutes: 5, keyPoints: ['Entradas'], body: 'Explico entradas y salidas.' };
describe('Exposiciones: contratos de IA y audio', () => {
  it('identifica contexto y propósito sin recortar material', () => {
    expect(presentationAiFingerprint(context, 'outline')).not.toBe(presentationAiFingerprint(context, 'questions'));
    expect(presentationAiFingerprint(context, 'outline')).not.toBe(presentationAiFingerprint({ ...context, attemptVersion: 2 }, 'outline'));
    expect(() => validatePresentationAiResult({ outline: 'a'.repeat(30001) }, 'outline', context)).toThrow();
  });
  it('marca el esquema sin materiales como orientativo y rechaza preguntas duplicadas', () => {
    expect(validatePresentationAiResult({ outline: 'Inicio, desarrollo y cierre' }, 'outline', context)).toEqual({ outline: 'Inicio, desarrollo y cierre', orientative: true });
    expect(() => validatePresentationAiResult({ questions: ['¿Cómo?', '¿Cómo?'] }, 'questions', context)).toThrow(/distintas/);
  });
  it('exige transcripciones ordenadas dentro del audio y sin truncamiento', () => {
    const audio = { ...context, audio: { id: 'audio', bytes: 200, mime: 'audio/mpeg', sha256: 'a'.repeat(64), durationSeconds: 30 } };
    expect(validatePresentationAiResult({ segments: [{ startSeconds: 0, endSeconds: 5, text: 'Hola' }] }, 'transcription', audio)).toMatchObject({ segments: [{ text: 'Hola' }] });
    expect(() => validatePresentationAiResult({ segments: [{ startSeconds: 0, endSeconds: 33, text: 'Hola' }] }, 'transcription', audio)).toThrow(/tiempo/);
    expect(() => validatePresentationAiResult({ segments: [{ startSeconds: 5, endSeconds: 10, text: 'Hola' }, { startSeconds: 2, endSeconds: 3, text: 'Hola' }] }, 'transcription', audio)).toThrow(/tiempo/);
  });
  it('no permite comentarios de voz sin audio y conserva los campos de orientación', () => {
    const feedback = { clarity: 'Orden', examples: 'Ejemplos', decisions: 'Enfoque', limitations: 'Límite', duration: 'Tiempo', oral: [{ atSeconds: 3, comment: 'Pausa' }] };
    expect(() => validatePresentationAiResult(feedback, 'feedback', context)).toThrow(/audio/);
    expect(validatePresentationAiResult({ ...feedback, oral: [] }, 'feedback', context)).toMatchObject({ clarity: 'Orden' });
  });
  it('reserva audio dentro del presupuesto compartido y valida límites reales', () => {
    expect(estimatePresentationAiTokens({ ...context, audio: { id: 'audio', bytes: 200, mime: 'audio/mpeg', sha256: 'a'.repeat(64), durationSeconds: 1200 } })).toBeGreaterThan(38_400);
    expect(() => validatePresentationAudioDuration(1200)).not.toThrow(); expect(() => validatePresentationAudioDuration(1201)).toThrow(/20 minutos/);
    expect(() => validatePresentationAudioDuration(Infinity)).toThrow(); expect(() => validatePresentationAudioSize(PRESENTATION_AUDIO_LIMITS.bytes + 1)).toThrow(/10 MiB/);
    expect(presentationAudioMime('audio/webm;codecs=opus')).toBe('audio/webm'); expect(presentationAudioMime('video/mp4')).toBe('audio/mp4'); expect(() => presentationAudioMime('text/plain')).toThrow();
  });
});
