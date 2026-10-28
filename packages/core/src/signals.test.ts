import { describe, expect, it } from 'vitest';
import { applySignalCommand, emptySignalsSnapshot, emptySignalsState, encodeSignalMessage, projectSignals, purgeSignals,
  signalInterpretation, signalSequenceText, SIGNAL_LIMITS, starterSignalDefinitions, validateSignalDefinitions,
  type SignalCommand, type SignalContext, type SignalDefinition, type SignalState } from './signals';

const DAY = 86_400_000;
function fixture() {
  let state = emptySignalsState(); let counter = 0; let actor = 'author'; let now = 1_800_000_000_000;
  let activeMembers = ['author', 'partner', 'other', 'admin'];
  const sources = new Map([['note:101', { subjectId: '1', version: 3 }], ['work:202', { subjectId: '1', version: 2 }], ['note:303', { subjectId: '2', version: 1 }]]);
  const context = (): SignalContext => ({ actor, now, activeMembers, subjects: ['1', '2'], isAdmin: actor === 'admin', source: (kind, id) => sources.get(`${kind}:${id}`) });
  const run = (command: Omit<SignalCommand, 'requestId'> | Record<string, unknown>, requestId = `request-${++counter}`): string => {
    const result = applySignalCommand(state, { ...command, requestId }, context()); state = result.state; return result.id!;
  };
  const dictionary = () => run({ action: 'createDictionary', subjectId: '1', topic: 'Funciones', title: 'Convención del grupo', definitions: starterSignalDefinitions() });
  const published = () => { const id = dictionary(); run({ action: 'publishDictionary', dictionaryId: id, expectedVersion: 1 }); return id; };
  const pair = () => {
    const dictionaryId = published();
    const id = run({ action: 'invitePartner', dictionaryId, dictionaryVersion: 1, medium: 'pen', guestId: 'partner' });
    actor = 'partner'; run({ action: 'respondInvitation', sessionId: id, expectedVersion: 1, accept: true });
    run({ action: 'startSession', sessionId: id, expectedVersion: 2 }); actor = 'author';
    return { id, dictionaryId };
  };
  return { run, dictionary, published, pair, context, sources, state: () => state, snapshot: () => projectSignals(state, context()),
    as: (next: string) => { actor = next; }, at: (next: number) => { now = next; }, now: () => now,
    inactive: (id: string) => { activeMembers = activeMembers.filter((member) => member !== id); },
    replace: (next: SignalState) => { state = next; } };
}

describe('Signal definitions and complete messages', () => {
  it('provides complete prefix-free examples for all three media', () => {
    const definitions = starterSignalDefinitions();
    expect(definitions).toHaveLength(54);
    expect(validateSignalDefinitions(definitions, true)).toEqual(definitions);
    for (const medium of ['pen', 'foot', 'knuckle'] as const) {
      const sequence = encodeSignalMessage(definitions, medium, '120', 'B', true);
      expect(sequence).toHaveLength(8);
      expect(sequence.every((part) => part.length === 5)).toBe(true);
      expect(signalSequenceText(sequence)).toContain(' / ');
    }
  });

  it('rejects both identical representations and a prefix collision at publication', () => {
    const definitions = starterSignalDefinitions();
    definitions[1]!.pattern = [...definitions[0]!.pattern];
    expect(validateSignalDefinitions(definitions)).toHaveLength(54); // Drafts may still be incomplete.
    expect(() => validateSignalDefinitions(definitions, true)).toThrow(/idénticas|ambiguo/);
    definitions[1]!.pattern = [...definitions[0]!.pattern, 'diagonal'];
    expect(() => validateSignalDefinitions(definitions, true)).toThrow(/prefijo ambiguo/);
  });

  it('checks semantic identities, primitives, token boundaries and publication controls', () => {
    const definitions = starterSignalDefinitions();
    expect(() => validateSignalDefinitions({})).toThrow();
    expect(() => validateSignalDefinitions([])).toThrow();
    expect(() => validateSignalDefinitions([...definitions, { ...definitions[0]! }])).toThrow(/identidad única/);
    expect(() => validateSignalDefinitions([{ ...definitions[0]!, medium: 'camera' }])).toThrow(/medio/);
    expect(() => validateSignalDefinitions([{ ...definitions[0]!, pattern: ['a / b'] }])).toThrow(/separadores/);
    expect(() => validateSignalDefinitions([{ ...definitions[0]!, pattern: [] }])).toThrow(/16 elementos/);
    expect(() => validateSignalDefinitions([{ ...definitions[0]!, kind: 'reference', value: '10' }])).toThrow(/solo dígito/);
    const missing = definitions.filter((entry) => entry.medium !== 'pen' || entry.kind !== 'repeat');
    expect(() => validateSignalDefinitions(missing, true)).toThrow(/repetición/);
    const onlyPen = definitions.filter((entry) => entry.medium === 'pen');
    expect(validateSignalDefinitions(onlyPen, true)).toHaveLength(18);
    expect(() => encodeSignalMessage(onlyPen, 'foot', '1', 'A')).toThrow(/necesaria/);
  });

  it('keeps the question context and framing controls and validates messages', () => {
    const definitions = starterSignalDefinitions();
    const sequence = encodeSignalMessage(definitions, 'knuckle', '007', ' a ');
    expect(sequence[0]).toEqual(definitions.find((entry) => entry.medium === 'knuckle' && entry.kind === 'reference' && entry.value === '0')!.pattern);
    expect(sequence.at(-1)).toEqual(definitions.find((entry) => entry.medium === 'knuckle' && entry.kind === 'end')!.pattern);
    expect(signalInterpretation('007', 'A')).toBe('007 → A');
    expect(() => encodeSignalMessage(definitions, 'pen', '', 'A')).toThrow();
    expect(() => encodeSignalMessage(definitions, 'pen', '1000', 'A')).toThrow();
    expect(() => encodeSignalMessage(definitions, 'pen', '1', 'Z')).toThrow(/necesaria/);
  });
});

