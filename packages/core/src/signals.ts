import { sha256 } from '@noble/hashes/sha2.js';

/** Shared state machine: both the demo and the server use these rules. No providers or sensors. */
export type SignalMedium = 'pen' | 'foot' | 'knuckle';
export type SignalKind = 'reference' | 'answer' | 'separator' | 'repeat' | 'confirm' | 'end';
export interface SignalDefinition { id: string; label: string; kind: SignalKind; value: string; medium: SignalMedium; pattern: string[]; example: string; }
export interface SignalSource { kind: 'note' | 'work'; id: string; version: number; location: string; }
export interface SignalDictionary { id: string; authorId: string; subjectId: string; topic: string; title: string; draft: SignalDefinition[]; version: number; publishedVersion: number; archived: boolean; proposalFor?: string; proposalVersion?: number; createdAt: number; updatedAt: number; }
export interface SignalVersion { id: string; dictionaryId: string; number: number; authorId: string; subjectId: string; topic: string; title: string; definitions: SignalDefinition[]; createdAt: number; }
export interface SignalRecommendation { id: string; subjectId: string; topic: string; dictionaryId: string; version: number; updatedBy: string; updatedAt: number; }
export interface SignalMessage { id: string; authorId: string; dictionaryId: string; dictionaryVersion: number; medium: SignalMedium; reference: string; answer: string; repeat: boolean; sequence: string[][]; version: number; createdAt: number; deletedAt?: number; }
export type SignalExerciseMode = 'recognize' | 'encode';
export interface SignalAttempt { id: string; authorId: string; dictionaryId: string; dictionaryVersion: number; medium: SignalMedium; mode: SignalExerciseMode; prompt: string; sequence: string[][]; options: string[]; expected?: string; response?: string; correct?: boolean; status: 'pending' | 'answered' | 'abandoned'; version: number; createdAt: number; finishedAt?: number; deletedAt?: number; }
export type SignalSessionStatus = 'pending' | 'accepted' | 'active' | 'finished' | 'rejected' | 'cancelled' | 'expired';
export interface SignalSession { id: string; hostId: string; guestId: string; dictionaryId: string; dictionaryVersion: number; medium: SignalMedium; status: SignalSessionStatus; turnNumber: number; version: number; createdAt: number; updatedAt: number; expiresAt: number; removedBy: Record<string, number>; }
export interface SignalTurn { id: string; sessionId: string; number: number; senderId: string; receiverId: string; sequence: string[][]; expected?: string; response?: string; correct?: boolean; status: 'pending' | 'answered'; version: number; createdAt: number; finishedAt?: number; }
export interface SignalCard { id: string; authorId: string; subjectId: string; topic: string; reference: string; body: string; conditions: string; support: string; source?: SignalSource; sourceAvailable?: boolean; version: number; createdAt: number; updatedAt: number; deletedAt?: number; }
export interface SignalCardRevision { id: string; cardId: string; authorId: string; number: number; card: SignalCard; createdAt: number; }
export interface SignalReceipt { id: string; actor: string; requestId: string; command: string; resultId?: string; createdAt: number; }
export interface SignalState { dictionaries: SignalDictionary[]; versions: SignalVersion[]; recommendations: SignalRecommendation[]; messages: SignalMessage[]; attempts: SignalAttempt[]; sessions: SignalSession[]; turns: SignalTurn[]; cards: SignalCard[]; cardRevisions: SignalCardRevision[]; receipts: SignalReceipt[]; }
export type SignalsState = SignalState;
export interface SignalTrashItem { kind: 'message' | 'attempt' | 'card' | 'session'; id: string; title: string; deletedAt: number; version: number; }
export interface SignalsSnapshot { dictionaries: SignalDictionary[]; versions: SignalVersion[]; recommendations: SignalRecommendation[]; messages: SignalMessage[]; attempts: SignalAttempt[]; sessions: SignalSession[]; turns: SignalTurn[]; cards: SignalCard[]; cardRevisions: SignalCardRevision[]; trash: SignalTrashItem[]; receipts: { requestId: string; id?: string }[]; }
export interface SignalContext { actor: string; now: number; activeMembers: string[]; subjects: string[]; isAdmin: boolean; source(kind: 'note' | 'work', id: string): { subjectId: string; version: number } | undefined; }
type SignalMutation = { requestId: string };
type SignalDictionaryRef = { dictionaryId: string; dictionaryVersion: number; medium: SignalMedium };
type SignalCardInput = { subjectId: string; topic: string; reference: string; body: string; conditions: string; support: string; source?: SignalSource };
export type SignalCommand = SignalMutation & (
  | { action: 'createDictionary'; subjectId: string; topic: string; title: string; definitions: SignalDefinition[]; proposalFor?: string }
  | { action: 'saveDictionary'; dictionaryId: string; expectedVersion: number; title: string; topic: string; definitions: SignalDefinition[] }
  | { action: 'publishDictionary'; dictionaryId: string; expectedVersion: number }
  | { action: 'acceptProposal'; dictionaryId: string; proposalId: string; expectedVersion: number; proposalVersion: number }
  | { action: 'archiveDictionary'; dictionaryId: string; expectedVersion: number; archived: boolean }
  | { action: 'recommendDictionary'; dictionaryId: string; expectedVersion: number }
  | ({ action: 'saveMessage'; reference: string; answer: string; repeat: boolean } & SignalDictionaryRef)
  | ({ action: 'startAttempt'; mode: SignalExerciseMode } & SignalDictionaryRef)
  | { action: 'answerAttempt'; attemptId: string; expectedVersion: number; answer: string }
  | { action: 'abandonAttempt'; attemptId: string; expectedVersion: number }
  | ({ action: 'invitePartner'; guestId: string } & SignalDictionaryRef)
  | { action: 'respondInvitation'; sessionId: string; expectedVersion: number; accept: boolean }
  | { action: 'startSession' | 'endSession' | 'cancelSession'; sessionId: string; expectedVersion: number }
  | { action: 'sendTurn'; sessionId: string; expectedVersion: number; reference: string; answer: string; repeat: boolean }
  | { action: 'answerTurn'; turnId: string; expectedVersion: number; answer: string }
  | ({ action: 'saveCard'; cardId?: string; expectedVersion: number } & SignalCardInput)
  | { action: 'trash' | 'restore'; kind: SignalTrashItem['kind']; id: string; expectedVersion: number }
);
export const SIGNAL_MEDIUM_LABELS: Record<SignalMedium, string> = { pen: 'Lápices y plumas', foot: 'Zapateadas', knuckle: 'Nudillos' };
export const SIGNAL_LIMITS = { title: 160, topic: 240, meaning: 500, example: 2_000, card: 4_000, definitions: 200, messageElements: 64, turns: 30, storageBytes: 2 * 1_024 * 1_024, groupStorageBytes: 20 * 1_024 * 1_024, cleanupStorageBytes: 1_024 * 1_024, groupCleanupStorageBytes: 2 * 1_024 * 1_024, receipts: 5_000, cleanupReceipts: 2_000, retentionMs: 30 * 86_400_000, invitationMs: 7 * 86_400_000 } as const;

