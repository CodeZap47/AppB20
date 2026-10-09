import { guideCoverage, WORK_KIND_LABEL, type GuideSourceKind } from '@b20/core';
import type { GuideSource, GuideSourceRef, Id, Snapshot, StudyGuide } from '../data/types';
import { authorsLabel } from './works';

/** Cómo se ve una fuente en la guía: qué es, cómo se llama, de dónde sale y su versión actual. */
export interface SourceInfo extends GuideSourceRef {
  label: string;
  title: string;
  context: string;
  link: string;
  version: number;
  /** Parcial del material; vacío si no tiene. */
  termId: Id | undefined;
}

export const SOURCE_KIND_LABEL: Record<GuideSourceKind, string> = {
  trabajo: 'Trabajo',
  tarea: 'Tarea',
  actividad: 'Actividad de clase',
  nota: 'Apunte',
  pregunta: 'Pregunta',
};

const key = (ref: GuideSourceRef) => `${ref.kind}:${ref.refId}`;

/** Lo que el usuario puede ver del material citado; `undefined` si ya no existe o no es visible. */
export function describeSource(ref: GuideSourceRef, data: Snapshot): SourceInfo | undefined {
  const base = { kind: ref.kind, refId: ref.refId };
  switch (ref.kind) {
    case 'trabajo': {
      const work = data.works.find((w) => w.id === ref.refId);
      const assignment = work && data.assignments.find((a) => a.id === work.assignmentId);
      if (!work || !assignment) return undefined;
      const authors = authorsLabel(work.authorIds, data.members);
      return {
        ...base,
        label: SOURCE_KIND_LABEL.trabajo,
        title: work.title || `Trabajo de ${authors}`,
        context: work.title ? `${authors} · ${assignment.title}` : assignment.title,
        link: `/m/tareas/${assignment.id}?trabajo=${work.id}`,
        version: work.version,
        termId: assignment.termId,
      };
    }
    case 'tarea': {
      const assignment = data.assignments.find((a) => a.id === ref.refId);
      if (!assignment) return undefined;
      return {
        ...base,
        label: WORK_KIND_LABEL[assignment.kind],
        title: assignment.title,
        context: 'Página principal: lo que se pidió',
        link: `/m/tareas/${assignment.id}`,
        version: assignment.version,
        termId: assignment.termId,
      };
    }
    case 'actividad': {
      const activity = data.activities.find((a) => a.id === ref.refId);
      if (!activity) return undefined;
      return {
        ...base,
        label: SOURCE_KIND_LABEL.actividad,
        title: activity.title,
        context: activity.topic || 'Sesión de clase',
        link: `/m/actividades/${activity.id}`,
        version: activity.version,
        termId: activity.termId,
      };
    }
    case 'nota': {
      const note = data.notes.find((n) => n.id === ref.refId && n.visibility === 'group');
      if (!note) return undefined;
      return {
        ...base,
        label: SOURCE_KIND_LABEL.nota,
        title: note.title,
        context: [note.topic, authorsLabel([note.authorId], data.members)]
          .filter(Boolean)
          .join(' · '),
        link: `/m/notas/${note.id}`,
        version: note.version,
        termId: undefined,
      };
    }
    case 'pregunta': {
      const question = data.questions.find((q) => q.id === ref.refId);
      if (!question) return undefined;
      return {
        ...base,
        label: SOURCE_KIND_LABEL.pregunta,
        title: question.title,
        context: question.status === 'resolved' ? 'Resuelta' : 'Sin resolver',
        link: `/m/preguntas/${question.id}`,
        version: 1,
        termId: undefined,
      };
    }
  }
}

/**
 * Material de la materia que puede citarse. `matched` es del mismo parcial (se propone
 * marcado); `unplaced` no tiene parcial (apuntes, preguntas, trabajos sin clasificar) y se
 * ofrece sin marcar para no meterlo en la guía equivocada. Lo de otros parciales no aparece.
 */
export function candidateSources(
  subjectId: Id,
  termId: Id | undefined,
  data: Snapshot,
  exclude: GuideSourceRef[] = [],
) {
  const skip = new Set(exclude.map(key));
  const refs: GuideSourceRef[] = [
    ...data.assignments
      .filter((a) => a.subjectId === subjectId)
      .flatMap((a) => [
        { kind: 'tarea' as const, refId: a.id },
        ...data.works
          .filter((w) => w.assignmentId === a.id)
          .map((w) => ({ kind: 'trabajo' as const, refId: w.id })),
      ]),
    ...data.activities
      .filter((a) => a.subjectId === subjectId)
      .map((a) => ({ kind: 'actividad' as const, refId: a.id })),
    ...data.notes
      .filter((n) => n.subjectId === subjectId && n.visibility === 'group')
      .map((n) => ({ kind: 'nota' as const, refId: n.id })),
    ...data.questions
      .filter((q) => q.subjectId === subjectId)
      .map((q) => ({ kind: 'pregunta' as const, refId: q.id })),
  ];
  const infos = refs
    .filter((ref) => !skip.has(key(ref)))
    .map((ref) => describeSource(ref, data))
    .filter((info): info is SourceInfo => Boolean(info));
  return {
    matched: termId ? infos.filter((i) => i.termId === termId) : [],
    unplaced: infos.filter((i) => !i.termId || !termId),
  };
}

/** Todo lo que la lista y el detalle muestran de una guía: cobertura, fuentes y revisiones. */
export function guideStatus(guide: StudyGuide, data: Snapshot) {
  const sources = data.guideSources.filter((s) => s.guideId === guide.id);
  const described = sources.map((source) => ({
    source,
    info: describeSource(source, data),
  }));
  const coverage = guideCoverage(guide.topics, sources);
  const reviews = data.guideReviews
    .filter((r) => r.guideId === guide.id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const current = reviews.filter((r) => r.guideVersion === guide.version);
  return {
    sources: described,
    coverage,
    covered: coverage.filter((c) => c.processed > 0).length,
    processed: sources.filter((s) => s.status === 'processed').length,
    pending: sources.filter((s) => s.status === 'pending').length,
    /** Material que cambió después de que se agregó a la guía. */
    outdated: described.filter((d) => d.info && d.info.version > d.source.sourceVersion).length,
    missing: described.filter((d) => !d.info).length,
    reviews,
    approvals: current.filter((r) => r.verdict === 'approved').length,
    changeRequests: current.filter((r) => r.verdict === 'changes').length,
  };
}

export function isOutdated(source: GuideSource, info: SourceInfo | undefined): boolean {
  return Boolean(info && info.version > source.sourceVersion);
}
