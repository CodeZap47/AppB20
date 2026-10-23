import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';
const bounded = <T>(promise: Promise<T>, label: string) => new Promise<T>((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Tiempo agotado: ${label}`)), 30_000); promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); }); });
async function waitFor(ready: () => boolean, label: string) { const deadline = performance.now() + 30_000; while (!ready()) { if (performance.now() >= deadline) throw new Error(`Tiempo agotado: ${label}`); await new Promise((resolve) => setTimeout(resolve, 20)); } }

const VIEWS = ['my_member', 'members', 'subjects', 'assignments', 'works', 'work_authors', 'my_agent_profile', 'my_agent_sources', 'my_agent_style_snapshots', 'my_agent_sessions', 'my_agent_suggestions', 'my_agent_originality_checks'];
const PRIVATE_TABLES = ['agent_profile', 'agent_style_source', 'agent_style_snapshot', 'agent_session', 'agent_suggestion', 'agent_originality_check', 'agent_expiry'];
const essay = 'Un ciclo while repite instrucciones mientras su condición sea verdadera. Si el índice nunca cambia, el ciclo no termina y el programa se queda congelado. Por eso conviene revisar el incremento antes de ejecutar el programa completo.';
const own = 'Yo resolví la recursión pensando primero en el caso base. Después escribí el caso recursivo y lo probé con números pequeños para ver cómo regresaba cada llamada.';

export async function runSmoke(options: { address: string; database: string; tokens: string[]; restart(): Promise<void> }) {
  assert.ok(options.address.startsWith('http://127.0.0.1:')); setGlobalLogLevel('error'); const connections = new Set<DbConnection>(); const checks: string[] = [];
  const connect = (token: string) => bounded(new Promise<DbConnection>((resolve, reject) => { const c = DbConnection.builder().withUri(options.address).withDatabaseName(options.database).withToken(token).withCompression('none').onConnect((ready) => resolve(ready)).onConnectError((_ctx, error) => reject(error)).build(); connections.add(c); }), 'conexión');
  const subscribe = (c: DbConnection, queries: string[]) => bounded(new Promise<void>((resolve, reject) => { c.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx, error) => reject(error)).subscribe(queries); }), 'suscripción');
  const observe = (c: DbConnection) => subscribe(c, VIEWS.map((view) => `SELECT * FROM ${view}`));
  const close = () => { for (const c of connections) c.disconnect(); connections.clear(); };
  const sessions = (c: DbConnection) => [...c.db.myAgentSessions.iter()];
  const lastCheck = (c: DbConnection) => [...c.db.myAgentOriginalityChecks.iter()].sort((a, b) => Number(a.id - b.id)).at(-1);
  try {
    let admin = await connect(options.tokens[0]!); await admin.reducers.setAuthConfig({ issuer: 'https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1', audiences: ['b20-local-smoke'] });
    for (const name of ['admin', 'owner', 'peer']) await admin.reducers.inviteMember({ email: `${name}@b20-smoke.invalid`, isCreator: name === 'admin' });
    await admin.reducers.joinGroup({ displayName: 'Local admin' });
    let owner = await connect(options.tokens[1]!); let peer = await connect(options.tokens[2]!); const outsider = await connect(options.tokens[3]!);
    await owner.reducers.joinGroup({ displayName: 'Luis Flores' }); await peer.reducers.joinGroup({ displayName: 'Ana Pérez' });
    await assert.rejects(outsider.reducers.joinGroup({ displayName: 'Sin invitación' })); await assert.rejects(outsider.reducers.enableAgent({ premisesVersion: 1 }));
    await Promise.all([admin, owner, peer, outsider].map(observe));

    await owner.reducers.createSubject({ name: 'Programación local', period: 1 }); await waitFor(() => [...owner.db.subjects.iter()].some((r) => r.name === 'Programación local'), 'materia');
    const subjectId = [...owner.db.subjects.iter()].find((r) => r.name === 'Programación local')!.id;
    await owner.reducers.createAssignmentV2({ subjectId, termId: undefined, kind: 'tarea', title: 'Ciclos', instructions: 'Explica qué ocurre cuando la condición de un ciclo nunca deja de cumplirse.', dueDate: '', topic: 'Ciclos' });
    await waitFor(() => [...owner.db.assignments.iter()].length === 1, 'tarea'); const assignmentId = [...owner.db.assignments.iter()][0]!.id;
    await peer.reducers.publishWorkV2({ assignmentId, title: 'Ensayo de Ana', description: essay, coauthors: [], topic: 'Ciclos', status: 'final' });
    await owner.reducers.publishWorkV2({ assignmentId, title: 'Mi recursión', description: own, coauthors: [], topic: 'Recursión', status: 'final' });
    await waitFor(() => [...owner.db.works.iter()].length === 2 && [...owner.db.workAuthors.iter()].length === 2, 'trabajos');
    const authorOf = (workId: bigint) => [...owner.db.workAuthors.iter()].find((a) => a.workId === workId)!.author;
    const ownWork = [...owner.db.works.iter()].find((w) => authorOf(w.id).isEqual(owner.identity!))!; const peerWork = [...owner.db.works.iter()].find((w) => w.id !== ownWork.id)!;

    await assert.rejects(owner.reducers.trainAgent({ sources: JSON.stringify([{ kind: 'work', refId: ownWork.id.toString() }]), expectedStyleVersion: 0 }));
    await assert.rejects(owner.reducers.enableAgent({ premisesVersion: 0 }));
    await owner.reducers.enableAgent({ premisesVersion: 1 });
    await assert.rejects(owner.reducers.trainAgent({ sources: JSON.stringify([{ kind: 'work', refId: peerWork.id.toString() }]), expectedStyleVersion: 0 }));
    await owner.reducers.trainAgent({ sources: JSON.stringify([{ kind: 'work', refId: ownWork.id.toString() }]), expectedStyleVersion: 0 });
    await waitFor(() => [...owner.db.myAgentStyleSnapshots.iter()].length === 1, 'perfil de estilo');
    assert.equal(JSON.parse([...owner.db.myAgentStyleSnapshots.iter()][0]!.features).tone, 'Cercano, en primera persona');
    checks.push('consentimiento con versión de premisas, entrenamiento solo con trabajos propios y perfil calculado en el servidor');

    const requestId = randomUUID(); await owner.reducers.startAgentSession({ assignmentId, requestId }); await owner.reducers.startAgentSession({ assignmentId, requestId });
    await waitFor(() => sessions(owner).length === 1, 'sesión'); const sessionId = sessions(owner)[0]!.id;
    await owner.reducers.saveAgentDraft({ sessionId, expectedDraftVersion: 0, stage: 'review', draft: `El ciclo ciclo termina. ${essay}` });
    await assert.rejects(owner.reducers.saveAgentDraft({ sessionId, expectedDraftVersion: 0, stage: 'review', draft: 'Pestaña antigua' }));
    await owner.reducers.proposeAgentSuggestions({ sessionId, draftVersion: 1, suggestions: JSON.stringify([{ reason: 'Se repite «ciclo».', original: 'ciclo ciclo', replacement: 'ciclo' }]) });
    await waitFor(() => [...owner.db.myAgentSuggestions.iter()].length === 1, 'sugerencia');
    await owner.reducers.resolveAgentSuggestion({ suggestionId: [...owner.db.myAgentSuggestions.iter()][0]!.id, accept: true });
    await waitFor(() => sessions(owner)[0]?.draftVersion === 2, 'sugerencia aplicada'); assert.ok(sessions(owner)[0]!.draft.startsWith('El ciclo termina.'));
    await owner.reducers.checkAgentOriginality({ sessionId, draftVersion: 2 }); await waitFor(() => !!lastCheck(owner), 'comparación');
    const matches = JSON.parse(lastCheck(owner)!.matches) as { refKey: string; level: string; authorName: string; excluded: { instructionGroups: number } }[];
    assert.deepEqual(matches.map((m) => m.refKey), [`work:${peerWork.id}`]); assert.equal(matches[0]!.level, 'block'); assert.equal(matches[0]!.authorName, 'Ana Pérez');
    await owner.reducers.acknowledgeAgentMatch({ checkId: lastCheck(owner)!.id, refKey: `work:${peerWork.id}` });
    checks.push('sesión idempotente, borrador versionado, sugerencia aplicada en el servidor y comparación contra el trabajo publicado de otra persona');

    for (const table of PRIVATE_TABLES) await assert.rejects(subscribe(peer, [`SELECT * FROM ${table}`]), `${table} debe ser privada`);
    for (const c of [peer, admin, outsider]) { assert.equal([...c.db.myAgentProfile.iter()].length, 0); assert.equal(sessions(c).length, 0); assert.equal([...c.db.myAgentOriginalityChecks.iter()].length, 0); }
    await assert.rejects(peer.reducers.saveAgentDraft({ sessionId, expectedDraftVersion: 2, stage: 'review', draft: 'intruso' }));
    checks.push('tablas privadas no suscribibles y vistas vacías para compañera, administrador e intruso');

    close(); await options.restart();
    admin = await connect(options.tokens[0]!); owner = await connect(options.tokens[1]!); peer = await connect(options.tokens[2]!); await Promise.all([admin, owner, peer].map(observe));
    assert.equal([...owner.db.myAgentProfile.iter()].length, 1); assert.equal(sessions(owner)[0]!.draftVersion, 2); assert.deepEqual([...lastCheck(owner)!.acknowledged], [`work:${peerWork.id}`]);
    checks.push('reinicio conserva perfil, borrador, versión y la marca «reescribiré esta parte»');

    await peer.reducers.withdrawContent({ kind: 'work', targetId: peerWork.id, withdrawn: true, expectedVersion: peerWork.version, reason: 'Prueba local' });
    const before = lastCheck(owner)!.id; await owner.reducers.checkAgentOriginality({ sessionId, draftVersion: 2 }); await waitFor(() => lastCheck(owner)!.id !== before, 'nueva comparación');
    assert.deepEqual(JSON.parse(lastCheck(owner)!.matches), []);
    checks.push('un trabajo retirado deja de contar en la comparación');

    await owner.reducers.disableAgent({});
    await waitFor(() => [...owner.db.myAgentProfile.iter()].length === 0 && sessions(owner).length === 0 && [...owner.db.myAgentStyleSnapshots.iter()].length === 0, 'desactivar');
    await peer.reducers.enableAgent({ premisesVersion: 1 }); await waitFor(() => [...peer.db.myAgentProfile.iter()].length === 1, 'agente de Ana');
    await admin.reducers.removeMember({ identity: peer.identity! }); await waitFor(() => [...peer.db.myAgentProfile.iter()].length === 0, 'baja');
    await assert.rejects(peer.reducers.enableAgent({ premisesVersion: 1 }));
    checks.push('desactivar borra los datos del agente; la baja revoca el acceso');
    return { environment: 'isolated local SpacetimeDB', checks };
  } finally { close(); }
}