describe('Dictionary collaboration, versions and idempotency', () => {
  it('never exposes an unpublished dictionary or changes another author draft', () => {
    const f = fixture(); const id = f.dictionary();
    f.as('partner'); expect(f.snapshot().dictionaries).toEqual([]); expect(f.snapshot().versions).toEqual([]);
    expect(() => f.run({ action: 'saveDictionary', dictionaryId: id, expectedVersion: 1, title: 'Otro', topic: 'Otro', definitions: starterSignalDefinitions() })).toThrow(/autor/);
    expect(() => f.run({ action: 'startAttempt', dictionaryId: id, dictionaryVersion: 1, medium: 'pen', mode: 'recognize' })).toThrow(/disponible/);
    f.as('author'); f.run({ action: 'publishDictionary', dictionaryId: id, expectedVersion: 1 });
    f.run({ action: 'saveDictionary', dictionaryId: id, expectedVersion: 2, title: 'Borrador secreto', topic: 'Tema secreto', definitions: starterSignalDefinitions() });
    f.as('partner'); const visible = f.snapshot().dictionaries[0]!;
    expect(visible.title).toBe('Convención del grupo'); expect(visible.topic).toBe('Funciones'); expect(visible.draft).toEqual([]);
  });

  it('fixes versions, blocks outdated saves and keeps historical messages after archival', () => {
    const f = fixture(); const id = f.published();
    const messageId = f.run({ action: 'saveMessage', dictionaryId: id, dictionaryVersion: 1, medium: 'foot', reference: '14', answer: 'C', repeat: false });
    const before = structuredClone(f.state().messages[0]); const definitions = starterSignalDefinitions();
    const patternA = definitions.find((entry) => entry.medium === 'foot' && entry.value === 'A')!;
    const patternB = definitions.find((entry) => entry.medium === 'foot' && entry.value === 'B')!;
    [patternA.pattern, patternB.pattern] = [patternB.pattern, patternA.pattern];
    const update = { action: 'saveDictionary', dictionaryId: id, expectedVersion: 2, title: 'Nueva convención', topic: 'Funciones', definitions };
    f.run(update); expect(() => f.run(update)).toThrow(/versión cambió/);
    f.run({ action: 'publishDictionary', dictionaryId: id, expectedVersion: 3 });
    expect(f.state().versions).toHaveLength(2); expect(f.state().messages[0]).toEqual(before);
    f.run({ action: 'archiveDictionary', dictionaryId: id, expectedVersion: 4, archived: true });
    expect(() => f.run({ action: 'saveMessage', dictionaryId: id, dictionaryVersion: 2, medium: 'foot', reference: '14', answer: 'C', repeat: false })).toThrow(/nuevas prácticas/);
    expect(f.snapshot().messages[0]!.id).toBe(messageId); expect(f.snapshot().versions).toHaveLength(2);
    f.run({ action: 'archiveDictionary', dictionaryId: id, expectedVersion: 5, archived: false });
    expect(f.snapshot().dictionaries[0]!.archived).toBe(false);
  });

  it('retries exactly once, ignores JSON property ordering and rejects a changed payload', () => {
    const f = fixture();
    const command = { action: 'createDictionary', subjectId: '1', topic: 'Funciones', title: 'Convención', definitions: starterSignalDefinitions() };
    const first = f.run(command, 'stable-id');
    const second = f.run({ definitions: command.definitions, title: 'Convención', topic: 'Funciones', subjectId: '1', action: 'createDictionary' }, 'stable-id');
    expect(first).toBe(second); expect(f.state().dictionaries).toHaveLength(1); expect(f.snapshot().receipts).toEqual([{ requestId: 'stable-id', id: first }]);
    expect(() => f.run({ ...command, title: 'Otra' }, 'stable-id')).toThrow(/otro contenido/);
    f.inactive('author'); expect(() => f.run(command, 'stable-id')).toThrow(/acceso activo/);
    expect(f.snapshot()).toEqual(emptySignalsSnapshot());
  });

  it('checks publication transactionally and lets the original author accept a published proposal', () => {
    const f = fixture(); const id = f.published(); const original = structuredClone(f.state());
    const broken = starterSignalDefinitions(); broken[0]!.pattern = [...broken[1]!.pattern];
    f.run({ action: 'saveDictionary', dictionaryId: id, expectedVersion: 2, title: 'Convención', topic: 'Funciones', definitions: broken });
    const badDraft = structuredClone(f.state());
    expect(() => f.run({ action: 'publishDictionary', dictionaryId: id, expectedVersion: 3 })).toThrow(/ambiguo/);
    expect(f.state()).toEqual(badDraft); // A rejected transaction does not partially publish.
    f.replace(original); f.as('partner');
    const proposed = starterSignalDefinitions(); proposed[0]!.example = 'Explicación revisada por el compañero.';
    const proposalId = f.run({ action: 'createDictionary', subjectId: '1', topic: 'Funciones', title: 'Mi propuesta', proposalFor: id, definitions: proposed });
    f.run({ action: 'publishDictionary', dictionaryId: proposalId, expectedVersion: 1 });
    expect(() => f.run({ action: 'acceptProposal', dictionaryId: id, proposalId, expectedVersion: 2, proposalVersion: 2 })).toThrow(/autor/);
    f.as('author'); f.run({ action: 'acceptProposal', dictionaryId: id, proposalId, expectedVersion: 2, proposalVersion: 2 });
    const versions = f.state().versions.filter((row) => row.dictionaryId === id);
    expect(versions).toHaveLength(2); expect(versions[1]!.definitions[0]!.example).toBe(proposed[0]!.example);
    expect(versions[0]!.definitions[0]!.example).not.toBe(proposed[0]!.example);
  });

  it('reserves choosing the common recommendation to an active administrator', () => {
    const f = fixture(); const id = f.published();
    expect(() => f.run({ action: 'recommendDictionary', dictionaryId: id, expectedVersion: 0 })).toThrow(/administrador/);
    f.as('admin'); f.run({ action: 'recommendDictionary', dictionaryId: id, expectedVersion: 0 });
    expect(f.snapshot().recommendations[0]!.dictionaryId).toBe(id);
    expect(() => f.run({ action: 'recommendDictionary', dictionaryId: id, expectedVersion: 0 })).toThrow(/versión cambió/);
    expect(f.snapshot().dictionaries[0]!.draft).toEqual([]); // Admin is still not the author.
  });
});

