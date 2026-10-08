# Arquitectura

Resumen técnico de la base inicial. La fuente de verdad del alcance es
[`definicion-del-proyecto.md`](definicion-del-proyecto.md) (secciones 5, 6 y 9).

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
`term_dates`, `assignment`, `page_revision`, `work_author`, `work_file`, `group_message`, `direct_conversation`, `direct_message`, `birthday`,
`change_log`, `activity`, `evidence`, `note`, `note_comment`, `question`, `answer`,
`last_seen`.

Vistas públicas con filtro por quien consulta: `my_member`, `members`, `subjects`, `terms`,
`calendar`, `assignments`, `page_revisions`, `works`, `work_authors`, `work_files`, `group_messages`, `birthdays`, `change_history`,
`my_direct_conversations`, `my_direct_messages`, `activities`, `evidences`, `notes` (del grupo
y las personales propias), `note_comments`, `questions`, `answers`, `my_last_seen`.

Faltan para el MVP: guías con fuentes, adjuntos fuera de los trabajos, instalaciones/suscripciones
push y preferencias de avisos.

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

### Cómo se relacionan «Tareas y Actividades» y «Actividades de clase»

Son módulos distintos: uno guarda lo que se entrega (página principal y trabajos de cada
alumno) y el otro lo que se hizo en una sesión (página y evidencias por equipo). No se enlazan
registro a registro; comparten la clasificación cuatrimestre → materia → parcial. Por eso cada
página lista lo del otro módulo en su misma materia y parcial. Las actividades de clase guardan
ahora su parcial (`termId`).

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

## Capa de datos de la interfaz

Las pantallas leen y escriben a través de `DataSource` (`packages/app/src/data/types.ts`),
cuyas acciones corresponden a los reducers del módulo y cuyo `Snapshot` corresponde a sus
vistas. Mientras no hay SpacetimeDB, la app usa `DemoDataSource`: datos de prueba en memoria
que aplican las mismas reglas de permisos, con un selector «Ver como» para revisar qué ve cada
miembro. Conectar SpacetimeDB consiste en escribir otra implementación de `DataSource`.

## Pendientes de la Etapa 0

- Instalar la CLI de SpacetimeDB, publicar el módulo y generar bindings; escribir
  una implementación de `DataSource` sobre `SpacetimeDBProvider` (`packages/app/src/lib/spacetime.tsx`). El módulo solo se ha
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
