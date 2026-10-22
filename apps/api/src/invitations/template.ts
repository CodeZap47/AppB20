export interface InvitationEmailInput { email: string; isCreator: boolean; inviterName: string; appUrl: string }
export interface InvitationEmail { subject: string; text: string; html: string }

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!); }

/** Plain invitation without tokens: access is granted by signing in with the invited, verified address. */
export function buildInvitationEmail({ email, isCreator, inviterName, appUrl }: InvitationEmailInput): InvitationEmail {
  const inviter = inviterName.trim() || 'Un integrante de App B20';
  const role = isCreator ? 'administración' : 'integrante';
  const subject = 'Te invitaron a App B20';
  const text = [
    `${inviter} te invitó a App B20 con el rol de ${role}.`,
    '',
    `Entra aquí: ${appUrl}`,
    '',
    `Inicia sesión con este mismo correo (${email}). SpacetimeAuth verificará que te pertenece y tendrás acceso al entrar.`,
    '',
    'Si no esperabas esta invitación, puedes ignorar este correo.',
  ].join('\n');
  const html = `<!doctype html>
<html lang="es"><body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#1a1a1a">
<p><strong>${escapeHtml(inviter)}</strong> te invitó a App B20 con el rol de <strong>${escapeHtml(role)}</strong>.</p>
<p><a href="${escapeHtml(appUrl)}">Entrar a App B20</a><br><span style="color:#555">${escapeHtml(appUrl)}</span></p>
<p>Inicia sesión con este mismo correo (<strong>${escapeHtml(email)}</strong>). SpacetimeAuth verificará que te pertenece y tendrás acceso al entrar.</p>
<p style="color:#555">Si no esperabas esta invitación, puedes ignorar este correo.</p>
</body></html>`;
  return { subject, text, html };
}
