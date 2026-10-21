# Arquitectura

Arquitectura elegida para completar el proyecto con SpacetimeDB y Cloudflare. La fuente de verdad del alcance es
[`definicion-del-proyecto.md`](definicion-del-proyecto.md) (secciones 5, 6 y 9).

## Piezas

| Pieza | Tecnología | Rol |
| --- | --- | --- |
| Interfaz | React 19 + TypeScript + Vite, `react-router` con rutas hash | Una sola app para todas las presentaciones. |
| Datos y backend principal | SpacetimeDB, SDK `spacetimedb` (cliente y módulo en TypeScript) | Datos, archivos binarios privados, permisos, reducers, vistas, procedures y trabajos programados. |
| Autenticación | SpacetimeAuth OIDC (Google) + invitaciones (`invitation`) | Emisor y audiencias configurables en `auth_config`; alta con correo verificado, vistas/acciones y backend con membresía activa. |
| Integraciones complementarias | Cloudflare Workers + Hono | Cifrado BYOK, solicitudes autorizadas a Gemini, planificación y entrega Web Push, y mantenimiento de respaldo. Conserva compatibilidad opcional con R2 anterior; los archivos nuevos no requieren Worker. |
| Gemini BYOK | Claves personales cifradas en SpacetimeDB; clave maestra en Cloudflare Secrets | Implementado localmente con consentimiento, límites y presupuesto. Las claves no vuelven al cliente; la generación comienza desactivada hasta su configuración. |
| Web/PWA | Cloudflare Pages + `vite-plugin-pwa`, service worker propio (`apps/web/src/sw.ts`) | Web estática, instalación y base para Web Push; recepción real por validar. |
| Extensión | Manifest V3, `sidePanel`, todo empaquetado | Panel lateral y vista completa (`app.html`). |
| Android | Capacitor 8 | Proyecto que comparte la bandeja de avisos. Firma, distribución y comprobación en dispositivos siguen pendientes; el push nativo con la app cerrada no está implementado bajo la restricción de proveedores. |

## Modelo de datos inicial (`packages/spacetime-module`)

Tablas privadas: `app_config`, `auth_config`, `invitation`, `member`, `subject`, `term`, `work`,
`term_dates`, `assignment`, `page_revision`, `work_author`, `work_file`, `group_message`, `direct_conversation`, `direct_message`, `birthday`,
`change_log`, `activity`, `evidence`, `note`, `note_comment`, `question`, `answer`,
`last_seen`, `message_reaction`, `sticker_pack`, `sticker`, `chat_command`.
`last_seen`, `study_guide`, `guide_source`, `guide_review`.

Vistas públicas con filtro por quien consulta: `my_member`, `members`, `subjects`, `terms`,
`calendar`, `assignments`, `page_revisions`, `works`, `work_authors`, `work_files`, `group_messages`, `birthdays`, `change_history`,
`my_direct_conversations`, `my_direct_messages`, `activities`, `evidences`, `notes` (del grupo
y las personales propias), `note_comments`, `questions`, `answers`, `my_last_seen`,
`message_reactions` (del canal y de tus 1 a 1), `sticker_packs` (tuyos y compartidos), `stickers`
(de esos paquetes y los ya enviados) y `my_chat_commands`.

Los mensajes guardan referencias a otros módulos dentro del texto como `[[tarea:id]]`,
`[[trabajo:id]]`, `[[clase:id]]`, `[[nota:id]]`, `[[pregunta:id]]` o `[[sticker:id]]`; cada cliente
las resuelve con lo que su vista le deja ver. Eliminar un mensaje vacía el texto y deja
`deleted_at`, para que las respuestas no pierdan el hilo.
`study_guides`, `guide_sources`, `guide_reviews`.

La tercera entrega añade tablas privadas para claves cifradas, preparaciones y borradores de
IA; avisos, preferencias, instalaciones y cola de entrega; y retención con purga programada.
Los adjuntos nativos ya abarcan los recursos académicos y mensajes. Los servicios y su
validación operativa se describen en el [índice de la entrega](tercera-entrega.md).

### Páginas que edita todo el grupo

Una tarea, actividad, exposición o examen es un `Assignment`: la página principal con lo que se
pidió. Los trabajos de cada alumno o equipo (`Work`) cuelgan de ella con `assignmentId`; la
materia, el parcial y el tipo se leen de la página, no se repiten en el trabajo.