describe('Private individual practice and server correction', () => {
  it.each(['recognize', 'encode'] as const)('fixes and grades a %s attempt once without leaking its solution', (mode) => {
    const f = fixture(); const dictionaryId = f.published();
    const id = f.run({ action: 'startAttempt', dictionaryId, dictionaryVersion: 1, medium: 'knuckle', mode }, 'exercise');
    const actual = f.state().attempts[0]!; const expected = actual.expected!;
    expect(f.snapshot().attempts[0]!.expected).toBeUndefined();
    expect(f.snapshot().attempts[0]!.options).toHaveLength(4);
    if (mode === 'encode') expect(f.snapshot().attempts[0]!.sequence).toEqual([]);
    else expect(f.snapshot().attempts[0]!.sequence).not.toEqual([]);
    const update = { action: 'answerAttempt', attemptId: id, expectedVersion: 1, answer: expected };
    f.run(update, 'answer'); f.run(update, 'answer');
    expect(f.snapshot().attempts[0]).toMatchObject({ correct: true, status: 'answered', expected, dictionaryVersion: 1, version: 2 });
    expect(() => f.run(update)).toThrow(/versión cambió/);
    f.as('admin'); expect(f.snapshot().attempts).toEqual([]); expect(f.snapshot().receipts).toEqual([]);
    expect(() => f.run({ action: 'answerAttempt', attemptId: id, expectedVersion: 2, answer: 'A' })).toThrow(/autor/);
  });

  it('records confusion, permits abandonment and never exposes private saved messages to another member', () => {
    const f = fixture(); const dictionaryId = f.published();
    const id = f.run({ action: 'startAttempt', dictionaryId, dictionaryVersion: 1, medium: 'pen', mode: 'recognize' });
    f.run({ action: 'answerAttempt', attemptId: id, expectedVersion: 1, answer: 'Respuesta distinta' });
    expect(f.snapshot().attempts[0]!.correct).toBe(false);
    const second = f.run({ action: 'startAttempt', dictionaryId, dictionaryVersion: 1, medium: 'foot', mode: 'encode' });
    f.run({ action: 'abandonAttempt', attemptId: second, expectedVersion: 1 });
    expect(f.snapshot().attempts[1]).toMatchObject({ status: 'abandoned', version: 2 });
    expect(f.snapshot().attempts[1]!.expected).toBeTruthy();
    f.run({ action: 'saveMessage', dictionaryId, dictionaryVersion: 1, medium: 'foot', reference: '9', answer: 'A', repeat: true });
    const snapshot = f.snapshot(); snapshot.messages[0]!.answer = 'mutated'; expect(f.state().messages[0]!.answer).toBe('A');
    f.as('other'); expect(f.snapshot().attempts).toEqual([]); expect(f.snapshot().messages).toEqual([]);
  });
});