export function emptySignalsState(): SignalState { return { dictionaries: [], versions: [], recommendations: [], messages: [], attempts: [], sessions: [], turns: [], cards: [], cardRevisions: [], receipts: [] }; }
export function emptySignalsSnapshot(): SignalsSnapshot { return { ...emptySignalsState(), trash: [], receipts: [] }; }

const MEDIA: SignalMedium[] = ['pen', 'foot', 'knuckle'];
const KINDS: SignalKind[] = ['reference', 'answer', 'separator', 'repeat', 'confirm', 'end'];
const fail = (message: string): never => { throw new Error(message); };
function text(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== 'string') return fail(`${label} no es válido.`);
  const result = value.trim();
  if ((required && !result) || result.length > max) return fail(`${label} debe tener ${required ? 'entre 1 y' : 'hasta'} ${max} caracteres.`);
  return result;
}
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('El envío no es válido.'); return value as Record<string, unknown>; }
function int(value: unknown, label: string, min = 0): number { if (!Number.isSafeInteger(value) || Number(value) < min) return fail(`${label} no es válido.`); return Number(value); }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') return fail('El valor debe ser verdadero o falso.'); return value; }
function medium(value: unknown): SignalMedium { if (!MEDIA.includes(value as SignalMedium)) return fail('El medio no es válido.'); return value as SignalMedium; }
function identifier(value: unknown): string { return text(value, 'El identificador', 240); }
function request(value: unknown): string { const result = text(value, 'El identificador de envío', 128); if (!/^[a-zA-Z0-9._:-]+$/.test(result)) return fail('El identificador de envío no es válido.'); return result; }
function reference(value: unknown): string { const result = text(value, 'La referencia', 3); if (!/^\d{1,3}$/.test(result)) return fail('Usa de uno a tres dígitos para la referencia.'); return result; }
function answer(value: unknown): string { return text(value, 'La respuesta', 32).toUpperCase(); }
function expectVersion(actual: number, expected: unknown): void { if (int(expected, 'La versión') !== actual) fail('La versión cambió. Conserva tu borrador y carga la versión actual antes de guardar.'); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function canonical(value: unknown): string {
  // Key order is irrelevant when retrying an otherwise identical JSON command.
  const sorted = (item: unknown): unknown => Array.isArray(item) ? item.map(sorted)
    : item && typeof item === 'object' ? Object.keys(item).sort().filter((key) => (item as Record<string, unknown>)[key] !== undefined).map((key) => [key, sorted((item as Record<string, unknown>)[key])]) : item;
  return JSON.stringify(sorted(value));
}
function compactFingerprint(value: string): string { return `sha256:${Array.from(sha256(new TextEncoder().encode(value)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`; }
function member(ctx: SignalContext): void { if (!ctx.actor || !ctx.activeMembers.includes(ctx.actor)) fail('Tu cuenta no tiene acceso activo al grupo.'); }
function subject(ctx: SignalContext, id: unknown): string { const result = identifier(id); if (!ctx.subjects.includes(result)) return fail('La materia no está disponible.'); return result; }
function own(owner: string, ctx: SignalContext): void { if (owner !== ctx.actor) fail('Solo su autor puede hacer este cambio.'); }
function hash(value: string): number { let result = 2_166_136_261; for (let i = 0; i < value.length; i++) { result ^= value.charCodeAt(i); result = Math.imul(result, 16_777_619); } return result >>> 0; }
function removedSessionCopyExpired(row: SignalSession, actor: string, now: number): boolean {
  const removedAt = row.removedBy[actor]; return removedAt !== undefined && removedAt + SIGNAL_LIMITS.retentionMs <= now;
}
function enforceStorage(state: SignalState, actor: string, now: number, cleanup: boolean): void {
  let groupBytes = 0; let actorBytes = 0;
  const actorLimit = SIGNAL_LIMITS.storageBytes + (cleanup ? SIGNAL_LIMITS.cleanupStorageBytes : 0);
  const groupLimit = SIGNAL_LIMITS.groupStorageBytes + (cleanup ? SIGNAL_LIMITS.groupCleanupStorageBytes : 0);
  const sessions = new Map(state.sessions.map((row) => [row.id, row]));
  for (const collection of Object.values(state)) for (const row of collection) {
    const json = JSON.stringify(row); let bytes = 0;
    for (const character of json) { const point = character.codePointAt(0)!; bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4; }
    groupBytes += bytes;
    const owner = 'authorId' in row ? row.authorId : 'actor' in row ? row.actor : 'hostId' in row ? row.hostId : 'senderId' in row ? row.senderId : 'updatedBy' in row ? row.updatedBy : undefined;
    if (owner === actor) {
      const session = 'hostId' in row ? row : 'sessionId' in row ? sessions.get(row.sessionId) : undefined;
      // The remaining participant keeps shared history within the group budget; an
      // expired personal deletion must not permanently consume its former owner's quota.
      if (!session || !removedSessionCopyExpired(session, actor, now)) actorBytes += bytes;
    }
    if (groupBytes > groupLimit) return fail(cleanup ? 'Se agotó la reserva compartida de limpieza. Espera a la purga programada de la papelera.' : 'El módulo alcanzó la cuota compartida de 20 MiB. Conserva tu borrador y revisa la conservación del contenido.');
    if (actorBytes > actorLimit) return fail(cleanup ? 'Se agotó tu reserva de limpieza. Espera a la purga programada de la papelera.' : 'Alcanzaste la cuota de 2 MiB del módulo. Conserva tu borrador y revisa tu contenido y papelera.');
  }
}

/** Five tokens per convention make the built-in examples prefix-free in each medium. */
export function starterSignalDefinitions(): SignalDefinition[] {
  const semantics: { kind: SignalKind; value: string; label: string }[] = [
    ...Array.from({ length: 10 }, (_, digit) => ({ kind: 'reference' as const, value: String(digit), label: `Dígito ${digit}` })),
    ...['A', 'B', 'C', 'D'].map((value) => ({ kind: 'answer' as const, value, label: `Respuesta ${value}` })),
    { kind: 'separator', value: 'separator', label: 'Separar referencia y respuesta' },
    { kind: 'repeat', value: 'repeat', label: 'Solicitar repetición' },
    { kind: 'confirm', value: 'confirm', label: 'Confirmación' },
    { kind: 'end', value: 'end', label: 'Final del mensaje' },
  ];
  return MEDIA.flatMap((item) => semantics.map((entry, index) => ({
    id: `${item}:${entry.kind}:${entry.value}`, medium: item, ...entry,
    pattern: index.toString(2).padStart(5, '0').split('').map((bit) => item === 'pen' ? bit === '0' ? 'horizontal' : 'vertical' : bit === '0' ? 'golpe' : 'pausa'),
    example: 'Convención de ejemplo editable; cada bloque representa una señal completa.',
  })));
}

export function validateSignalDefinitions(input: unknown, publish = false): SignalDefinition[] {
  if (!Array.isArray(input) || !input.length || input.length > SIGNAL_LIMITS.definitions) return fail('Añade entre 1 y 200 señales.');
  const ids = new Set<string>();
  const result = input.map((raw): SignalDefinition => {
    const value = record(raw); const id = text(value.id, 'La identidad de la señal', 128);
    if (!/^[a-zA-Z0-9._:-]+$/.test(id) || ids.has(id)) return fail('Cada señal debe tener una identidad única y válida.');
    ids.add(id); const kind = value.kind as SignalKind;
    if (!KINDS.includes(kind)) return fail('El tipo de señal no es válido.');
    const itemMedium = medium(value.medium);
    let meaning = text(value.value, 'El significado', SIGNAL_LIMITS.meaning);
    if (kind === 'reference') { if (!/^\d$/.test(meaning)) return fail('Una señal de referencia representa un solo dígito.'); }
    else if (kind === 'answer') meaning = answer(meaning);
    else meaning = kind;
    if (!Array.isArray(value.pattern) || !value.pattern.length || value.pattern.length > 16) return fail('Una señal debe contener de 1 a 16 elementos.');
    const pattern = value.pattern.map((part) => {
      const token = text(part, 'Cada elemento de la señal', 32).toLowerCase().replace(/\s+/g, '-');
      if (!/^[\p{L}\p{N}_-]+$/u.test(token)) return fail('Los elementos de la señal usan palabras, números o guiones, sin separadores de mensaje.');
      return token;
    });
    return { id, label: text(value.label, 'El nombre de la señal', SIGNAL_LIMITS.title), kind, value: meaning, medium: itemMedium, pattern, example: text(value.example, 'El ejemplo', SIGNAL_LIMITS.example, false) };
  });
  for (const itemMedium of MEDIA) {
    const entries = result.filter((row) => row.medium === itemMedium); const meanings = new Set<string>();
    for (let a = 0; a < entries.length; a++) {
      const row = entries[a]!; const key = `${row.kind}:${row.value}`;
      if (meanings.has(key)) fail('Cada significado debe tener una sola señal por medio.');
      meanings.add(key);
      if (publish) for (let b = a + 1; b < entries.length; b++) {
        const other = entries[b]!; const common = Math.min(row.pattern.length, other.pattern.length);
        if (row.pattern.slice(0, common).every((token, index) => token === other.pattern[index])) fail(`Las señales «${row.label}» y «${other.label}» son idénticas o tienen un prefijo ambiguo.`);
      }
    }
    if (publish && entries.length) {
      if (Array.from({ length: 10 }, (_, digit) => `reference:${digit}`).some((key) => !meanings.has(key)) || !entries.some((entry) => entry.kind === 'answer')
        || ['separator', 'repeat', 'confirm', 'end'].some((kind) => !meanings.has(`${kind}:${kind}`))) fail('Para publicar cada medio necesita los diez dígitos, respuestas, separación, repetición, confirmación y final.');
    }
  }
  return result;
}

export function encodeSignalMessage(definitions: SignalDefinition[], itemMedium: SignalMedium, question: string, response: string, repeat = false): string[][] {
  const available = validateSignalDefinitions(definitions, true).filter((entry) => entry.medium === medium(itemMedium));
  const ref = reference(question); const result = answer(response); bool(repeat);
  const find = (kind: SignalKind, value?: string): string[] => {
    const entry = available.find((item) => item.kind === kind && (value === undefined || item.value === value));
    if (!entry) return fail(`El diccionario no contiene la señal necesaria: ${value ?? kind}.`);
    return [...entry.pattern];
  };
  const sequence = [...ref].map((digit) => find('reference', digit));
  sequence.push(find('separator'), find('answer', result));
  if (repeat) sequence.push(find('repeat'));
  sequence.push(find('confirm'), find('end'));
  if (sequence.length > SIGNAL_LIMITS.messageElements) fail('El mensaje supera 64 elementos.');
  return sequence;
}
export function signalSequenceText(sequence: string[][]): string { return sequence.map((part) => part.join(' ')).join(' / '); }
export function signalInterpretation(reference: string, answer: string): string { return `${reference} → ${answer}`; }
function sourceAvailable(ctx: SignalContext, source: SignalSource | undefined, subjectId: string): boolean {
  if (!source) return true;
  try { const row = ctx.source(source.kind, source.id); return !!row && row.subjectId === subjectId; } catch { return false; }
}
function cardProjection(card: SignalCard, ctx: SignalContext): SignalCard {
  const available = sourceAvailable(ctx, card.source, card.subjectId);
  return { ...card, sourceAvailable: available, source: available ? card.source : undefined };
}
function sessionStatus(session: SignalSession, ctx: SignalContext): SignalSessionStatus {
  if (session.status === 'pending' && session.expiresAt <= ctx.now) return 'expired';
  if (['pending', 'accepted', 'active'].includes(session.status) && (!ctx.activeMembers.includes(session.hostId) || !ctx.activeMembers.includes(session.guestId))) return 'cancelled';
  return session.status;
}
function visibleSession(session: SignalSession, actor: string): boolean { return (session.hostId === actor || session.guestId === actor) && session.removedBy[actor] === undefined; }
export function projectSignals(state: SignalState, ctx: SignalContext): SignalsSnapshot {
  if (!ctx.activeMembers.includes(ctx.actor)) return emptySignalsSnapshot();
  const sessions = state.sessions.filter((row) => visibleSession(row, ctx.actor));
  const sessionIds = new Set(sessions.filter((row) => row.status !== 'pending').map((row) => row.id));
  const cards = state.cards.filter((row) => row.authorId === ctx.actor && row.deletedAt === undefined);
  const cardIds = new Set(cards.map((row) => row.id));
  const dictionaries = state.dictionaries.filter((row) => row.authorId === ctx.actor || row.publishedVersion > 0).map((row) => {
    if (row.authorId === ctx.actor) return row;
    const published = state.versions.find((version) => version.dictionaryId === row.id && version.number === row.publishedVersion);
    return { ...row, title: published?.title ?? '', topic: published?.topic ?? '', draft: [] };
  });
  const dictionaryIds = new Set(dictionaries.map((row) => row.id));
  const trash: SignalTrashItem[] = [];
  for (const [kind, rows] of [['message', state.messages], ['attempt', state.attempts], ['card', state.cards]] as const) for (const row of rows) {
    if (row.authorId === ctx.actor && row.deletedAt !== undefined && row.deletedAt + SIGNAL_LIMITS.retentionMs > ctx.now) trash.push({ kind, id: row.id, title: kind === 'card' ? (row as SignalCard).reference : kind === 'message' ? 'Mensaje guardado' : 'Práctica individual', deletedAt: row.deletedAt, version: row.version });
  }
  for (const row of state.sessions) { const deletedAt = row.removedBy[ctx.actor]; if (deletedAt !== undefined && deletedAt + SIGNAL_LIMITS.retentionMs > ctx.now && (row.hostId === ctx.actor || row.guestId === ctx.actor)) trash.push({ kind: 'session', id: row.id, title: 'Práctica en pareja', deletedAt, version: row.version }); }
  return clone({
    dictionaries, versions: state.versions.filter((row) => dictionaryIds.has(row.dictionaryId)),
    recommendations: state.recommendations.filter((row) => { const dictionary = state.dictionaries.find((entry) => entry.id === row.dictionaryId); return dictionary && !dictionary.archived && dictionary.publishedVersion > 0; }),
    messages: state.messages.filter((row) => row.authorId === ctx.actor && row.deletedAt === undefined),
    attempts: state.attempts.filter((row) => row.authorId === ctx.actor && row.deletedAt === undefined).map((row) => row.status === 'pending' ? { ...row, expected: undefined, sequence: row.mode === 'encode' ? [] : row.sequence } : row),
    sessions: sessions.map((row) => ({ ...row, status: sessionStatus(row, ctx), removedBy: {} })),
    turns: state.turns.filter((row) => sessionIds.has(row.sessionId)).map((row) => row.status === 'pending' && row.receiverId === ctx.actor ? { ...row, expected: undefined } : row),
    cards: cards.map((row) => cardProjection(row, ctx)),
    cardRevisions: state.cardRevisions.filter((row) => row.authorId === ctx.actor && cardIds.has(row.cardId)).map((row) => ({ ...row, card: cardProjection(row.card, ctx) })),
    trash, receipts: state.receipts.filter((row) => row.actor === ctx.actor).map((row) => ({ requestId: row.requestId, ...(row.resultId ? { id: row.resultId } : {}) })),
  });
}

/** The scheduler calls this independently of any member's privileges. Shared history survives one participant's deletion. */
export function purgeSignals(input: SignalState, now: number): SignalState {
  const state = clone(input); const cutoff = now - SIGNAL_LIMITS.retentionMs;
  state.messages = state.messages.filter((row) => row.deletedAt === undefined || row.deletedAt > cutoff);
  state.attempts = state.attempts.filter((row) => row.deletedAt === undefined || row.deletedAt > cutoff);
  state.cards = state.cards.filter((row) => row.deletedAt === undefined || row.deletedAt > cutoff);
  const cards = new Set(state.cards.map((row) => row.id)); state.cardRevisions = state.cardRevisions.filter((row) => cards.has(row.cardId));
  state.sessions = state.sessions.filter((row) => !(row.removedBy[row.hostId] !== undefined && row.removedBy[row.hostId]! <= cutoff && row.removedBy[row.guestId] !== undefined && row.removedBy[row.guestId]! <= cutoff));
  for (const row of state.sessions) if (row.status === 'pending' && row.expiresAt <= now) { row.status = 'expired'; row.version++; row.updatedAt = now; }
  const sessions = new Set(state.sessions.map((row) => row.id)); state.turns = state.turns.filter((row) => sessions.has(row.sessionId));
  // Keep compact tombstones so a delayed network retry cannot resurrect a purged entity.
  const live = new Set<string>([...state.dictionaries, ...state.messages, ...state.attempts, ...state.sessions, ...state.turns, ...state.cards, ...state.recommendations].map((row) => row.id));
  const turnsById = new Map(state.turns.map((row) => [row.id, row])); const sessionsById = new Map(state.sessions.map((row) => [row.id, row]));
  state.receipts = state.receipts.map((row) => {
    if (row.createdAt > cutoff || !row.resultId) return row;
    const turn = turnsById.get(row.resultId);
    const session = sessionsById.get(turn?.sessionId ?? row.resultId);
    return !live.has(row.resultId) || (session && removedSessionCopyExpired(session, row.actor, now)) ? { ...row, command: '', resultId: undefined } : row;
  });
  return state;
}

function getDictionary(state: SignalState, id: unknown): SignalDictionary { return state.dictionaries.find((row) => row.id === identifier(id)) ?? fail('El diccionario no está disponible.'); }
function getVersion(state: SignalState, raw: Record<string, unknown>, newUse: boolean): { dictionary: SignalDictionary; version: SignalVersion; medium: SignalMedium } {
  const dictionary = getDictionary(state, raw.dictionaryId); const number = int(raw.dictionaryVersion, 'La versión del diccionario', 1);
  if ((newUse && dictionary.archived) || dictionary.publishedVersion < number) return fail('Esta versión del diccionario no está disponible para nuevas prácticas.');
  const version = state.versions.find((row) => row.dictionaryId === dictionary.id && row.number === number) ?? fail('La versión no está disponible.');
  const itemMedium = medium(raw.medium);
  if (!version.definitions.some((row) => row.medium === itemMedium)) return fail('Esta versión no ofrece ese medio.');
  return { dictionary, version, medium: itemMedium };
}
function getSession(state: SignalState, id: unknown, ctx: SignalContext, allowRemoved = false): SignalSession {
  const row = state.sessions.find((item) => item.id === identifier(id));
  if (!row || (row.hostId !== ctx.actor && row.guestId !== ctx.actor) || (!allowRemoved && row.removedBy[ctx.actor] !== undefined)) return fail('La sesión no está disponible.');
  return row;
}
function activeSession(row: SignalSession, ctx: SignalContext): void { if (sessionStatus(row, ctx) !== 'active') fail('La sesión no está en curso o uno de sus participantes perdió acceso.'); }
function sessionCountsFor(state: SignalState, row: SignalSession, actor: string, now: number): boolean {
  if (removedSessionCopyExpired(row, actor, now)) return false;
  if (row.hostId === actor) return true;
  if (row.guestId !== actor) return false;
  // A sender cannot consume another person's capacity just by sending invitations.
  return ['accepted', 'active', 'finished'].includes(row.status) || state.turns.some((turn) => turn.sessionId === row.id);
}
function normalizeResponse(value: unknown): string { return text(value, 'Tu respuesta', 8_000).replace(/->/g, '→').replace(/\s+/g, ' ').toLocaleUpperCase('es'); }
function readSource(raw: unknown, ctx: SignalContext, subjectId: string): SignalSource | undefined {
  if (raw === undefined) return undefined;
  const value = record(raw);
  if (value.kind !== 'note' && value.kind !== 'work') return fail('El tipo de fuente no es válido.');
  const source: SignalSource = { kind: value.kind, id: identifier(value.id), version: int(value.version, 'La versión de la fuente', 1), location: text(value.location, 'La ubicación de la fuente', 500, false) };
  let available: ReturnType<SignalContext['source']>;
  try { available = ctx.source(source.kind, source.id); } catch { return fail('La fuente no está disponible.'); }
  if (!available || available.subjectId !== subjectId || available.version !== source.version) return fail('La fuente no está disponible o cambió de versión. Selecciona la fuente actual.');
  return source;
}
function addVersion(state: SignalState, row: SignalDictionary, ctx: SignalContext): void {
  const definitions = validateSignalDefinitions(row.draft, true); const number = row.publishedVersion + 1;
  state.versions.push({ id: `${row.id}#${number}`, dictionaryId: row.id, number, authorId: ctx.actor, subjectId: row.subjectId, title: row.title, topic: row.topic, definitions: clone(definitions), createdAt: ctx.now });
  row.publishedVersion = number; row.version++; row.updatedAt = ctx.now;
}

export function applySignalCommand(input: SignalState, command: unknown, ctx: SignalContext): { state: SignalState; id?: string } {
  member(ctx); int(ctx.now, 'La fecha');
  const raw = record(command); const requestId = request(raw.requestId); const action = text(raw.action, 'La operación', 64);
  const completeCommand = canonical(raw); if (completeCommand.length > 650_000) return fail('El envío es demasiado grande.');
  const cleanup = action === 'trash';
  // Only removing content can consume the cleanup reserve. Its receipt never
  // retains arbitrary extra payload; the full command still participates in replay equality.
  const fingerprint = cleanup ? compactFingerprint(completeCommand) : completeCommand;
  const state = purgeSignals(input, ctx.now);
  const previous = state.receipts.find((row) => row.actor === ctx.actor && row.requestId === requestId);
  if (previous) {
    if (!previous.command) return fail('Este envío ya fue procesado y su contenido se eliminó definitivamente.');
    if (previous.command !== fingerprint && previous.command !== completeCommand) return fail('El identificador de envío ya se usó para otro contenido.');
    return { state, id: previous.resultId };
  }
  const receiptLimit = SIGNAL_LIMITS.receipts + (cleanup ? SIGNAL_LIMITS.cleanupReceipts : 0);
  if (input.receipts.filter((row) => row.actor === ctx.actor).length >= receiptLimit) return fail(cleanup ? 'Se agotó tu reserva de operaciones de limpieza.' : 'Has alcanzado el límite de operaciones de este módulo.');
  const id = `${ctx.actor}~${requestId}`; let resultId: string | undefined;
  switch (action) {
    case 'createDictionary': {
      if (state.dictionaries.filter((row) => row.authorId === ctx.actor).length >= 100) return fail('Puedes crear hasta 100 diccionarios.');
      const subjectId = subject(ctx, raw.subjectId); const proposalFor = raw.proposalFor === undefined ? undefined : identifier(raw.proposalFor);
      const parent = proposalFor ? getDictionary(state, proposalFor) : undefined;
      if (parent && (parent.archived || !parent.publishedVersion || parent.subjectId !== subjectId)) return fail('La propuesta necesita un diccionario publicado de la misma materia.');
      state.dictionaries.push({ id, authorId: ctx.actor, subjectId, topic: text(raw.topic, 'El tema', SIGNAL_LIMITS.topic), title: text(raw.title, 'El título', SIGNAL_LIMITS.title), draft: validateSignalDefinitions(raw.definitions), version: 1, publishedVersion: 0, archived: false, proposalFor, proposalVersion: parent?.version, createdAt: ctx.now, updatedAt: ctx.now }); resultId = id; break;
    }
    case 'saveDictionary': {
      const row = getDictionary(state, raw.dictionaryId); own(row.authorId, ctx); expectVersion(row.version, raw.expectedVersion);
      if (row.archived) return fail('Restaura el diccionario antes de editarlo.');
      row.title = text(raw.title, 'El título', SIGNAL_LIMITS.title); row.topic = text(raw.topic, 'El tema', SIGNAL_LIMITS.topic); row.draft = validateSignalDefinitions(raw.definitions); row.version++; row.updatedAt = ctx.now; resultId = row.id; break;
    }
    case 'publishDictionary': {
      const row = getDictionary(state, raw.dictionaryId); own(row.authorId, ctx); expectVersion(row.version, raw.expectedVersion);
      if (row.archived) return fail('Restaura el diccionario antes de publicarlo.');
      if (row.publishedVersion >= 100) return fail('El diccionario admite hasta 100 versiones publicadas.');
      addVersion(state, row, ctx); resultId = row.id; break;
    }
    case 'acceptProposal': {
      const row = getDictionary(state, raw.dictionaryId); own(row.authorId, ctx); expectVersion(row.version, raw.expectedVersion);
      const proposal = getDictionary(state, raw.proposalId); expectVersion(proposal.version, raw.proposalVersion);
      if (row.archived || proposal.archived || proposal.proposalFor !== row.id || !proposal.publishedVersion || row.publishedVersion >= 100) return fail('La propuesta publicada no está disponible para este diccionario.');
      const published = state.versions.find((entry) => entry.dictionaryId === proposal.id && entry.number === proposal.publishedVersion)!;
      row.draft = clone(published.definitions); addVersion(state, row, ctx); resultId = row.id; break;
    }
    case 'archiveDictionary': {
      const row = getDictionary(state, raw.dictionaryId); own(row.authorId, ctx); expectVersion(row.version, raw.expectedVersion);
      row.archived = bool(raw.archived); row.version++; row.updatedAt = ctx.now; resultId = row.id; break;
    }
    case 'recommendDictionary': {
      if (!ctx.isAdmin) return fail('Solo un administrador puede elegir el diccionario recomendado.');
      const row = getDictionary(state, raw.dictionaryId); if (row.archived || !row.publishedVersion) return fail('Elige un diccionario publicado y disponible.');
      const published = state.versions.find((entry) => entry.dictionaryId === row.id && entry.number === row.publishedVersion)!;
      const key = `${row.subjectId}:${published.topic.toLocaleLowerCase('es')}`;
      const recommendation = state.recommendations.find((entry) => entry.id === key); expectVersion(recommendation?.version ?? 0, raw.expectedVersion);
      const next: SignalRecommendation = { id: key, subjectId: row.subjectId, topic: published.topic, dictionaryId: row.id, version: (recommendation?.version ?? 0) + 1, updatedBy: ctx.actor, updatedAt: ctx.now };
      if (recommendation) Object.assign(recommendation, next); else state.recommendations.push(next); resultId = row.id; break;
    }
    case 'saveMessage': {
      if (state.messages.filter((row) => row.authorId === ctx.actor).length >= 500) return fail('Puedes conservar hasta 500 mensajes.');
      const selected = getVersion(state, raw, true); const question = reference(raw.reference); const response = answer(raw.answer); const repeat = bool(raw.repeat);
      state.messages.push({ id, authorId: ctx.actor, dictionaryId: selected.dictionary.id, dictionaryVersion: selected.version.number, medium: selected.medium, reference: question, answer: response, repeat, sequence: encodeSignalMessage(selected.version.definitions, selected.medium, question, response, repeat), version: 1, createdAt: ctx.now }); resultId = id; break;
    }
    case 'startAttempt': {
      if (state.attempts.filter((row) => row.authorId === ctx.actor).length >= 500) return fail('Puedes conservar hasta 500 intentos.');
      const selected = getVersion(state, raw, true); if (raw.mode !== 'recognize' && raw.mode !== 'encode') return fail('El ejercicio no es válido.');
      const answers = selected.version.definitions.filter((entry) => entry.medium === selected.medium && entry.kind === 'answer').map((entry) => entry.value);
      const seed = hash(`${id}:${ctx.now}`); const question = String(seed % 99 + 1); const response = answers[seed % answers.length]!;
      const sequence = encodeSignalMessage(selected.version.definitions, selected.medium, question, response); const expected = raw.mode === 'recognize' ? signalInterpretation(question, response) : signalSequenceText(sequence);
      const options = answers.map((value) => raw.mode === 'recognize' ? signalInterpretation(question, value) : signalSequenceText(encodeSignalMessage(selected.version.definitions, selected.medium, question, value)));
      const offset = Math.floor(seed / 99) % options.length; const rotated = [...options.slice(offset), ...options.slice(0, offset)];
      state.attempts.push({ id, authorId: ctx.actor, dictionaryId: selected.dictionary.id, dictionaryVersion: selected.version.number, medium: selected.medium, mode: raw.mode, prompt: raw.mode === 'recognize' ? 'Interpreta la referencia y la respuesta de esta secuencia.' : `Construye: ${signalInterpretation(question, response)}`, sequence, options: rotated, expected, status: 'pending', version: 1, createdAt: ctx.now }); resultId = id; break;
    }
    case 'answerAttempt':
    case 'abandonAttempt': {
      const row = state.attempts.find((entry) => entry.id === identifier(raw.attemptId)); if (!row || row.deletedAt !== undefined) return fail('El intento no está disponible.'); own(row.authorId, ctx); expectVersion(row.version, raw.expectedVersion);
      if (row.status !== 'pending') return fail('El intento ya terminó.');
      if (action === 'answerAttempt') { row.response = text(raw.answer, 'Tu respuesta', 8_000); row.correct = normalizeResponse(row.response) === normalizeResponse(row.expected); row.status = 'answered'; }
      else row.status = 'abandoned';
      row.finishedAt = ctx.now; row.version++; resultId = row.id; break;
    }
    case 'invitePartner': {
      const selected = getVersion(state, raw, true); const guestId = identifier(raw.guestId);
      if (guestId === ctx.actor || !ctx.activeMembers.includes(guestId)) return fail('Elige a otro integrante activo.');
      if (state.sessions.filter((row) => sessionCountsFor(state, row, ctx.actor, ctx.now)).length >= 200 || state.sessions.filter((row) => sessionCountsFor(state, row, guestId, ctx.now)).length >= 200) return fail('Cada participante puede conservar hasta 200 sesiones.');
      if (state.sessions.filter((row) => row.hostId === ctx.actor && row.status === 'pending').length >= 20) return fail('Puedes tener hasta 20 invitaciones pendientes.');
      state.sessions.push({ id, hostId: ctx.actor, guestId, dictionaryId: selected.dictionary.id, dictionaryVersion: selected.version.number, medium: selected.medium, status: 'pending', turnNumber: 1, version: 1, createdAt: ctx.now, updatedAt: ctx.now, expiresAt: ctx.now + SIGNAL_LIMITS.invitationMs, removedBy: {} }); resultId = id; break;
    }
    case 'respondInvitation': {
      const row = getSession(state, raw.sessionId, ctx); expectVersion(row.version, raw.expectedVersion);
      if (row.guestId !== ctx.actor || sessionStatus(row, ctx) !== 'pending') return fail('La invitación ya no está pendiente para tu cuenta.');
      row.status = bool(raw.accept) ? 'accepted' : 'rejected'; row.version++; row.updatedAt = ctx.now; resultId = row.id; break;
    }
    case 'startSession':
    case 'endSession':
    case 'cancelSession': {
      const row = getSession(state, raw.sessionId, ctx); expectVersion(row.version, raw.expectedVersion); const status = sessionStatus(row, ctx);
      if (action === 'startSession') { if (status !== 'accepted') return fail('Ambos deben aceptar antes de comenzar.'); row.status = 'active'; }
      else if (action === 'endSession') { if (status !== 'active' && status !== 'accepted') return fail('La sesión ya terminó o no ha sido aceptada.'); row.status = 'finished'; }
      else { if (!['pending', 'accepted', 'active'].includes(status)) return fail('La sesión ya terminó.'); row.status = 'cancelled'; }
      row.version++; row.updatedAt = ctx.now; resultId = row.id; break;
    }
    case 'sendTurn': {
      const row = getSession(state, raw.sessionId, ctx); activeSession(row, ctx); expectVersion(row.version, raw.expectedVersion);
      const senderId = row.turnNumber % 2 ? row.hostId : row.guestId; const receiverId = senderId === row.hostId ? row.guestId : row.hostId;
      if (senderId !== ctx.actor) return fail('Ahora le toca enviar a tu compañero.');
      if (row.turnNumber > SIGNAL_LIMITS.turns || state.turns.some((turn) => turn.sessionId === row.id && turn.number === row.turnNumber)) return fail('Resuelve el turno pendiente antes de enviar otro.');
      const selected = getVersion(state, { dictionaryId: row.dictionaryId, dictionaryVersion: row.dictionaryVersion, medium: row.medium }, false);
      const question = reference(raw.reference); const response = answer(raw.answer); const repeat = bool(raw.repeat); const turnId = `${row.id}:turn:${row.turnNumber}`;
      state.turns.push({ id: turnId, sessionId: row.id, number: row.turnNumber, senderId, receiverId, sequence: encodeSignalMessage(selected.version.definitions, row.medium, question, response, repeat), expected: signalInterpretation(question, response), status: 'pending', version: 1, createdAt: ctx.now });
      row.version++; row.updatedAt = ctx.now; resultId = turnId; break;
    }
    case 'answerTurn': {
      const turn = state.turns.find((entry) => entry.id === identifier(raw.turnId)); if (!turn) return fail('El turno no está disponible.');
      const row = getSession(state, turn.sessionId, ctx); activeSession(row, ctx); expectVersion(turn.version, raw.expectedVersion);
      if (turn.receiverId !== ctx.actor || turn.status !== 'pending' || turn.number !== row.turnNumber) return fail('Este turno no espera una respuesta de tu cuenta.');
      turn.response = text(raw.answer, 'Tu interpretación', 8_000); turn.correct = normalizeResponse(turn.response) === normalizeResponse(turn.expected); turn.status = 'answered'; turn.version++; turn.finishedAt = ctx.now;
      row.turnNumber++; row.version++; row.updatedAt = ctx.now; if (row.turnNumber > SIGNAL_LIMITS.turns) row.status = 'finished'; resultId = turn.id; break;
    }
    case 'saveCard': {
      const cardId = raw.cardId === undefined ? undefined : identifier(raw.cardId); const row = cardId ? state.cards.find((entry) => entry.id === cardId) : undefined;
      if (cardId && (!row || row.deletedAt !== undefined)) return fail('La ficha no está disponible.');
      if (row) own(row.authorId, ctx); expectVersion(row?.version ?? 0, raw.expectedVersion);
      if (!row && state.cards.filter((entry) => entry.authorId === ctx.actor).length >= 500) return fail('Puedes conservar hasta 500 fichas.');
      const subjectId = subject(ctx, raw.subjectId); const source = readSource(raw.source, ctx, subjectId);
      const fields = { subjectId, topic: text(raw.topic, 'El tema', SIGNAL_LIMITS.topic), reference: text(raw.reference, 'La pregunta o referencia', 500), body: text(raw.body, 'La anotación', SIGNAL_LIMITS.card), conditions: text(raw.conditions, 'Las condiciones y unidades', 2_000, false), support: text(raw.support, 'El soporte previsto', 160), source, updatedAt: ctx.now };
      const next: SignalCard = row ? { ...row, ...fields, version: row.version + 1 } : { id, authorId: ctx.actor, ...fields, version: 1, createdAt: ctx.now };
      if (row) Object.assign(row, next); else state.cards.push(next);
      if (state.cardRevisions.filter((entry) => entry.cardId === next.id).length >= 100) return fail('La ficha admite hasta 100 revisiones.');
      state.cardRevisions.push({ id: `${next.id}#${next.version}`, cardId: next.id, authorId: ctx.actor, number: next.version, card: clone(next), createdAt: ctx.now }); resultId = next.id; break;
    }
    case 'trash':
    case 'restore': {
      const kind = raw.kind; const target = identifier(raw.id); const restoring = action === 'restore';
      if (kind === 'session') {
        const row = getSession(state, target, ctx, true); expectVersion(row.version, raw.expectedVersion);
        const removedAt = row.removedBy[ctx.actor];
        if (restoring) { if (removedAt === undefined || removedAt + SIGNAL_LIMITS.retentionMs <= ctx.now) return fail('La sesión ya no puede restaurarse.'); delete row.removedBy[ctx.actor]; }
        else { if (removedAt !== undefined) return fail('La sesión ya está en tu papelera.'); row.removedBy[ctx.actor] = ctx.now; if (['pending', 'accepted', 'active'].includes(row.status)) row.status = 'cancelled'; }
        row.version++; row.updatedAt = ctx.now; resultId = row.id;
      } else {
        const rows = kind === 'message' ? state.messages : kind === 'attempt' ? state.attempts : kind === 'card' ? state.cards : fail('El tipo de contenido no es válido.');
        const row = rows.find((entry) => entry.id === target); if (!row) return fail('El contenido no está disponible.'); own(row.authorId, ctx); expectVersion(row.version, raw.expectedVersion);
        if (restoring) { if (row.deletedAt === undefined || row.deletedAt + SIGNAL_LIMITS.retentionMs <= ctx.now) return fail('El contenido ya no puede restaurarse.'); delete row.deletedAt; }
        else {
          if (row.deletedAt !== undefined) return fail('El contenido ya está en la papelera.'); row.deletedAt = ctx.now;
          if (kind === 'attempt' && (row as SignalAttempt).status === 'pending') { (row as SignalAttempt).status = 'abandoned'; (row as SignalAttempt).finishedAt = ctx.now; }
        }
        row.version++; resultId = row.id;
      }
      break;
    }
    default: return fail('La operación de señales no existe.');
  }
  state.receipts.push({ id, actor: ctx.actor, requestId, command: fingerprint, resultId, createdAt: ctx.now });
  enforceStorage(state, ctx.actor, ctx.now, cleanup);
  return { state, id: resultId };
}
