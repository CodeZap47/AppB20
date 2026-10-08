# Arquitectura

Resumen técnico de la base inicial. La fuente de verdad del alcance es
`../../docs/app-b20-definicion-del-proyecto.md` (secciones 5, 6 y 9).

## Piezas

| Pieza | Tecnología | Rol |
| --- | --- | --- |
| Interfaz | React 19 + TypeScript + Vite, `react-router` con rutas hash | Una sola app para todas las presentaciones. |
| Datos en tiempo real | SpacetimeDB, SDK `spacetimedb` (cliente y módulo en TypeScript) | Membresía, perfiles, trabajos, mensajes, cumpleaños. |
| Autenticación | Google OIDC + lista autorizada (`invitation`) | El módulo valida emisor y correo verificado; el backend valida firma, emisor y audiencia. |
| Backend | Node + Hono + `@google/genai` + `jose` | Gemini BYOK; después URLs firmadas de Cloud Storage y envío de push. |
| Secretos | `EncryptedMemoryStore` (desarrollo) → Google Cloud Secret Manager | Claves BYOK por usuario, nunca devueltas al cliente. |
| Web/PWA | `vite-plugin-pwa` con service worker propio (`apps/web/src/sw.ts`) | Instalación en iPhone y Web Push. |
| Extensión | Manifest V3, `sidePanel`, todo empaquetado | Panel lateral y vista completa (`app.html`). |
| Android | Capacitor 8 + `@capacitor/push-notifications` (FCM) | APK firmado con avisos nativos. |

## Modelo de datos inicial (`packages/spacetime-module`)

Tablas privadas: `app_config`, `invitation`, `member`, `subject`, `term`, `work`,
`work_author`, `group_message`, `direct_conversation`, `direct_message`, `birthday`,
`change_log`.

Vistas públicas con filtro por quien consulta: `my_member`, `members`, `subjects`, `terms`,
`works`, `work_authors`, `group_messages`, `birthdays`, `change_history`,
`my_direct_conversations`, `my_direct_messages`.

Faltan para el MVP: actividades, notas, preguntas y respuestas, guías con fuentes, adjuntos,
instalaciones/suscripciones push y preferencias de avisos.

## Pendientes de la Etapa 0

- Instalar la CLI de SpacetimeDB, publicar el módulo y generar bindings; conectar
  `packages/app/src/lib/spacetime.tsx` con `SpacetimeDBProvider`. El módulo solo se ha
  revisado con `tsc`; falta publicarlo en un servidor real.
- Elegir flujo de inicio de sesión con Google por presentación (web, páginas de extensión,
  WebView de Capacitor) y validar la audiencia en el módulo.
- Confirmar edad del grupo y acceso a Google AI Studio antes de habilitar Gemini; definir el
  modelo vigente en `GEMINI_MODEL`, límites de solicitudes y presupuesto.
- Iconos PNG de la PWA (192, 512 y apple-touch-icon 180) y de la extensión.
- Claves VAPID, suscripciones Web Push y prueba en un iPhone real con la PWA instalada.
- Proyecto de Firebase para FCM, `google-services.json` (no se versiona) y APK firmado de prueba.
- Bandeja de avisos de la extensión.
- Confirmar el `appId` de Android antes de firmar el primer APK.
