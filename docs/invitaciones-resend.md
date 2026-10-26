# Correo de invitaciones con Resend

Administración conserva las invitaciones y su cola en SpacetimeDB. El Worker `b20-api`
envía sus correos mediante `POST https://api.resend.com/emails`; los códigos de acceso
de Supabase conservan su configuración independiente.

## Activación del 26 de octubre de 2026

El envío está activo en `b20-api`, versión `882d246c-67b7-4691-b326-e10366745263`.
La persona administradora confirmó que recibió el correo de prueba y la clave quedó
guardada como secreto. La ejecución automática envió la única invitación que seguía
pendiente, con cero errores y cero reintentos. La siguiente ejecución no volvió a enviarla.
Las variables y los secretos anteriores del Worker se conservaron.

## Configuración

- Dominio verificado en Resend: `b20.mx`.
- `INVITATION_EMAIL_FROM`: `B20 <invitaciones@b20.mx>`.
- `RESEND_API_KEY`: secreto administrado del Worker, con permiso de envío para ese dominio.
- `INVITATION_EMAILS_ENABLED`: activar únicamente después de comprobar el correo de prueba.
- `APP_URL`, `NOTIFICATION_SERVICE_TOKEN`, `SPACETIMEDB_URI` y `SPACETIMEDB_MODULE`:
  se reutiliza la configuración existente.

El ayudante `scripts/configurar-resend.mjs` requiere Node 22 y recibe el correo de
administración como primer argumento. Lee la clave sin mostrar caracteres; con `--web`
ofrece un formulario de contraseña local, ligado a `127.0.0.1` y una ruta aleatoria.
Envía un correo con asunto `[Prueba] Invitaciones B20 con Resend` y guarda la clave
mediante la entrada estándar de Wrangler. Nunca guarda la clave en archivos ni la imprime.
El recibo local contiene únicamente el identificador del correo y el resultado de instalación.

## Entrega y reintentos

El cron procesa hasta diez trabajos cada minuto. Solo marca `sent` cuando Resend acepta
el mensaje y devuelve un identificador válido. Ese estado acredita aceptación por el
proveedor; la recepción se comprueba con el correo de prueba.

Cada solicitud conserva una clave de idempotencia SHA-256 derivada de correo y fecha
original. Recuperar un trabajo interrumpido conserva la clave; reenviar manualmente
crea otra. Resend conserva estas claves durante 24 horas. Un conflicto por contenido
modificado falla y requiere un reenvío manual.

Los fallos de red, errores temporales y límites de solicitudes se reintentan. Credenciales,
remitente, validación y cuota agotada dejan el trabajo fallido para intervención. Se conserva
el máximo de cinco intentos y la espera de diez minutos entre reenvíos exitosos. `Retry-After`
se transmite a la cola dentro de sus límites existentes.

Los registros muestran activación, cantidades enviadas/reintentadas/fallidas y códigos
sanitizados. No incluyen destinatarios, cuerpos de respuesta ni credenciales. Para detener
los envíos se desactiva `INVITATION_EMAILS_ENABLED`, conservando la cola.

Referencias: [envío](https://resend.com/docs/api-reference/emails/send-email),
[errores](https://resend.com/docs/api-reference/errors) e
[idempotencia](https://resend.com/docs/dashboard/emails/idempotency-keys).
