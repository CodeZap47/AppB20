import { DOCUMENT_LIMITS, type DocumentSegment } from '@b20/core';
import { extractGuideDocument, supportsGuideExtraction, GUIDE_EXTRACTION_LIMITS, type GuideDocumentInput } from './guideExtraction';

/** Shared secure reader. Full extraction is retained; EX-3 selects its 40k budget explicitly. */
export async function extractExamDocument(input: GuideDocumentInput) {
  const extracted = await extractGuideDocument({ ...input, maxCharacters: DOCUMENT_LIMITS.maxBytes });
  const segments = extracted.segments.flatMap((segment): DocumentSegment[] => {
    if (segment.text.length <= 4000) return [segment];
    const pieces: DocumentSegment[] = [];
    for (let offset = 0; offset < segment.text.length; offset += 4000) pieces.push({ ...segment, id: `${segment.id}:part-${offset / 4000 + 1}`, text: segment.text.slice(offset, offset + 4000) });
    return pieces;
  });
  return { ...extracted, segments, omissions: extracted.omissions.map((omission) => omission.reason.replace('esta entrega no aplica OCR', 'puedes seleccionar páginas y solicitar OCR opcional')) };
}
export { supportsGuideExtraction as supportsDocumentExtraction, GUIDE_EXTRACTION_LIMITS as DOCUMENT_EXTRACTION_LIMITS };