describe('Partner invitations and alternating turns', () => {
  it('uses explicit acceptance, hides pending objectives and alternates participants', () => {
    const f = fixture(); const dictionaryId = f.published();
    const id = f.run({ action: 'invitePartner', dictionaryId, dictionaryVersion: 1, medium: 'pen', guestId: 'partner' });
    expect(() => f.run({ action: 'startSession', sessionId: id, expectedVersion: 1 })).toThrow(/aceptar/);
    f.as('other'); expect(f.snapshot().sessions).toEqual([]);
    expect(() => f.run({ action: 'respondInvitation', sessionId: id, expectedVersion: 1, accept: true })).toThrow(/disponible/);
    f.as('partner'); expect(f.snapshot().sessions).toHaveLength(1); expect(f.snapshot().turns).toEqual([]);
    f.run({ action: 'respondInvitation', sessionId: id, expectedVersion: 1, accept: true });
    f.run({ action: 'startSession', sessionId: id, expectedVersion: 2 });
    expect(() => f.run({ action: 'sendTurn', sessionId: id, expectedVersion: 3, reference: '12', answer: 'B', repeat: false })).toThrow(/compañero/);
    f.as('author'); const turnId = f.run({ action: 'sendTurn', sessionId: id, expectedVersion: 3, reference: '12', answer: 'B', repeat: false });
    expect(f.snapshot().turns[0]!.expected).toBe('12 → B');
    expect(() => f.run({ action: 'sendTurn', sessionId: id, expectedVersion: 4, reference: '12', answer: 'B', repeat: false })).toThrow(/pendiente/);
    f.as('partner'); expect(f.snapshot().turns[0]!.expected).toBeUndefined();
    f.run({ action: 'answerTurn', turnId, expectedVersion: 1, answer: '12 -> b' });
    expect(f.snapshot().turns[0]).toMatchObject({ correct: true, status: 'answered', expected: '12 → B' });
    expect(f.snapshot().sessions[0]).toMatchObject({ turnNumber: 2, version: 5 });
    const second = f.run({ action: 'sendTurn', sessionId: id, expectedVersion: 5, reference: '4', answer: 'A', repeat: true });
    f.as('author'); expect(f.snapshot().turns.find((row) => row.id === second)!.expected).toBeUndefined();
    f.run({ action: 'answerTurn', turnId: second, expectedVersion: 1, answer: '4 → D' });
    expect(f.snapshot().turns[1]!.correct).toBe(false);
    f.as('admin'); expect(f.snapshot().turns).toEqual([]); expect(f.snapshot().sessions).toEqual([]);
  });

  it('allows already accepted practice to keep its frozen dictionary after archival', () => {
    const f = fixture(); const pair = f.pair();
    f.run({ action: 'archiveDictionary', dictionaryId: pair.dictionaryId, expectedVersion: 2, archived: true });
    f.run({ action: 'sendTurn', sessionId: pair.id, expectedVersion: 3, reference: '1', answer: 'D', repeat: false });
    expect(f.snapshot().turns).toHaveLength(1);
    expect(() => f.run({ action: 'invitePartner', dictionaryId: pair.dictionaryId, dictionaryVersion: 1, medium: 'pen', guestId: 'other' })).toThrow(/nuevas prácticas/);
  });

  it('expires invitations and stops all turns when either participant loses membership', () => {
    const f = fixture(); const dictionaryId = f.published();
    const id = f.run({ action: 'invitePartner', dictionaryId, dictionaryVersion: 1, medium: 'foot', guestId: 'partner' });
    f.at(f.now() + SIGNAL_LIMITS.invitationMs); f.as('partner');
    expect(f.snapshot().sessions[0]!.status).toBe('expired');
    expect(() => f.run({ action: 'respondInvitation', sessionId: id, expectedVersion: 1, accept: true })).toThrow(/pendiente|versión cambió/);
    const another = fixture(); const pair = another.pair(); another.inactive('partner');
    expect(another.snapshot().sessions[0]!.status).toBe('cancelled');
    expect(() => another.run({ action: 'sendTurn', sessionId: pair.id, expectedVersion: 3, reference: '1', answer: 'A', repeat: false })).toThrow(/perdió acceso/);
    another.as('partner'); expect(another.snapshot()).toEqual(emptySignalsSnapshot());
  });

  it('requires a different active partner and honors rejection, cancellation and ending', () => {
    const f = fixture(); const dictionaryId = f.published();
    for (const guestId of ['author', 'stranger']) expect(() => f.run({ action: 'invitePartner', dictionaryId, dictionaryVersion: 1, medium: 'pen', guestId })).toThrow(/otro integrante/);
    const id = f.run({ action: 'invitePartner', dictionaryId, dictionaryVersion: 1, medium: 'pen', guestId: 'partner' });
    expect(() => f.run({ action: 'respondInvitation', sessionId: id, expectedVersion: 1, accept: true })).toThrow(/pendiente/);
    f.as('partner'); f.run({ action: 'respondInvitation', sessionId: id, expectedVersion: 1, accept: false });
    expect(f.snapshot().sessions[0]!.status).toBe('rejected');
    expect(() => f.run({ action: 'startSession', sessionId: id, expectedVersion: 2 })).toThrow(/aceptar/);
    const another = fixture(); const pair = another.pair(); another.run({ action: 'endSession', sessionId: pair.id, expectedVersion: 3 });
    expect(another.snapshot().sessions[0]!.status).toBe('finished');
    expect(() => another.run({ action: 'sendTurn', sessionId: pair.id, expectedVersion: 4, reference: '1', answer: 'A', repeat: false })).toThrow(/en curso/);
  });

  it('ends after exactly thirty resolved turns', () => {
    const f = fixture(); const pair = f.pair();
    for (let number = 1; number <= 30; number++) {
      f.as(number % 2 ? 'author' : 'partner'); const session = f.state().sessions[0]!;
      const turnId = f.run({ action: 'sendTurn', sessionId: pair.id, expectedVersion: session.version, reference: String(number), answer: 'A', repeat: false });
      f.as(number % 2 ? 'partner' : 'author'); f.run({ action: 'answerTurn', turnId, expectedVersion: 1, answer: `${number} → A` });
    }
    expect(f.state().turns).toHaveLength(30); expect(f.snapshot().sessions[0]).toMatchObject({ status: 'finished', turnNumber: 31 });
    expect(() => f.run({ action: 'sendTurn', sessionId: pair.id, expectedVersion: f.state().sessions[0]!.version, reference: '31', answer: 'A', repeat: false })).toThrow(/en curso/);
  });

  it('does not let incoming invitations or the other participant’s retained copy consume personal capacity', () => {
    const f = fixture(); const pair = f.pair(); const session = f.state().sessions[0]!;
    f.replace({ ...f.state(), sessions: Array.from({ length: 200 }, (_, index) => ({ ...session, id: `old-${index}`, status: 'finished', removedBy: { author: f.now() - SIGNAL_LIMITS.retentionMs } })) });
    expect(f.snapshot().sessions).toEqual([]); expect(f.snapshot().trash).toEqual([]);
    expect(f.run({ action: 'invitePartner', dictionaryId: pair.dictionaryId, dictionaryVersion: 1, medium: 'pen', guestId: 'other' })).toBeTruthy();
    const another = fixture(); const anotherPair = another.pair(); const row = another.state().sessions[0]!;
    another.replace({ ...another.state(), sessions: Array.from({ length: 200 }, (_, index) => ({ ...row, id: `incoming-${index}`, hostId: 'partner', guestId: 'author', status: 'pending', removedBy: {} })) });
    expect(another.run({ action: 'invitePartner', dictionaryId: anotherPair.dictionaryId, dictionaryVersion: 1, medium: 'pen', guestId: 'other' })).toBeTruthy();
  });
});

