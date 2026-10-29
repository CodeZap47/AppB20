# Comentarios y enlaces del feed

Comentarios compartidos entre el feed y cada recurso, y enlaces con una vista previa externa de título, materia y extracto. El contenido completo conserva el acceso por membresía. Publicado y activado en producción el 26 de octubre de 2026 por solicitud del usuario; no se han enviado mensajes de WhatsApp.

## Conversaciones

Las referencias de interacción son independientes de las reacciones. Los 23 tipos del catálogo se resuelven a 20 recursos canónicos: Museo y avisos de resolución usan la pregunta original; las novedades de fecha usan la tarea. No hay publicaciones sombra.

`feed_thread` lee y modifica los comentarios nativos de publicaciones, notas, trabajos/evidencias, preguntas/respuestas y retos/soluciones. Solo los recursos sin conversación previa utilizan `feed_thread_comment`. `feed_thread_receipt` conserva la idempotencia por integrante, referencia e intento, incluso si después se borra el comentario. Las observaciones de código, revisiones académicas y chats privados conservan sus funciones propias.

Los comentarios plegados del feed no consultan cada hilo en segundo plano. Los abiertos se actualizan con la suscripción, al recuperar el foco y periódicamente mientras la página está visible. Al cambiar de cuenta o perder acceso se descarta la lectura anterior; un error al guardar conserva el borrador.

Los avisos del ranking usan una referencia de periodo, integrante y momento. El servidor y la app comparten reglas de aportes, copias y puntuación; la comprobación de avisos históricos limita la ventana al final efectivo del periodo. Las claves de periodo usan fechas UTC para ser iguales en navegador y servidor.

## Enlaces externos

- `POST /shares`: requiere sesión de un integrante activo; crea un token aleatorio y registra únicamente su hash junto al recurso y creador.
- `GET /shares?kind=…&id=…`: lista los estados y permisos de revocación para el recurso.
- `DELETE /shares/:id`: permite revocar al creador del enlace, autor/coautores del contenido o administración.
- `GET /s/:token`: responde con HTML y Open Graph iniciales, sin necesitar JavaScript ni sesión del visitante. El CTA abre la ruta precisa de B20; Supabase mantiene esa ruta al iniciar sesión.

La proyección se calcula desde los datos actuales del servidor. No confía en títulos, extractos o destinos suministrados por el navegador. El extracto tiene hasta 160 caracteres; una publicación de texto sin título utiliza sus primeros 80 caracteres como título. La descripción de los metadatos antepone la materia cuando existe, conservando el título original. El HTML incluye la imagen B20 ya existente y no obtiene adjuntos, mensajes privados, progreso ni respuestas de exámenes.

Las rutas y campos se validan, el texto se escapa y las respuestas usan `no-store`. Los enlaces retirados o revocados no devuelven metadatos antiguos. Los hooks de retirada, archivo, privacidad y purga los invalidan de forma irreversible: restaurar contenido no reactiva sus enlaces anteriores. WhatsApp u otros receptores pueden conservar vistas previas que ya hayan guardado.

