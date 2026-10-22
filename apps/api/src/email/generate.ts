// Genera la plantilla que se pega en Supabase → Authentication → Emails → Magic Link.
// Uso: npm run email:templates -w @b20/api
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAccessCodeTemplate } from './accessCode.ts';

export const MAGIC_LINK_PATH = fileURLToPath(new URL('../../../../docs/email/supabase-magic-link.html', import.meta.url));

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  writeFileSync(MAGIC_LINK_PATH, buildAccessCodeTemplate());
  console.log(`Plantilla escrita en ${MAGIC_LINK_PATH}`);
}
