# Tercera entrega: IA, notificaciones y papelera

Esta entrega implementa tres recorridos sobre SpacetimeDB y Cloudflare:
Gemini con clave personal, avisos con recordatorios y Web Push, y conservación del contenido
retirado durante 30 días. Conserva la colaboración de la [segunda entrega](segunda-entrega.md)
y la implementación de [Salas de estudio](salas-de-estudio.md).

La infraestructura sigue siendo SpacetimeDB y servicios de Cloudflare. Gemini BYOK es el
proveedor de IA elegido expresamente; no se incorporan otras bases de datos, almacenamiento
o proveedores de IA. La ruta R2 heredada permanece por compatibilidad y los archivos nuevos
siguen en SpacetimeDB.

La tercera entrega integrada quedó publicada y verificada el 21 de octubre de 2026 en
Maincloud, el Worker dedicado de IA y Cloudflare Pages. Se conservó el servicio de Guías y
su activación anterior. El [registro de publicación](#publicación-verificada-del-21-de-octubre-de-2026)
distingue las comprobaciones con la cuenta real de las pruebas aisladas y los pendientes de
generación y recepción push.

## Alcance implementado

| Bloque | Recorrido implementado | Documentación específica |
| --- | --- | --- |
| Gemini BYOK | Consentimiento, clave cifrada por persona, vista previa de fuentes/versiones/omisiones, límites y presupuesto, guía o explicación privada, historial y publicación expresa. | [Gemini con clave personal](gemini-byok.md) |
| Avisos y recordatorios | Bandeja privada, preferencias y zona horaria, lectura, descanso, recordatorios, instalaciones propias, cola persistente, leases, reintentos y Web Push configurable. | [Avisos y recordatorios](avisos-recordatorios.md) |
| Papelera | Retiro, restauración antes de vencer, reloj del servidor, purga programada, limpieza de datos y referencias, conservación de copias independientes y bytes aún utilizados. | [Papelera de 30 días](tercera-entrega-retencion.md) |

La [matriz de requisitos](estado-del-proyecto.md) conserva el detalle por módulo. La
[arquitectura](arquitectura.md) explica la separación entre interfaz, datos y Worker.

## Gemini y fuentes autorizadas

La clave personal se guarda cifrada con AES-GCM en tablas privadas de SpacetimeDB y la clave
maestra queda en Cloudflare Secrets. El navegador no conserva claves en almacenamiento local
ni puede volver a consultar su contenido. Eliminar la clave borra su registro e invalida las
operaciones pendientes; una petición ya enviada al proveedor puede continuar.

El servidor prepara notas, tareas, actividades, trabajos, evidencias y guías actualmente
legibles. Extrae texto UTF8 compatible de adjuntos nativos de hasta 256 KiB por archivo.
PDF, DOCX, imágenes y otros formatos binarios no admitidos producen omisiones visibles;
no se afirma haberlos procesado. Preparar y revisar no llama a Gemini.

Cada envío exige consentimiento y confirmación del material y del posible consumo de cuota
o cargos del proyecto de Google. El presupuesto se expresa en tokens estimados, sin prometer
un precio exacto. Los UUID idempotentes impiden reenviar automáticamente una operación ya
reclamada, incluso cuando su resultado sea incierto.

Las guías y explicaciones quedan privadas, conservan sus fuentes y se recuperan tras reiniciar.
La publicación exige otra acción y crea una nota o guía grupal independiente con citas e
historial. No permite publicar directamente un resultado basado en fuentes personales.
Cambios, retiros o pérdida de acceso invalidan los resultados derivados; purgar el original
elimina también las preparaciones y copias privadas de texto asociadas.

## Avisos sin depender del push

La bandeja funciona dentro de la app sin VAPID ni permiso del navegador. Los mensajes y
menciones generan avisos privados inmediatamente; un cursor conserva el fanout pendiente.
Los recordatorios cubren entregas, actividades, cumpleaños voluntarios, repasos inscritos,
sesiones y votaciones según preferencias y zona horaria.

Cloudflare planifica los recordatorios y entrega Web Push cuando se configuran y habilitan
sus credenciales. Los endpoints y claves de las instalaciones permanecen privados; el cliente
solo recibe sus propios nombres y estados. Antes de enviar se revalidan membresía, permisos,
lectura, silencio, bloqueo y suscripción. Los títulos son genéricos y no copian el texto de
mensajes privados al payload.

La entrega real requiere soporte de Push API, HTTPS, service worker y permiso concedido.
Debe comprobarse en cada navegador y presentación, incluido iPhone con la PWA instalada.
La bandeja está compartida por web, extensión y Android; el push nativo del APK con la app
cerrada sigue pendiente.

## Conservación de 30 días

Notas, preguntas, respuestas, guías, trabajos y evidencias retirados tienen una fecha límite
calculada por el servidor. Antes de vencer se restauran con los permisos y la versión
esperada; una retirada de moderación conserva su motivo y requiere administrador para
revertirla. Administrar el grupo no abre notas personales ajenas.

Al vencer, el programador de SpacetimeDB purga el contenido y sus dependencias. Un mantenimiento
de Cloudflare permite reintentar lotes como respaldo. Se limpian versiones, textos derivados,
referencias y adjuntos sin uso. Las publicaciones independientes conservan sus propios datos;
los bytes compartidos se liberan al desaparecer la última referencia. La purga conserva una
auditoría técnica sin texto ni identidad y evita que clonar un aporte eliminado vuelva a
sumar puntos.

## Comprobación local

Con Node 22 o superior y Spacetime CLI 2.12 disponibles, los siguientes comandos crean bases
reales aisladas, identidades sintéticas y carpetas temporales. No usan Maincloud:

```bash
node scripts/smoke-spacetime-ai.mjs
node scripts/smoke-spacetime-notifications.mjs
node scripts/smoke-spacetime-retention.mjs
```

Los tres recorridos pasaron. IA comprobó un adjunto UTF8 real, explicación privada, guía con
ocho secciones y fuentes, publicación única, persistencia, retiro y eliminación de clave.
Usó dos respuestas simuladas y ninguna llamada real a Gemini. Notificaciones comprobó
vistas propias, dispositivos, leases, lectura/bloqueo, cursores, reinicio y revocación, sin
enviar Web Push real. Retención aceleró el plazo únicamente en una copia temporal del
módulo para comprobar el programador; el código de producción mantiene los 30 días y las
pruebas con reloj controlado verifican la frontera exacta.

La verificación global del 21 de octubre de 2026 terminó correctamente:

- `npm test`: **999 pruebas aprobadas** (app 504, core 94, módulo 246, API 104 y web 51).
- `npm run typecheck`: todos los paquetes; bindings regenerados con CLI/SDK 2.12.0.
- `npm run build`: web/PWA, extensión y Worker mediante `wrangler deploy --dry-run`.
- `npm run build:pages`: correcto usando la configuración pública de `.env.pages.example`.
- Los recorridos reales de archivos, segunda entrega y Salas volvieron a pasar. Archivos
  confirmó 50 MiB con SHA-256, reanudación, persistencia y revocación.
- El recorrido real de retención volvió a pasar tras cerrar la limpieza de dependencias.
- `git diff --check`: sin errores.

Estas comprobaciones usan Node 24.15.0 y bases locales aisladas; no sustituyen la aceptación
con cuentas, claves del proveedor y dispositivos reales.

Al integrar los cambios posteriores de `main` (`cda8030`) se conservaron Exposiciones y los
registros de Tareas/Salas. La suite conjunta pasó con **1,098 pruebas** (app 562, core 110,
módulo 271, API 104 y web 51), con bindings regenerados y el recorrido real aislado de
Exposiciones aprobado. El total de 999 anterior corresponde a la entrega previa a esa integración.
Los tipos globales y las compilaciones de web/PWA, extensión y Worker (`--dry-run`) también
pasaron con el código integrado.

## Publicación verificada del 21 de octubre de 2026

La revisión operativa [`e75edfbe`](https://github.com/CodeZap47/AppB20/commit/e75edfbe0b6ecc54d28ba614d37eee9502317082)
integra la tercera entrega de `main`, las Guías publicadas desde `ff98cc87` y la navegación
incorporada posteriormente en `1989745`. `main` y `codex/pages-spacetimeauth` estaban
sincronizadas en esa revisión al verificar la publicación. El cierre documental posterior
no cambia el programa ni los archivos de ejecución comprobados.

Se conservaron las rutas de Guías, sus lotes, borradores y procedencia, junto al historial y
publicación expresa de las guías y explicaciones de la entrega genérica. Los bindings se
regeneraron desde el módulo combinado. La autenticación y los datos anteriores se conservaron;
no se importaron los ejemplos demo.

Maincloud se actualizó con `--delete-data=never`. La comparación inmediatamente anterior y
posterior confirmó que **las 98 tablas previas y sus 291 registros conservaron sus huellas
SHA-256 sin cambios**. Se añadieron 14 tablas, para un total de 112. El programa remoto coincide
exactamente con el bundle validado, SHA-256
`116cc34c3a9f646e0cf58ab8f3ea2e700c11396e6a204d2166c9fdbb110ce8b1`.
Las comprobaciones posteriores de la cuenta añadieron sus propios registros de prueba; no
sustituyeron ni eliminaron las filas conservadas en esta comparación.

La IA y el cron de avisos se publicaron en el Worker dedicado `app-b20-ai`, sin R2,
mediante `apps/api/wrangler.ai.jsonc`. Se conservaron el token técnico y las maestras de IA,
`AI_ENABLED=true` y el modelo `gemini-3.8-flash`. Se registró una identidad técnica exclusiva
de avisos y se añadieron sus dos secretos; la clave VAPID pública coincide con la de Pages.
La versión activa del Worker es `a9d81832-b113-419f-b9c7-75bf0e502cdd`, con tráfico al 100 %.

Se observó un **cron real a las 19:41 UTC**, con `notifications ok:true`, resultado correcto
y cero excepciones. El respaldo de retención devolvió desactivado al no tener credencial de
mantenimiento. No se configuró `MAINTENANCE_SERVICE_TOKEN`, no se llamó a `purge_due` y no se
adelantó el vencimiento normal de 30 días del programador interno de SpacetimeDB. El Worker
anterior `app-b20-api` conserva las descargas R2 y `appb20` mantiene sus builds desactivados.

Cloudflare Pages aprobó el despliegue `4440d39a-fb92-4e0f-86fb-0f38a8d71215` en el dominio
estable. Sus **16 archivos públicos de ejecución** coinciden con los compilados y ocho rutas
respondieron HTTP 200. La configuración sigue apuntando a Maincloud y al Worker dedicado.

| Comprobación de esta publicación | Resultado |
| --- | --- |
| Pruebas del código integrado | **1 225 aprobadas**: app 627, core 125, módulo 298, API 124 y web 51 |
| Tipos y compilaciones | Aprobados: web/PWA, extensión, API heredada, Worker dedicado y Pages |
| Ensayos con servidor persistente aislado | IA, Guías, avisos y retención aprobados; cero llamadas reales a Gemini o Web Push |
| Maincloud y conservación | Programa idéntico al bundle; 98 tablas/291 registros anteriores intactos; 112 tablas después de la actualización |
| Worker y autenticación | Versión activa comprobada; cuatro secretos presentes sin revelar sus valores; salud, CORS y rechazo sin sesión aprobados |
| Recordatorios | Cron real observado y servicio de avisos operativo |
| Pages | Despliegue aprobado; 16 huellas coincidentes y ocho rutas HTTP 200 |
| Escritorio y móvil | Vistas de 1 440 px y 390 px sin desbordamiento; menú móvil aprobado |

La primera ejecución de la suite de la app se repitió con dos workers por contención de
recursos, sin cambiar los tiempos límite de las pruebas. Esa ejecución completa aprobó
los 627 casos de la app.

Con la **única cuenta real autorizada** se guardaron las preferencias de avisos con zona
`America/Tijuana`, se comprobaron al recargar y se marcó un aviso como leído. Se creó una
nota ficticia personal (ID 3), se retiró y restauró con el mismo ID, versión 3 e historial;
quedó activa en la cuenta. Su vista previa de IA se preparó de forma privada sin llamar a
Gemini. Guías excluyó correctamente esa nota personal; al no haber fuentes compartidas
seleccionables no se creó otro borrador.

La clave personal de Gemini sigue sin configurar en esa cuenta, por lo que no se probó
una generación real ni el consumo del proveedor. Hay cero instalaciones push; no se pidió
permiso al navegador, no se registró ningún dispositivo y no se comprobó recepción real.
Los permisos entre remitente, destinatario, tercero y otros roles se comprobaron con
identidades sintéticas en bases aisladas, no con varias personas en producción.

Los recibos, comparaciones de datos y programa, huellas de Pages y capturas de los recorridos
quedan en `artifacts/third-release/`, como evidencia local excluida de Git. Este apartado es
el registro común al que remiten las guías de despliegue, Pages y Worker heredado.

## Pendientes conservados

- Validar una generación con la clave personal y confirmación de su titular, las cuotas
  reales del modelo y la recepción push en dispositivos que hayan concedido permiso.
- Aceptación con varias cuentas reales del grupo y validación propia de cada navegador,
  extensión y dispositivo. La comprobación con una cuenta no sustituye esos recorridos.
- Activar y validar la ampliación de la [cuarta entrega](cuarta-entrega.md) para tarjetas de
  Repaso y preguntas específicas de Aprende enseñando. El resumen de novedades sigue
  pendiente de implementar. La versión manual de Repaso y sus intervalos se conservan; los
  recordatorios están publicados. Exámenes mantiene su registro de alcance independiente
  en [examenes-ia.md](examenes-ia.md).
- Lenguaje de señales, módulo **3.11**, permanece en la **entrega 5**, con el alcance íntegro
  de la [definición funcional](definicion-del-proyecto.md).
- Push nativo del APK con la app cerrada, firma/distribución y validación real de Android y
  extensión. No se añade otro proveedor automáticamente para cerrar ese pendiente.

La [guía de despliegue](despliegue.md) y los documentos específicos describen la configuración;
un commit o push a GitHub no equivale a activar ni validar los servicios.
