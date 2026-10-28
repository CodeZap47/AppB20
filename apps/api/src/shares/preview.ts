import type { FeedSharePreview } from '@b20/core';

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
const style = `:root{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#183354;background:#f3f6fb}*{box-sizing:border-box}body{margin:0;padding:32px 20px;min-height:100vh;display:grid;place-items:center}main{width:min(100%,640px);padding:clamp(24px,5vw,44px);border:1px solid #dce5f1;border-radius:22px;background:white;overflow-wrap:anywhere}.brand{font-size:20px;font-weight:800;color:#3157a7;margin:0 0 32px}.context{font-size:13px;font-weight:600;color:#47628a}h1{font-size:clamp(26px,6vw,36px);line-height:1.2;letter-spacing:-.035em;margin:14px 0 20px}.description{font-size:16px;line-height:1.75;white-space:pre-wrap}.notice{margin:28px 0 24px;padding:15px 18px;background:#f3f6fb;border-radius:12px;font-size:13px;line-height:1.65;color:#506580}a{display:inline-block;padding:13px 20px;border-radius:11px;background:#3157a7;color:#fff;text-decoration:none;font-weight:600;font-size:14px}a:focus-visible{outline:3px solid #3157a7;outline-offset:4px}`;
export function shareHtml(input: {
  preview?: FeedSharePreview;
  canonical?: string;
  app?: URL;
  unavailable?: boolean;
}): string {
  const { preview, canonical, app } = input;
  const title = preview
    ? `${preview.title} · B20`
    : input.unavailable
      ? 'Enlace no disponible · B20'
      : 'No pudimos abrir este enlace · B20';
  const destination = app && new URL(app);
  if (destination && preview) destination.hash = preview.path;
  const description = preview
    ? [preview.subject, preview.description].filter(Boolean).join(' · ')
    : '';
  const metadata =
    preview && app && canonical
      ? `
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="B20">
    <meta property="og:title" content="${escape(preview.title)}">
    <meta property="og:description" content="${escape(description)}">
    <meta property="og:url" content="${escape(canonical)}">
    <meta property="og:image" content="${escape(new URL('/og/compartir.png', app).href)}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="B20 · Aprende y comparte con tu grupo">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escape(preview.title)}">
    <meta name="twitter:description" content="${escape(description)}">
    <meta name="description" content="${escape(description)}">`
      : '';
  return `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><title>${escape(title)}</title>${metadata}<style>${style}</style></head><body><main><p class="brand">B20</p>${preview ? `<p class="context">${escape(preview.kindLabel)}${preview.subject ? ` · ${escape(preview.subject)}` : ''}</p><h1>${escape(preview.title)}</h1><p class="description">${escape(preview.description)}</p><p class="notice">Esta es una vista previa compartida públicamente. Para leer el contenido completo o comentar, necesitas iniciar sesión y tener acceso vigente al grupo.</p>` : `<h1>${input.unavailable ? 'Este enlace ya no está disponible' : 'No pudimos consultar este enlace'}</h1><p class="description">${input.unavailable ? 'Puede que se haya retirado el enlace o que la publicación ya no se pueda compartir.' : 'Inténtalo de nuevo en unos momentos.'}</p>`}${destination ? `<a href="${escape(destination.href)}" rel="noreferrer">${preview ? 'Abrir publicación en B20' : 'Ir a B20'}</a>` : ''}</main></body></html>`;
}