describe('Prepared private cards, source access and retention', () => {
  const cardInput = { action: 'saveCard', expectedVersion: 0, subjectId: '1', topic: 'Funciones', reference: 'Parámetros', body: 'Resumen escrito por su autor', conditions: 'Mantener las unidades', support: 'Borrador', source: { kind: 'note', id: '101', version: 3, location: 'Apartado 2' } } as const;

  it('checks source scope/version and keeps revisions private even for administrators', () => {
    const f = fixture(); const id = f.run(cardInput);
    f.run({ ...cardInput, cardId: id, expectedVersion: 1, body: 'Resumen corregido' });
    expect(f.snapshot().cardRevisions).toHaveLength(2); expect(f.snapshot().cards[0]).toMatchObject({ version: 2, body: 'Resumen corregido', sourceAvailable: true });
    expect(f.snapshot().cardRevisions[0]!.card.body).toBe(cardInput.body);
    expect(() => f.run({ ...cardInput, source: { ...cardInput.source, version: 2 } })).toThrow(/cambió de versión/);
    expect(() => f.run({ ...cardInput, source: { ...cardInput.source, id: '303', version: 1 } })).toThrow(/no está disponible/);
    expect(() => f.run({ ...cardInput, source: { ...cardInput.source, id: 'not-owned' } })).toThrow(/no está disponible/);
    f.as('admin'); expect(f.snapshot().cards).toEqual([]); expect(f.snapshot().cardRevisions).toEqual([]);
    expect(() => f.run({ ...cardInput, cardId: id, expectedVersion: 2 })).toThrow(/autor/);
  });

  it('redacts an inaccessible source without erasing the author’s own summary', () => {
    const f = fixture(); f.run(cardInput); f.sources.delete('note:101');
    expect(f.snapshot().cards[0]).toMatchObject({ body: cardInput.body, sourceAvailable: false });
    expect(f.snapshot().cards[0]!.source).toBeUndefined(); expect(f.snapshot().cardRevisions[0]!.card.source).toBeUndefined();
    expect(f.state().cards[0]!.source).toEqual(cardInput.source); // Provenance survives internally.
    f.run({ ...cardInput, source: undefined }); expect(f.snapshot().cards[1]!.sourceAvailable).toBe(true);
  });

  it('restores private cards for thirty days and purges their revisions and replay contents', () => {
    const f = fixture(); const id = f.run(cardInput, 'original'); const initial = structuredClone(f.state());
    expect(f.state().receipts.find((row) => row.requestId === 'original')!.command).toContain(cardInput.body);
    f.run({ action: 'trash', kind: 'card', id, expectedVersion: 1 });
    expect(f.snapshot().cards).toEqual([]); expect(f.snapshot().cardRevisions).toEqual([]); expect(f.snapshot().trash[0]).toMatchObject({ kind: 'card', id, version: 2 });
    f.run({ action: 'restore', kind: 'card', id, expectedVersion: 2 }); expect(f.snapshot().cards).toHaveLength(1);
    f.run({ action: 'trash', kind: 'card', id, expectedVersion: 3 }); f.at(f.now() + 30 * DAY);
    const before = structuredClone(f.state()); const purged = purgeSignals(f.state(), f.now()); expect(f.state()).toEqual(before);
    expect(purged.cards).toEqual([]); expect(purged.cardRevisions).toEqual([]); expect(purged.receipts.find((row) => row.requestId === 'original')!.command).toBe('');
    f.replace(purged); expect(() => f.run(cardInput, 'original')).toThrow(/eliminó definitivamente/);
    expect(() => f.run({ action: 'restore', kind: 'card', id, expectedVersion: 4 })).toThrow(/no está disponible/);
    expect(initial.cards[0]!.version).toBe(1);
  });

  it('runs expiration before replay lookup when the scheduler has not yet purged the content', () => {
    const f = fixture(); const id = f.run(cardInput, 'original');
    f.run({ action: 'trash', kind: 'card', id, expectedVersion: 1 }); f.at(f.now() + SIGNAL_LIMITS.retentionMs);
    expect(f.state().cards).toHaveLength(1); // Simulates a scheduler racing with the retry.
    expect(() => f.run(cardInput, 'original')).toThrow(/eliminó definitivamente/);
    const next = f.run({ ...cardInput, body: 'Otro contenido' }, 'new-operation');
    expect(f.state().cards.map((row) => row.id)).toEqual([next]);
    expect(f.state().receipts.find((row) => row.requestId === 'original')!.command).toBe('');
  });

  it('hides an unfinished attempt when trashed and only exposes its solution after restoration', () => {
    const f = fixture(); const dictionaryId = f.published(); const id = f.run({ action: 'startAttempt', dictionaryId, dictionaryVersion: 1, medium: 'pen', mode: 'encode' });
    f.run({ action: 'trash', kind: 'attempt', id, expectedVersion: 1 });
    expect(f.snapshot().attempts).toEqual([]);
    f.run({ action: 'restore', kind: 'attempt', id, expectedVersion: 2 });
    expect(f.snapshot().attempts[0]!.status).toBe('abandoned'); expect(f.snapshot().attempts[0]!.expected).toBeTruthy();
  });

  it('preserves the other participant’s history when one deletes their copy', () => {
    const f = fixture(); const pair = f.pair();
    const turnId = f.run({ action: 'sendTurn', sessionId: pair.id, expectedVersion: 3, reference: '4', answer: 'D', repeat: false });
    f.as('partner'); f.run({ action: 'answerTurn', turnId, expectedVersion: 1, answer: '4 → D' }); f.as('author');
    f.run({ action: 'trash', kind: 'session', id: pair.id, expectedVersion: 5 });
    expect(f.snapshot().sessions).toEqual([]); expect(f.snapshot().turns).toEqual([]);
    f.as('partner'); expect(f.snapshot().sessions[0]!.status).toBe('cancelled'); expect(f.snapshot().turns[0]!.expected).toBe('4 → D');
    const ownSharedReceiptIds = f.state().receipts.filter((row) => row.actor === 'author' && (row.resultId === pair.id || row.resultId === turnId)).map((row) => row.id);
    const peerSharedReceiptIds = f.state().receipts.filter((row) => row.actor === 'partner' && (row.resultId === pair.id || row.resultId === turnId)).map((row) => row.id);
    f.at(f.now() + 31 * DAY); f.replace(purgeSignals(f.state(), f.now())); expect(f.state().turns).toHaveLength(1);
    expect(f.state().receipts.filter((row) => ownSharedReceiptIds.includes(row.id)).every((row) => row.command === '' && row.resultId === undefined)).toBe(true);
    expect(f.state().receipts.filter((row) => peerSharedReceiptIds.includes(row.id)).every((row) => row.command !== '')).toBe(true);
    f.run({ action: 'trash', kind: 'session', id: pair.id, expectedVersion: 6 }); f.at(f.now() + 30 * DAY); f.replace(purgeSignals(f.state(), f.now()));
    expect(f.state().sessions).toEqual([]); expect(f.state().turns).toEqual([]);
  });

  it('frees personal storage for an expired shared copy while retaining the other participant’s turns', () => {
    const f = fixture(); const pair = f.pair();
    const turnId = f.run({ action: 'sendTurn', sessionId: pair.id, expectedVersion: 3, reference: '4', answer: 'A', repeat: false });
    f.as('partner'); f.run({ action: 'answerTurn', turnId, expectedVersion: 1, answer: '4 → A' }); f.as('author');
    const session = f.state().sessions[0]!; const turn = f.state().turns[0]!;
    const sessions = Array.from({ length: 10 }, (_, index) => ({ ...session, id: `retained-${index}`, status: 'finished' as const, removedBy: { author: f.now() - SIGNAL_LIMITS.retentionMs } }));
    const turns = sessions.flatMap((row) => Array.from({ length: 30 }, (_, index) => ({ ...turn, id: `${row.id}:turn:${index}`, sessionId: row.id, number: index + 1, response: 'x'.repeat(8_000) })));
    f.replace({ ...f.state(), sessions, turns });
    expect(f.snapshot().sessions).toEqual([]);
    expect(f.run({ action: 'invitePartner', dictionaryId: pair.dictionaryId, dictionaryVersion: 1, medium: 'pen', guestId: 'other' })).toBeTruthy();
    f.as('partner'); expect(f.snapshot().turns).toHaveLength(300);
  });
});

