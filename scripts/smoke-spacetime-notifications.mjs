/** Notificaciones, servidor real aislado y sin envíos Web Push: no usa cuentas ni bases de producción. */
import { spawn } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.B20_SMOKE_NOTIFICATIONS_PORT ?? '3354');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('B20_SMOKE_PORT inválido.');
const address = `http://127.0.0.1:${port}`;
const database = 'b20-local-notifications-smoke';
const temporary = await mkdtemp(join(tmpdir(), 'b20-spacetime-notifications-'));
const config = join(temporary, 'cli.toml');
const privatePath = join(temporary, 'private.pem');
const publicPath = join(temporary, 'public.pem');
let server;
let serverLog = '';
let passed = false;

function command(args) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn('spacetime', ['--config-path', config, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Tiempo agotado: ${args[0]}`)); }, 120_000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolveCommand(output);
      else reject(new Error(`Falló ${args[0]} (${code}): ${output}`));
    });
  });
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const current = server;
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => current.kill('SIGKILL'), 8_000);
    current.once('exit', () => { clearTimeout(timer); resolveStop(); });
    current.kill('SIGTERM');
  });
  server = undefined;
}

async function startServer() {
  server = spawn('spacetime', ['--config-path', config, 'start', '--listen-addr', `127.0.0.1:${port}`,
    '--data-dir', join(temporary, 'data'), '--jwt-pub-key-path', publicPath,
    '--jwt-priv-key-path', privatePath, '--non-interactive'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (data) => { serverLog += data; });
  server.stderr.on('data', (data) => { serverLog += data; });
  let startError;
  server.once('error', (error) => { startError = error; });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (startError) throw startError;
    if (server.exitCode !== null) throw new Error(`El servidor local terminó: ${serverLog}`);
    try {
      const response = await fetch(`${address}/v1/identity/public-key`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch { /* El proceso todavía está iniciando. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error('El servidor local no inició a tiempo.');
}

try {
  // Falla si hay otro proceso en el puerto. Nunca se conecta a un servidor preexistente.
  await new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolvePort));
  });
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  await writeFile(privatePath, keys.privateKey, { mode: 0o600 });
  await writeFile(publicPath, keys.publicKey, { mode: 0o600 });
  const tokens = ['owner', 'author', 'other', 'outsider'].map((subject) => {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode({
      iss: 'https://auth.spacetimedb.com/oidc', sub: `b20-local-smoke-${subject}`,
      aud: ['b20-local-smoke'], iat: now, exp: now + 7200,
      email: `${subject}@b20-smoke.invalid`, email_verified: true,
    })}`;
    return `${payload}.${sign('sha256', Buffer.from(payload), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  });
  // El verificador local acepta su propia clave. No se modifica la política de autenticación del módulo.
  await command(['login', '--token', tokens[0]]);
  await command(['build', '--module-path', 'packages/spacetime-module']);
  await startServer();
  await command(['publish', '--server', address, '--js-path', 'packages/spacetime-module/dist/bundle.js',
    '--delete-data=never', '--no-config', '--yes=all', database]);
  const clientPath = join(temporary, 'smoke-client.mjs');
  await build({ entryPoints: [join(root, 'scripts/smoke-spacetime-notifications.client.ts')], outfile: clientPath,
    platform: 'node', target: 'node22', format: 'esm', bundle: true, logLevel: 'silent',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
  const { runSmoke } = await import(pathToFileURL(clientPath).href);
  const summary = await runSmoke({ address, database, tokens,
    restart: async () => { await stopServer(); await startServer(); } });
  passed = true;
  console.log(JSON.stringify({ result: 'passed', ...summary }, null, 2));
} finally {
  await stopServer();
  if (!passed) await writeFile(join(temporary, 'server.log'), serverLog);
  if (passed) await rm(temporary, { recursive: true, force: true });
  else console.error(`Diagnóstico del servidor local: ${join(temporary, 'server.log')}`);
}
