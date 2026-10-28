import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setGlobalLogLevel } from 'spacetimedb';
import { starterSignalDefinitions, type SignalsSnapshot } from '../packages/core/src/signals';
import { DbConnection } from '../packages/app/src/module_bindings';

const bounded = <T>(promise: Promise<T>, label: string) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Tiempo agotado: ${label}`)), 30_000);
  promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});
const waitFor = async (ready: () => boolean, label: string) => {
  const deadline = performance.now() + 30_000;
  while (!ready()) {
    if (performance.now() >= deadline) throw new Error(`Tiempo agotado: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

/** Uses only a temporary local database and synthetic identities. No production tokens. */
export async function runSmoke(options: { address: string; database: string; tokens: string[]; restart(): Promise<void> }) {
  assert.ok(options.address.startsWith('http://127.0.0.1:'));
  setGlobalLogLevel('error');
  const connections = new Set<DbConnection>();
  const checks: string[] = [];
  const connect = (token: string) => bounded(new Promise<DbConnection>((resolve, reject) => {
    const connection = DbConnection.builder().withUri(options.address).withDatabaseName(options.database)
      .withToken(token).withCompression('none').onConnect(ready => resolve(ready))
      .onConnectError((_ctx, error) => reject(error)).build();
    connections.add(connection);
  }), 'conectar');
  const subscribe = (connection: DbConnection, queries: string[]) => bounded(new Promise<void>((resolve, reject) => {
    connection.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx, error) => reject(error)).subscribe(queries);
  }), 'suscripción');
  const observe = (connection: DbConnection) => subscribe(connection, ['subjects', 'notes', 'signal_snapshot'].map(view => `SELECT * FROM ${view}`));
  const view = (connection: DbConnection): SignalsSnapshot | undefined => {
    const row = [...connection.db.signalSnapshot.iter()][0];
    return row ? JSON.parse(row.json) as SignalsSnapshot : undefined;
  };
  const send = async (connection: DbConnection, value: Record<string, unknown>, requestId = randomUUID()) => {
    await connection.reducers.signalAction({ payload: JSON.stringify({ ...value, requestId }) });
    await waitFor(() => !!view(connection)?.receipts.some(row => row.requestId === requestId), 'confirmación de señales');
    return view(connection)!.receipts.find(row => row.requestId === requestId)?.id;
  };
  const close = () => { for (const connection of connections) connection.disconnect(); connections.clear(); };
  try {
    let admin = await connect(options.tokens[0]!);
    await admin.reducers.setAuthConfig({ issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['b20-local-smoke'] });
    for (const name of ['owner', 'author', 'reviewer']) {
      await admin.reducers.inviteMember({ email: `${name}@b20-smoke.invalid`, isCreator: name === 'owner' });
    }
    await admin.reducers.joinGroup({ displayName: 'Local administrator' });
    let author = await connect(options.tokens[1]!);
    let partner = await connect(options.tokens[2]!);
    let outsider = await connect(options.tokens[3]!);
    await author.reducers.joinGroup({ displayName: 'Local signals author' });
    await partner.reducers.joinGroup({ displayName: 'Local signals partner' });
    await Promise.all([admin, author, partner, outsider].map(observe));
    assert.equal(view(outsider), undefined);
    await assert.rejects(send(outsider, { action: 'startAttempt' }));
    for (const table of ['signal_record', 'signal_expiry']) await assert.rejects(subscribe(partner, [`SELECT * FROM ${table}`]));
    checks.push('tablas privadas inaccesibles y acceso denegado sin membresía');

    await author.reducers.createSubject({ name: 'Local signals', period: 1 });
    const subjectId = [...author.db.subjects.iter()].find(row => row.name === 'Local signals')!.id.toString();
    const create = { action: 'createDictionary', subjectId, topic: 'Redes', title: 'Convenciones sintéticas', definitions: starterSignalDefinitions() };
    const createRequest = randomUUID();
    const dictionaryId = (await send(author, create, createRequest))!;
    await send(author, create, createRequest);
    assert.equal(view(author)!.dictionaries.length, 1);
    assert.equal(view(partner)!.dictionaries.length, 0);
    assert.equal(view(admin)!.dictionaries.length, 0);
    await assert.rejects(send(author, { ...create, title: 'Payload alterado' }, createRequest));
    await send(author, { action: 'publishDictionary', dictionaryId, expectedVersion: view(author)!.dictionaries[0]!.version });
    await waitFor(() => view(partner)!.versions.length === 1, 'versión compartida');
    const dictionaryVersion = 1;
    assert.equal(view(partner)!.dictionaries[0]!.draft.length, 0);
    for (const medium of ['pen', 'foot', 'knuckle']) {
      await send(author, { action: 'saveMessage', dictionaryId, dictionaryVersion, medium, reference: '12', answer: 'B', repeat: true });
    }
    assert.equal(view(author)!.messages.length, 3);
    assert.equal(view(partner)!.messages.length, 0);
    checks.push('diccionario versionado, tres medios, borrador privado y creaciones idempotentes');

    // Only the temporary server copy uses four seconds. Production retains thirty days.
    const erasable = { action: 'saveMessage', dictionaryId, dictionaryVersion, medium: 'pen', reference: '99', answer: 'D', repeat: false };
    const eraseRequest = randomUUID();
    const erasedId = (await send(author, erasable, eraseRequest))!;
    await send(author, { action: 'trash', kind: 'message', id: erasedId, expectedVersion: 1 });
    await send(author, { action: 'restore', kind: 'message', id: erasedId, expectedVersion: 2 });
    assert.ok(view(author)!.messages.some(row => row.id === erasedId));
    await send(author, { action: 'trash', kind: 'message', id: erasedId, expectedVersion: 3 });
    await waitFor(() => !view(author)!.trash.some(row => row.id === erasedId), 'purga programada sin otra escritura');
    await assert.rejects(send(author, { action: 'restore', kind: 'message', id: erasedId, expectedVersion: 4 }));
    await assert.rejects(send(author, erasable, eraseRequest));
    assert.equal(view(author)!.messages.length, 3);
    checks.push('restauración y purga programada reales con plazo acelerado únicamente en copia temporal');

    const attemptId = (await send(author, { action: 'startAttempt', dictionaryId, dictionaryVersion, medium: 'foot', mode: 'recognize' }))!;
    const attempt = view(author)!.attempts.find(row => row.id === attemptId)!;
    assert.equal(attempt.expected, undefined);
    await send(author, { action: 'answerAttempt', attemptId, expectedVersion: attempt.version, answer: attempt.options[0] });
    assert.ok(view(author)!.attempts[0]!.expected);
    assert.equal(view(partner)!.attempts.length, 0);
    assert.equal(view(admin)!.attempts.length, 0);
    checks.push('intentos privados y solución no distribuida antes de responder');

    await author.reducers.saveNote({ noteId: undefined, subjectId: BigInt(subjectId), title: 'Fuente privada de señales', topic: 'TCP',
      body: 'Contenido sintético, no se copia al diccionario', tags: [], visibility: 'personal', source: 'student' });
    const source = [...author.db.notes.iter()].find(row => row.title === 'Fuente privada de señales')!;
    const cardId = await send(author, { action: 'saveCard', expectedVersion: 0, subjectId, topic: 'TCP', reference: 'Pregunta 1', body: 'Mi resumen',
      conditions: 'Unidades y contexto', support: 'Borrador', source: { kind: 'note', id: source.id.toString(), version: source.version, location: 'Introducción' } });
    assert.ok(cardId);
    assert.equal(view(author)!.cards[0]!.sourceAvailable, true);
    assert.equal(view(partner)!.cards.length, 0);
    checks.push('fichas y procedencia privadas sin copiar el cuerpo de la fuente');

    const sessionId = (await send(author, { action: 'invitePartner', dictionaryId, dictionaryVersion, medium: 'knuckle', guestId: partner.identity!.toHexString() }))!;
    await waitFor(() => view(partner)!.sessions.length === 1, 'invitación de pareja');
    assert.equal(view(partner)!.turns.length, 0);
    assert.equal(view(admin)!.sessions.length, 0);
    await send(partner, { action: 'respondInvitation', sessionId, expectedVersion: view(partner)!.sessions[0]!.version, accept: true });
    await waitFor(() => view(author)!.sessions[0]!.status === 'accepted', 'aceptación');
    await send(author, { action: 'startSession', sessionId, expectedVersion: view(author)!.sessions[0]!.version });
    const turnVersion = view(author)!.sessions[0]!.version;
    const sendTurn = { action: 'sendTurn', sessionId, expectedVersion: turnVersion, reference: '7', answer: 'C', repeat: false };
    const attempts = await Promise.allSettled([send(author, sendTurn), send(author, sendTurn)]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    await waitFor(() => view(partner)!.turns.length === 1, 'turno de pareja');
    assert.equal(view(partner)!.turns[0]!.expected, undefined);
    const turnId = view(partner)!.turns[0]!.id;
    checks.push('aceptación expresa, alternancia y envíos concurrentes sin duplicados');

    close(); await options.restart();
    admin = await connect(options.tokens[0]!); author = await connect(options.tokens[1]!);
    partner = await connect(options.tokens[2]!); outsider = await connect(options.tokens[3]!);
    await Promise.all([admin, author, partner, outsider].map(observe));
    assert.equal(view(author)!.messages.length, 3);
    assert.equal(view(author)!.cards.length, 1);
    assert.equal(view(partner)!.turns[0]!.id, turnId);
    assert.equal(view(partner)!.turns[0]!.expected, undefined);
    const answer = { action: 'answerTurn', turnId, expectedVersion: view(partner)!.turns[0]!.version, answer: '7 → C' };
    const answerRequest = randomUUID();
    await send(partner, answer, answerRequest); await send(partner, answer, answerRequest);
    assert.equal(view(partner)!.turns[0]!.correct, true);
    const nextSession = view(partner)!.sessions[0]!;
    await send(partner, { action: 'sendTurn', sessionId, expectedVersion: nextSession.version, reference: '8', answer: 'A', repeat: false });
    await waitFor(() => view(author)!.turns.length === 2, 'turno alterno');
    checks.push('reinicio persistente, solución aún oculta y respuesta idempotente tras reconectar');

    await admin.reducers.removeMember({ identity: author.identity! });
    await waitFor(() => !view(author), 'revocación de la suscripción tras baja');
    await assert.rejects(send(author, { action: 'startAttempt', dictionaryId, dictionaryVersion, medium: 'pen', mode: 'encode' }));
    await assert.rejects(send(partner, { action: 'sendTurn', sessionId, expectedVersion: view(partner)!.sessions[0]?.version ?? 1, reference: '1', answer: 'A', repeat: false }));
    assert.equal(view(admin)!.messages.length, 0);
    assert.equal(view(admin)!.cards.length, 0);
    checks.push('baja inmediata y rechazo de nuevas acciones de una pareja sin membresía activa');
    return { checks, providerCalls: 0, productionData: false };
  } finally { close(); }
}
