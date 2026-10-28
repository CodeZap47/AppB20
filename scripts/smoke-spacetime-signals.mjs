/** Copia temporal con retención acelerada. Nunca modifica código ni datos de producción. */
import { spawn } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.B20_SIGNALS_SMOKE_PORT ?? '3398');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('B20_SIGNALS_SMOKE_PORT inválido.');
const address = `http://127.0.0.1:${port}`;
const database = 'b20-local-signals-smoke';
const temporary = await mkdtemp(join(tmpdir(), 'b20-spacetime-signals-'));
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
  const tokens = ['owner', 'author', 'reviewer', 'outsider'].map((subject) => {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode({
      iss: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', sub: `b20-local-smoke-${subject}`,
      aud: ['b20-local-smoke'], iat: now, exp: now + 7200,
      email: `${subject}@b20-smoke.invalid`, email_verified: true,
    })}`;
    return `${payload}.${sign('sha256', Buffer.from(payload), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  });
  // El verificador local acepta su propia clave. No se modifica la política de autenticación del módulo.
  await command(['login', '--token', tokens[0]]);
  const temporaryPackages = join(temporary, 'packages');
  await mkdir(temporaryPackages);
  const modulePath = join(temporaryPackages, 'spacetime-module');
  const corePath = join(temporaryPackages, 'core');
  const include = (path) => !path.split('/').some(part => part === 'node_modules' || part === 'dist');
  await cp(join(root, 'packages/spacetime-module'), modulePath, { recursive: true, filter: include });
  await cp(join(root, 'packages/core'), corePath, { recursive: true, filter: include });
  await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
  await symlink(join(root, 'node_modules'), join(modulePath, 'node_modules'), 'dir');
  await cp(join(root, 'tsconfig.base.json'), join(temporary, 'tsconfig.base.json'));
  await cp(join(root, 'package.json'), join(temporary, 'package.json'));
  const signalsPath = join(corePath, 'src/signals.ts');
  const original = await readFile(signalsPath, 'utf8');
  const accelerated = original.replace('retentionMs: 30 * 86_400_000', 'retentionMs: 4_000');
  if (accelerated === original) throw new Error('No se encontró el plazo de 30 días en la copia temporal.');
  await writeFile(signalsPath, accelerated);
  await command(['build', '--module-path', modulePath]);
  await startServer();
  await command(['publish', '--server', address, '--js-path', join(modulePath, 'dist/bundle.js'),
    '--delete-data=never', '--no-config', '--yes=all', database]);
  const clientPath = join(temporary, 'smoke-client.mjs');
  await build({ entryPoints: [join(root, 'scripts/smoke-spacetime-signals.client.ts')], outfile: clientPath,
    platform: 'node', target: 'node22', format: 'esm', bundle: true, logLevel: 'silent' });
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
