import { currentTerm, type TermDates } from './calendar';
import { scoreContributions, type ContributionEvent, type ContributionWindow, type ScoredEvent } from './contributions';
type Id = string;
const parseDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** Datos de grupo normalizados: la app y el servidor aplican las mismas reglas de aportes. */
export interface RankingContributionData {
  members: { id: string; status: string }[];
  calendar: TermDates[];
  assignments: { id: string; title: string; createdBy: string; createdAt: Date }[];
  activities: { id: string; title: string; createdBy: string; createdAt: Date }[];
  works: { id: string; assignmentId: string; title: string; description: string; topic?: string; authorIds: string[]; createdAt: Date; status?: string; withdrawnAt?: Date }[];
  notes: { id: string; subjectId: string; termId?: string; title: string; topic: string; body: string; authorId: string; visibility: string; createdAt: Date; withdrawnAt?: Date }[];
  noteComments: { id: string; noteId: string; authorId: string; createdAt: Date }[];
  questions: { id: string; title: string; authorId: string; acceptedAnswerId?: string; resolvedAt?: Date; withdrawnAt?: Date }[];
  answers: { id: string; questionId: string; authorId: string; createdAt: Date; withdrawnAt?: Date }[];
  revisions: { id: string; page: string; pageId: string; version: number; editedBy: string; editedAt: Date; title: string }[];
  evidences: { id: string; activityId: string; authorId: string; participantIds: string[]; content: string; createdAt: Date; withdrawnAt?: Date }[];
  guides: { id: string; subjectId: string; termId?: string; title: string; topics: string[]; sections: string[]; createdBy: string; createdAt: Date; withdrawnAt?: Date }[];
  guideSources: { id: string; guideId: string; kind: string; refId: string; status: string; addedBy: string; addedAt: Date }[];
  guideReviews: { id: string; guideId: string; guideVersion: number; reviewerId: string; createdAt: Date }[];
  resourceFiles: { id: string; targetKind: string; targetId: string; name: string; size: number; contentType: string; removedAt?: Date }[];
  workFiles: { id: string; workId: string; name: string; size: number; contentType: string }[];
  contributionOrigins?: { kind: string; refId: string; memberId: string; creditedAt: Date; duplicateOf?: string }[];
}

/** Un aporte con lo necesario para verificarlo: qué fue y dónde abrirlo. */
export interface ContributionEntry extends ContributionEvent {
  title: string;
  link: string;
}

export type ScoredEntry = ScoredEvent & ContributionEntry;

/** Comparación exacta: conserva mayúsculas, espacios internos y código. */
const contributionText = (value: string) => value.replace(/\r\n?/g, '\n').trim();
function contentSignature(kind: string, context: unknown[], content: unknown[], files: unknown[], fallback: Id): string {
  // Sin texto ni adjuntos identificables no suponemos que dos trabajos vacíos son iguales.
  const hasContent = content.some((part) => typeof part === 'string' ? Boolean(part) : Array.isArray(part) && part.some(Boolean));
  return JSON.stringify([kind, context, content, files, !hasContent && !files.length ? fallback : '']);
}

/**
 * Todos los aportes que el usuario puede ver, sacados de los registros del grupo. No incluye
 * mensajes, preguntas ni apuntes personales: no suman (ver `NOT_SCORED`).
 */
