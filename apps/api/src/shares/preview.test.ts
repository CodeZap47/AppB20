import { describe, expect, it } from 'vitest';
import type { FeedSharePreview } from '@b20/core';
import { shareHtml } from './preview.ts';

const preview: FeedSharePreview = {
  title: 'Tablas de verdad',
  subject: 'Lógica',
  description: 'Un extracto de la publicación.',
  kindLabel: 'Nota de clase',
  path: '/m/notas/1',
};
const htmlFor = (value: FeedSharePreview) =>
  shareHtml({
    preview: value,
    app: new URL('https://b20.mx'),
    canonical: `https://api.b20.mx/s/${'A'.repeat(43)}`,
  });

describe('contexto académico en la vista previa externa', () => {
  it('incluye materia y extracto en OG, Twitter y buscadores manteniendo el título original', () => {
    const value = { ...preview, description: 'a'.repeat(160) };
    const html = htmlFor(value);
    for (const attribute of [
      'property="og:description"',
      'name="twitter:description"',
      'name="description"',
    ]) {
      expect(html).toContain(`<meta ${attribute} content="Lógica · ${value.description}">`);
    }
    expect(html).toContain('<meta property="og:title" content="Tablas de verdad">');
    expect(html).toContain('<meta name="twitter:title" content="Tablas de verdad">');
    expect(html).toContain(`<p class="description">${value.description}</p>`);
    expect(value.description).toHaveLength(160);
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta property="og:image:height" content="630">');
  });
  it('escapa contexto y extracto en cada atributo sin convertirlos en HTML', () => {
    const html = htmlFor({
      ...preview,
      subject: 'Lógica "A" & <B>',
      description: "Texto 'final' </meta><script>alert(1)</script>",
    });
    for (const attribute of [
      'property="og:description"',
      'name="twitter:description"',
      'name="description"',
    ]) {
      expect(html).toContain(
        `<meta ${attribute} content="Lógica &quot;A&quot; &amp; &lt;B&gt; · Texto &#39;final&#39; &lt;/meta&gt;&lt;script&gt;alert(1)&lt;/script&gt;">`,
      );
    }
    expect(html).not.toContain('<script>');
  });
  it('conserva solo el extracto cuando no hay materia', () => {
    const html = htmlFor({ ...preview, subject: undefined });
    expect(html).toContain(
      '<meta property="og:description" content="Un extracto de la publicación.">',
    );
    expect(html).not.toContain('content=" ·');
  });
});
