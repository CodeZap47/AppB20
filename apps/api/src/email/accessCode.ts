import { emailCode, emailNote, renderEmail } from './layout.ts';

/** Asunto de la plantilla Magic Link de Supabase; se configura en el panel junto al cuerpo. */
export const ACCESS_CODE_SUBJECT = 'Tu código para entrar a B20';

/**
 * Cuerpo de la plantilla Magic Link de Supabase. `{{ .Token }}` y `{{ .Email }}` quedan literales:
 * Supabase los sustituye al enviar. Sirve para el primer acceso y para "Olvidé mi contraseña".
 */
export function buildAccessCodeTemplate(appUrl = 'https://b20.mx'): string {
  return renderEmail({
    title: ACCESS_CODE_SUBJECT,
    preheader: 'Tu código para entrar a B20. Vence en una hora.',
    headline: 'Tu código para',
    highlight: 'entrar.',
    intro: 'Escríbelo en la pantalla de acceso de B20. Si es tu primera vez, después crearás tu contraseña.',
    content: [
      emailCode('{{ .Token }}'),
      emailNote('Vence en una hora y solo funciona una vez.'),
      emailNote('Si no lo pediste, ignora este correo: nadie puede entrar sin este código.'),
    ].join('\n'),
    footer: 'Enviamos este correo a {{ .Email }} porque se pidió un código para entrar a B20.',
    appUrl,
  });
}

/** Contenido de ejemplo para revisar el diseño sin pasar por Supabase. */
export function previewAccessCode(appUrl?: string): string {
  return buildAccessCodeTemplate(appUrl).replace('{{ .Token }}', '482915').replace('{{ .Email }}', 'alumno@cesunbc.edu.mx');
}