export function contributionEntries(data: RankingContributionData): ContributionEntry[] {
  const entries: ContributionEntry[] = [];
  // Las firmas completas solo viven durante este cálculo. El desglose recibe una clave
  // opaca local y nunca duplica cuerpos de notas/guías en campos de puntuación.
  const copies = new Map<string, string>();
  const contentKey = (...args: Parameters<typeof contentSignature>) => {
    const signature = contentSignature(...args);
    let key = copies.get(signature);
    if (!key) { key = `copy:${copies.size}`; copies.set(signature, key); }
    return key;
  };
  const assignmentTitle = (id: Id) => data.assignments.find((a) => a.id === id)?.title ?? 'Tarea';
  const filesFor = (kind: string, id: Id) => {
    const files = data.resourceFiles.filter((file) => file.targetKind === kind && file.targetId === id && !file.removedAt)
      .map((file) => [file.id, file.name, file.size, file.contentType]);
    if (kind === 'work' && !files.length) files.push(...data.workFiles.filter((file) => file.workId === id).map((file) => [file.id, file.name, file.size, file.contentType]));
    return files.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  };

  for (const work of data.works) {
    if (work.withdrawnAt || work.status === 'draft') continue;
    const title = work.title || assignmentTitle(work.assignmentId);
    for (const memberId of new Set(work.authorIds)) {
      entries.push({
        kind: 'trabajo',
        memberId,
        at: work.createdAt,
        refId: work.id,
        limitKey: contentKey('work', [work.assignmentId], [contributionText(work.title), contributionText(work.description), contributionText(work.topic ?? '')], filesFor('work', work.id), work.id),
        title,
        link: `/m/tareas/${work.assignmentId}?trabajo=${work.id}`,
      });
    }
  }

  for (const note of data.notes) {
    if (note.visibility !== 'group' || note.withdrawnAt) continue;
    entries.push({
      kind: 'apunte',
      memberId: note.authorId,
      at: note.createdAt,
      refId: note.id,
      limitKey: contentKey('note', [note.subjectId, note.termId ?? ''], [contributionText(note.title), contributionText(note.body), contributionText(note.topic)], filesFor('note', note.id), note.id),
      title: note.title,
      link: `/m/notas/${note.id}`,
    });
  }

  for (const comment of data.noteComments) {
    const note = data.notes.find((n) => n.id === comment.noteId);
    if (!note || note.visibility !== 'group' || note.withdrawnAt) continue;
    entries.push({
      kind: 'comentario',
      memberId: comment.authorId,
      at: comment.createdAt,
      refId: comment.id,
      limitKey: note.id,
      excluded:
        note.authorId === comment.authorId ? 'Es un comentario en tu propio apunte.' : undefined,
      title: note.title,
      link: `/m/notas/${note.id}`,
    });
  }

  for (const answer of data.answers) {
    const question = data.questions.find((q) => q.id === answer.questionId);
    if (!question || question.withdrawnAt || answer.withdrawnAt) continue;
    const own = question.authorId === answer.authorId;
    const link = `/m/preguntas/${question.id}`;
    entries.push({
      kind: 'respuesta',
      memberId: answer.authorId,
      at: answer.createdAt,
      refId: answer.id,
      limitKey: question.id,
      excluded: own ? 'Respondiste tu propia pregunta.' : undefined,
      title: question.title,
      link,
    });
    if (question.acceptedAnswerId === answer.id && !own) {
      entries.push({
        kind: 'respuesta-aceptada',
        memberId: answer.authorId,
        at: question.resolvedAt ?? answer.createdAt,
        refId: answer.id,
        title: question.title,
        link,
      });
    }
  }

  for (const assignment of data.assignments) {
    entries.push({
      kind: 'pagina',
      memberId: assignment.createdBy,
      at: assignment.createdAt,
      refId: `assignment:${assignment.id}`,
      title: assignment.title,
      link: `/m/tareas/${assignment.id}`,
    });
  }

  for (const activity of data.activities) {
    entries.push({
      kind: 'pagina',
      memberId: activity.createdBy,
      at: activity.createdAt,
      refId: `activity:${activity.id}`,
      title: activity.title,
      link: `/m/actividades/${activity.id}`,
    });
  }

  // La versión 1 es la página registrada; cada versión posterior es una corrección.
  for (const revision of data.revisions) {
    if (revision.version <= 1) continue;
    const isActivity = revision.page === 'activity';
    entries.push({
      kind: 'correccion',
      memberId: revision.editedBy,
      at: revision.editedAt,
      refId: revision.id,
      limitKey: `${revision.page}:${revision.pageId}`,
      title: `${revision.title} (versión ${revision.version})`,
      link: isActivity ? `/m/actividades/${revision.pageId}` : `/m/tareas/${revision.pageId}`,
    });
  }

  for (const evidence of data.evidences) {
    if (evidence.withdrawnAt) continue;
    const activity = data.activities.find((a) => a.id === evidence.activityId);
    for (const memberId of new Set([evidence.authorId, ...evidence.participantIds])) {
      entries.push({
        kind: 'evidencia',
        memberId,
        at: evidence.createdAt,
        refId: evidence.id,
        limitKey: contentKey('evidence', [evidence.activityId], [contributionText(evidence.content)], filesFor('evidence', evidence.id), evidence.id),
        title: activity?.title ?? 'Actividad de clase',
        link: `/m/actividades/${evidence.activityId}`,
      });
    }
  }

  for (const guide of data.guides) {
    if (guide.withdrawnAt) continue;
    entries.push({
      kind: 'guia',
      memberId: guide.createdBy,
      at: guide.createdAt,
      refId: guide.id,
      limitKey: contentKey('guide', [guide.subjectId, guide.termId ?? ''], [contributionText(guide.title), guide.topics.map(contributionText), guide.sections.map(contributionText)], filesFor('guide', guide.id), guide.id),
      title: guide.title,
      link: `/m/guias/${guide.id}`,
    });
  }

  for (const source of data.guideSources) {
    const guide = data.guides.find((g) => g.id === source.guideId);
    if (!guide || guide.withdrawnAt || source.status !== 'processed') continue;
    entries.push({
      kind: 'fuente',
      memberId: source.addedBy,
      at: source.addedAt,
      refId: source.id,
      limitKey: `${source.guideId}:${source.kind}:${source.refId}`,
      title: guide.title,
      link: `/m/guias/${guide.id}`,
    });
  }

  for (const review of data.guideReviews) {
    const guide = data.guides.find((g) => g.id === review.guideId);
    if (!guide || guide.withdrawnAt) continue;
    entries.push({
      kind: 'revision-guia',
      memberId: review.reviewerId,
      at: review.createdAt,
      refId: review.id,
      limitKey: `${review.guideId}:${review.guideVersion}`,
      title: `${guide.title} (versión ${review.guideVersion})`,
      link: `/m/guias/${guide.id}`,
    });
  }

  // El servidor conserva el origen incluso si el primer registro fue retirado y ya no
  // puede leerse. Solo publica fecha y referencia del aporte actual, nunca su contenido.
  const origins = new Map((data.contributionOrigins ?? []).map((origin) => [
    JSON.stringify([origin.kind, origin.refId, origin.memberId]), origin,
  ]));
  return entries.map((entry) => {
    const origin = origins.get(JSON.stringify([entry.kind, entry.refId, entry.memberId]));
    return origin ? { ...entry, at: origin.creditedAt, excluded: entry.excluded || (origin.duplicateOf
      ? 'Es una copia idéntica de un aporte anterior del mismo autor y contexto.' : undefined) } : entry;
  });
}

