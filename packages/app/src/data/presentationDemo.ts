import { DemoPresentationFeatures } from './presentationFeatureDemo';
import {
  emptyPresentationObservations, normalizePresentationAnswer, normalizePresentationBody,
  normalizePresentationConfiguration, normalizePresentationFeedback, normalizePresentationNextSteps,
  normalizePresentationObservations, normalizePresentationQuestion, presentationGuidingQuestions,
} from '@b20/core';
import type { PresentationSourceKind } from '@b20/core';
import type { Id, Member, Note, StudyGuide, Subject, Term } from './types';
import type {
  PresentationActions, PresentationAttempt, PresentationAttemptInput, PresentationFeedbackInput,
  PresentationPractice, PresentationPracticeInput, PresentationsSnapshot,
} from './presentationTypes';

export interface PresentationDemoState extends PresentationsSnapshot {
  presentationRequests: { actorId: Id; kind: string; requestId: string; fingerprint: string; resultId: Id }[];
}
interface State extends PresentationDemoState { members: Member[]; subjects: Subject[]; terms: Term[]; notes: Note[]; guides: StudyGuide[]; }
interface Context { state(): State; active(): Member; id(): Id; now(): Date; emit(): void; sourceAvailable(kind: PresentationSourceKind, id: Id): boolean; }
export function emptyPresentationsSnapshot(): PresentationsSnapshot {
  return { presentationPractices: [], presentationAttempts: [], presentationPersonal: [], presentationQuestions: [], presentationFeedback: [] };
}
const version = (current: number, expected: number | undefined) => {
  if (current !== expected) throw new Error('La versión cambió. Actualiza la página antes de guardar.');
};
const request = (value: string) => {
  const clean = value.trim();
  if (!clean || clean.length > 120) throw new Error('La identificación del envío no es válida.');
  return clean;
};

/** Simula las mismas transacciones y vistas privadas del módulo real. */
export class DemoPresentationStore implements PresentationActions {
  readonly features: DemoPresentationFeatures;
  constructor(private ctx: Context) {
    this.features = new DemoPresentationFeatures({ actor: () => ctx.active().id, now: () => ctx.now().getTime(),
      attempt: (id, own) => { const { row, practice } = this.attempt(id, own); return { attempt: row, practice }; },
      applyOutline: (id, body, expected) => { const { row } = this.attempt(id, true); version(row.version, expected); if (row.status !== 'draft') throw new Error('El intento ya está concluido.'); row.body = body; row.version++; row.updatedAt = ctx.now(); ctx.emit(); },
      addQuestion: (id, text, requestId) => { this.askPresentationQuestion(id, text, requestId); },
    });
  }
  private active(id: Id) { return this.ctx.state().members.some((member) => member.id === id && member.status === 'active'); }
  private practice(id: Id, owner = false, allowArchived = false) {
    const me = this.ctx.active();
    const row = this.ctx.state().presentationPractices.find((practice) => practice.id === id);
    if (!row || !this.active(row.ownerId) || (row.ownerId !== me.id && (owner || row.reviewerId !== me.id || row.archived))) {
      throw new Error('No tienes acceso a esta exposición.');
    }
    if (row.archived && !allowArchived) throw new Error('Esta exposición está archivada.');
    return row;
  }
  private attempt(id: Id, owner = false) {
    const row = this.ctx.state().presentationAttempts.find((attempt) => attempt.id === id);
    if (!row) throw new Error('El intento no existe.');
    const practice = this.practice(row.practiceId, owner);
    if (practice.ownerId !== this.ctx.active().id && row.status !== 'completed') throw new Error('No tienes acceso a este intento.');
    return { row, practice };
  }
  private source(input: { kind: PresentationSourceKind; id: Id } | undefined, subjectId: Id, ownerId: Id) {
    if (!input) return {};
    const state = this.ctx.state();
    const source = input.kind === 'note' ? state.notes.find((note) => note.id === input.id &&
      (note.visibility === 'group' || note.authorId === ownerId)) : input.kind === 'guide' ? state.guides.find((guide) => guide.id === input.id) : undefined;
    if (!source || source.withdrawnAt || !this.ctx.sourceAvailable(input.kind, input.id)) throw new Error('La fuente no está disponible.');
    if (source.subjectId !== subjectId) throw new Error('La fuente debe pertenecer a la misma materia.');
    return { sourceKind: input.kind, sourceId: input.id, sourceVersion: source.version };
  }
  private prior(kind: string, requestId: string, fingerprint: string) {
    const me = this.ctx.active();
    const row = this.ctx.state().presentationRequests.find((row) => row.actorId === me.id && row.kind === kind && row.requestId === requestId);
    if (row && row.fingerprint !== fingerprint) throw new Error('Este envío ya se usó con otro contenido.');
    return row?.resultId;
  }
  private remember(kind: string, requestId: string, fingerprint: string, resultId: Id) {
    this.ctx.state().presentationRequests.push({ actorId: this.ctx.active().id, kind, requestId, fingerprint, resultId });
  }
  private mutatePractice(row: PresentationPractice) { row.version += 1; row.updatedAt = this.ctx.now(); }

