import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setGlobalLogLevel } from 'spacetimedb';
import { GUIDE_SECTIONS } from '../packages/core/src/guides';
import { DbConnection } from '../packages/app/src/module_bindings';
import { PUBLIC_VIEWS, readSnapshot } from '../packages/app/src/data/spacetimeSnapshot';
import { buildLeaderboard } from '../packages/app/src/lib/contributions';
import { buildNews, unreadMessages } from '../packages/app/src/lib/whatsNew';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean, label: string) {
  const deadline = performance.now() + 20_000;
  while (!predicate()) { if (performance.now() > deadline) throw new Error(`Tiempo agotado: ${label}`); await delay(20); }
}
const bounded = <T>(promise: Promise<T>, label: string) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Tiempo agotado: ${label}`)), 30_000);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});

export async function runSmoke(options: { address: string; database: string; tokens: string[]; restart(): Promise<void> }) {
  setGlobalLogLevel('error');
  const connections = new Set<DbConnection>(); const checks: string[] = [];
  const connect = (token: string) => bounded(new Promise<DbConnection>((resolve, reject) => {
    const connection = DbConnection.builder().withUri(options.address).withDatabaseName(options.database).withToken(token).withCompression('none')
      .onConnect((ready) => resolve(ready)).onConnectError((_ctx, error) => reject(error)).build(); connections.add(connection);
  }), 'conectar');
  const subscribe = (connection: DbConnection, views: readonly string[] = [...PUBLIC_VIEWS, 'change_history']) => bounded(new Promise<void>((resolve, reject) => {
    connection.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx, error) => reject(error)).subscribe(views.map((name) => `SELECT * FROM ${name}`));
  }), 'suscribir vistas');
  const close = () => { for (const connection of connections) connection.disconnect(); connections.clear(); };
  const upload = async (connection: DbConnection, kind: string, id: bigint, version: number, bytes: Uint8Array, mime = 'text/plain') => {
    const fileId = randomUUID();
    try {
      await connection.reducers.beginResourceUpload({ uploadId: fileId, targetKind: kind, targetId: id, expectedVersion: version,
        name: mime === 'image/png' ? 'synthetic-photo.png' : 'synthetic.txt', mime, bytes: BigInt(bytes.length), sha256: hash(bytes) });
      await connection.reducers.putResourceChunk({ uploadId: fileId, index: 0, bytes, sha256: hash(bytes) });
      await connection.reducers.finalizeResourceUpload({ uploadId: fileId });
    } catch (error) {
      await connection.reducers.cancelResourceUpload({ uploadId: fileId }).catch(() => {});
      throw error;
    }
    return fileId;
  };
  const snapshot = (connection: DbConnection) => readSnapshot(connection, connection.identity!.toHexString());
  try {
    let owner = await connect(options.tokens[0]);
    await owner.reducers.setAuthConfig({ issuer: 'https://auth.spacetimedb.com/oidc', audiences: ['b20-local-smoke'] });
    await owner.reducers.inviteMember({ email: 'owner@b20-smoke.invalid', isCreator: true });
    await owner.reducers.inviteMember({ email: 'author@b20-smoke.invalid', isCreator: false });
    await owner.reducers.joinGroup({ displayName: 'Synthetic admin' });
    let author = await connect(options.tokens[1]); await author.reducers.joinGroup({ displayName: 'Synthetic author' });
    let peer = await connect(options.tokens[2]); await subscribe(peer);
    assert.equal([...peer.db.subjects.iter()].length, 0);
    await assert.rejects(peer.reducers.joinGroup({ displayName: 'Synthetic peer' }));
    await owner.reducers.inviteMember({ email: 'outsider@b20-smoke.invalid', isCreator: false });
    await peer.reducers.joinGroup({ displayName: 'Synthetic peer' });
    await subscribe(owner); await subscribe(author);
    await author.reducers.createSubject({ name: 'Synthetic delivery 2', period: 1 });
    const subjectId = [...author.db.subjects.iter()][0].id;
    checks.push('tres identidades sintéticas y acceso por invitación');

    const noteInput = { noteId: undefined, expectedVersion: undefined, subjectId, termId: undefined, session: '2026-10-21',
      topic: 'Privacy', title: 'Synthetic private note', body: 'Private initial body', tags: ['privacy'], visibility: 'personal', source: 'student', assignmentIds: [], activityIds: [], questionIds: [] };
    await author.reducers.saveNoteV2(noteInput);
    const noteId = [...author.db.notes.iter()][0].id;
    const noteBytes = new TextEncoder().encode('Private bytes shared only by explicit publication');
    const privateFileId = await upload(author, 'note', noteId, 1, noteBytes);
    await assert.rejects(owner.procedures.readResourceChunk({ fileId: privateFileId, index: 0 }));
    assert.equal([...owner.db.notes.iter()].length, 0);
    assert.equal([...peer.db.notes.iter()].length, 0);
    assert.equal([...peer.db.changeHistory.iter()].some((row) => row.entity === 'invitation' || row.entity === 'note' && row.entityId === noteId.toString() || row.entity === 'resource_file' && row.entityId === privateFileId), false);
    assert.equal([...owner.db.changeHistory.iter()].some((row) => row.entity === 'note' && row.entityId === noteId.toString() || row.entity === 'resource_file' && row.entityId === privateFileId), false);
    await author.reducers.publishNoteVersion({ noteId, expectedVersion: 2 });
    await author.reducers.publishNoteVersion({ noteId, expectedVersion: 2 });
    const shared = [...author.db.notes.iter()].find((row) => row.visibility === 'group')!;
    await until(() => [...peer.db.notes.iter()].some((row) => row.id === shared.id), 'nota publicada');
    await until(() => [...peer.db.resourceFiles.iter()].some((file) => file.targetKind === 'note' && file.targetId === shared.id), 'alias del archivo publicado');
    const alias = [...peer.db.resourceFiles.iter()].find((file) => file.targetKind === 'note' && file.targetId === shared.id)!;
    assert.notEqual(alias.id, privateFileId);
    assert.equal(hash((await peer.procedures.readResourceChunk({ fileId: alias.id, index: 0 })).bytes), hash(noteBytes));
    await assert.rejects(peer.procedures.readResourceChunk({ fileId: privateFileId, index: 0 }));
    await author.reducers.saveNoteV2({ ...noteInput, noteId, expectedVersion: 2, body: 'Private future body, never published' });
    assert.equal([...peer.db.notes.iter()].find((row) => row.id === shared.id)?.body, 'Private initial body');
    assert.equal([...peer.db.noteVersions.iter()].some((row) => row.noteId === noteId), false);
    assert.equal([...peer.db.noteDetails.iter()].find((row) => row.noteId === shared.id)?.publishedFromId, undefined);
    await author.reducers.restoreNoteVersion({ noteId, version: 1, expectedVersion: 3 });
    assert.equal([...author.db.notes.iter()].find((row) => row.id === noteId)?.version, 4);
    checks.push('nota personal, publicación idempotente con bytes por alias, historial privado y restauración');

    await author.reducers.openDirectConversation({ other: peer.identity! });
    const conversationId = [...author.db.myDirectConversations.iter()][0].id;
    await author.reducers.sendDirectMessage({ conversationId, text: 'Synthetic confidential direct', replyToId: undefined });
    const messageId = [...author.db.myDirectMessages.iter()][0].id;
    const packRequest = { requestId: randomUUID(), name: 'Synthetic private stickers' };
    const packId = await author.procedures.createStickerPackNative(packRequest);
    assert.equal(await author.procedures.createStickerPackNative(packRequest), packId);
    const stickerBytes = new Uint8Array(4096); stickerBytes.set(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCWQAAAAASUVORK5CYII=', 'base64'));
    const stickerRequest = { requestId: randomUUID(), packId, name: 'synthetic-sticker.png', contentType: 'image/png', animated: false, bytes: stickerBytes };
    const stickerId = await author.procedures.addStickerNative(stickerRequest);
    assert.equal(await author.procedures.addStickerNative(stickerRequest), stickerId);
    await assert.rejects(author.procedures.addStickerNative({ ...stickerRequest, name: 'different-name.png' }));
    await assert.rejects(owner.procedures.readStickerBytes({ stickerId }));
    await assert.rejects(peer.procedures.readStickerBytes({ stickerId }));
    await author.reducers.sendDirectMessage({ conversationId, text: `[[sticker:${stickerId}]]`, replyToId: undefined });
    await until(() => [...peer.db.stickers.iter()].some((row) => row.id === stickerId), 'sticker visible solo en el directo');
    assert.equal(hash((await peer.procedures.readStickerBytes({ stickerId })).bytes), hash(stickerBytes));
    assert.equal([...owner.db.stickers.iter()].some((row) => row.id === stickerId), false);
    await assert.rejects(owner.procedures.readStickerBytes({ stickerId }));
    await assert.rejects(subscribe(author, ['sticker_blob']));
    await assert.rejects(subscribe(author, ['sticker_import']));
    const directBytes = new TextEncoder().encode('Attachment selectively reported');
    const directFileId = await upload(author, 'direct_message', messageId, 1, directBytes);
    const unreportedFileId = await upload(author, 'direct_message', messageId, 2, new TextEncoder().encode('Unreported private attachment'));
    await until(() => [...peer.db.myDirectMessages.iter()].some((row) => row.id === messageId), 'directo del compañero');
    assert.equal([...owner.db.myDirectMessages.iter()].length, 0);
    await assert.rejects(owner.procedures.readResourceChunk({ fileId: directFileId, index: 0 }));
    await peer.reducers.reportMessage({ scope: 'direct', messageId, reason: 'Synthetic report', shareText: false, attachmentIds: [directFileId] });
    await until(() => [...owner.db.myMessageReports.iter()].length === 1, 'reporte selectivo');
    assert.equal([...owner.db.myMessageReports.iter()][0].evidenceText, '');
    assert.equal(hash((await owner.procedures.readResourceChunk({ fileId: directFileId, index: 0 })).bytes), hash(directBytes));
    await assert.rejects(owner.procedures.readResourceChunk({ fileId: unreportedFileId, index: 0 }));
    assert.equal([...owner.db.myDirectMessages.iter()].length, 0);
    await peer.reducers.setMemberBlocked({ memberId: author.identity!, blocked: true });
    await assert.rejects(author.reducers.sendDirectMessage({ conversationId, text: 'Must be blocked', replyToId: undefined }), /cuentas/);
    await peer.reducers.setMemberBlocked({ memberId: author.identity!, blocked: false });
    checks.push('directos con bytes privados, administración sin acceso, reporte selectivo y bloqueo');

    await author.reducers.createChatChannel({ name: 'Synthetic subject channel', kind: 'subject', subjectId });
    const channelId = [...author.db.chatChannels.iter()][0].id;
    await author.reducers.sendChannelMessage({ channelId, text: `Hello [[mencion:${peer.identity!.toHexString()}]]`, replyToId: undefined });
    const channelMessageId = [...author.db.channelMessages.iter()][0].id;
    await until(() => [...peer.db.channelMessages.iter()].length === 1, 'canal sincronizado');
    assert.equal(unreadMessages(snapshot(peer)).channels[0].count, 1);
    await peer.reducers.markSeen({});
    assert.equal(unreadMessages(snapshot(peer)).channels[0].count, 1);
    await peer.reducers.markConversationRead({ scope: 'channel', conversationId: channelId.toString(), messageId: channelMessageId });
    assert.equal(unreadMessages(snapshot(peer)).channels.length, 0);
    await peer.reducers.setConversationMuted({ scope: 'channel', conversationId: channelId.toString(), muted: true });
    assert.equal([...peer.db.myConversationStates.iter()].find((row) => row.conversationId === channelId.toString())?.muted, true);
    assert.equal([...owner.db.myConversationStates.iter()].length, 0);
    checks.push('canales, menciones, lectura y silenciado independientes del inicio y privados por persona');

    const profileInput = { expectedVersion: 0, preferredName: 'Synthetic preferred', bio: 'Synthetic presentation', interests: ['Rust'], learningGoals: '', skills: [], helpTopics: [], portfolioLinks: ['https://example.com/'], subjectIds: [subjectId], photoFileId: undefined };
    await author.reducers.saveMemberProfile(profileInput);
    const profileId = [...author.db.memberProfiles.iter()].find((row) => row.memberId.isEqual(author.identity!))!.id;
    const photoBytes = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCWQAAAAASUVORK5CYII=', 'base64'));
    await assert.rejects(upload(author, 'profile', profileId, 1, new TextEncoder().encode('Not a PNG'), 'image/png'), /no coincide/);
    await assert.rejects(upload(peer, 'profile', profileId, 1, photoBytes, 'image/png'), /autor/);
    const photoId = await upload(author, 'profile', profileId, 1, photoBytes, 'image/png');
    assert.equal(hash((await peer.procedures.readResourceChunk({ fileId: photoId, index: 0 })).bytes), hash(photoBytes));
    await assert.rejects(peer.reducers.saveMemberProfile({ ...profileInput, photoFileId: photoId }));
    await assert.rejects(author.reducers.saveMemberProfile(profileInput), /cambió/);
    assert.equal([...author.db.memberProfiles.iter()].find((row) => row.id === profileId)?.photoFileId, photoId);
    checks.push('perfil propio con control de versiones y foto PNG privada con bytes íntegros');

    await author.reducers.askQuestion({ subjectId, topic: 'Privacy', title: 'Synthetic question', body: 'How?' });
    const questionId = [...author.db.questions.iter()][0].id;
    await peer.reducers.answerQuestion({ questionId, body: 'Synthetic explanatory answer' });
    const answerId = [...peer.db.answers.iter()][0].id;
    await author.reducers.commentQuestion({ questionId, answerId, text: 'Synthetic clarification' });
    await author.reducers.toggleAnswerUsefulness({ answerId });
    assert.equal([...author.db.answerUsefulness.iter()].length, 1);
    await assert.rejects(peer.reducers.toggleAnswerUsefulness({ answerId }), /propia/);
    await author.reducers.toggleAnswerUsefulness({ answerId });
    assert.equal([...author.db.answerUsefulness.iter()].length, 0);
    const guideInput = { subjectId, termId: undefined, title: 'Synthetic guide', topics: ['Privacy'], sections: GUIDE_SECTIONS.map(() => '') };
    await author.reducers.createGuide({ ...guideInput, sources: [{ kind: 'nota', refId: shared.id }] });
    const guideId = [...author.db.studyGuides.iter()][0].id;
    await peer.reducers.updateGuideV2({ ...guideInput, guideId, expectedVersion: 1, title: 'Edited synthetic guide' });
    await peer.reducers.restoreGuideVersion({ guideId, version: 1, expectedVersion: 2 });
    assert.equal([...peer.db.studyGuides.iter()][0].title, 'Synthetic guide');
    assert.equal([...peer.db.guideVersions.iter()].filter((row) => row.guideId === guideId).length, 3);
    await author.reducers.saveQuestionLinks({ questionId, noteIds: [shared.id], guideIds: [guideId] });
    assert.equal([...author.db.questionLinks.iter()].length, 2);
    checks.push('aclaraciones separadas, utilidad reversible sin auto votos, vínculos e historial recuperable de guías');

    await until(() => snapshot(peer).notes.some((row) => row.id === shared.id.toString()), 'snapshot de contribuciones');
    const authorIdentity = author.identity!.toHexString();
    const pointsOf = () => buildLeaderboard(snapshot(peer), {}).find((standing) => standing.memberId === authorIdentity)!.points;
    const pointsBefore = pointsOf();
    await author.reducers.withdrawContent({ kind: 'note', targetId: shared.id, withdrawn: true, expectedVersion: 1, reason: '' });
    await until(() => !snapshot(peer).notes.some((row) => row.id === shared.id.toString()), 'retirada oculta al grupo');
    assert.equal(pointsOf(), pointsBefore - 8);
    assert.equal(buildNews(snapshot(peer)).some((row) => row.link === `/m/notas/${shared.id}`), false);
    await assert.rejects(peer.procedures.readResourceChunk({ fileId: alias.id, index: 0 }));
    await author.reducers.withdrawContent({ kind: 'note', targetId: shared.id, withdrawn: false, expectedVersion: 2, reason: '' });
    await until(() => snapshot(peer).notes.some((row) => row.id === shared.id.toString()), 'restauración al grupo');
    assert.equal(pointsOf(), pointsBefore);
    assert.equal(hash((await peer.procedures.readResourceChunk({ fileId: alias.id, index: 0 })).bytes), hash(noteBytes));
    checks.push('retirada y restauración del mismo registro, acceso a bytes y puntuación sin duplicados');

    const repeatedInput = { ...noteInput, visibility: 'group', title: 'Synthetic exact duplicate', body: 'Same shared contribution', tags: [] };
    await author.reducers.saveNoteV2(repeatedInput);
    const original = [...author.db.notes.iter()].find((row) => row.title === repeatedInput.title)!;
    await until(() => snapshot(peer).contributionOrigins.some((row) => row.refId === original.id.toString()), 'origen de contribución');
    const originalPoints = pointsOf();
    await author.reducers.withdrawContent({ kind: 'note', targetId: original.id, withdrawn: true, expectedVersion: 1, reason: '' });
    await until(() => !snapshot(peer).notes.some((row) => row.id === original.id.toString()), 'original retirado');
    await author.reducers.saveNoteV2(repeatedInput);
    const clone = [...author.db.notes.iter()].find((row) => row.title === repeatedInput.title && row.id !== original.id)!;
    await until(() => snapshot(peer).contributionOrigins.some((row) => row.refId === clone.id.toString() && row.duplicateOf === original.id.toString()), 'clon vinculado al original retirado');
    assert.equal(pointsOf(), originalPoints - 8);
    const cloneOrigin = snapshot(peer).contributionOrigins.find((row) => row.refId === clone.id.toString())!;
    assert.equal(cloneOrigin.creditedAt.getTime(), original.createdAt.toDate().getTime());
    assert.equal(snapshot(peer).contributionOrigins.some((row) => row.kind === 'apunte' && row.refId === noteId.toString()), false);
    await author.reducers.withdrawContent({ kind: 'note', targetId: original.id, withdrawn: false, expectedVersion: 2, reason: '' });
    await until(() => snapshot(peer).notes.some((row) => row.id === original.id.toString()), 'original recuperado sin duplicar puntos');
    assert.equal(pointsOf(), originalPoints);
    checks.push('copias idénticas no suman aunque el original esté retirado; fecha y puntos originales preservados');

    close(); await options.restart();
    owner = await connect(options.tokens[0]); author = await connect(options.tokens[1]); peer = await connect(options.tokens[2]);
    await subscribe(owner); await subscribe(author); await subscribe(peer);
    assert.equal([...author.db.notes.iter()].find((row) => row.id === noteId)?.visibility, 'personal');
    assert.equal([...peer.db.notes.iter()].some((row) => row.id === noteId), false);
    assert.equal([...peer.db.myConversationStates.iter()].find((row) => row.conversationId === channelId.toString())?.muted, true);
    assert.equal(hash((await peer.procedures.readResourceChunk({ fileId: photoId, index: 0 })).bytes), hash(photoBytes));
    await owner.reducers.removeMember({ identity: peer.identity! });
    await assert.rejects(peer.procedures.readResourceChunk({ fileId: photoId, index: 0 }), /activo/);
    checks.push('datos y permisos persistentes tras reinicio, revocación inmediata de lectura');
    return { checks, identities: 3, restarts: 1 };
  } finally { close(); }
}
