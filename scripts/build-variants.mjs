import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
for (const brand of ['studio', 'campus']) {
  console.log(`Building B20 ${brand} (demo comparison, no deployment)…`);
  const result = spawnSync(
    'npm',
    [
      'run',
      'build',
      '-w',
      '@b20/web',
      '--',
      '--mode',
      'design-preview',
      '--outDir',
      resolve(root, 'build', brand),
      '--emptyOutDir',
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_BRAND: brand,
        VITE_DATA_MODE: 'demo',
        VITE_API_URL: '',
        VITE_AI_API_URL: '',
        VITE_SPACETIME_URI: 'ws://localhost:3000',
        VITE_SPACETIME_DB: 'app-b20',
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(
  'Both variants are available under build/studio and build/campus. Open design-preview.html through a local static server to compare without signing in.',
);
