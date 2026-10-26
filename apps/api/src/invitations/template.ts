import { emailButton, emailNote, emailParagraph, emailSteps, escapeHtml, renderEmail } from '../email/layout.ts';

export { escapeHtml };
export interface InvitationEmailInput { email: string; isCreator: boolean; inviterName: string; appUrl: string }
export interface InvitationEmail { subject: string; text: string; html: string }

/** Sin tokens: la invitación activa la cuenta y el primer acceso pide un código enviado a ese correo. */
export function buildInvitationEmail({ email, isCreator, inviterName, appUrl }: InvitationEmailInput): InvitationEmail {
  const inviter = inviterName.trim() || 'Un integrante de B20';
  const role = isCreator ? 'administración' : 'integrante';
  const subject = 'Te invitaron a B20';
  const text = [
    `${inviter} te invitó a B20 con el rol de ${role}.`,
    '',
    `1. Entra a ${appUrl} con este correo (${email}).`,
    '2. Escribe el código que te llegará por correo.',
    '3. Crea tu contraseña y listo.',
    '',
    'Si no esperabas esta invitación, puedes ignorar este correo.',
  ].join('\n');
  const html = renderEmail({
    title: subject,
    preheader: `${inviter} te invitó a B20. Entra con tu correo y crea tu contraseña.`,
    headline: 'Buenas ideas. Mejor',
    highlight: 'en grupo.',
    intro: 'Tus apuntes, tus entregas y tu gente, en un mismo espacio.',
    content: [
      emailParagraph(`<strong>${escapeHtml(inviter)}</strong> te invitó a B20 como <strong>${escapeHtml(role)}</strong>.`),
      emailSteps([
        `Entra a B20 con <strong>${escapeHtml(email)}</strong>.`,
        'Escribe el código que te llegará por correo.',
        'Crea tu contraseña y listo.',
      ]),
      emailButton(appUrl, 'Entrar a B20'),
      emailNote('Si no esperabas esta invitación, puedes ignorar este correo.'),
    ].join('\n'),
    footer: `Recibiste esta invitación en ${escapeHtml(email)}.`,
    appUrl,
  });
  return { subject, text, html };
}
