# Arquitectura

Resumen técnico de la base inicial. La fuente de verdad del alcance es
[`definicion-del-proyecto.md`](definicion-del-proyecto.md) (secciones 5, 6 y 9).

## Piezas

| Pieza | Tecnología | Rol |
| --- | --- | --- |
| Interfaz | React 19 + TypeScript + Vite, `react-router` con rutas hash | Una sola app para todas las presentaciones. |
| Datos en tiempo real | SpacetimeDB, SDK `spacetimedb` (cliente y módulo en TypeScript) | Membresía, perfiles, trabajos, mensajes, cumpleaños. |
| Autenticación | SpacetimeAuth OIDC (Google) + invitaciones (`invitation`) | Emisor y audiencias configurables en `auth_config`; alta con correo verificado, vistas/acciones y backend con membresía activa. |
| Backend | Node + Hono + `@google/genai` + `jose` | Gemini BYOK; después URLs firmadas de Cloud Storage y envío de push. |
| Secretos | `EncryptedMemoryStore` (desarrollo) → Google Cloud Secret Manager | Claves BYOK por usuario, nunca devueltas al cliente. |
| Web/PWA | `vite-plugin-pwa` con service worker propio (`apps/web/src/sw.ts`) | Instalación en iPhone y Web Push. |
| Extensión | Manifest V3, `sidePanel`, todo empaquetado | Panel lateral y vista completa (`app.html`). |
| Android | Capacitor 8 + `@capacitor/push-notifications` (FCM) | APK firmado con avisos nativos. |

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

Faltan para el MVP: el borrador de guías con Gemini, adjuntos fuera de los trabajos,
instalaciones/suscripciones push y preferencias de avisos.

### Páginas que edita todo el grupo

Una tarea, actividad, exposición o examen es un `Assignment`: la página principal con lo que se
pidió. Los trabajos de cada alumno o equipo (`Work`) cuelgan de ella con `assignmentId`; la
materia, el parcial y el tipo se leen de la página, no se repiten en el trabajo.

`update_assignment` y `update_activity` no comprueban autoría: basta ser miembro activo, como
en un wiki. Cada creación o edición guarda el texto completo en `page_revision` (título,
objetivo e instrucciones) con quién y cuándo, y aumenta `version`. Restaurar una versión es
editar con el texto de esa versión, así que nunca se borra historial. No hay bloqueo de edición
simultánea: gana el último que guarda y el anterior queda en el historial.

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
el reducer `import_curriculum`, que solo ejecutan los creadores y no duplica materias; falta
llamarlo desde la interfaz cuando se conecte SpacetimeDB. `create_subject` sigue disponible para
materias fuera del plan y ahora pide el cuatrimestre.

Cada página principal lleva `kind`: `tarea`, `actividad`, `exposicion` o `examen` (`WORK_KINDS` en
`@b20/core`, repetido en el módulo). `create_assignment` y `update_assignment` lo validan.

### Archivos adjuntos y su límite

Cada archivo pesa como máximo **50 MB**. El valor vive en `MAX_FILE_BYTES` de `@b20/core`
(`packages/core/src/files.ts`) y se comprueba en tres lugares:

1. La interfaz (`FilePicker`) descarta el archivo y explica por qué antes de subirlo.
2. El reducer `attach_work_file` rechaza registrar un archivo vacío o de más de 50 MB. El módulo
   repite la constante porque no importa `@b20/core`; hay que cambiar las dos juntas.
3. Pendiente con el almacenamiento: el backend debe firmar cada subida con ese mismo tope, para
   que el servicio de archivos rechace el exceso aunque alguien salte la interfaz.

Por ahora solo los trabajos aceptan adjuntos (`attachWorkFile` y `removeWorkFile` en
`DataSource`). En modo de prueba el archivo no sale del navegador.

### Guías de estudio (3.5)

Primera versión manual. Una guía (`study_guide`) es de una materia y, si se elige, de un parcial;
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

## Capa de datos de la interfaz

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

## Pendientes de la Etapa 0

- Configurar el proyecto y cliente de SpacetimeAuth, publicar el módulo, establecer
  `auth_config` y crear la primera invitación. Probar acceso, persistencia, dos cuentas,
  exclusión de no invitados y bajas en un servidor real.
- Registrar y probar el acceso de extensión y Android; la configuración web no basta para
  estas presentaciones. Validar renovación y cierre de sesión también en la PWA instalada.
- Confirmar edad del grupo y acceso a Google AI Studio antes de habilitar Gemini; definir el
  modelo vigente en `GEMINI_MODEL`, límites de solicitudes y presupuesto.
- Iconos PNG de la PWA (192, 512 y apple-touch-icon 180) y de la extensión.
- Claves VAPID, suscripciones Web Push y prueba en un iPhone real con la PWA instalada.
- Proyecto de Firebase para FCM, `google-services.json` (no se versiona) y APK firmado de prueba.
- Bandeja de avisos de la extensión.
- Confirmar el `appId` de Android antes de firmar el primer APK.
