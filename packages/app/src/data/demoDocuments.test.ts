import { describe, expect, it, vi } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';

describe('EX-3 documental en demostración', () => {
  it('prepara documentos y OCR sin red, conserva texto privado y permite una versión compartida', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('La demo no puede contactar la red'));
    const source = new DemoDataSource(createDemoState(), 'demo-1');
    try {
      const subjectId = source.getSnapshot().subjects[0]!.id;
      const noteId = source.saveNote({ subjectId, title: 'Fuente documental', topic: 'Tema', body: 'Texto base.', tags: [], visibility: 'group', source: 'student' });
      const fileId = await source.attachResourceFile('note', noteId, new File(['Texto documental del alumno'], 'fuente.txt', { type: 'text/plain' }), 1);
      const metadata = await source.getDocumentFile(fileId);
      const input = { id: crypto.randomUUID(), fileId, fileHash: metadata.fileHash, targetKind: metadata.targetKind, targetId: metadata.targetId, targetVersion: metadata.targetVersion,
        reviewed: true as const, segments: [{ id: 'lines-1', text: 'Texto documental del alumno', locator: { kind: 'lines' as const, start: 1, end: 1 } }], omissions: [] };
      const transcription = await source.saveDocumentTranscription(input); expect(await source.saveDocumentTranscription(input)).toEqual(transcription);
      const ocr = await source.prepareDocumentOcr({ id: crypto.randomUUID(), input: { fileId, fileHash: metadata.fileHash, targetVersion: metadata.targetVersion, pages: [1] } });
      const generationId = crypto.randomUUID(); const request = { expectedRevision: ocr.revision, generationId, fingerprint: ocr.fingerprint, confirmed: true as const };
      const ready = await source.runDocumentOcr(ocr.id, request); expect(ready.state).toBe('ready'); expect(ready.result?.segments[0]?.text).toContain('ficticio');
      expect(await source.runDocumentOcr(ocr.id, request)).toEqual(ready);
      const prep = await source.prepareExamMaterial({ subjectId, topics: ['Tema'], sources: [{ kind: 'note', refId: noteId, topics: ['Tema'], includeUnplaced: true, transcriptionIds: [transcription.id] }], config: { purpose: 'questions', questionCount: 1, types: ['single'], difficulty: 'basic' } });
      expect(prep.fragments.some((fragment) => fragment.origins.some((origin) => origin.fileId === fileId && origin.fileHash === metadata.fileHash))).toBe(true);
      const generated = await source.generateExamQuestions({ id: crypto.randomUUID(), preparationId: prep.id, fingerprint: prep.fingerprint, config: prep.config, confirmed: true });
      let exam = await source.examAction({ action: 'importGeneration', generationId: generated.id, requestId: crypto.randomUUID(), title: 'Documento compartido' });
      exam = await source.examAction({ action: 'approveVersion', examId: exam.id, version: 1, expectedRevision: exam.revision, reviewedQuestionIds: exam.draft!.questions.map((q) => q.id) });
      exam = await source.examAction({ action: 'setVisibility', examId: exam.id, expectedRevision: exam.revision, visibility: 'group' });
      source.setViewer('demo-2'); await expect(source.getDocumentTranscription(transcription.id)).rejects.toThrow('privado'); expect(await source.listDocumentTranscriptions()).toEqual([]);
      const attempt = await source.examAction({ action: 'startAttempt', examId: exam.id, version: 1, mode: 'practice', requestId: crypto.randomUUID() });
      expect(attempt.questions[0]?.unavailable).not.toBe(true); await expect(source.getDocumentOcr(ocr.id)).rejects.toThrow('privada');
      source.setViewer('demo-1'); source.removeResourceFile(fileId, metadata.targetVersion);
      source.setViewer('demo-2'); const redacted = await source.examAction({ action: 'getAttempt', attemptId: attempt.id }); expect(redacted.contentUnavailable).toBe(true);
      expect(network).not.toHaveBeenCalled();
    } finally { source.dispose(); network.mockRestore(); }
  });

  it('retira solo la selección documental eliminada de una variante del mismo registro', async () => {
    const source = new DemoDataSource(createDemoState(), 'demo-1');
    try {
      const subjectId = source.getSnapshot().subjects[0]!.id;
      const noteId = source.saveNote({ subjectId, title: 'Dos documentos', topic: 'Tema', body: 'Texto base.', tags: [], visibility: 'group', source: 'student' });
      const fileA = await source.attachResourceFile('note', noteId, new File(['Documento A'], 'a.txt', { type: 'text/plain' }), 1);
      const fileB = await source.attachResourceFile('note', noteId, new File(['Documento B'], 'b.txt', { type: 'text/plain' }), 2);
      const metadataA = await source.getDocumentFile(fileA); const metadataB = await source.getDocumentFile(fileB);
      const prepareDocument = (metadata: typeof metadataA, label: string) => source.saveDocumentTranscription({
        id: crypto.randomUUID(), fileId: metadata.fileId, fileHash: metadata.fileHash, targetKind: metadata.targetKind,
        targetId: metadata.targetId, targetVersion: metadata.targetVersion, reviewed: true,
        segments: [{ id: `lines-${label}`, text: `Documento ${label}`, locator: { kind: 'lines', start: 1, end: 1 } }], omissions: [],
      });
      const transcriptionA = await prepareDocument(metadataA, 'A'); const transcriptionB = await prepareDocument(metadataB, 'B');
      const bankFromDocument = async (transcriptionId: string, label: string) => {
        const preparation = await source.prepareExamMaterial({ subjectId, topics: ['Tema'],
          sources: [{ kind: 'note', refId: noteId, topics: ['Tema'], includeUnplaced: true, transcriptionIds: [transcriptionId] }],
          config: { purpose: 'questions', questionCount: 1, types: ['single'], difficulty: 'basic' } });
        const generated = await source.generateExamQuestions({ id: crypto.randomUUID(), preparationId: preparation.id,
          fingerprint: preparation.fingerprint, config: preparation.config, confirmed: true });
        let exam = await source.examAction({ action: 'importGeneration', generationId: generated.id, requestId: crypto.randomUUID(), title: `Documento ${label}` });
        exam = await source.examAction({ action: 'saveDraft', examId: exam.id, version: 1, expectedRevision: exam.revision,
          title: exam.title, config: exam.draft!.config, questions: exam.draft!.questions.map((question) => ({ ...question, text: `Pregunta del documento ${label}` })) });
        exam = await source.examAction({ action: 'approveVersion', examId: exam.id, version: 1, expectedRevision: exam.revision,
          reviewedQuestionIds: exam.draft!.questions.map((question) => question.id) });
        const bank = await source.examAction({ action: 'saveToBank', examId: exam.id, version: 1,
          questionId: exam.draft!.questions[0]!.id, requestId: crypto.randomUUID() });
        return source.examAction({ action: 'setBankVisibility', bankId: bank.id, expectedVersion: bank.version, visibility: 'group' });
      };
      const bankA = await bankFromDocument(transcriptionA.id, 'A'); const bankB = await bankFromDocument(transcriptionB.id, 'B');
      source.setViewer('demo-2');
      let variant = await source.examAction({ action: 'createVariant', title: 'Variante documental', requestId: crypto.randomUUID(),
        plan: { subjectId, topics: ['Tema'], questionCount: 2, types: ['single'], difficulty: 'basic', seed: 'documentos', bankIds: [bankA.id, bankB.id] } });
      expect(variant.draft!.preparation.sources).toHaveLength(2);
      expect(variant.draft!.preparation.sources.map((ref) => ref.transcriptionIds)).toEqual(expect.arrayContaining([[transcriptionA.id], [transcriptionB.id]]));
      variant = await source.examAction({ action: 'approveVersion', examId: variant.id, version: 1, expectedRevision: variant.revision,
        reviewedQuestionIds: variant.draft!.questions.map((question) => question.id) });
      let attempt = await source.examAction({ action: 'startAttempt', examId: variant.id, version: 1, mode: 'simulation', requestId: crypto.randomUUID() });
      attempt = await source.examAction({ action: 'finishAttempt', attemptId: attempt.id, expectedRevision: attempt.revision, requestId: crypto.randomUUID() });
      const score = attempt.result;
      source.setViewer('demo-1'); source.removeResourceFile(fileA, metadataA.targetVersion);
      await expect(source.getDocumentTranscription(transcriptionB.id)).rejects.toThrow('cambió');
      source.setViewer('demo-2');
      const reread = await source.examAction({ action: 'getAttempt', attemptId: attempt.id });
      expect(reread.questions.find((question) => question.id === bankA.id)!.unavailable).toBe(true);
      expect(reread.questions.find((question) => question.id === bankB.id)!.unavailable).not.toBe(true);
      expect(reread.questions.find((question) => question.id === bankB.id)!.text).toContain('documento B');
      expect(reread.result).toEqual(score);
    } finally { source.dispose(); }
  });
});
