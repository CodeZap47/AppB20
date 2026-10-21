# Tercera entrega: IA, notificaciones y papelera

Esta entrega implementa localmente tres recorridos completos sobre SpacetimeDB y Cloudflare:
Gemini con clave personal, avisos con recordatorios y Web Push, y conservación del contenido
retirado durante 30 días. Conserva la colaboración de la [segunda entrega](segunda-entrega.md)
y la implementación de [Salas de estudio](salas-de-estudio.md).

La infraestructura sigue siendo SpacetimeDB y servicios de Cloudflare. Gemini BYOK es el
proveedor de IA elegido expresamente; no se incorporan otras bases de datos, almacenamiento
o proveedores de IA. La ruta R2 heredada permanece por compatibilidad y los archivos nuevos
siguen en SpacetimeDB.

El registro de implementación local no acredita publicación en Maincloud, Cloudflare Pages
ni Workers. La integración posterior conserva el servicio de Guías y su activación anterior;
los resultados de publicación de la tercera entrega se registran al final de este documento.
Las pruebas de implementación usan proveedores simulados y no realizan inferencias ni envíos
push reales.

## Alcance implementado

| Bloque | Recorrido disponible localmente | Documentación específica |
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

## Publicación de la integración: en verificación

La revisión preparada integra la tercera entrega de `main`, las Guías publicadas desde
`ff98cc87` y la navegación incorporada posteriormente en `1989745`. Conserva las rutas de
Guías, sus lotes, borradores y procedencia, junto al historial y publicación expresa de las
guías y explicaciones de la entrega genérica. Los bindings se regeneran desde el módulo
combinado; no se sustituye la configuración de autenticación ni se importan datos demo.

El inventario anterior al despliegue contiene **98 tablas y 291 registros**. Las definiciones
del módulo integrado conservan las 98 tablas anteriores sin cambios y añaden 14. Esto acredita
que el esquema preparado es aditivo; la conservación de filas debe confirmarse comparando los
inventarios inmediatamente anteriores y posteriores a la publicación con `--delete-data=never`.

La IA y el cron de avisos se configuran en el Worker dedicado `app-b20-ai`, sin R2,
mediante `apps/api/wrangler.ai.jsonc`. Se conservan el token técnico y las maestras de IA,
`AI_ENABLED=true` y el modelo `gemini-3.8-flash`. Los avisos añaden una identidad técnica
exclusiva, dos secretos propios y VAPID. La misma clave pública se incluye en Pages; no se
concede permiso del navegador ni se registran dispositivos por cuenta del titular. El Worker
anterior `app-b20-api` conserva las descargas R2 y `appb20` mantiene sus builds desactivados.

No se configura la credencial de mantenimiento de respaldo ni se ejecuta `purge_due` durante
este despliegue. El programador interno conserva el vencimiento normal de 30 días.

| Comprobación de esta publicación | Estado por completar con evidencia |
| --- | --- |
| Commit final y ramas `main` / `codex/pages-spacetimeauth` | Pendiente de registrar la revisión final y confirmar igualdad remota |
| Pruebas, tipos y compilaciones del código integrado | En ejecución; registrar resultados finales y ensayos persistentes |
| Maincloud sin borrado y programa remoto | Pendiente de recibo y coincidencia SHA-256 del bundle |
| Conservación de 98 tablas y 291 registros anteriores | Pendiente de comparación posterior de filas y huellas |
| Worker IA, secretos conservados y servicio de avisos | Pendiente de registro y publicación comprobados |
| Cron de recordatorios y VAPID | Pendiente de observar el cron; recepción push requiere suscripción consentida |
| Pages y dominio estable | Pendiente de despliegue aprobado y coincidencia de los archivos públicos |
| Recorrido con la cuenta real titular | Pendiente de registrar las acciones efectivamente comprobadas |

No se realizará una inferencia Gemini como comprobación de despliegue. La aceptación con
varias cuentas reales, las cuotas del proveedor y la recepción en cada navegador/dispositivo
se conservan como verificaciones independientes. Los permisos entre identidades se comprueban
en bases locales aisladas; no se atribuyen a un recorrido realizado con una sola cuenta.

## Pendientes conservados

- Configurar los servicios, publicar sin borrar datos y validar cuentas reales, cuotas del
  modelo elegido, recepción push y persistencia en producción.
- Generación con Gemini de tarjetas de Repaso, Exámenes, preguntas específicas de Aprende
  enseñando y resumen de novedades. La versión manual de Repaso y sus intervalos existentes
  se conservan; los recordatorios ya están integrados localmente.
- Lenguaje de señales, módulo **3.11**, permanece en la **entrega 5**, con el alcance íntegro
  de la [definición funcional](definicion-del-proyecto.md).
- Push nativo del APK con la app cerrada, firma/distribución y validación real de Android y
  extensión. No se añade otro proveedor automáticamente para cerrar ese pendiente.

La [guía de despliegue](despliegue.md) y los documentos específicos describen la configuración;
un commit o push a GitHub no equivale a activar ni validar los servicios.
