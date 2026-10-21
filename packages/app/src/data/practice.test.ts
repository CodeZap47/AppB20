import { describe, expect, it, vi } from 'vitest';
import { DemoPracticeStore } from './demoPractice';
import type { Member } from './types';
const challenge = { requestId: 'challenge', subjectId: 'ALG1', title: 'Sumar', topic: 'Listas', difficulty: 'basic' as const, objective: 'Recorrer', instructions: 'Suma elementos', examples: '[1,2] → 3', hints: ['Recorre', 'Acumula'] };
const review = { requestId: 'review', subjectId: 'ALG1', title: 'Bucle', language: 'TypeScript', summary: 'Revisar límites', code: '  first()\nsecond()', repositoryUrl: '' };
function setup() {
  const state = { subjects: [{ id: 'ALG1' }] }; const me = { id: 'alice', status: 'active' } as Member; let count = 0; const emit = vi.fn();
  const context = (who: Member) => ({ state: () => state, active: () => { if (who.status !== 'active') throw new Error('Tu membresía no está activa.'); return who; }, now: () => new Date('2026-10-21T12:00:00Z'), id: () => `id${++count}`, emit });
  const owner = new DemoPracticeStore(context(me)); const peer = new DemoPracticeStore(context({ id: 'bob', status: 'active' } as Member));
  return { owner, peer, emit, me };
}
describe('Demo Retos y revisión: sesiones compartidas y permisos', () => {
  it('no entrega pistas bloqueadas ni el progreso de otra persona y reintenta el mismo paso sin saltos', () => {
    const s = setup(); const id = s.owner.createCodingChallenge(challenge); expect(s.peer.snapshot().challengeHints).toEqual([]); expect(s.owner.snapshot().challengeHints).toHaveLength(2);
    s.peer.unlockChallengeHint(id, 0); s.peer.unlockChallengeHint(id, 0); expect(s.peer.snapshot().challengeHints).toHaveLength(1); expect(s.owner.snapshot().challengeProgress[0]?.unlockedHints).toBe(0);
    s.peer.unlockChallengeHint(id, 1); expect(s.peer.snapshot().challengeHints).toHaveLength(2); const snapshot = s.peer.snapshot(); snapshot.challengeHints[0]!.body = 'Manipulado'; expect(s.peer.snapshot().challengeHints[0]!.body).toBe('Recorre');
  });
  it('crea una sola vez por autor y requiere explicación para soluciones compartidas', () => {
    const s = setup(); const id = s.owner.createCodingChallenge(challenge); expect(s.owner.createCodingChallenge(challenge)).toBe(id); expect(() => s.owner.createCodingChallenge({ ...challenge, title: 'Reintento' })).toThrow(/otro contenido/); expect(s.owner.snapshot().codingChallenges).toHaveLength(1);
    expect(() => s.peer.saveChallengeSolution({ challengeId: id, body: 'x', explanation: '', expectedVersion: 0, requestId: 's' })).toThrow();
    s.peer.saveChallengeSolution({ challengeId: id, body: 'x', explanation: 'Porque suma', expectedVersion: 0, requestId: 's' }); s.peer.saveChallengeSolution({ challengeId: id, body: 'x', explanation: 'Porque suma', expectedVersion: 0, requestId: 's' }); expect(s.owner.snapshot().challengeSolutions).toHaveLength(1);
    expect(() => s.peer.saveChallengeSolution({ challengeId: id, body: 'y', explanation: 'Cambio', expectedVersion: 0, requestId: 's2' })).toThrow();
  });
  it('solo el autor cierra y la conclusión impide nuevas soluciones y comentarios', () => {
    const s = setup(); const id = s.owner.createCodingChallenge(challenge); expect(() => s.peer.closeCodingChallenge(id, 'Listo', 1)).toThrow(); expect(() => s.owner.closeCodingChallenge(id, '', 1)).toThrow(); s.owner.closeCodingChallenge(id, 'Aprendimos acumulación', 1);
    expect(() => s.peer.addChallengeComment({ challengeId: id, body: 'Comentario', requestId: 'c' })).toThrow(/cerrada/); expect(() => s.peer.saveChallengeSolution({ challengeId: id, body: 'x', explanation: 'x', expectedVersion: 0, requestId: 's' })).toThrow(/cerrada/);
  });
  it('las versiones son inmutables y cada comentario conserva sus líneas originales', () => {
    const s = setup(); const id = s.owner.createCodeReview(review); s.peer.addCodeReviewComment({ reviewId: id, versionNumber: 1, lineStart: 2, lineEnd: 2, kind: 'error', body: 'Fuera de rango', requestId: 'c' });
    s.owner.addCodeReviewVersion({ reviewId: id, expectedVersion: 1, code: 'new()', repositoryUrl: '', summary: 'Corregido', requestId: 'v2' }); s.owner.addCodeReviewVersion({ reviewId: id, expectedVersion: 1, code: 'new()', repositoryUrl: '', summary: 'Corregido', requestId: 'v2' });
    expect(s.peer.snapshot().codeReviewVersions).toHaveLength(2); expect(s.peer.snapshot().codeReviewVersions[0]?.code).toBe(review.code); expect(s.peer.snapshot().codeReviewComments[0]?.versionNumber).toBe(1); expect(() => s.peer.addCodeReviewComment({ reviewId: id, versionNumber: 2, lineStart: 2, lineEnd: 2, kind: 'error', body: 'No existe', requestId: 'c2' })).toThrow();
    expect(() => s.owner.addCodeReviewVersion({ reviewId: id, expectedVersion: 1, code: 'stale()', repositoryUrl: '', summary: 'x', requestId: 'v3' })).toThrow(); expect(() => s.peer.addCodeReviewVersion({ reviewId: id, expectedVersion: 2, code: 'hack()', repositoryUrl: '', summary: 'x', requestId: 'v3' })).toThrow();
  });
  it('el autor de la revisión resuelve con explicación; el revisor no puede resolver ni cerrar', () => {
    const s = setup(); const id = s.owner.createCodeReview(review); s.peer.addCodeReviewComment({ reviewId: id, versionNumber: 1, lineStart: 0, lineEnd: 0, kind: 'suggestion', body: 'Usa nombres claros', requestId: 'c' }); const comment = s.owner.snapshot().codeReviewComments[0]!;
    expect(() => s.peer.resolveCodeReviewComment(comment.id, 'applied', 'x', 1)).toThrow(); expect(() => s.owner.resolveCodeReviewComment(comment.id, 'dismissed', '', 1)).toThrow();
    s.owner.resolveCodeReviewComment(comment.id, 'applied', 'Renombré el contador en v2', 1); expect(s.peer.snapshot().codeReviewComments[0]?.resolution).toContain('v2'); expect(() => s.peer.closeCodeReview(id, 1)).toThrow(); s.owner.closeCodeReview(id, 1); expect(() => s.peer.addCodeReviewComment({ reviewId: id, versionNumber: 1, lineStart: 0, lineEnd: 0, kind: 'question', body: 'x', requestId: 'late' })).toThrow();
  });
  it('una baja pierde lectura y escritura; no permite referencias a materias inexistentes', () => {
    const s = setup(); expect(() => s.owner.createCodeReview({ ...review, subjectId: 'missing' })).toThrow(); s.owner.createCodingChallenge(challenge); s.me.status = 'removed'; expect(() => s.owner.snapshot()).toThrow(); expect(() => s.owner.createCodeReview(review)).toThrow();
  });
  it('rechaza reutilizar el envío para otra revisión, solución, versión o comentario', () => {
    const s = setup(); const challengeId = s.owner.createCodingChallenge(challenge); const reviewId = s.owner.createCodeReview(review);
    expect(() => s.owner.createCodeReview({ ...review, code: 'changed()' })).toThrow(/otro contenido/);
    const solution = { challengeId, body: 'sum()', explanation: 'Acumular', expectedVersion: 0, requestId: 's' }; s.peer.saveChallengeSolution(solution); expect(() => s.peer.saveChallengeSolution({ ...solution, explanation: 'Otra explicación' })).toThrow(/otro contenido/);
    const version = { reviewId, code: 'new()', repositoryUrl: '', summary: 'Otra versión', expectedVersion: 1, requestId: 'v2' }; s.owner.addCodeReviewVersion(version); expect(() => s.owner.addCodeReviewVersion({ ...version, code: 'different()' })).toThrow(/otro contenido/);
    const comment = { reviewId, versionNumber: 1, lineStart: 0, lineEnd: 0, kind: 'question' as const, body: '¿Por qué?', requestId: 'c' }; s.peer.addCodeReviewComment(comment); s.peer.addCodeReviewComment(comment); expect(() => s.peer.addCodeReviewComment({ ...comment, body: '¿Algo distinto?' })).toThrow(/otro contenido/); expect(s.owner.snapshot().codeReviewComments).toHaveLength(1);
  });
});