  snapshot(identity: Id): PresentationsSnapshot {
    if (!this.active(identity)) return emptyPresentationsSnapshot();
    const state = this.ctx.state();
    const practices = state.presentationPractices.filter((row) => this.active(row.ownerId) &&
      (row.ownerId === identity || (row.reviewerId === identity && !row.archived &&
        state.presentationAttempts.some((attempt) => attempt.practiceId === row.id && attempt.status === 'completed'))));
    const presentationPractices = practices.map((row): PresentationPractice => {
      if (row.ownerId === identity) return { ...row, keyPoints: [...row.keyPoints] };
      const completed = state.presentationAttempts.filter((attempt) => attempt.practiceId === row.id && attempt.status === 'completed')
        .sort((a, b) => b.number - a.number)[0]!;
      const { sourceKind: _kind, sourceId: _id, sourceVersion: _version, ...publicRow } = row;
      const source = completed.sourceId && completed.sourceKind ? this.readableSource(completed.sourceKind, completed.sourceId, identity, completed.subjectId ?? row.subjectId) : false;
      return { ...publicRow, title: completed.title, topic: completed.topic, audience: completed.audience,
        targetMinutes: completed.targetMinutes, keyPoints: [...completed.keyPoints], subjectId: completed.subjectId ?? row.subjectId, termId: completed.termId,
        ...(source ? { sourceKind: completed.sourceKind, sourceId: completed.sourceId, sourceVersion: completed.sourceVersion } : {}) };
    });
    const visible = new Map(practices.map((row) => [row.id, row]));
    const own = new Set(practices.filter((row) => row.ownerId === identity).map((row) => row.id));
    const presentationAttempts = state.presentationAttempts.filter((row) => visible.has(row.practiceId) &&
      (own.has(row.practiceId) || row.status === 'completed')).map((row): PresentationAttempt => {
        const { sourceKind: _kind, sourceId: _id, sourceVersion: _version, ...publicRow } = row;
        return { ...publicRow, keyPoints: [...row.keyPoints], ...(own.has(row.practiceId) || (row.sourceId && row.sourceKind && this.readableSource(row.sourceKind, row.sourceId, identity, row.subjectId ?? visible.get(row.practiceId)!.subjectId))
          ? { sourceKind: row.sourceKind, sourceId: row.sourceId, sourceVersion: row.sourceVersion } : {}) };
      });
    const attemptIds = new Set(presentationAttempts.map((row) => row.id));
    const ownAttemptIds = new Set(presentationAttempts.filter((row) => own.has(row.practiceId)).map((row) => row.id));
    return { presentationPractices, presentationAttempts,
      presentationPersonal: state.presentationPersonal.filter((row) => ownAttemptIds.has(row.attemptId)).map((row) => ({ ...row })),
      presentationQuestions: state.presentationQuestions.filter((row) => attemptIds.has(row.attemptId)).map((row) => ({ ...row })),
      presentationFeedback: state.presentationFeedback.filter((row) => ownAttemptIds.has(row.attemptId) ||
        (attemptIds.has(row.attemptId) && row.authorId === identity)).map((row) => ({ ...row })),
    };
  }
  private readableSource(kind: PresentationSourceKind, id: Id, viewer: Id, subjectId: Id) {
    if (!this.ctx.sourceAvailable(kind, id)) return false;
    return kind === 'guide' ? this.ctx.state().guides.some((row) => row.id === id && row.subjectId === subjectId && !row.withdrawnAt) :
      this.ctx.state().notes.some((row) => row.id === id && row.subjectId === subjectId && !row.withdrawnAt && (row.visibility === 'group' || row.authorId === viewer));
  }

