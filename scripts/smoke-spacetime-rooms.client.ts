import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setGlobalLogLevel, Timestamp } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';
import { PUBLIC_VIEWS, readSnapshot } from '../packages/app/src/data/spacetimeSnapshot';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const json = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? item.toString() : item);
async function until(predicate: () => boolean, label: string) {
  const deadline = performance.now() + 20_000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Tiempo agotado: ${label}`);
    await delay(20);
  }
}
const bounded = <T>(promise: Promise<T>, label: string) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Tiempo agotado: ${label}`)), 30_000);
  promise.then((result) => { clearTimeout(timer); resolve(result); }, (error) => { clearTimeout(timer); reject(error); });
});

/** Identidades sintéticas y servidor temporal; nunca conecta a una base preexistente. */
export async function runSmoke(options: { address: string; database: string; tokens: string[]; restart(): Promise<void> }) {
  setGlobalLogLevel('error');
  const connections = new Set<DbConnection>();
  const checks: string[] = [];
  const connect = (token: string) => bounded(new Promise<DbConnection>((resolve, reject) => {
    const connection = DbConnection.builder().withUri(options.address).withDatabaseName(options.database)
      .withToken(token).withCompression('none').onConnect((ready) => resolve(ready))
      .onConnectError((_ctx, error) => reject(error)).build();
    connections.add(connection);
  }), 'conectar');
  const subscribe = (connection: DbConnection) => bounded(new Promise<void>((resolve, reject) => {
    connection.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx, error) => reject(error))
      .subscribe(PUBLIC_VIEWS.map((view) => `SELECT * FROM ${view}`));
  }), 'suscribir vistas');
  const snapshot = (connection: DbConnection) => readSnapshot(connection, connection.identity!.toHexString());
  const close = () => { for (const connection of connections) connection.disconnect(); connections.clear(); };
  try {
    let admin = await connect(options.tokens[0]);
    await admin.reducers.setAuthConfig({ issuer: 'https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1', audiences: ['b20-local-smoke'] });
    for (const [index, email] of ['owner', 'author', 'outsider'].entries()) {
      await admin.reducers.inviteMember({ email: `${email}@b20-smoke.invalid`, isCreator: index === 0 });
    }
    await admin.reducers.joinGroup({ displayName: 'Synthetic admin' });
    let author = await connect(options.tokens[1]);
    let peer = await connect(options.tokens[2]);
    await author.reducers.joinGroup({ displayName: 'Synthetic organizer' });
    await peer.reducers.joinGroup({ displayName: 'Synthetic participant' });
    await Promise.all([subscribe(admin), subscribe(author), subscribe(peer)]);
    await author.reducers.createSubject({ name: 'Synthetic rooms', period: 1 });
    const subjectId = [...author.db.subjects.iter()][0]!.id;
    const noteInput = { noteId: undefined, expectedVersion: undefined, subjectId, termId: undefined,
      session: '', topic: 'Decisions', title: 'Synthetic personal source', body: 'Secret personal source', tags: [],
      visibility: 'personal', source: 'student', assignmentIds: [], activityIds: [], questionIds: [] };
    await author.reducers.saveNoteV2(noteInput);
    const personalId = [...author.db.notes.iter()].find((row) => row.visibility === 'personal')!.id;
    await author.reducers.saveNoteV2({ ...noteInput, title: 'Synthetic shared source', body: 'Shared material', visibility: 'group' });
    const noteId = [...author.db.notes.iter()].find((row) => row.visibility === 'group')!.id;
    await author.reducers.saveHelpPost({ id: undefined, kind: 'offer', subjectId, title: 'Synthetic help',
      topic: 'Decisions', description: 'Explain decisions', level: 'initial', modality: 'messages', availability: '' });
    const postId = [...author.db.helpPosts.iter()].find((row) => row.title === 'Synthetic help')!.id;
    await until(() => [...peer.db.helpPosts.iter()].some((row) => row.id === postId), 'publicación de ayuda');
    await peer.reducers.sendHelpContact({ postId, message: 'Secret contact message, never in room' });
    await until(() => [...author.db.myHelpContactRequests.iter()].length === 1, 'contacto de ayuda');
    const contactId = [...author.db.myHelpContactRequests.iter()][0]!.id;
    await author.reducers.respondHelpContact({ requestId: contactId, decision: 'accepted' });
    const input = { requestId: randomUUID(), title: 'Synthetic private room', subjectId, topic: 'Decisions',
      objective: 'Explain decisions together', startsAt: Timestamp.fromDate(new Date(Date.now() + 3_600_000)),
      endsAt: Timestamp.fromDate(new Date(Date.now() + 7_200_000)), capacity: 2, visibility: 'private',
      helpContactId: contactId, sourceKind: 'note', sourceId: noteId };
    await author.reducers.createStudyRoom(input);
    await author.reducers.createStudyRoom(input);
    const room = [...author.db.studyRooms.iter()].find((row) => row.requestId === input.requestId)!;
    assert.ok(room);
    const roomId = room.id;
    assert.equal([...author.db.studyRooms.iter()].filter((row) => row.requestId === input.requestId).length, 1);
    assert.equal(room.participantCount, 1);
    assert.equal(json(snapshot(author).studyRooms).includes('Secret contact message'), false);
    await until(() => snapshot(peer).studyRooms.some((row) => row.id === roomId.toString()), 'invitación de sala');
    assert.equal(snapshot(peer).roomMaterials.some((row) => row.roomId === roomId.toString()), false);
    assert.equal(snapshot(peer).roomSummaries.some((row) => row.roomId === roomId.toString()), false);
    assert.equal(snapshot(admin).studyRooms.some((row) => row.id === roomId.toString()), false);
    await assert.rejects(admin.reducers.joinStudyRoom({ roomId }));
    await assert.rejects(peer.reducers.sendStudyRoomEntry({ roomId, kind: 'message', text: 'Not accepted', requestId: randomUUID() }));
    await assert.rejects(admin.procedures.studyRoomClock({ roomId }));
    await peer.reducers.respondStudyRoomInvitation({ roomId, accepted: true });
    await until(() => snapshot(peer).roomMaterials.some((row) => row.roomId === roomId.toString()), 'material tras aceptar');
    await assert.rejects(author.reducers.setStudyRoomMaterial({ roomId, kind: 'note', sourceId: personalId, enabled: true }));
    checks.push('Ayuda privada, creación idempotente, aceptación voluntaria y fuentes personales rechazadas');

    const entryId = randomUUID();
    await peer.reducers.sendStudyRoomEntry({ roomId, kind: 'question', text: 'Secret room question', requestId: entryId });
    await peer.reducers.sendStudyRoomEntry({ roomId, kind: 'question', text: 'Secret room question', requestId: entryId });
    await until(() => snapshot(author).roomEntries.some((row) => row.requestId === entryId), 'pregunta del participante');
    assert.equal(snapshot(author).roomEntries.filter((row) => row.requestId === entryId).length, 1);
    assert.equal(snapshot(admin).roomEntries.length, 0);
    const privateQuery = await fetch(`${options.address}/v1/database/${options.database}/sql`, {
      method: 'POST', headers: { Authorization: `Bearer ${options.tokens[2]}`, 'Content-Type': 'text/plain' },
      body: 'SELECT * FROM room_entry',
    });
    assert.equal(privateQuery.ok, false, 'un participante no puede consultar la tabla privada directamente');
    await author.reducers.setStudyRoomStatus({ roomId, status: 'active', expectedVersion: room.version });
    const initialTimer = snapshot(author).roomTimers.find((row) => row.roomId === roomId.toString())!;
    await author.reducers.controlStudyRoomTimer({ roomId, action: 'start', expectedVersion: initialTimer.version,
      studyMinutes: 25, breakMinutes: 5 });
    await until(() => snapshot(peer).roomTimers.some((row) => row.roomId === roomId.toString() && row.state === 'running'), 'temporizador compartido');
    const running = snapshot(peer).roomTimers.find((row) => row.roomId === roomId.toString())!;
    await assert.rejects(peer.reducers.controlStudyRoomTimer({ roomId, action: 'pause', expectedVersion: initialTimer.version, studyMinutes: undefined, breakMinutes: undefined }));
    const clock = await peer.procedures.studyRoomClock({ roomId });
    assert.ok(Math.abs(clock.toDate().getTime() - Date.now()) < 30_000);
    checks.push('mensajes únicos, tablas privadas inaccesibles y temporizador sincronizado con control de versiones');

    close();
    await options.restart();
    admin = await connect(options.tokens[0]); author = await connect(options.tokens[1]); peer = await connect(options.tokens[2]);
    await Promise.all([subscribe(admin), subscribe(author), subscribe(peer)]);
    const recovered = snapshot(peer).roomTimers.find((row) => row.roomId === roomId.toString())!;
    assert.equal(recovered.state, 'running');
    assert.equal(recovered.version, running.version);
    assert.equal(recovered.startedAt!.getTime(), running.startedAt!.getTime());
    await peer.reducers.controlStudyRoomTimer({ roomId, action: 'pause', expectedVersion: recovered.version,
      studyMinutes: undefined, breakMinutes: undefined });
    await until(() => snapshot(author).roomTimers.some((row) => row.roomId === roomId.toString() && row.state === 'paused'), 'pausa de otro cliente');
    await peer.reducers.saveStudyRoomSummary({ roomId, text: 'Collaborative public conclusion',
      expectedVersion: snapshot(peer).roomSummaries.find((row) => row.roomId === roomId.toString())!.version });
    await until(() => snapshot(author).roomSummaries.some((row) => row.text === 'Collaborative public conclusion'), 'resumen compartido');
    await assert.rejects(author.reducers.saveStudyRoomSummary({ roomId, text: 'Stale overwriting', expectedVersion: 1 }));
    await author.reducers.removeStudyRoomMember({ roomId, memberId: peer.identity! });
    await until(() => !snapshot(peer).studyRooms.some((row) => row.id === roomId.toString()), 'retirada de acceso en la caché');
    assert.equal(snapshot(peer).roomEntries.some((row) => row.roomId === roomId.toString()), false);
    await assert.rejects(peer.procedures.studyRoomClock({ roomId }));
    await author.reducers.inviteStudyRoomMember({ roomId, memberId: peer.identity! });
    await peer.reducers.respondStudyRoomInvitation({ roomId, accepted: true });
    await author.reducers.setStudyRoomStatus({ roomId, status: 'completed', expectedVersion: snapshot(author).studyRooms.find((row) => row.id === roomId.toString())!.version });
    await author.reducers.publishStudyRoomSummary({ roomId, expectedVersion: snapshot(author).roomSummaries.find((row) => row.roomId === roomId.toString())!.version });
    const published = snapshot(author).roomSummaries.find((row) => row.roomId === roomId.toString())!.publishedNoteId!;
    await author.reducers.publishStudyRoomSummary({ roomId, expectedVersion: snapshot(author).roomSummaries.find((row) => row.roomId === roomId.toString())!.version });
    await until(() => snapshot(admin).notes.some((row) => row.id === published), 'nota pública del resumen');
    const note = snapshot(admin).notes.find((row) => row.id === published)!;
    assert.equal(note.body, 'Collaborative public conclusion');
    assert.equal(note.authorId, author.identity!.toHexString());
    assert.equal(note.source, 'student');
    assert.equal(snapshot(author).notes.filter((row) => row.id === published).length, 1);
    assert.equal(json(snapshot(admin)).includes('Secret room question'), false);
    checks.push('persistencia tras reinicio, edición colaborativa, revocación inmediata y publicación única sin contenido privado');

    const openInput = { ...input, requestId: randomUUID(), title: 'Synthetic capacity race', visibility: 'group',
      helpContactId: undefined, sourceKind: undefined, sourceId: undefined };
    await author.reducers.createStudyRoom(openInput);
    const openId = [...author.db.studyRooms.iter()].find((row) => row.requestId === openInput.requestId)!.id;
    await until(() => snapshot(admin).studyRooms.some((row) => row.id === openId.toString()), 'ficha abierta');
    await until(() => snapshot(peer).studyRooms.some((row) => row.id === openId.toString()), 'ficha abierta al compañero');
    assert.equal(snapshot(admin).roomMembers.some((row) => row.roomId === openId.toString()), false);
    const race = await Promise.allSettled([admin.reducers.joinStudyRoom({ roomId: openId }), peer.reducers.joinStudyRoom({ roomId: openId })]);
    assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
    await until(() => snapshot(author).studyRooms.find((row) => row.id === openId.toString())?.participantCount === 2, 'cupo tras inscripción concurrente');
    await admin.reducers.removeMember({ identity: author.identity! });
    const winner = race[0]!.status === 'fulfilled' ? admin : peer;
    await until(() => snapshot(winner).studyRooms.some((row) => row.id === openId.toString() && row.status === 'cancelled'), 'baja del organizador');
    await assert.rejects(author.procedures.studyRoomClock({ roomId: openId }));
    checks.push('última plaza atómica entre clientes y cancelación al dar de baja al organizador');
    return { checks, identities: 3, restarts: 1 };
  } finally { close(); }
}
