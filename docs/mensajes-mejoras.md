# Mensajes: integración y herramientas

Recibo de implementación del 26 de octubre de 2026. La interfaz compartida conserva los datos y permisos de SpacetimeDB; las capturas de diseño usan exclusivamente ejemplos ficticios.

## Cambios y evidencia

| Anotación | Comportamiento implementado | Captura |
| --- | --- | --- |
| 1. Integración | Mensajes llena el área junto a la navegación, sin margen exterior ni marco adicional. Lista, historial y herramientas mantienen desplazamiento interno. | [Chat integrado](evidencia/mensajes/01-chat-integrado.png) |
| 2. Nueva conversación | Menú con directo/canal, selector de compañeros con búsqueda, reutilización de directos y formulario de canal con estados de espera y error. | [Nueva conversación](evidencia/mensajes/02-nueva-conversacion.png) |
| 3. Stickers | Selección o arrastre, miniaturas revisables, nombre, formatos/límites, importación real y reintento del mismo paquete. | [Importador](evidencia/mensajes/03-stickers.png) |
| 4. Ayuda | Secciones desplegables por plataforma, pasos numerados, ruta de Android copiable y alternativa manual. | [Guía](evidencia/mensajes/04-guia.png) |
| 5. Recursos | Los comandos de tarea, trabajo, actividad, nota y pregunta permiten citar o crear mediante los formularios existentes dentro del chat. Guardar añade la referencia al borrador, sin enviar el mensaje. | [Crear desde el chat](evidencia/mensajes/05-crear-recurso.png) |
| 6. Comandos propios | Plantillas o acciones de creación, personales o compartidas, con nombre normalizado, validación y prueba en el chat. Solo el autor edita; un administrador puede despublicar uno compartido conservando la copia del autor. | [Comandos](evidencia/mensajes/06-comandos.png) |
| 7. Reacciones | Accesos rápidos y selector de catálogo Unicode local, búsqueda en español, categorías, recientes, tonos y entrada desde el teclado. La misma validación se aplica en servidor y demo. | [Reacciones](evidencia/mensajes/07-reacciones.png) |
| 8. Escritura en vivo | Texto provisional en tarjetas de hasta tres personas y control para mostrar las demás; cada borrador largo puede ampliarse. Aviso visible y desactivación persistente de la cuenta. | [Escritura simultánea](evidencia/mensajes/08-escritura.png) |

[Vista móvil](evidencia/mensajes/09-movil.png). Los colores de mensajería y sus diálogos siguen el tema de la aplicación, evitando la mezcla anterior de paneles claros y etiquetas claras.

## Valores predeterminados y conservación

- La escritura en vivo comienza activada. Desactivarla borra el texto provisional de las conexiones del usuario; permanece el indicador convencional de escritura y se puede seguir viendo a los demás.
- Primera actualización inmediata; siguientes como máximo cada 200 ms. Inactividad: 3,5 s; caducidad: 7 s. Enviar, vaciar, salir, perder foco o desconectar retira el borrador. Suscripción limitada a la conversación abierta, separada del snapshot general.
- Los borradores solo llegan a miembros con permiso sobre la conversación, respetan bloqueos y no producen mensajes, avisos ni entradas del historial. Un administrador ajeno a un directo no recibe su texto.
- Comandos anteriores sin metadatos: plantillas personales, con sus IDs conservados. Los nombres compartidos son únicos en el salón; los personales, por autor. Si coinciden, el menú distingue alcance y autor y muestra primero el personal.
- Una reacción por persona y mensaje. Elegir otra la sustituye; repetirla la retira. Catálogo empaquetado Unicode 18.0 / CLDR 49, sin descarga de datos emoji en tiempo de uso.
- Stickers nuevos privados, máximo 30 por paquete y 1 MiB por imagen. Se mantienen WebP, PNG, GIF, JPEG, `.wastickers` y `.zip`. Retirar un paquete conserva los stickers usados en mensajes anteriores.
- Crear un recurso conserva el borrador. `/trabajo` pide una tarea; la visibilidad de las notas se muestra explícitamente y solo se añade una referencia compartible. Publicar un recurso y enviar su mensaje son acciones separadas.

## Contratos nuevos

| Elemento | Función |
| --- | --- |
| `chat_command_detail` | Metadatos aditivos por ID: alcance compartido, acción `text/create`, tipo de recurso, versión y fecha. |
| `available_chat_commands`, `chat_command_details` | Vistas autorizadas de comandos propios y compartidos. Se conservan los contratos anteriores. |
| `save_chat_command_v2` | Guardado de nombre, descripción, texto, alcance, acción y recurso; edición con versión esperada. `remove_chat_command` elimina el propio o despublica uno ajeno compartido cuando llama un administrador. |
| `chat_live_draft`, `chat_live_preference`, `chat_live_draft_expiry` | Tablas privadas de texto temporal por conexión, preferencia de cuenta y siguiente vencimiento programado. |
| `set_live_draft`, `set_live_draft_sharing` | Actualización con revisión creciente y cambio de preferencia para todas las conexiones del usuario. |
| `live_drafts`, `my_live_draft_preference` | Texto filtrado por permisos y preferencia propia. `live_drafts` queda fuera de las suscripciones generales. |
| `expire_live_drafts` y desconexión | Limpieza del texto vencido y de las filas que pertenecen a la conexión cerrada. Se conserva el contrato booleano de presencia sin texto. |