La preparación del mensaje sigue el enlace oficial de [WhatsApp Click to Chat](https://faq.whatsapp.com/5913398998672934); los metadatos se entregan conforme al [protocolo Open Graph](https://ogp.me/).

## Configuración del servicio

La prueba con SpacetimeDB real confirmó que su `on_connect` también protege las llamadas HTTP. Por eso el Worker consulta `feed_share_preview` con una identidad técnica **exclusiva** para esa proyección, sin abrir conexiones anónimas generales ni reutilizar credenciales de archivos, IA o avisos.

Orden de activación aplicado en producción, conservado como referencia operativa:

1. Publicar el módulo de forma aditiva, conservando los datos existentes. Las cuatro tablas nuevas son privadas; se mantienen los endpoints antiguos.
2. Crear una identidad técnica nueva sin membresía ni vínculo de autenticación. Configurar su identidad mediante `configure_feed_share_service(identity, enabled)` con el propietario del módulo. El servidor rechaza identidades de usuarios, del propietario o de otros servicios.
3. Guardar su token como el secreto `SHARE_SERVICE_TOKEN` en el Worker efectivo `b20-api`, cuya configuración es `apps/api/wrangler.ai.jsonc`. No usar una variable pública `VITE_*`. La falta de esta configuración produce un estado de servicio no disponible y evita crear enlaces inutilizables.
4. Publicar Worker y clientes web/extensión. Verificar primero una URL HTTPS de ejemplo; después comprobar su vista previa real en WhatsApp con las vistas previas habilitadas. La app prepara el mensaje; la persona decide destinatario y envío.

La simulación muestra una vista previa local claramente identificada. No fabrica URLs públicas activas ni envía contenidos a WhatsApp.

## Comprobación

Pruebas de recursos, permisos, conversaciones nativas y nuevas, idempotencia, sesiones cambiadas, cierres, privacidad, padres retirados, revocación y restauración. Pruebas del Worker para Open Graph sin JavaScript, caracteres especiales, respuestas defectuosas, rutas manipuladas, límites y fallos de servicio. Integración del feed con notas/tareas y enfoque de evidencia/respuesta. La prueba aislada con servidor real usa claves, puerto y base temporales, sin producción.

Validación local del 26 de octubre de 2026:

- La batería completa de todos los espacios pasó; después también pasaron las regresiones finales de los 23 tipos de tarjeta, retorno exacto tras login, trabajo final→borrador→final y baja→reinvitación del ranking. El servidor terminó con 524 pruebas y el Worker con 265.
- Comprobación de tipos en todos los espacios y `npm run build`: web, extensión y ambos Workers correctos. Wrangler se ejecutó únicamente con `--dry-run`.
- Revisión en navegador a 360, 768 y 1280 px y en vista compacta: sin desbordamiento horizontal. Se comprobó foco al abrir comentarios, ciclo de teclado y restauración del foco en el diálogo.
- Un comentario creado desde una tarjeta de nota apareció en su módulo original y al volver al feed. La simulación y las capturas utilizan contenido ficticio.
- La prueba aislada con SpacetimeDB real comprobó HTTP/SDK, acceso exclusivo de servicio, tablas privadas, concurrencia, revocación, restauración y persistencia después de reiniciar.

## Publicación y comprobación en producción

El 26 de octubre de 2026 se publicó una copia aislada de comentarios y enlaces del feed, sin incorporar otros trabajos locales pendientes. Se conservaron las 180 tablas existentes y todos sus contratos; únicamente se añadieron cuatro tablas privadas, tres procedimientos y el configurador de servicio. Los conteos anteriores y posteriores no detectaron pérdidas: solo aumentó en uno el registro de auditoría durante la comprobación.

- Base: `app-b20-34245` en Maincloud, con `--delete-data=never`. Bundle SHA-256: `72ade68ab02131c2a5b9f92a9bfe41dee4a10d4931d85be66677bbe70320deef`.
- API: `b20-api` en `https://api.b20.mx`, versión `9026e4a8-6482-484a-a7c7-12678ed4c811`. Se añadió exclusivamente `SHARE_SERVICE_TOKEN`; se conservaron las siete credenciales y las variables anteriores. El token temporal se eliminó al terminar la instalación.
- Web: Pages `app-b20`, publicación `a2add0e9` en la rama de producción `main`, comprobada también en `https://b20.mx`. Los archivos publicados coinciden con la compilación validada. No se ha creado commit ni se ha hecho push a GitHub.
- Pruebas del paquete aislado: 1161 de app, 517 de servidor y 28 focalizadas de enlaces del Worker; comprobación de tipos completa y compilaciones web, extensión y Worker correctas.

Desde una sesión activa real se comprobó la lectura del hilo de una nota, sus permisos y el foco del campo de comentario. Se crearon enlaces de esa nota mediante la app: la respuesta pública anónima fue HTML 200 con título original, materia, extracto, URL canónica, imagen B20 y destino exacto, sin JavaScript. La revocación dejó el enlace de prueba en 404 y eliminó sus metadatos. Un segundo enlace quedó activo y abrió la nota correcta.

El botón de WhatsApp abrió su sitio oficial con el título y la URL preparados. No se eligió destinatario ni se envió un mensaje. La comprobación de la tarjeta dentro de un chat de WhatsApp requiere que la persona abra o envíe el enlace allí con sus vistas previas habilitadas; ese último resultado no se da por verificado.

Se observó una desconexión transitoria durante la revisión. «Volver a conectar» recuperó la sesión y permitió leer la nota y su conversación. La revisión acotada de registros no encontró errores nuevos de conexión del módulo. La renovación del token ya remontaba la aplicación antes de esta entrega; ese comportamiento no se modificó.

La evidencia de publicación, comparación de esquema y capturas se conserva en el checkout gestionado `feed-whatsapp-publicacion`, bajo `artifacts/feed-publicacion-2026-10-26/`. Ningún secreto forma parte de esa evidencia.