`update_assignment` y `update_activity` no comprueban autoría: basta ser miembro activo, como
en un wiki. Cada creación o edición guarda el texto completo en `page_revision` (título,
objetivo e instrucciones) con quién y cuándo, y aumenta `version`. Restaurar una versión es
editar con el texto de esa versión, así que nunca se borra historial. Las operaciones académicas
V2 comprueban la versión esperada para avisar de cambios simultáneos; las operaciones antiguas
se conservan por compatibilidad y no deben usarse para omitir ese control.

`update_work`, `attach_work_file` y `remove_work_file` sí exigen ser autor del trabajo.

### Calendario de parciales y parcial vigente

`term_dates` guarda el primer y el último día de cada parcial (cuatrimestre 1 a 9, parcial 1 a
3). Lo cambia el reducer `save_calendar`, que solo ejecutan los creadores (`requireCreator`) y
reemplaza de una vez las fechas de un cuatrimestre; valida fechas reales, en orden y sin
encimarse. En la interfaz está en Ajustes (`CalendarSettings`): todos lo ven, solo los
administradores lo editan (`canManageCalendar` en `@b20/core`).

El parcial vigente es el último que ya empezó (`currentTerm` en `@b20/core`): cambia el día en
que inicia el siguiente y, entre dos parciales, sigue valiendo el anterior. Los formularios de
«Registrar actividad» y «Nueva tarea o actividad» abren con ese cuatrimestre y ese parcial,
salvo que se llegue desde una lista ya filtrada. Si no hay fechas, abren en el último
cuatrimestre que la persona usó.

### Un solo módulo con dos vistas

«Actividades de clase» ya no es un módulo aparte: vive dentro de «Tareas y Actividades». Los
datos siguen siendo dos (`Assignment` con sus `Work`, y `Activity` con sus `Evidence`), pero la
lista los junta como publicaciones (`buildPosts` en `packages/app/src/lib/posts.ts`) y los
mismos filtros aplican a los dos. Hay dos vistas, elegibles con `?vista=`:

- **Por materia** (por omisión): tarjetas agrupadas en materia → parcial.
- **Por fecha** (`vista=fechas`): filas por mes con el día a la izquierda. Una actividad de clase
  va en el día de su sesión; una tarea, en su fecha de entrega o, si no tiene, en el día que se
  creó.

Las páginas de una actividad de clase conservan sus direcciones (`/m/actividades/:id`); la
dirección de la lista antigua redirige a la vista por fecha.

### Plan de estudios y tipos de trabajo

Las 45 materias (nueve cuatrimestres de cinco) viven en `CURRICULUM` de `@b20/core`. Cada
materia guarda su cuatrimestre (`period`) y tiene tres parciales. En el servidor se cargan con
el reducer `import_curriculum`, que solo ejecutan los creadores y no duplica materias; Ajustes
expone su importación en modo real. `create_subject` sigue disponible para
materias fuera del plan y ahora pide el cuatrimestre.

Cada página principal lleva `kind`: `tarea`, `actividad`, `exposicion` o `examen` (`WORK_KINDS` en
`@b20/core`, repetido en el módulo). `create_assignment` y `update_assignment` lo validan.

### Archivos académicos, versiones y permisos

Los archivos nuevos de consignas, trabajos, actividades y evidencias se guardan directamente
en tablas privadas de SpacetimeDB, divididos en fragmentos de 1 MiB y con un máximo de
50 MiB (52,428,800 bytes). Cada operación comprueba membresía y permisos sobre el recurso;
los clientes reciben metadatos en las suscripciones y descargan bytes solo al pedirlos.
La subida conserva un manifiesto para reanudar, cancelar y confirmar de forma idempotente.
Ver [archivos-spacetime.md](archivos-spacetime.md).

Los IDs de archivos existentes y sus referencias históricas se conservan. Los objetos R2
previos requieren su ruta de compatibilidad hasta migrarlos y verificar su integridad; una
instalación nueva no requiere R2, buckets ni una credencial técnica de archivos.

Las nuevas tablas son aditivas: avance privado, metadatos, revisiones de trabajos, snapshots
completos de páginas, revisiones nominales, comentarios, recursos y vínculos. Cada cambio
material conserva un snapshot y requiere la versión esperada. Los archivos históricos se
conservan al retirarlos de la versión actual durante el plazo aplicable. La papelera permite
restaurar contenido antes de 30 días; después se purgan sus dependencias, preservando los
bytes todavía referenciados por otras publicaciones. Las evidencias y sus archivos actualizan
la versión de la actividad para que las guías avisen del cambio; comentar no la modifica. Los adjuntos
retirados de evidencias siguen descargables para miembros activos mientras exista su destino;
solo el autor de la evidencia puede recuperarlos con su versión actual. Esto conserva archivos
y referencias, sin presentar un historial completo del texto de la evidencia.

