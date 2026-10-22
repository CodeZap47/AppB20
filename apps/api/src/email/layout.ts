// Correos con la edición Campus (packages/app/src/design/edition.css). Tablas y estilos en línea:
// los clientes de correo ignoran CSS moderno, SVG y fuentes web en distintos grados.

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!); }

const FONT = "Figtree,'Segoe UI',Helvetica,Arial,sans-serif";
const COLORS = {
  bg: '#f5f7fb', surface: '#ffffff', text: '#182e4d', muted: '#596c83', border: '#dee5ef',
  accent: '#3152a0', deep: '#193657', soft: '#e6edf9', bright: '#9efa68', heroText: '#dbe4f3', heroWord: '#24466e',
};

/** Textos planos salvo `content` y `footer`, que ya llegan como HTML escapado por quien llama. */
export interface EmailLayout {
  title: string;
  preheader: string;
  headline: string;
  highlight: string;
  intro: string;
  content: string;
  footer: string;
  appUrl: string;
}

export function renderEmail({ title, preheader, headline, highlight, intro, content, footer, appUrl }: EmailLayout): string {
  // Solo el origen: la URL de la app puede traer ruta o parámetros.
  const origin = new URL(appUrl).origin;
  const host = escapeHtml(new URL(appUrl).host);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700;800&amp;display=swap" rel="stylesheet">
<style>
  body { margin: 0; padding: 0; background: ${COLORS.bg}; -webkit-text-size-adjust: 100%; }
  a { color: ${COLORS.accent}; }
  @media (max-width: 620px) {
    .b20-shell { width: 100% !important; }
    .b20-hero { padding: 28px 22px 20px !important; }
    .b20-headline { font-size: 32px !important; }
    .b20-star-cell { padding: 22px 18px 0 0 !important; width: 78px !important; }
    .b20-star { width: 60px !important; height: 60px !important; }
    .b20-word { padding: 0 22px 14px !important; font-size: 44px !important; }
    .b20-card { padding: 26px 22px !important; }
    .b20-code { font-size: 30px !important; letter-spacing: 8px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}${'&#8203;&nbsp;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.bg}" style="background:${COLORS.bg};">
<tr><td align="center" style="padding:32px 12px 40px;">
<table role="presentation" class="b20-shell" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
  <tr><td style="padding:0 6px 20px;font-family:${FONT};">
    <span style="font-size:28px;font-weight:800;letter-spacing:-1px;color:${COLORS.accent};">B20</span>
    <span style="font-size:13px;color:${COLORS.muted};padding-left:10px;">Espacio del grupo</span>
  </td></tr>
  <tr><td bgcolor="${COLORS.deep}" style="background:${COLORS.deep};border-radius:24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td class="b20-hero" style="padding:40px 40px 24px;font-family:${FONT};vertical-align:top;">
          <h1 class="b20-headline" style="margin:0 0 16px;font-family:${FONT};font-size:42px;line-height:1.08;font-weight:700;letter-spacing:-1.2px;color:#ffffff;">${escapeHtml(headline)} <span style="color:${COLORS.bright};">${escapeHtml(highlight)}</span></h1>
          <p style="margin:0;font-size:16px;line-height:1.65;color:${COLORS.heroText};">${escapeHtml(intro)}</p>
        </td>
        <td class="b20-star-cell" width="132" align="right" style="padding:30px 28px 0 0;vertical-align:top;width:132px;">
          <img class="b20-star" src="${escapeHtml(origin)}/email/estrella.png" width="104" height="104" alt="" style="display:block;border:0;outline:none;width:104px;height:104px;">
        </td>
      </tr>
      <tr><td class="b20-word" colspan="2" style="padding:0 40px 18px;font-family:${FONT};font-size:56px;font-weight:800;letter-spacing:-2px;line-height:1;color:${COLORS.heroWord};">b20.</td></tr>
    </table>
  </td></tr>
  <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>
  <tr><td class="b20-card" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:16px;padding:34px 40px;font-family:${FONT};font-size:16px;line-height:1.6;color:${COLORS.text};">
${content}
  </td></tr>
  <tr><td align="center" style="padding:26px 12px 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${COLORS.muted};">
    <strong style="color:${COLORS.text};">Un espacio para aprender en grupo.</strong><br>
    ${footer}<br>
    <a href="${escapeHtml(origin)}" style="color:${COLORS.accent};text-decoration:none;font-weight:600;">${host}</a>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

/** Bloques reutilizables. Reciben HTML ya escapado. */
export const emailParagraph = (html: string) =>
  `<p style="margin:0 0 18px;font-family:${FONT};font-size:16px;line-height:1.6;color:${COLORS.text};">${html}</p>`;

export const emailNote = (html: string) =>
  `<p style="margin:0 0 8px;font-family:${FONT};font-size:14px;line-height:1.55;color:${COLORS.muted};">${html}</p>`;

/** Botón con tabla: Outlook no respeta el relleno de un enlace por sí solo. */
export const emailButton = (href: string, label: string) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px;">
  <tr><td bgcolor="${COLORS.accent}" style="background:${COLORS.accent};border-radius:12px;">
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">${escapeHtml(label)}</a>
  </td></tr>
</table>`;

export const emailSteps = (items: string[]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px;">
${items.map((html, index) => `  <tr>
    <td width="44" style="padding:0 0 14px;vertical-align:top;width:44px;">
      <div style="width:32px;height:32px;line-height:32px;border-radius:16px;background:${COLORS.bright};color:${COLORS.deep};font-family:${FONT};font-size:15px;font-weight:800;text-align:center;">${index + 1}</div>
    </td>
    <td style="padding:5px 0 14px;font-family:${FONT};font-size:16px;line-height:1.5;color:${COLORS.text};vertical-align:top;">${html}</td>
  </tr>`).join('\n')}
</table>`;

export const emailCode = (code: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px;">
  <tr><td align="center" bgcolor="${COLORS.soft}" style="background:${COLORS.soft};border-radius:14px;padding:22px 12px;">
    <div style="font-family:${FONT};font-size:13px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.muted};margin-bottom:8px;">Tu código</div>
    <div class="b20-code" style="font-family:${FONT};font-size:36px;font-weight:800;letter-spacing:12px;color:${COLORS.deep};">${escapeHtml(code)}</div>
  </td></tr>
</table>`;