## Validación

- Revisión de interfaz: **31 pruebas focalizadas aprobadas**, incluyendo menús con teclado/Escape, devolución del foco, reintentos sin doble envío, importación, miniaturas con nombres duplicados, compartir paquetes y copia de ruta con alternativa manual.
- Comprobación de tipos de todos los paquetes: **aprobada**.
- Pruebas generales: **2.344 aprobadas** (interfaz 1.242, dominio 242, servidor 531, API 265 y web 64).
- Compilaciones de web/PWA, extensión y servicios API/IA, además de la compilación de Pages con la configuración de producción: **aprobadas**.
- `node scripts/smoke-spacetime-live-drafts.mjs`: **aprobada** con tres integrantes simultáneos e intruso, aislamiento de directos incluso ante administradores, suscripción por conversación, actualizaciones de texto, bloqueo, revisiones, desconexión, caducidad, preferencia entre pestañas y persistencia tras reiniciar. Incluye comandos anteriores y compartidos, acciones de creación y retirada administrativa. Latencia local medida: **7 ms**; no representa una medición de red de producción.
- Ensayo de migración desde el módulo publicado, con datos sintéticos: **aprobado**. Las 184 tablas anteriores, los 203 reducers, las 63 procedures y las 122 vistas conservan sus contratos. Las 31 filas sintéticas en 23 tablas se conservaron al actualizar con `--delete-data=never` y reiniciar. Los comandos nuevos, la preferencia y una reacción también persistieron tras otro reinicio.
- Auditoría previa de producción: **184 tablas y 513 registros**, guardando únicamente huellas y esquema en el directorio privado ignorado `artifacts/mensajes-2026-10-26/`. Se conserva una copia del programa remoto para recuperación.
- Publicación conjunta de Mensajes y Lenguaje de señales, autorizada expresamente: **completada** en [b20.mx](https://b20.mx/#/m/mensajes), primero servidor y después cliente.

Las capturas de escritura simultánea usan `design-preview.html?messages-review=1`: cuatro sesiones ficticias sobre el mismo estado de demo, con limpieza al cerrar la página. Esa entrada queda fuera de las compilaciones normales de producción. La prueba con servidor aislado aporta la evidencia funcional entre conexiones reales, independiente de las capturas.

La inspección local no acredita instrucciones de extracción probadas en dispositivos físicos ni latencia inferior a 500 ms en redes reales. Android/iPhone, teclado móvil real y medición de latencia conservan su validación correspondiente cuando no exista un recibo de prueba específico.

## Orden de publicación

1. Ejecutar tipos, pruebas, compilaciones y prueba aislada con las nuevas vistas y operaciones.
2. Publicar primero el servidor compatible conservando datos (`--delete-data=never`) y verificar tablas, IDs y registros existentes.
3. Regenerar bindings del mismo módulo y publicar después el cliente. El cliente nuevo depende de las vistas nuevas; invertir el orden puede impedir la suscripción inicial.
4. Comprobar las rutas completas en el entorno publicado, permisos de directos, comandos compartidos y preferencia de escritura entre sesiones. Registrar URL y resultados efectivos sin confundir publicación con aceptación en dispositivos.

Los cambios locales que ya existían en el proyecto se conservan. Este recibo no sustituye la revisión de otros cambios previos ni acredita su publicación.

## Recibo de publicación del 26 de octubre de 2026

- Maincloud `app-b20-34245`: **184 → 190 tablas**, con cuatro tablas nuevas de Mensajes y dos de Señales. Publicado con `--delete-data=never`; los **513 registros existentes se conservan**. Las huellas de 183 tablas son idénticas; la única excepción es la fila del cursor `notification_planner_state`, que avanza con el programador existente. Su esquema y cantidad de filas se conservan.
- Programa publicado y ensayado: SHA-256 `d253d74fad1994f5d3aadaa547ceace7e368ffe69428cdc65e139df68ee9a9f2`. La comparación usa el artefacto inmutable `rehearsed-target-bundle.js`, porque una compilación posterior de otro trabajo reemplazó el archivo mutable de `dist`. Ese otro paquete no se publicó en esta entrega.
- Pages: despliegue de producción `0a02caba-59a6-47ac-a484-d94ff5e43bd0`, rama `main`, [URL del despliegue](https://0a02caba.app-b20.pages.dev). Los **31 archivos públicos** de `b20.mx` coinciden con la compilación validada; autenticación, invitaciones y salud de la API responden correctamente. Los dominios, la rama y las variables del proyecto conservan sus huellas anteriores.
- Navegador de producción: el compositor y el control de escritura en vivo están presentes en una sesión existente; el chat y el área principal coinciden en sus cuatro bordes. Lenguaje de señales abre correctamente y no registra errores de consola. Las pruebas que crean mensajes, reacciones y recursos se realizaron con datos sintéticos aislados, sin crear ni alterar mensajes reales.
- La carga directa representa un checkout con cambios locales (`commit_dirty=true`); el commit indicado por Pages no identifica por sí solo el contenido publicado. Recibos, huellas, compilación estática y programa exacto se conservan en `artifacts/mensajes-2026-10-26/`, excluido de Git.