### Guías de estudio (3.5)

La base manual de una guía (`study_guide`) es de una materia y, si se elige, de un parcial;
guarda el temario y una entrada por sección en el orden de `GUIDE_SECTIONS`
(`packages/core/src/guides.ts`). Como las páginas de tareas, cualquier miembro activo la edita y la
versión sube; quién guardó cada una queda en `change_log`.

- **Fuentes** (`guide_source`): cada una apunta a un trabajo, tarea, actividad de clase, apunte del
  grupo o pregunta de la misma materia, con la versión que tenía al agregarse. Entran como
  pendientes; una pendiente siempre lleva su razón. Las notas personales no pueden ser fuente.
- **Cobertura**: un tema del temario cuenta como cubierto cuando al menos una fuente procesada lo
  trata (`guideCoverage`). Nada se da por cubierto sin fuente.
- **Material que cambió**: si la versión actual de una fuente es mayor que la guardada, la guía lo
  señala hasta que alguien la revisa (`refresh_guide_source`).
- **Revisión entre compañeros** (`guide_review`): aprobada o con cambios propuestos (con
  comentario), una por persona y versión; quien guardó la versión no puede revisarla.
- **Compendio**: `/m/guias/compendio?cuatri=N` junta las guías de un cuatrimestre, cada materia por
  separado, y se puede imprimir o guardar como PDF.

La tercera entrega permite preparar texto y adjuntos UTF8 compatibles para Gemini BYOK,
revisar sus versiones y omisiones y generar un borrador privado. Publicarlo crea una guía
o nota independiente con citas, historial y control de acceso; los resultados basados en
fuentes personales no se comparten directamente. Los formatos no admitidos quedan
explícitamente omitidos. Véase [gemini-byok.md](gemini-byok.md).

### Contribuciones y leaderboard (3.6)

Los puntos no tienen tabla propia: se calculan de los registros que ya valida el servidor
(trabajos, apuntes, respuestas, páginas, versiones, evidencias, guías, fuentes y revisiones). Así
cada punto se puede verificar abriendo su registro, y lo que se borra deja de contar. Las reglas,
los límites y los reconocimientos están en `packages/core/src/contributions.ts`, para que el
módulo pueda usar exactamente las mismas si algún día se guardan los totales.

- **Reglas visibles**: la pantalla muestra cuántos puntos da cada aporte y qué nunca suma
  (mensajes, preguntas, calificaciones, apuntes personales, préstamos o disponibilidad).
- **Límites**: una respuesta por pregunta, una corrección por página y un comentario por apunte;
  responder tu propia pregunta o comentar tu propio apunte no cuenta. Lo que no sumó aparece en el
  desglose con la razón.
- **Periodos**: parcial y cuatrimestre vigentes según el calendario de Ajustes, o los últimos 30
  días si no hay fechas; «Todo» siempre está.
- **Pendiente**: los valores son una propuesta; la definición pide ajustarlos con el grupo.
### Votaciones (3.8)

Nominales: las vistas `polls` y `poll_votes` muestran a todo el grupo quién votó y qué eligió, y a
nadie de fuera. No hay votaciones anónimas en esta versión. Las reglas están en
`packages/core/src/polls.ts` y el módulo las repite al validar.

- **Un voto por persona**: la llave de `poll_vote` es votación + identidad, así que un segundo voto
  solo puede ser un cambio, y solo si se anunció al crearla (`allowChange`) y antes del cierre.
- **Elegibles**: se fijan al crearla; solo ellos votan, aunque todos ven el resultado.
- **Opciones fijas**: con al menos un voto ya no se edita; se cancela con una razón visible y se
  reinicia en una consulta nueva (`restartOf`). Los votos de la cancelada se conservan como registro.
- **Resultado y acuerdo**: tras el cierre, cualquier integrante registra el acuerdo adoptado, con su
  nombre y fecha, separado del resultado de la consulta.
- **Navegación**: `ready` en `MODULES` muestra en el menú un módulo de una etapa posterior que ya
  tiene pantalla.

### Ayuda entre compañeros (7.3)

`/m/ayuda` permite publicar ofertas y peticiones por materia, tema, nivel del contenido y
modalidad. La disponibilidad es voluntaria: incluirla en la publicación la comparte con el
grupo. «Mis publicaciones» incluye las cerradas y las retiradas propias; los perfiles solo
muestran publicaciones públicas. Este módulo no genera puntos.

