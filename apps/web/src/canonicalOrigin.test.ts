import { describe, expect, it } from 'vitest';
import { canonicalPagesUrl, parsePagesOrigin, parseWebOrigin } from './canonicalOrigin';

const canonical = 'https://app-b20.pages.dev';
const alias = 'https://af0dd1ec.app-b20.pages.dev';

describe('origen estable de Pages', () => {
  it('lleva los aliases de compilación y de rama al mismo origen de acceso', () => {
    for (const origin of [alias, 'https://codex-pages-spacetimeauth.app-b20.pages.dev']) {
      expect(canonicalPagesUrl(`${origin}/`, canonical)).toBe(`${canonical}/`);
    }
  });
  it('conserva la pantalla, la demo y sus filtros', () => {
    expect(canonicalPagesUrl(`${alias}/?demo&view=mine#/m/tareas/27`, canonical))
      .toBe(`${canonical}/?demo&view=mine#/m/tareas/27`);
  });
  it('conserva rutas sin permitir que cambien el host de destino', () => {
    expect(canonicalPagesUrl(`${alias}//otro.example/pagina?q=uno`, canonical))
      .toBe(`${canonical}//otro.example/pagina?q=uno`);
  });
  it('no genera un bucle en el dominio estable', () => {
    expect(canonicalPagesUrl(`${canonical}/auth/callback?code=abc&state=xyz`, canonical)).toBeUndefined();
  });
  it.each([
    'http://localhost:5173/', 'http://127.0.0.1:5173/', 'https://localhost/',
    'capacitor://localhost/', 'chrome-extension://abc/index.html',
    'https://b20.example/', 'https://app-b20.example.com/',
    'https://other.pages.dev/', 'https://preview.other.pages.dev/',
    'https://app-b20.pages.dev.attacker.example/', 'https://preview.app-b20.pages.dev.attacker.example/',
    'https://two.levels.app-b20.pages.dev/', 'http://preview.app-b20.pages.dev/',
    'https://preview.app-b20.pages.dev:8443/', 'https://user:secret@preview.app-b20.pages.dev/',
  ])('no cambia plataformas, dominios ajenos ni URLs parecidas: %s', (href) => {
    expect(canonicalPagesUrl(href, canonical)).toBeUndefined();
  });
  it.each([
    undefined, '', 'no-es-url', '//app-b20.pages.dev', 'http://app-b20.pages.dev',
    'https://app-b20.pages.dev/path', 'https://app-b20.pages.dev?return=https://other.example',
    'https://app-b20.pages.dev#fragment', 'https://user:secret@app-b20.pages.dev',
    'https://app-b20.pages.dev:8443', 'https://preview.app-b20.pages.dev', 'https://app-b20.example',
  ])('descarta una configuración que no sea un origen estable exacto: %s', (value) => {
    expect(parsePagesOrigin(value)).toBeUndefined();
    expect(canonicalPagesUrl(`${alias}/`, value)).toBeUndefined();
  });
  it.each([
    '/auth/callback?code=secret&state=private', '/auth/logout?state=private', '/auth/callback',
    '/AUTH%2fCALLBACK?next=private', '/?code=secret&state=private#/m/notas',
    '/?state=private', '/?session_state=private', '/?error=denied&error_description=private',
    '/#access_token=secret&state=private', '/#id_token=secret', '/#refresh_token=secret',
    '/#/m/notas?code=secret&state=private', '/#%61ccess_token=secret', '/?CODE=secret',
  ])('reinicia en el origen estable sin transferir la respuesta OAuth: %s', (path) => {
    expect(canonicalPagesUrl(`${alias}${path}`, canonical)).toBe(`${canonical}/?auth_restart=1`);
  });
});

describe('dominio propio sobre Pages', () => {
  const custom = 'https://b20.mx';
  const pages = 'https://app-b20.pages.dev';
  it('lleva el subdominio de Pages y sus aliases al dominio propio', () => {
    for (const origin of [pages, alias]) {
      expect(canonicalPagesUrl(`${origin}/?demo#/m/tareas/27`, custom, pages)).toBe(`${custom}/?demo#/m/tareas/27`);
    }
  });
  it('reinicia el acceso sin transferir la respuesta OAuth', () => {
    expect(canonicalPagesUrl(`${pages}/auth/callback?code=secret`, custom, pages)).toBe(`${custom}/?auth_restart=1`);
  });
  it.each([
    `${custom}/auth/callback?code=abc`, 'https://www.b20.mx/', 'https://other.pages.dev/',
    'https://two.levels.app-b20.pages.dev/', 'http://app-b20.pages.dev/', 'http://localhost:5173/',
  ])('no redirige el dominio propio ni hosts ajenos: %s', (href) => {
    expect(canonicalPagesUrl(href, custom, pages)).toBeUndefined();
  });
  it.each(['https://b20.mx/ruta', 'http://b20.mx', 'https://localhost', 'https://b20.mx:8443'])(
    'descarta un dominio propio que no sea un origen exacto: %s', (value) => {
      expect(parseWebOrigin(value)).toBeUndefined();
      expect(canonicalPagesUrl(`${pages}/`, value, pages)).toBeUndefined();
    });
  it('exige un origen de Pages válido junto al dominio propio', () => {
    expect(canonicalPagesUrl(`${pages}/`, custom, '')).toBeUndefined();
    expect(canonicalPagesUrl(`${pages}/`, custom, 'https://b20.mx')).toBeUndefined();
  });
});