export function scoreEntries(
  entries: ContributionEntry[],
  window: ContributionWindow,
): ScoredEntry[] {
  return scoreContributions(entries, window) as ScoredEntry[];
}

export type PeriodId = 'parcial' | 'cuatrimestre' | 'mes' | 'todo';

export interface LeaderboardPeriod {
  id: PeriodId;
  label: string;
  /** Explicación corta del rango, para el encabezado. */
  detail: string;
  window: ContributionWindow;
  /** Identidad estable del rango, independiente de etiquetas y zona del dispositivo. */
  key: string;
}

/**
 * Periodos del leaderboard. Con fechas en Ajustes: parcial y cuatrimestre vigentes; sin ellas,
 * los últimos 30 días. «Todo» siempre está.
 */
export function leaderboardPeriods(
  calendar: readonly TermDates[],
  now = new Date(),
): LeaderboardPeriod[] {
  const placement = currentTerm(calendar, now.toISOString().slice(0, 10));
  const all: LeaderboardPeriod = {
    id: 'todo',
    key: 'todo',
    label: 'Todo',
    detail: 'Desde el inicio',
    window: {},
  };
  if (!placement) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
    return [
      { id: 'mes', key: `mes:${from.toISOString().slice(0, 10)}`, label: 'Últimos 30 días', detail: 'Últimos 30 días', window: { from } },
      all,
    ];
  }
  const terms = calendar.filter((entry) => entry.period === placement.period);
  const periodStart = terms.reduce(
    (min, t) => (t.startDate < min ? t.startDate : min),
    placement.startDate,
  );
  // Sin fecha de fin: el parcial vigente sigue contando hasta que empiece el siguiente.
  return [
    {
      id: 'parcial',
      key: `parcial:${placement.period}:${placement.term}:${placement.startDate}`,
      label: `Parcial ${placement.term}`,
      detail: `Parcial ${placement.term} del cuatrimestre ${placement.period}`,
      window: { from: parseDay(placement.startDate) },
    },
    {
      id: 'cuatrimestre',
      key: `cuatrimestre:${placement.period}:${periodStart}`,
      label: 'Cuatrimestre',
      detail: `Cuatrimestre ${placement.period}`,
      window: { from: parseDay(periodStart) },
    },
    all,
  ];
}

export interface LeaderChange {
  memberId: Id;
  /** Momento del aporte con el que llegó al #1. */
  at: Date;
  /** Con quién comparte el #1 en ese momento; vacío si lo tiene sola. */
  tiedWith: Id[];
  points: number;
  periodLabel: string;
  periodKey: string;
}

/**
 * Cada vez que alguien entra al #1 del periodo vigente (el que abre el leaderboard), sola o
 * empatada. Recorre los aportes con puntos en orden y recalcula los totales tras cada uno.
 */
export function leaderChanges(data: RankingContributionData, now = new Date()): LeaderChange[] {
  const period = leaderboardPeriods(data.calendar, now)[0]!;
  return leaderChangesForPeriod(data, period);
}

/** También verifica avisos históricos sin incluir aportes de parciales posteriores. */
export function leaderChangesForPeriod(data: RankingContributionData, period: LeaderboardPeriod): LeaderChange[] {
  const active = new Set(data.members.filter((m) => m.status === 'active').map((m) => m.id));
  const scored = scoreEntries(contributionEntries(data), period.window)
    .filter((event) => event.points > 0 && active.has(event.memberId))
    .reverse();
  const totals = new Map<Id, number>();
  let leaders = new Set<Id>();
  const changes: LeaderChange[] = [];
  for (const event of scored) {
    totals.set(event.memberId, (totals.get(event.memberId) ?? 0) + event.points);
    const top = Math.max(...totals.values());
    const next = new Set([...totals].filter(([, points]) => points === top).map(([id]) => id));
    for (const id of next) {
      if (!leaders.has(id)) {
        changes.push({ memberId: id, at: event.at, tiedWith: [...next].filter((other) => other !== id), points: top, periodLabel: period.label, periodKey: period.key });
      }
    }
    leaders = next;
  }
  return changes;
}

export const rankingFeedId = (change: LeaderChange) => `${change.periodKey}|${change.memberId}|${change.at.getTime()}`;
