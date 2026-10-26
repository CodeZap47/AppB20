import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DbConnection } from '../packages/app/src/module_bindings';
import { AI_CONSENT_VERSION, type AiGenerationConfig, type AiPreparation } from '../packages/core/src/ai';
import type { DocumentFileMetadata, DocumentOcrClaim, DocumentOcrDraft, DocumentTranscription } from '../packages/core/src/documentPreparation';
import type { ExamActionRequest, ExamAttempt, ExamDetail } from '../packages/core/src/exams';
import { encryptAiKey } from '../apps/api/src/ai/crypto';

/** Local real SpacetimeDB procedures, synthetic model outputs and no external model traffic. */
export async function smokeDocumentExpansion(input: { author: DbConnection; peer: DbConnection; owner: DbConnection; service: DbConnection;
  subjectId: bigint; termId: bigint; secret: { AI_MASTER_VERSION: string; AI_MASTER_KEYS_JSON: string } }) {
  const { author, peer, owner, service, subjectId, termId, secret } = input;
  const documents = async <T>(connection: DbConnection, action: string, payload: Record<string, unknown> = {}) => JSON.parse(await connection.procedures.documentPreparation({ payload: JSON.stringify({ action, ...payload }) })) as T;
  const exams = async <T>(connection: DbConnection, request: ExamActionRequest) => JSON.parse(await connection.procedures.examAction({ payload: JSON.stringify(request) })) as T;
  await author.reducers.saveNoteV2({ noteId: undefined, expectedVersion: undefined, subjectId, termId, session: '', topic: 'Ciclos', title: 'EX3 verified document fixture',
    body: 'Fuente sintética para comprobar la procedencia documental.', tags: ['synthetic'], visibility: 'group', source: 'student', assignmentIds: [], activityIds: [], questionIds: [] });
  const noteId = [...author.db.notes.iter()].find((note) => note.title === 'EX3 verified document fixture')!.id;
  const bytes = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=', 'base64'));
  const fileHash = createHash('sha256').update(bytes).digest('hex'), fileId = randomUUID();
  await author.reducers.beginResourceUpload({ uploadId: fileId, targetKind: 'note', targetId: noteId, expectedVersion: 1, name: 'synthetic-scan.png', mime: 'image/png', bytes: BigInt(bytes.length), sha256: fileHash });
  await author.reducers.putResourceChunk({ uploadId: fileId, index: 0, bytes, sha256: fileHash });
  await author.reducers.finalizeResourceUpload({ uploadId: fileId });
  const file = await documents<DocumentFileMetadata>(peer, 'fileInfo', { fileId }); assert.equal(file.fileHash, fileHash); assert.equal(file.targetVersion, 2);
  const transcriptInput = { id: randomUUID(), fileId, fileHash, targetKind: 'note', targetId: String(noteId), targetVersion: file.targetVersion,
    reviewed: true, segments: [{ id: 'page-1', text: 'DOCUMENT_NATIVE_SENTINEL: un ciclo repite instrucciones.', locator: { kind: 'page', start: 1, end: 1 } }], omissions: ['Texto sintético revisado para el smoke local.'] };
  const transcript = await documents<DocumentTranscription>(peer, 'saveTranscription', transcriptInput);
  assert.deepEqual(await documents(peer, 'saveTranscription', transcriptInput), transcript);
  await assert.rejects(documents(author, 'getTranscription', { id: transcript.id })); await assert.rejects(documents(owner, 'getTranscription', { id: transcript.id }));
  await assert.rejects(documents(peer, 'saveTranscription', { ...transcriptInput, id: randomUUID(), fileHash: '0'.repeat(64) }));
  const actor = peer.identity!.toHexString().replace(/^0x/u, ''); const keyId = randomUUID(), intentId = randomUUID();
  await peer.procedures.aiSetConsent({ payload: JSON.stringify({ version: AI_CONSENT_VERSION, accepted: true }) });
  await peer.procedures.aiAuthorizeKey({ payload: JSON.stringify({ keyId, intentId, provider: 'gemini' }) });
  const envelope = await encryptAiKey(secret, { actor, keyId, provider: 'gemini' }, 'synthetic-document-key-not-real');
  await service.procedures.aiCommitKey({ payload: JSON.stringify({ actor, keyId, intentId, provider: 'gemini', ...envelope }) });
  let ocr = await documents<DocumentOcrDraft>(peer, 'prepareOcr', { id: randomUUID(), input: { fileId, fileHash, targetVersion: file.targetVersion, pages: [1] }, model: 'synthetic-no-network' });
  const generationId = randomUUID();
  ocr = (await documents<{ draft: DocumentOcrDraft }>(peer, 'authorizeOcr', { id: ocr.id, generationId, expectedRevision: ocr.revision, fingerprint: ocr.fingerprint, model: ocr.model, confirmed: true, allowNew: true })).draft;
  const claimed = await documents<DocumentOcrClaim>(service, 'claimOcr', { id: ocr.id, actor, generationId }); assert.equal(claimed.claimed, true);
  assert.equal((await documents<DocumentOcrClaim>(service, 'claimOcr', { id: ocr.id, actor, generationId })).claimed, false);
  ocr = await documents<DocumentOcrDraft>(service, 'finishOcr', { id: ocr.id, actor, generationId, state: 'succeeded', result: { segments: transcript.segments, omissions: [] }, usage: { inputTokens: 100, outputTokens: 100 } });
  assert.equal(ocr.state, 'ready'); await assert.rejects(documents(author, 'getOcr', { id: ocr.id }));
  const config: AiGenerationConfig = { purpose: 'questions', questionCount: 1, types: ['single'], difficulty: 'basic' };
  const prep = JSON.parse(await peer.procedures.aiPrepare({ payload: JSON.stringify({ id: randomUUID(), subjectId: String(subjectId), termId: String(termId), topics: ['Ciclos'], model: 'synthetic-no-network', config,
    sources: [{ kind: 'note', refId: String(noteId), topics: ['Ciclos'], includeUnplaced: false, transcriptionIds: [transcript.id] }] }) })) as AiPreparation;
  const origin = prep.fragments.flatMap((fragment) => fragment.origins).find((origin) => origin.fileId === fileId)!;
  assert.equal(origin.fileHash, fileHash); assert.equal(origin.transcriptionId, transcript.id); assert.equal(origin.locator?.start, 1);
  const id = randomUUID(); await peer.procedures.aiAuthorizeGeneration({ payload: JSON.stringify({ id, preparationId: prep.id, fingerprint: prep.fingerprint, config, model: prep.model, confirmed: true, allowNew: true }) });
  const claim = JSON.parse(await service.procedures.aiClaimGeneration({ payload: JSON.stringify({ id, actor }) })); assert.equal(claim.claimed, true);
  const citation = prep.fragments.find((fragment) => fragment.origins.some((origin) => origin.fileId === fileId))!.id;
  await service.procedures.aiFinishGeneration({ payload: JSON.stringify({ id, actor, state: 'succeeded', result: { questions: [{ id: 'document-loop', type: 'single', text: '¿Qué hace un ciclo según el documento?', topic: 'Ciclos',
    options: [{ id: 'a', text: 'Repite instrucciones' }, { id: 'b', text: 'Cierra todo' }, { id: 'c', text: 'Borra datos' }, { id: 'd', text: 'Envía mensajes' }], correctOptionId: 'a', explanation: 'El documento describe repetición.', citations: [citation] }] }, usage: { inputTokens: 100, outputTokens: 100 } }) });
  let exam = await exams<ExamDetail>(peer, { action: 'importGeneration', generationId: id, requestId: randomUUID(), title: 'EX3 document shared fixture' });
  exam = await exams<ExamDetail>(peer, { action: 'approveVersion', examId: exam.id, version: 1, expectedRevision: exam.revision, reviewedQuestionIds: ['document-loop'] });
  exam = await exams<ExamDetail>(peer, { action: 'setVisibility', examId: exam.id, expectedRevision: exam.revision, visibility: 'group' });
  const attempt = await exams<ExamAttempt>(author, { action: 'startAttempt', examId: exam.id, version: 1, mode: 'practice', requestId: randomUUID() });
  assert.equal(attempt.questions[0]?.text, '¿Qué hace un ciclo según el documento?');
  await assert.rejects(documents(author, 'getTranscription', { id: transcript.id }));
  return { checks: ['EX-3 documental real: hash nativo confirmado, texto revisado privado incluso ante administrador, OCR con claim único/cuota compartida, citas con localizador y examen compartido accesible sin abrir la transcripción privada'], syntheticProviderCalls: 2 };
}
