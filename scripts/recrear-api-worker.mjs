#!/usr/bin/env node
// Recrea el Worker b20-api (api.b20.mx) con secretos nuevos. Los secretos se generan aquí,
// viajan a Cloudflare en un archivo temporal que se borra al terminar y nunca se imprimen.
// Uso, desde la raíz del repositorio y con Node 22: node scripts/recrear-api-worker.mjs
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVER = 'https://maincloud.spacetimedb.com';
const DATABASE = 'app-b20-34245';
const MASTER_VERSION = 'v2';
const WORKER_CONFIG = 'apps/api/wrangler.ai.jsonc';
/** Archivos donde vive la clave VAPID pública: el Worker y la web deben usar la misma. */
const VAPID_FILES = [WORKER_CONFIG, 'wrangler.jsonc', '.env.pages.example'];

/** Clave maestra AES-256 para las claves de Gemini, en el formato de AI_MASTER_KEYS_JSON. */
export function masterKeysJson(version = MASTER_VERSION) {
  return JSON.stringify({ [version]: randomBytes(32).toString('base64') });
}

/** Par VAPID P-256: pública sin comprimir (65 bytes) y escalar privado (32 bytes), en base64url. */
export function vapidPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
  return { publicKey: point.toString('base64url'), privateKey: privateKey.export({ format: 'jwk' }).d };
}

/** Sustituye la clave pública en la configuración del Worker y de la web. */
export function replaceVapidPublicKey(text, publicKey) {
  return text
    .replace(/("(?:VITE_)?VAPID_PUBLIC_KEY":\s*")[A-Za-z0-9_-]+(")/g, `$1${publicKey}$2`)
    .replace(/^(VITE_VAPID_PUBLIC_KEY=)[A-Za-z0-9_-]*$/m, `$1${publicKey}`);
}

async function newIdentity() {
  const response = await fetch(`${SERVER}/v1/identity`, { method: 'POST' });
  if (!response.ok) throw new Error(`SpacetimeDB no creó la identidad técnica (HTTP ${response.status}).`);
  const body = await response.json();
  const hex = String(body.identity ?? '').replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex) || typeof body.token !== 'string' || !body.token) {
    throw new Error('SpacetimeDB devolvió una identidad técnica inesperada.');
  }
  return { identity: `0x${hex}`, token: body.token };
}

function run(command, args, { quiet = false } = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (result.status !== 0) {
    if (quiet) process.stderr.write(result.stderr ?? '');
    throw new Error(`Falló «${[command.split('/').pop(), ...args.slice(0, 3)].join(' ')}…».`);
  }
  return result.stdout ?? '';
}

/** Lee la clave desde una tubería (por ejemplo `pbpaste | node …`) sin mostrarla. */
async function readPiped() {
  let value = '';
  for await (const chunk of process.stdin) value += chunk;
  return value.trim();
}

/** Lee una línea sin mostrarla en pantalla. */
function askHidden(question) {
  if (!process.stdin.isTTY) return readPiped();
  return new Promise((resolve) => {
    const input = process.stdin;
    process.stdout.write(question);
    let value = '';
    const done = () => { input.setRawMode?.(false); input.pause(); input.off('data', onData); process.stdout.write('\n'); resolve(value.trim()); };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return done();
        if (char === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    input.setRawMode?.(true);
    input.setEncoding('utf8');
    input.resume();
    input.on('data', onData);
  });
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Usa Node 22 o superior (nvm use 22).');
  const npx = join(dirname(process.execPath), 'npx');
  const spacetime = run('spacetime', ['login', 'show'], { quiet: true }).trim();
  console.log(`SpacetimeDB: ${spacetime}`);
  console.log('Se registrarán las identidades técnicas con esa sesión; debe ser la propietaria de la base.\n');

  const supabaseSecret = await askHidden('Pega la clave sb_secret_ del proyecto pypdkigeywdughdhxlcm (no se mostrará): ');
  if (!supabaseSecret.startsWith('sb_secret_')) throw new Error('Esa clave no empieza con sb_secret_. No se cambió nada.');

  console.log('\n1/4 Generando claves e identidades técnicas…');
  const vapid = vapidPair();
  const ai = await newIdentity();
  const notifications = await newIdentity();

  console.log('2/4 Registrando las identidades en Maincloud…');
  run('spacetime', ['call', '-s', 'maincloud', DATABASE, 'set_ai_service', JSON.stringify(ai.identity), 'true', JSON.stringify({ some: 100_000 })]);
  run('spacetime', ['call', '-s', 'maincloud', DATABASE, 'set_notification_service', JSON.stringify(notifications.identity), 'true']);

  console.log('3/4 Guardando la clave VAPID pública en la configuración…');
  for (const file of VAPID_FILES) {
    const path = join(ROOT, file);
    writeFileSync(path, replaceVapidPublicKey(readFileSync(path, 'utf8'), vapid.publicKey));
  }

  console.log('4/4 Desplegando b20-api en api.b20.mx con sus secretos…');
  const dir = mkdtempSync(join(tmpdir(), 'b20-api-'));
  const secretsFile = join(dir, 'secrets.json');
  try {
    writeFileSync(secretsFile, JSON.stringify({
      AI_MASTER_KEYS_JSON: masterKeysJson(),
      AI_SERVICE_TOKEN: ai.token,
      NOTIFICATION_SERVICE_TOKEN: notifications.token,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      SUPABASE_SECRET_KEY: supabaseSecret,
    }), { mode: 0o600 });
    run(npx, ['wrangler', 'deploy', '--config', WORKER_CONFIG, '--secrets-file', secretsFile]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log('\nListo. Datos públicos (puedes compartirlos):');
  console.log(`  Identidad técnica de IA:       ${ai.identity}`);
  console.log(`  Identidad técnica de avisos:   ${notifications.identity}`);
  console.log(`  Clave VAPID pública:           ${vapid.publicKey}`);
  console.log('\nLa clave pública ya quedó en la configuración; avisa para publicar la web.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => { console.error(`\n${error instanceof Error ? error.message : error}`); process.exit(1); });
}