Las tablas `help_post` y `help_contact_request` son privadas. La vista `help_posts` entrega al
grupo publicaciones no retiradas de miembros activos y a cada autor sus propias retiradas.
`my_help_contact_requests` entrega únicamente los contactos enviados o recibidos por quien
consulta; ser administrador no permite leer contactos ajenos. Las solicitudes conservan el
título y el tema originales para mantener contexto tras editar o retirar una publicación.
Las acciones de contacto no se registran en el historial público.

Aceptar un contacto crea o reutiliza atómicamente la conversación 1 a 1, sin enviar mensajes
automáticos ni cerrar la publicación. Solo el destinatario acepta/rechaza; el remitente
cancela pendientes y cualquiera de los participantes cierra un contacto aceptado. Cada
persona puede enviar una sola solicitud por publicación, incluso si ya fue rechazada o
cancelada. Las bajas impiden enviar y aceptar nuevos contactos.

El autor decide cerrar y puede reabrir una publicación cerrada. Cerrar o retirar termina los
contactos pendientes y conserva los aceptados y sus conversaciones. Retirar oculta la
publicación al grupo y no permite reabrirla. El autor puede retirarla; un administrador que
retire una ajena debe registrar un motivo que el autor puede consultar. Los encuentros se
coordinan por mensajes; convertirlos en salas de estudio queda para una entrega posterior.

La demo aplica las mismas reglas en memoria y contiene ejemplos ficticios. Su implementación
de SpacetimeDB y bindings están incluidos, sin cambiar el modo demo ni publicar en Maincloud.

## Capa de datos de la interfaz

### Aprende enseñando (7.8)

La primera versión es manual y funciona sin Gemini. `teaching_practice` conserva explicación
inicial, revisada, estado (`draft`, `practicing`, `completed`) y un compañero opcional.
`teaching_personal` separa reflexión, temas para repasar, fuente y nota publicada;
`teaching_question` conserva las preguntas orientadoras o del compañero y las respuestas.
Las tres tablas son privadas. Las vistas entregan prácticas y preguntas únicamente al autor
o al compañero invitado actual, con membresía activa de ambos; los datos personales solo al
autor. No hay privilegio de lectura por administrar el grupo.

Los reducers validan autoría, estado y acceso a fuentes, y no escriben eventos privados en
`change_log`. Iniciar conserva la explicación inicial y crea tres preguntas una sola vez.
Completar exige explicación revisada, reflexión y una respuesta; reabrir permite continuar.
La publicación inserta una nota de grupo y guarda su ID en la misma transacción: es idempotente
y copia únicamente la explicación revisada. La nota se edita después en Notas de clase.

La demo aplica las mismas reglas en memoria. Las suscripciones y snapshots de SpacetimeDB
retiran las prácticas al revocar invitaciones o dar de baja participantes. El cambio de esquema
es aditivo; al activar el modo real debe actualizarse el módulo antes que los clientes, sin
borrar datos. Esta entrega no activa datos reales ni cambia la configuración de despliegue.

Las pantallas leen y escriben a través de `DataSource` (`packages/app/src/data/types.ts`),
cuyas acciones corresponden a los reducers del módulo y cuyo `Snapshot` corresponde a sus
vistas. La sesión real utiliza la implementación de SpacetimeDB con el ID token de SpacetimeAuth;
la demo usa `DemoDataSource`, con datos de prueba en memoria y un selector «Ver como». Iniciar
sesión no selecciona automáticamente un usuario de la demo ni sustituye la validación del módulo.

## Autenticación y membresía

La web inicia Authorization Code con PKCE mediante SpacetimeAuth. El callback es
`/auth/callback` y el retorno de logout es `/auth/logout`, fuera de las rutas hash; el hosting
debe resolverlos a la aplicación. El cliente renueva la sesión y vuelve a autenticar la conexión de datos con su ID token. La configuración
pública solo contiene emisor, client ID y direcciones de retorno.

`set_auth_config` configura el emisor y las audiencias admitidas del módulo con la identidad
que publicó la base. Es obligatorio validar la audiencia porque distintos proyectos de
SpacetimeAuth comparten emisor. El backend obtiene las claves públicas OIDC y verifica firma,
emisor y audiencia; además consulta `assert_active_member` antes de las rutas protegidas.

`join_group` conserva la comprobación del correo verificado contra `invitation`. Las vistas y
acciones exigen miembro activo; los privilegios de creador se asignan en la invitación del
módulo. La primera invitación se prepara desde la CLI, pues la identidad del publicador no es
la identidad OIDC con la que después entra al navegador. No se fusionan identidades antiguas
de Google con las nuevas por correo.

