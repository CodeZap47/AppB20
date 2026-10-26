import { t, table, SenderError } from 'spacetimedb/server';
import { aiHash, aiUuid, type AiPreparation } from '../../core/src/ai';
import type { ExamAttempt } from '../../core/src/exams';
import { memberIdentityFor } from './authIdentity';
import { activeMember, isActive, type Ctx, type ViewDb } from './moduleContext';
import { canReadTarget, withdrawn } from './delivery2Handlers';
import { examResponse } from './examHandlers';

export const spacedExamOrigin = table({ name: 'spaced_exam_origin' }, {
  id: t.u64().primaryKey().autoInc(), key: t.string().index('btree'), actor: t.identity().index('btree'),
  examId: t.string(), examVersion: t.u32(), questionId: t.string(), collectionId: t.u64(), cardId: t.u64(), preparationJson: t.string(),
});
export const examSpacedTables = { spacedExamOrigin };

/** Keep scheduling metadata, but remove copied material when its original is purged. */
export function purgeExamSpacedSource(ctx: Ctx, kind: string, id: bigint): void {
  const matches = (source: { kind: string; refId: string }) => source.kind === kind && source.refId === String(id);
  for (const origin of ctx.db.spacedExamOrigin.iter()) {
    const preparation = JSON.parse(origin.preparationJson) as AiPreparation;
    if (!preparation.sources.some((source) => matches(source) || source.origins.some(matches)) && !preparation.fragments.some((fragment) => fragment.origins.some(matches))) continue;
    for (const card of ctx.db.spacedCard.iter()) if (card.sourceKind === 'exam_question' && card.sourceId === origin.id) {
      ctx.db.spacedCard.id.update({ ...card, question: '', explanation: '', hint: '', archived: true, version: card.version + 1 });
    }
    ctx.db.spacedExamOrigin.id.delete(origin.id);
  }
}

/** A private bridge keeps UUID exams out of the existing numeric source identifiers. */
export function spacedExamSourceVersion(db: ViewDb, actor: Ctx['sender'], collection: { ownerId: Ctx['sender']; visibility: string; subjectId: bigint }, id: bigint): number | undefined {
  const origin = db.spacedExamOrigin.id.find(id);
  if (!origin || !isActive(db, actor) || !origin.actor.isEqual(actor) || !collection.ownerId.isEqual(actor) || collection.visibility !== 'personal') return undefined;
  const exam = db.studyExam.id.find(origin.examId);
  if (!exam || (exam.visibility !== 'group' && !exam.owner.isEqual(actor)) || exam.subjectId !== collection.subjectId) return undefined;
  const version = db.examVersion.key.find(`${exam.id}:${origin.examVersion}`);
  if (!version) return undefined;
  const value = JSON.parse(version.json) as { preparation: AiPreparation; purgedQuestionIds?: string[] };
  if (value.purgedQuestionIds?.includes(origin.questionId)) return undefined;
  const prep = JSON.parse(origin.preparationJson) as AiPreparation;
  for (const source of [...prep.sources, ...prep.sources.flatMap((source) => source.origins)]) {
    const ref = BigInt(source.refId);
    if (source.kind === 'teaching') { if (!db.teachingPractice.id.find(ref)?.owner.isEqual(actor)) return undefined; }
    else if (source.kind === 'spaced_card') {
      const card = db.spacedCard.id.find(ref); const parent = card && db.spacedCollection.id.find(card.collectionId);
      if (!card || card.archived || !parent || parent.archived || (parent.visibility !== 'group' && !parent.ownerId.isEqual(actor))) return undefined;
    } else if (!canReadTarget(db, actor, source.kind, ref) || withdrawn(db, source.kind, ref)) return undefined;
  }
  for (const fragment of prep.fragments) for (const source of fragment.origins) if (source.fileId) {
    let file: { id: string; storageKey: string; etag: string; size: bigint; targetKind: string; targetId: bigint; removedAt?: unknown } | undefined = db.resourceFile.id.find(source.fileId) ?? undefined;
    if (source.fileId.startsWith('legacy:')) {
      const legacy = db.workFile.id.find(BigInt(source.fileId.slice(7)));
      if (!legacy) return undefined;
      file = [...db.resourceFile.targetId.filter(legacy.workId)].find((row) => row.targetKind === 'work' && row.storageKey === legacy.storageKey)
        ?? { id: source.fileId, storageKey: legacy.storageKey, etag: '', size: legacy.size, targetKind: 'work', targetId: legacy.workId };
    }
    if (!file || file.removedAt !== undefined || !canReadTarget(db, actor, file.targetKind, file.targetId) || withdrawn(db, file.targetKind, file.targetId)) return undefined;
    const native = file.storageKey.startsWith('stdb:') ? db.resourceUpload.id.find(file.storageKey.slice(5)) : undefined;
    const verification = db.documentFileVerification.fileId.find(source.fileId);
    const stamp = aiHash({ id: file.id, storageKey: file.storageKey, etag: file.etag, size: String(file.size), kind: file.targetKind, targetId: String(file.targetId) });
    const currentHash = native?.state === 'ready' ? native.sha256 : verification?.stamp === stamp ? verification.sha256 : undefined;
    if (currentHash !== source.fileHash) return undefined;
  }
  return origin.examVersion;
}

