#!/usr/bin/env node
// Lee la clave sin eco y la transmite por stdin a Wrangler; nunca la guarda ni la imprime.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createResendEmailSend } from '../apps/api/src/invitations/resend.ts';
import { buildInvitationEmail } from '../apps/api/src/invitations/template.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = 'apps/api/wrangler.ai.jsonc';
const RECEIPT = new URL('../artifacts/resend-2026-10-26/setup.json', import.meta.url);

async function readSecret() {
  if (!process.stdin.isTTY) {
    let value = '';
    for await (const chunk of process.stdin) value += chunk;
    return value.trim();
  }
  process.stdout.write('Pega la clave de Resend y pulsa Enter (no se mostrará): ');
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    let value = '';
    const cleanup = () => { input.setRawMode(false); input.pause(); input.off('data', onData); process.stdout.write('\n'); };
    const onData = (chunk) => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') { cleanup(); resolve(value.trim()); return; }
        if (char === '\u0003') { cleanup(); reject(new Error('Operación cancelada.')); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    input.setRawMode(true); input.resume(); input.on('data', onData);
  });
}

async function configure(key, recipient) {
  if (!/^re_[A-Za-z0-9_-]{10,}$/.test(key)) throw new Error('La clave de Resend no tiene un formato válido.');
  const message = buildInvitationEmail({ email: recipient, isCreator: false, inviterName: 'La administración de B20', appUrl: 'https://b20.mx' });
  message.subject = '[Prueba] Invitaciones B20 con Resend';
  const idempotencyKey = 'b20-invitation-setup/' + createHash('sha256').update(key + '\n' + recipient).digest('hex');
  const result = await createResendEmailSend(key)({ ...message, to: recipient, from: 'B20 <invitaciones@b20.mx>' }, idempotencyKey);
  process.stdout.write('Resend aceptó el correo de prueba. Guardando la clave en Cloudflare…\n');
  const saved = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'secret', 'put', 'RESEND_API_KEY', '--config', CONFIG], {
    cwd: ROOT, input: key + '\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (saved.status !== 0) throw new Error('Cloudflare no pudo guardar el secreto. La clave no se mostró ni se guardó en archivos.');
  mkdirSync(new URL('.', RECEIPT), { recursive: true });
  writeFileSync(RECEIPT, JSON.stringify({ testAccepted: true, testEmailId: result.id, secretInstalled: true, at: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write('Listo. Clave guardada como secreto de b20-api. Revisa el correo de prueba en tu bandeja.\n');
}

async function secureForm(recipient) {
  const path = '/resend/' + randomUUID();
  let origin;
  let busy = false;
  const html = (content) => '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectar Resend a B20</title><style>body{font:17px system-ui;background:#f3f5f8;color:#193657;padding:40px;max-width:550px;margin:60px auto}main{background:white;padding:32px;border-radius:18px}input,button{box-sizing:border-box;width:100%;padding:14px;margin-top:12px;font:inherit;border-radius:8px;border:1px solid #ccd3dc}button{background:#193657;color:white;cursor:pointer}p{line-height:1.5}</style><main>' + content + '</main></html>';
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url !== path || request.headers.host !== new URL(origin).host) { response.writeHead(404); response.end(); return; }
    if (request.method === 'GET') {
      response.end(html('<h1>Conectar Resend a B20</h1><p>Pega la clave de envío para <strong>b20.mx</strong>. Los caracteres se ocultarán. La clave se guardará como secreto del servidor y se enviará una prueba al correo de administración.</p><form method="post" autocomplete="off"><label>Clave de Resend<input name="key" type="password" required autocomplete="off" spellcheck="false" placeholder="re_…"></label><button>Guardar clave y enviar prueba</button></form>'));
      return;
    }
    if (request.method !== 'POST' || request.headers.origin !== origin || busy) { response.writeHead(403); response.end(); return; }
    busy = true;
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 4096) throw new Error('La clave supera el tamaño permitido.');
      }
      await configure(new URLSearchParams(body).get('key')?.trim() ?? '', recipient);
      response.end(html('<h1>Resend conectado</h1><p>La clave está guardada como secreto y Resend aceptó el correo de prueba. Revisa tu bandeja de entrada y vuelve al chat.</p><p>Ya puedes cerrar esta pestaña.</p>'));
      server.close();
    } catch (error) {
      busy = false;
      response.writeHead(400);
      // No devolver errores remotos ni valores introducidos al navegador.
      response.end(html('<h1>No se pudo completar</h1><p>Comprueba que la clave permite enviar desde b20.mx y vuelve a intentarlo recargando esta página.</p>'));
      process.stderr.write('Configuración pendiente: ' + (error instanceof Error ? error.message : 'error') + '\n');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  process.stdout.write(JSON.stringify({ setupUrl: origin + path }) + '\n');
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Se necesita Node 22 o superior.');
  const recipient = process.argv[2];
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('Indica el correo de administración como primer argumento.');
  if (process.argv[3] === '--web') return secureForm(recipient);
  await configure(await readSecret(), recipient);
}

main().catch((error) => {
  // Los errores del adaptador contienen únicamente códigos sanitizados.
  process.stderr.write((error instanceof Error ? error.message : 'No se pudo completar la configuración.') + '\n');
  process.exitCode = 1;
});