La configuración del panel y del primer creador está en
[`spacetimeauth.md`](spacetimeauth.md). Web/PWA usa redirecciones en su origen; extensión y
Android usan el navegador del sistema y callbacks propios que deben registrarse y probarse
antes de distribuirse.

### Repaso espaciado (7.9)

`spaced_collection` y `spaced_card` almacenan colecciones personales/compartidas y tarjetas
con una nota o guía de origen versionada. Las vistas comprueban membresía, visibilidad de la
colección y accesibilidad actual de la fuente; las notas personales solo sirven en colecciones
personales de su autor. Publicar valida todas las fuentes, incluidas las tarjetas archivadas.

`spaced_enrollment`, `spaced_progress` y `spaced_review` permanecen privados por identidad,
mediante vistas `my_spaced_*`. No se registran respuestas escritas ni se incorporan sesiones a
contribuciones o novedades. La interfaz mantiene una cola finita por sesión; guardar exige
versión de tarjeta, revisión del progreso y un identificador idempotente por intento.

La función pura `nextSpacedSchedule` de `@b20/core` la usan demo y módulo: acierto a 1/3/7/14/30/
60/120 días, pista a un día sin avanzar y olvido a diez minutos con reinicio. El servidor
determina la hora y rechaza revisiones adelantadas. Cambiar el contenido reinicia el aprendizaje;
actualizar solo la referencia o archivar conserva el intervalo e invalida sesiones antiguas.

El cambio añade tablas, vistas y reducers, sin migrar datos existentes ni cambiar el modo de
datos del despliegue. Para usarlo en modo real hace falta publicar el módulo actualizado por
el procedimiento habitual; la implementación local no publica ni elimina datos.

## Pendientes de la Etapa 0

- Verificar la publicación del módulo actualizado, `auth_config` e invitaciones existentes.
  Probar acceso y persistencia con autor, compañero autorizado y tercero; incluir bajas y
  rechazo de lectura de bytes privados. El código local no acredita el despliegue de esta entrega.
- Registrar y probar el acceso de extensión y Android; la configuración web no basta para
  estas presentaciones. Validar renovación y cierre de sesión también en la PWA instalada.
- Confirmar elegibilidad del grupo y acceso a Google AI Studio antes de habilitar Gemini;
  configurar el modelo vigente en `GEMINI_MODEL` y los secretos, y comprobar el presupuesto
  y los límites implementados. La integración local no activa el proveedor.
- Iconos PNG de la PWA (192, 512 y apple-touch-icon 180) y de la extensión.
- Configurar claves VAPID y suscripciones Web Push; comprobar recepción en dispositivos
  reales, incluido iPhone con la PWA instalada.
- APK firmado de prueba y recordatorios locales. El requisito original de push nativo Android
  permanece pendiente bajo la restricción de usar únicamente SpacetimeDB y Cloudflare.
- Validar la bandeja de avisos incluida en la extensión y la disponibilidad de Push API en
  cada presentación; no asumir que el contenedor ofrece entrega en segundo plano.
- Confirmar el `appId` de Android antes de firmar el primer APK.

## Alcance y estado de la primera entrega

La incorporación del módulo 3.11 al catálogo no implementa su pantalla. Su alcance funcional
se conserva íntegro en la definición y su primera incorporación corresponde a la etapa 3.
Ayuda, Aprende enseñando y Repaso ya tienen implementación manual local; sus integraciones
pendientes y las pruebas reales se reflejan en [estado-del-proyecto.md](estado-del-proyecto.md).

La [tercera entrega](tercera-entrega.md) implementa localmente la papelera de 30 días,
Gemini BYOK para guías/explicaciones, la programación de recordatorios y Web Push. Su
activación y aceptación en dispositivos siguen pendientes de configuración y despliegue.
Exámenes, generación de tarjetas de Repaso con IA y push nativo del APK no forman parte de
esta implementación. El SDK del cliente y del módulo está fijado en `2.12.0`, con bindings
regenerados; las pruebas y compilaciones se registran al verificar cada entrega.

## Exposiciones por texto

`PresentationActions` y `PresentationsSnapshot` incorporan prácticas, intentos, preguntas,
retroalimentación y autoobservaciones separadas. Cinco tablas privadas y sus vistas exigen
membresía activa y propiedad o invitación expresa. Los revisores solo reciben intentos
concluidos; `my_presentation_personal` es exclusiva del autor, sin excepción administrativa.
Las versiones y los identificadores de petición evitan sobrescrituras y duplicados. Las
preguntas locales y la validación se comparten entre demo y servidor mediante `@b20/core`.
No hay puntos ni novedades comunitarias por ensayar. Ver [reglas](exposiciones.md).