  savePresentationPractice(input: PresentationPracticeInput): Id {
    const me = this.ctx.active(); const state = this.ctx.state();
    const config = normalizePresentationConfiguration(input); const requestId = request(input.requestId);
    const fingerprint = JSON.stringify({ ...config, subjectId: input.subjectId, termId: input.termId, sourceKind: input.source?.kind, sourceId: input.source?.id, expectedVersion: input.expectedVersion });
    if (!input.id) { const old = this.prior('practice', requestId, fingerprint); if (old) return old; }
    if (!state.subjects.some((row) => row.id === input.subjectId)) throw new Error('La materia no existe.');
    if (input.termId && !state.terms.some((row) => row.id === input.termId && row.subjectId === input.subjectId)) throw new Error('El parcial no pertenece a esta materia.');
    const current = input.id ? this.practice(input.id, true) : undefined;
    if (current) version(current.version, input.expectedVersion);
    const source = this.source(input.source, input.subjectId, me.id); const now = this.ctx.now();
    if (!current && state.presentationPractices.filter((row) => row.ownerId === me.id).length >= 200) throw new Error('Puedes guardar hasta 200 exposiciones.');
    const row: PresentationPractice = { ...config, ...source, id: current?.id ?? this.ctx.id(), ownerId: me.id,
      subjectId: input.subjectId, termId: input.termId, reviewerId: current?.reviewerId, archived: false,
      version: (current?.version ?? 0) + 1, createdAt: current?.createdAt ?? now, updatedAt: now };
    state.presentationPractices = [...state.presentationPractices.filter((item) => item.id !== row.id), row];
    if (!current) this.remember('practice', requestId, fingerprint, row.id);
    this.ctx.emit(); return row.id;
  }
  setPresentationReviewer(practiceId: Id, reviewerId: Id | undefined, expectedVersion: number) {
    const row = this.practice(practiceId, true); version(row.version, expectedVersion);
    if (reviewerId && (reviewerId === row.ownerId || !this.active(reviewerId))) throw new Error('Elige a otro integrante activo.');
    this.features.revoke(practiceId); row.reviewerId = reviewerId; this.mutatePractice(row); this.ctx.emit();
  }
  archivePresentationPractice(practiceId: Id, archived: boolean, expectedVersion: number) {
    const row = this.practice(practiceId, true, true); version(row.version, expectedVersion);
    if (archived) this.features.revoke(practiceId); row.archived = archived; if (archived) row.reviewerId = undefined; this.mutatePractice(row); this.ctx.emit();
  }
  createPresentationAttempt(practiceId: Id, requestIdInput: string, expectedVersion: number): Id {
    const row = this.practice(practiceId, true); const requestId = request(requestIdInput);
    const fingerprint = JSON.stringify({ practiceId, expectedVersion });
    const prior = this.prior('attempt', requestId, fingerprint); if (prior) return prior;
    version(row.version, expectedVersion);
    if (row.sourceKind && row.sourceId && (!this.ctx.sourceAvailable(row.sourceKind, row.sourceId) ||
      (row.sourceKind === 'note' ? this.ctx.state().notes : this.ctx.state().guides).some((source) => source.id === row.sourceId && source.withdrawnAt))) {
      throw new Error('La fuente fue retirada. Configura otra fuente o continúa sin referencia antes de crear un intento.');
    }
    const state = this.ctx.state(); const attempts = state.presentationAttempts.filter((attempt) => attempt.practiceId === practiceId);
    if (attempts.some((attempt) => attempt.status === 'draft')) throw new Error('Ya tienes un intento en borrador.');
    if (attempts.length >= 100) throw new Error('Puedes guardar hasta 100 intentos por exposición.');
    const previous = attempts.sort((a, b) => b.number - a.number)[0]; const now = this.ctx.now();
    const id = this.ctx.id(); const { title, topic, audience, targetMinutes, keyPoints, sourceKind, sourceId, sourceVersion, subjectId, termId } = row;
    state.presentationAttempts.push({ id, practiceId, number: attempts.length + 1, status: 'draft', body: previous?.body ?? '',
      title, topic, audience, targetMinutes, keyPoints: [...keyPoints], sourceKind, sourceId, sourceVersion, subjectId, termId, version: 1, createdAt: now, updatedAt: now });
    state.presentationPersonal.push({ attemptId: id, ...emptyPresentationObservations(), nextSteps: '' });
    this.remember('attempt', requestId, fingerprint, id); this.mutatePractice(row); this.ctx.emit(); return id;
  }
  savePresentationAttempt(attemptId: Id, input: PresentationAttemptInput, expectedVersion: number) {
    const { row } = this.attempt(attemptId, true); version(row.version, expectedVersion);
    if (row.status !== 'draft') throw new Error('La explicación de un intento completado se conserva. Crea otro intento.');
    const body = normalizePresentationBody(input.body); const personal = { ...normalizePresentationObservations(input), nextSteps: normalizePresentationNextSteps(input.nextSteps) };
    row.body = body; row.version += 1; row.updatedAt = this.ctx.now();
    this.ctx.state().presentationPersonal = [...this.ctx.state().presentationPersonal.filter((item) => item.attemptId !== attemptId), { attemptId, ...personal }];
    this.ctx.emit();
  }
  completePresentationAttempt(attemptId: Id, expectedVersion: number) {
    const { row, practice } = this.attempt(attemptId, true);
    if (row.status === 'completed' && expectedVersion === row.version - 1) return;
    version(row.version, expectedVersion); if (row.status === 'completed') return;
    normalizePresentationBody(row.body, !this.features.ready(attemptId)); const now = this.ctx.now();
    const questions = presentationGuidingQuestions(row);
    if (this.ctx.state().presentationQuestions.filter((item) => item.attemptId === attemptId).length + questions.length > 100) throw new Error('Puedes guardar hasta 100 preguntas por intento.');
    row.status = 'completed'; row.version += 1; row.updatedAt = now; row.completedAt = now;
    for (const text of questions) this.ctx.state().presentationQuestions.push({ id: this.ctx.id(), attemptId,
      authorId: practice.ownerId, kind: 'guided', text, answer: '', version: 1, createdAt: now });
    this.ctx.emit();
  }
  askPresentationQuestion(attemptId: Id, textInput: string, requestIdInput: string): Id {
    const { row, practice } = this.attempt(attemptId); const text = normalizePresentationQuestion(textInput); const requestId = request(requestIdInput);
    const fingerprint = JSON.stringify({ attemptId, text }); const prior = this.prior('question', requestId, fingerprint); if (prior) return prior;
    const state = this.ctx.state(); if (state.presentationQuestions.filter((item) => item.attemptId === attemptId).length >= (row.status === 'draft' ? 95 : 100)) throw new Error('Puedes guardar hasta 100 preguntas por intento.');
    const id = this.ctx.id(); const me = this.ctx.active();
    state.presentationQuestions.push({ id, attemptId, text, authorId: me.id, kind: me.id === practice.ownerId ? 'personal' : 'peer', answer: '', version: 1, createdAt: this.ctx.now() });
    this.remember('question', requestId, fingerprint, id); this.ctx.emit(); return id;
  }
  answerPresentationQuestion(questionId: Id, answerInput: string, expectedVersion: number) {
    const question = this.ctx.state().presentationQuestions.find((row) => row.id === questionId); if (!question) throw new Error('La pregunta no existe.');
    this.attempt(question.attemptId, true); version(question.version, expectedVersion); const answer = normalizePresentationAnswer(answerInput);
    question.answer = answer; question.answeredAt = this.ctx.now(); question.version += 1; this.ctx.emit();
  }
  savePresentationFeedback(attemptId: Id, input: PresentationFeedbackInput, expectedVersion?: number) {
    const { row, practice } = this.attempt(attemptId); const me = this.ctx.active();
    if (practice.reviewerId !== me.id || me.id === practice.ownerId) throw new Error('Solo el compañero revisor puede guardar retroalimentación.');
    if (row.status !== 'completed') throw new Error('Completa el intento antes de revisarlo.');
    const clean = normalizePresentationFeedback(input); const state = this.ctx.state();
    const current = state.presentationFeedback.find((item) => item.attemptId === attemptId && item.authorId === me.id);
    if (current) version(current.version, expectedVersion); else if (expectedVersion !== undefined) throw new Error('La versión cambió. Actualiza la página antes de guardar.');
    const now = this.ctx.now(); state.presentationFeedback = [...state.presentationFeedback.filter((item) => item.id !== current?.id),
      { ...clean, id: current?.id ?? this.ctx.id(), attemptId, authorId: me.id, version: (current?.version ?? 0) + 1, createdAt: current?.createdAt ?? now, updatedAt: now }];
    this.ctx.emit();
  }
}