describe('Signals boundary validation', () => {
  it('rejects malformed operations, fields, stale versions and oversized values atomically', () => {
    const f = fixture(); const before = structuredClone(f.state());
    expect(() => applySignalCommand(f.state(), null, f.context())).toThrow(/envío/);
    expect(() => f.run({ action: 'destroyEverything' })).toThrow(/no existe/);
    expect(() => f.run({ action: 'createDictionary', subjectId: 'no-subject', topic: 'T', title: 'D', definitions: starterSignalDefinitions() })).toThrow(/materia/);
    expect(() => f.run({ action: 'createDictionary', subjectId: '1', topic: 'T', title: 'x'.repeat(161), definitions: starterSignalDefinitions() })).toThrow(/160/);
    expect(() => f.run({ action: 'createDictionary', subjectId: '1', topic: 'T', title: 'D', definitions: starterSignalDefinitions() }, 'bad request')).toThrow(/envío no es válido/);
    expect(f.state()).toEqual(before);
  });

  it('enforces quotas before unbounded creation or revision', () => {
    const f = fixture(); const id = f.published(); const dictionary = f.state().dictionaries[0]!;
    f.replace({ ...f.state(), dictionaries: Array.from({ length: 100 }, (_, index) => ({ ...dictionary, id: `${id}-${index}` })) });
    expect(() => f.dictionary()).toThrow(/100 diccionarios/);
    const another = fixture(); const published = another.published();
    expect(() => another.run({ action: 'archiveDictionary', dictionaryId: published, expectedVersion: '2', archived: true })).toThrow(/versión/);
    expect(() => another.run({ action: 'archiveDictionary', dictionaryId: published, expectedVersion: 2, archived: 'yes' })).toThrow(/verdadero o falso/);
  });

  it('counts receipt copies and content together against the per-author storage budget', () => {
    const f = fixture(); const definitions = starterSignalDefinitions().map((entry) => ({ ...entry, example: 'x'.repeat(2_000) }));
    while (definitions.length < 200) {
      const index = definitions.length;
      definitions.push({ id: `custom:${index}`, medium: 'pen', kind: 'answer', value: `OPTION-${index}`, label: `Opción ${index}`, example: 'x'.repeat(2_000), pattern: index.toString(2).padStart(8, '0').split('').map((part) => part === '0' ? 'horizontal' : 'vertical') });
    }
    const command = { action: 'createDictionary', subjectId: '1', topic: 'Funciones', title: 'Diccionario grande', definitions };
    f.run(command); f.run(command); const before = structuredClone(f.state());
    expect(() => f.run(command)).toThrow(/cuota de 2 MiB/);
    expect(f.state()).toEqual(before);
  });

  it('allows bounded cleanup at an exactly full storage quota without storing extra payload', () => {
    const f = fixture();
    const card = { action: 'saveCard', expectedVersion: 0, subjectId: '1', topic: 'T', reference: 'R', body: 'Contenido propio', conditions: '', support: 'Borrador' };
    const id = f.run(card);
    const state = structuredClone(f.state());
    const size = (value: SignalState) => Object.values(value).flat().reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row), 'utf8'), 0);
    const filler = { id: 'filler', actor: 'author', requestId: 'filler', command: '', createdAt: f.now() };
    filler.command = 'x'.repeat(SIGNAL_LIMITS.storageBytes - size(state) - Buffer.byteLength(JSON.stringify(filler), 'utf8'));
    state.receipts.push(filler); expect(size(state)).toBe(SIGNAL_LIMITS.storageBytes); f.replace(state);
    expect(() => f.run(card)).toThrow(/cuota de 2 MiB/);
    const cleanup = { action: 'trash', kind: 'card', id, expectedVersion: 1, extra: 'untrusted-data-'.repeat(40_000) };
    f.run(cleanup, 'remove-full');
    expect(f.snapshot().trash[0]!.id).toBe(id); expect(f.snapshot().cards).toEqual([]);
    const receipt = f.state().receipts.find((row) => row.requestId === 'remove-full')!;
    expect(receipt.command).toMatch(/^sha256:[a-f0-9]{64}$/); expect(size(f.state())).toBeGreaterThan(SIGNAL_LIMITS.storageBytes);
    expect(size(f.state())).toBeLessThan(SIGNAL_LIMITS.storageBytes + SIGNAL_LIMITS.cleanupStorageBytes);
    f.run(cleanup, 'remove-full'); // Exact retry uses the compact fingerprint.
    expect(() => f.run({ ...cleanup, extra: 'changed' }, 'remove-full')).toThrow(/otro contenido/);
    expect(() => f.run(card)).toThrow(/cuota de 2 MiB/);
  });

  it('keeps a finite cleanup receipt reserve when the normal operation limit has been reached', () => {
    const f = fixture(); const card = { action: 'saveCard', expectedVersion: 0, subjectId: '1', topic: 'T', reference: 'R', body: 'Cuerpo', conditions: '', support: 'Borrador' }; const id = f.run(card);
    const state = structuredClone(f.state());
    while (state.receipts.length < SIGNAL_LIMITS.receipts) state.receipts.push({ id: `filler-${state.receipts.length}`, actor: 'author', requestId: `fill-${state.receipts.length}`, command: '', createdAt: f.now() });
    f.replace(state); f.run({ action: 'trash', kind: 'card', id, expectedVersion: 1 });
    expect(f.state().receipts).toHaveLength(SIGNAL_LIMITS.receipts + 1); expect(f.snapshot().trash).toHaveLength(1);
    expect(() => f.run(card)).toThrow(/límite de operaciones/);
    expect(() => f.run({ action: 'restore', kind: 'card', id, expectedVersion: 2 })).toThrow(/límite de operaciones/);
    const another = fixture(); const anotherId = another.run(card); const hardLimit = structuredClone(another.state());
    while (hardLimit.receipts.length < SIGNAL_LIMITS.receipts + SIGNAL_LIMITS.cleanupReceipts) hardLimit.receipts.push({ id: `filler-${hardLimit.receipts.length}`, actor: 'author', requestId: `fill-${hardLimit.receipts.length}`, command: '', createdAt: another.now() });
    another.replace(hardLimit); expect(() => another.run({ action: 'trash', kind: 'card', id: anotherId, expectedVersion: 1 })).toThrow(/reserva de operaciones/);
  });

  it('does not keep references to caller-owned definitions after an accepted mutation', () => {
    const f = fixture(); const definitions: SignalDefinition[] = starterSignalDefinitions();
    const id = f.run({ action: 'createDictionary', subjectId: '1', topic: 'T', title: 'D', definitions });
    definitions[0]!.pattern[0] = 'changed';
    expect(f.state().dictionaries.find((row) => row.id === id)!.draft[0]!.pattern[0]).toBe('horizontal');
  });
});