export function sendExamToSpaced(ctx: Ctx, raw: Record<string, unknown>) {
  activeMember(ctx); const actor = memberIdentityFor(ctx);
  if (!aiUuid(raw.requestId)) throw new SenderError('invalid:La solicitud debe tener un identificador válido.');
  const operationKey = `${actor.toHexString()}:${raw.requestId}`; const requestHash = aiHash(raw);
  const operation = ctx.db.examOperation.key.find(operationKey);
  if (operation && (operation.action !== 'sendToSpaced' || operation.requestHash !== requestHash)) throw new SenderError('conflict:La solicitud ya pertenece a otra operación.');
  const attempt = JSON.parse(examResponse(ctx, JSON.stringify({ action: 'getAttempt', attemptId: raw.attemptId }))) as ExamAttempt & { ok?: boolean };
  if (attempt.ok === false || attempt.state !== 'closed' || attempt.contentUnavailable) throw new SenderError('unavailable:Termina un intento propio con fuentes disponibles antes de crear tarjetas.');
  const question = attempt.questions.find((entry) => entry.id === raw.questionId);
  if (!question?.solution || question.unavailable) throw new SenderError('unavailable:La pregunta o su explicación ya no está disponible.');
  const key = aiHash([actor.toHexString(), attempt.examId, attempt.examVersion, question.id]);
  const previous = [...ctx.db.spacedExamOrigin.key.filter(key)][0];
  const remember = () => { if (!operation) ctx.db.examOperation.insert({ key: operationKey, actor, action: 'sendToSpaced', requestHash, examId: attempt.examId, attemptId: attempt.id, createdAt: ctx.timestamp }); };
  if (previous) { remember(); return { collectionId: String(previous.collectionId), cardId: String(previous.cardId), created: false }; }
  const field = (value: unknown, name: string, max: number, required = true) => {
    if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw new SenderError(`invalid:Revisa ${name} antes de guardar la tarjeta.`);
    return value.trim();
  };
  const text = field(raw.question, 'la pregunta (máximo 1000 caracteres)', 1000);
  const explanation = field(raw.explanation, 'la explicación', 20_000); const hint = field(raw.hint ?? '', 'la pista', 2000, false);
  const exam = ctx.db.studyExam.id.find(attempt.examId)!;
  const version = JSON.parse(ctx.db.examVersion.key.find(`${exam.id}:${attempt.examVersion}`)!.json) as { preparation: AiPreparation };
  const related = [...ctx.db.spacedExamOrigin.actor.filter(actor)].find((row) => row.examId === exam.id && (() => { const collection = ctx.db.spacedCollection.id.find(row.collectionId); return collection?.archived === false && collection.visibility === 'personal' && collection.ownerId.isEqual(actor) && collection.subjectId === exam.subjectId; })());
  const collection = related ? ctx.db.spacedCollection.id.find(related.collectionId)! : ctx.db.spacedCollection.insert({ id: 0n, subjectId: exam.subjectId,
    termId: exam.termId, title: `Repaso: ${exam.title}`.slice(0, 200), visibility: 'personal', ownerId: actor, version: 1, archived: false,
    createdAt: ctx.timestamp, updatedAt: ctx.timestamp, updatedBy: actor });
  const origin = ctx.db.spacedExamOrigin.insert({ id: 0n, key, actor, examId: exam.id, examVersion: attempt.examVersion, questionId: question.id,
    collectionId: collection.id, cardId: 0n, preparationJson: JSON.stringify({ ...version.preparation,
      fragments: version.preparation.fragments.filter((fragment) => question.solution!.citations.some((citation) => citation.id === fragment.id)),
      sources: version.preparation.sources.filter((source) => source.fragmentIds.some((id) => question.solution!.citations.some((citation) => citation.id === id))).map((source) => source.kind === 'question' ? { ...source, origins: source.origins.filter((origin) => origin.kind !== 'answer' || question.solution!.citations.some((citation) => citation.origins.some((cited) => cited.kind === origin.kind && cited.refId === origin.refId))) } : source) }) });
  const card = ctx.db.spacedCard.insert({ id: 0n, collectionId: collection.id, question: text, explanation, hint, sourceKind: 'exam_question', sourceId: origin.id,
    sourceVersion: origin.examVersion, version: 1, archived: false, createdBy: actor, updatedBy: actor, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
  ctx.db.spacedExamOrigin.id.update({ ...origin, cardId: card.id }); remember();
  return { collectionId: String(collection.id), cardId: String(card.id), created: true };
}
