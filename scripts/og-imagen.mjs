// Genera apps/web/public/og/compartir.png (1200×630) desde apps/web/og/compartir.html con Chrome sin interfaz.
// Uso: node scripts/og-imagen.mjs [ruta de Chrome]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.argv[2] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = mkdtempSync(join(tmpdir(), 'b20-og-'));
try {
  const result = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630', '--virtual-time-budget=2000',
    `--screenshot=${join(root, 'apps/web/public/og/compartir.png')}`, pathToFileURL(join(root, 'apps/web/og/compartir.html')).href], { stdio: 'ignore' });
  if (result.status !== 0) throw new Error('Chrome no pudo generar la imagen.');
  console.log('Imagen escrita en apps/web/public/og/compartir.png');
} finally {
  rmSync(profile, { recursive: true, force: true });
}
