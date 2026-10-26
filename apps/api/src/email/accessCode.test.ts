import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCESS_CODE_SUBJECT, buildAccessCodeTemplate, previewAccessCode } from './accessCode.ts';
import { MAGIC_LINK_PATH } from './generate.ts';

describe('plantilla del código de acceso para Supabase', () => {
  it('deja los marcadores de Supabase literales y una sola vez el código', () => {
    const html = buildAccessCodeTemplate();
    expect(html.split('{{ .Token }}')).toHaveLength(2);
    expect(html).toContain('{{ .Email }}');
    expect(html).toContain(`<title>${ACCESS_CODE_SUBJECT}</title>`);
    expect(html).not.toContain('{{ .ConfirmationURL }}');
    expect(new TextEncoder().encode(html).length).toBeLessThan(100_000);
  });

  it('el archivo para pegar en Supabase está al día con la plantilla', () => {
    expect(readFileSync(MAGIC_LINK_PATH, 'utf8')).toBe(buildAccessCodeTemplate());
  });

  it('la vista previa sustituye los marcadores por datos de ejemplo', () => {
    const html = previewAccessCode();
    expect(html).not.toContain('{{');
    expect(html).toContain('482915');
  });
});
