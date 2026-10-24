import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';

const bounded = <T>(promise: Promise<T>, label: string) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Tiempo agotado: ${label}`)), 30_000);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});
const waitFor = async (ready: () => boolean, label: string) => {
  const deadline = performance.now() + 30_000;
  while (!ready()) {
    if (performance.now() >= deadline) throw new Error(`Tiempo agotado: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const observations = { clarity: '', examples: '', decisions: '', limitations: '' };

/** Solo servidor local aislado; cuatro identidades y datos ficticios. */
export async function runSmoke(options: { address: string; database: string; tokens: string[]; restart(): Promise<void> }) {
  assert.ok(options.address.startsWith('http://127.0.0.1:'), 'El smoke nunca usa producción');
  setGlobalLogLevel('error');
  const connections = new Set<DbConnection>();
  const checks: string[] = [];
  const connect = (token: string) => bounded(new Promise<DbConnection>((resolve, reject) => {
    const connection = DbConnection.builder().withUri(options.address).withDatabaseName(options.database)
      .withToken(token).withCompression('none').onConnect((ready) => resolve(ready))
      .onConnectError((_ctx, error) => reject(error)).build();
    connections.add(connection);
  }), 'conectar');
  const subscribe = (connection: DbConnection, queries: string[]) => bounded(new Promise<void>((resolve, reject) => {
    connection.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx, error) => reject(error)).subscribe(queries);
  }), 'suscripción');
  const views = ['subjects', 'notes', 'presentation_practices', 'presentation_attempts',
    'my_presentation_personal', 'presentation_questions', 'presentation_feedback'];
  const observe = (connection: DbConnection) => subscribe(connection, views.map((view) => `SELECT * FROM ${view}`));
  const practices = (connection: DbConnection) => [...connection.db.presentationPractices.iter()];
  const attempts = (connection: DbConnection) => [...connection.db.presentationAttempts.iter()];
  const questions = (connection: DbConnection) => [...connection.db.presentationQuestions.iter()];
  const personal = (connection: DbConnection) => [...connection.db.myPresentationPersonal.iter()];
  const feedback = (connection: DbConnection) => [...connection.db.presentationFeedback.iter()];
  const close = () => { for (const connection of connections) connection.disconnect(); connections.clear(); };
  try {
    let admin = await connect(options.tokens[0]);
    await admin.reducers.setAuthConfig({ issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['b20-local-smoke'] });
    for (const name of ['owner', 'author', 'reviewer']) {
      await admin.reducers.inviteMember({ email: `${name}@b20-smoke.invalid`, isCreator: name === 'owner' });
    }
    await admin.reducers.joinGroup({ displayName: 'Local admin' });
    let author = await connect(options.tokens[1]);
    let reviewer = await connect(options.tokens[2]);
    let outsider = await connect(options.tokens[3]);
    await author.reducers.joinGroup({ displayName: 'Local author' });
    await reviewer.reducers.joinGroup({ displayName: 'Local reviewer' });
    await assert.rejects(outsider.reducers.joinGroup({ displayName: 'Local outsider' }));
    await Promise.all([admin, author, reviewer, outsider].map(observe));
    await author.reducers.createSubject({ name: 'Local presentations', period: 1 });
    const subjectId = [...author.db.subjects.iter()].find((row) => row.name === 'Local presentations')!.id;
    await author.reducers.saveNote({ noteId: undefined, subjectId, topic: 'TCP', title: 'Local private source',
      body: 'Synthetic private note', tags: [], visibility: 'personal', source: 'student' });
    const sourceId = [...author.db.notes.iter()].find((row) => row.title === 'Local private source')!.id;
    const input = { practiceId: undefined, subjectId, termId: undefined, title: 'Local TCP rehearsal', topic: 'TCP',
      audience: 'compañeros', targetMinutes: 5, keyPoints: ['Conexión', 'Fiabilidad'], sourceKind: 'note', sourceId,
      expectedVersion: undefined, requestId: randomUUID() };
    await author.reducers.savePresentationPractice(input);
    await author.reducers.savePresentationPractice(input);
    assert.equal(practices(author).length, 1);
    await assert.rejects(author.reducers.savePresentationPractice({ ...input, title: 'Different payload' }));
    const practiceId = practices(author)[0].id;
    await author.reducers.createPresentationAttempt({ practiceId, requestId: 'attempt-1', expectedVersion: practices(author)[0].version });
    const firstId = attempts(author)[0].id;
    const firstRequest = { practiceId, requestId: 'attempt-1', expectedVersion: 1 };
    await author.reducers.createPresentationAttempt(firstRequest);
    assert.equal(attempts(author).length, 1);
    const firstBody = 'TCP establece una conexión y ofrece entrega fiable. Por ejemplo, permite reconstruir datos en orden.';
    await author.reducers.savePresentationAttempt({ attemptId: firstId, body: firstBody, ...observations,
      clarity: 'Private self observation', nextSteps: 'Private next steps', expectedVersion: 1 });
    await author.reducers.setPresentationReviewer({ practiceId, reviewerId: reviewer.identity!, expectedVersion: practices(author)[0].version });
    await assert.rejects(reviewer.reducers.savePresentationAttempt({ attemptId: firstId, body: 'unauthorized',
      ...observations, nextSteps: '', expectedVersion: 2 }));
    assert.equal(attempts(reviewer).length, 0);
    assert.equal(attempts(admin).length, 0);
    assert.equal(personal(reviewer).length, 0);
    assert.equal(personal(admin).length, 0);
    checks.push('creación idempotente y borrador/autoobservaciones privados incluso frente a administrador');

    await author.reducers.completePresentationAttempt({ attemptId: firstId, expectedVersion: 2 });
    await author.reducers.completePresentationAttempt({ attemptId: firstId, expectedVersion: 2 });
    assert.equal(questions(author).length, 5);
    await waitFor(() => attempts(reviewer).length === 1, 'intento concluido compartido');
    assert.equal(attempts(reviewer)[0].body, firstBody);
    assert.equal(attempts(reviewer)[0].sourceId, undefined);
    assert.equal(practices(reviewer)[0].sourceId, undefined);
    assert.equal(personal(reviewer).length, 0);
    assert.equal(practices(admin).length, 0);
    assert.equal(practices(outsider).length, 0);
    await assert.rejects(author.reducers.savePresentationAttempt({ attemptId: firstId, body: 'rewrite completed',
      ...observations, nextSteps: '', expectedVersion: attempts(author)[0].version }));
    checks.push('conclusión idempotente, cinco preguntas locales y fuente personal oculta al revisor');

    const questionRequest = { attemptId: firstId, text: '¿Qué sucede si se pierde un paquete?', requestId: randomUUID() };
    await reviewer.reducers.askPresentationQuestion(questionRequest);
    await reviewer.reducers.askPresentationQuestion(questionRequest);
    await waitFor(() => questions(author).some((row) => row.text === questionRequest.text), 'pregunta de compañero');
    const question = questions(author).find((row) => row.text === questionRequest.text)!;
    assert.equal(questions(author).filter((row) => row.text === questionRequest.text).length, 1);
    await author.reducers.answerPresentationQuestion({ questionId: question.id, answer: 'TCP puede retransmitir los datos perdidos.', expectedVersion: question.version });
    await assert.rejects(author.reducers.answerPresentationQuestion({ questionId: question.id, answer: 'Stale overwrite', expectedVersion: question.version }));
    await reviewer.reducers.savePresentationFeedback({ attemptId: firstId, ...observations,
      examples: 'Añade un caso de retransmisión.', comment: 'Feedback orientativo sintético', expectedVersion: undefined });
    await waitFor(() => feedback(author).length === 1, 'feedback del compañero');
    checks.push('preguntas y respuestas versionadas, reintentos y retroalimentación del revisor');

    await author.reducers.createPresentationAttempt({ practiceId, requestId: 'attempt-2', expectedVersion: practices(author)[0].version });
    const secondId = attempts(author).find((row) => row.id !== firstId)!.id;
    const second = attempts(author).find((row) => row.id === secondId)!;
    assert.equal(second.body, firstBody);
    assert.equal(second.number, 2);
    assert.equal(personal(author).find((row) => row.attemptId === secondId)!.nextSteps, '');
    assert.equal(attempts(reviewer).length, 1);
    await assert.rejects(author.reducers.createPresentationAttempt({ practiceId, requestId: 'parallel-draft', expectedVersion: practices(author)[0].version }));
    const improvedBody = `${firstBody} Si se pierde un paquete, TCP solicita o espera su retransmisión; no garantiza latencia baja.`;
    await author.reducers.savePresentationAttempt({ attemptId: secondId, body: improvedBody, ...observations,
      limitations: 'Explicar latencia', nextSteps: 'Second private plan', expectedVersion: second.version });
    await author.reducers.completePresentationAttempt({ attemptId: secondId, expectedVersion: second.version + 1 });
    assert.equal(attempts(author).find((row) => row.id === firstId)!.body, firstBody);
    await author.reducers.savePresentationPractice({ ...input, practiceId, requestId: randomUUID(),
      title: 'Private future configuration', expectedVersion: practices(author)[0].version });
    await waitFor(() => attempts(reviewer).length === 2, 'segundo intento concluido');
    assert.equal(practices(reviewer)[0].title, input.title);
    assert.equal(attempts(reviewer).find((row) => row.id === secondId)!.title, input.title);
    checks.push('segundo intento separado, un único borrador y contexto histórico sin filtrar configuración futura');

    close(); await options.restart();
    admin = await connect(options.tokens[0]); author = await connect(options.tokens[1]);
    reviewer = await connect(options.tokens[2]); outsider = await connect(options.tokens[3]);
    await Promise.all([admin, author, reviewer, outsider].map(observe));
    assert.equal(attempts(author).length, 2);
    assert.equal(feedback(author).length, 1);
    assert.equal(personal(author).length, 2);
    await author.reducers.completePresentationAttempt({ attemptId: secondId, expectedVersion: 2 });
    assert.equal(questions(author).filter((row) => row.attemptId === secondId).length, 5);
    checks.push('persistencia tras reiniciar y reintento sin duplicar preguntas');

    await author.reducers.setPresentationReviewer({ practiceId, reviewerId: admin.identity!, expectedVersion: practices(author)[0].version });
    await waitFor(() => practices(reviewer).length === 0 && attempts(reviewer).length === 0, 'revocación del revisor anterior');
    await waitFor(() => attempts(admin).length === 2, 'nuevo revisor expresamente invitado');
    assert.equal(personal(admin).length, 0);
    assert.equal(feedback(admin).length, 0);
    assert.equal(feedback(author).length, 1);
    await assert.rejects(reviewer.reducers.askPresentationQuestion({ attemptId: firstId, text: 'Revoked', requestId: randomUUID() }));
    await author.reducers.archivePresentationPractice({ practiceId, archived: true, expectedVersion: practices(author)[0].version });
    await waitFor(() => attempts(admin).length === 0, 'archivo revoca lectura');
    assert.equal(attempts(author).length, 2);
    assert.equal(feedback(author).length, 1);
    await author.reducers.archivePresentationPractice({ practiceId, archived: false, expectedVersion: practices(author)[0].version });
    assert.equal(practices(author)[0].reviewerId, undefined);
    await author.reducers.setPresentationReviewer({ practiceId, reviewerId: admin.identity!, expectedVersion: practices(author)[0].version });
    await waitFor(() => attempts(admin).length === 2, 'restauración conserva historial');
    checks.push('cambio de revisor, archivo y restauración sin perder historial privado');

    for (const name of ['presentation_practice', 'presentation_attempt', 'presentation_personal', 'presentation_question', 'presentation_feedback_entry']) {
      await assert.rejects(subscribe(author, [`SELECT * FROM ${name}`]));
    }
    await admin.reducers.removeMember({ identity: author.identity! });
    await waitFor(() => practices(author).length === 0 && attempts(author).length === 0 && personal(author).length === 0, 'baja de integrante');
    await assert.rejects(author.reducers.savePresentationPractice({ ...input, requestId: randomUUID() }));
    checks.push('cinco tablas no suscribibles y baja inmediata de integrante');
    return { environment: 'isolated local SpacetimeDB 2.12.0', checks };
  } finally { close(); }
}
