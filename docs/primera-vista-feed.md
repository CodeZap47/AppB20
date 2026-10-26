# Primera vista: Feed y vista Clásica

La pantalla de inicio («¿Qué me perdí?», sección 7.1, rutas `/` y `/m/inicio`) se puede
ver de dos formas. Cada persona elige con el selector **Feed | Clásica** del encabezado; la
elección se recuerda en el dispositivo (`localStorage`, clave `b20:inicio:vista`) y también
viaja en la URL (`?vista=feed|clasica`). Sin preferencia guardada se abre el feed.

Las dos vistas comparten todo lo que ya hacía el módulo:

- **Pendientes / Todo** y **Marcar todo como visto** (`markSeen`).
- Filtros por tipo de novedad y por materia (`?tipo=`, `?materia=`).
- Resumen sin IA, aviso de privacidad y columna con cumpleaños de hoy, mensajes nuevos,
  entregas de la semana y enlace a todos los módulos.
- Las mismas reglas de visibilidad: nada personal ajeno ni retirado.

## Vista Clásica

Es la lista compacta de siempre, agrupada por día. Ahora también incluye las publicaciones
de compañeros como novedad del tipo «Publicaciones»; al abrirlas se llega al feed con la
publicación resaltada (`?vista=feed&publicacion=<id>`).

## Vista Feed

- **Historias:** burbujas con lo urgente del día (cumpleaños, chats con mensajes nuevos y
  entregas próximas). Cada una abre su módulo.
- **«¿Qué estás pensando?»:** publicaciones de texto para el grupo (máximo 1000
  caracteres) con materia opcional.
- **Tarjetas:** cada novedad muestra autor, tiempo relativo, materia, tipo, una vista previa
  del contenido (apunte, pregunta, respuesta, consigna…) y el botón **Abrir**. Tus propias
  publicaciones también aparecen: todas en «Todo» y las recientes en «Pendientes».
- **Reacciones:** 👍 ❤️ 😂 🎉 😮 🙏, una por persona y contenido; elegir otra la cambia y
  repetirla la quita. La reacción se guarda sobre el contenido (el apunte, la pregunta…),
  no sobre el aviso, así que se conserva aunque el contenido se edite.
- **Comentarios:** solo en las publicaciones del feed (máximo 500 caracteres). Se ven los
  dos últimos y el resto con «Ver los N comentarios».
- **Notas de clase:** todas las notas compartidas con el grupo, también las tuyas
  («Compartiste la nota de clase…»), con su tema y un extracto. Las personales nunca salen.
- **#1 del ranking:** cada vez que alguien llega al #1 del periodo vigente (el que abre el
  leaderboard: parcial en curso o últimos 30 días), sola o empatada, aparece una tarjeta 🏆
  con los puntos de ese momento y el botón «Ver ranking». Se calcula en el cliente a partir de
  los aportes, igual que el leaderboard, así que no admite reacciones. Los avisos de otras
  personas también salen en la vista Clásica y en el resumen; los tuyos solo en el Feed.

## Permisos

| Acción | Quién |
| --- | --- |
| Reaccionar | Miembros activos, sobre contenido que pueden leer en su módulo de origen. |
| Publicar y comentar | Miembros activos. Reintentar con el mismo `requestId` no duplica. |
| Editar una publicación | Su autor. |
| Eliminar una publicación | Su autor o un administrador; se van también sus comentarios y reacciones. |
| Eliminar un comentario | Quien comentó, quien publicó o un administrador. |

Las eliminaciones son lógicas (se vacía el texto y se registra quién y cuándo); las de un
administrador quedan en el registro de moderación.

## Datos

Tablas privadas en SpacetimeDB (`packages/spacetime-module/src/feedTables.ts`):
`feed_reaction` (clave `tipo:id:miembro`), `feed_post` y `feed_comment`. Las vistas
`feed_reactions`, `feed_posts` y `feed_comments` filtran por membresía activa y por la
legibilidad del contenido. Reducers: `toggle_feed_reaction`, `create_feed_post`,
`edit_feed_post`, `delete_feed_post`, `comment_feed_post` y `delete_feed_comment`.
Las reglas compartidas (emojis, tipos de contenido y límites) viven en
`packages/core/src/feed.ts`. El modo demo replica las mismas reglas con datos de ejemplo.

## Rediseño social académico — implementación local, 26 de octubre de 2026

El feed utiliza tarjetas con etiquetas de tipo, materia y estado, visibles también en móvil.
Cada familia presenta sus datos propios: entregas y cambios de fecha, documentos y archivos,
preguntas y respuestas, temarios, votaciones, ayuda, repaso, código, bugs, oportunidades,
salas y exámenes de estudio. Las consignas diferencian tarea, actividad académica,
exposición y examen académico. Los textos y el código extensos permiten «Ver más».

El catálogo incorpora retos, soluciones, revisiones y observaciones de código, Museo de bugs,
oportunidades, salas abiertas al grupo y exámenes compartidos. Las publicaciones propias de
todos los tipos aparecen en Feed; no suman novedades ajenas ni alteran la lectura de chats.
Las notas publicadas desde Aprende enseñando o desde el resumen de una sala conservan una
sola tarjeta con su origen. Museo conserva la identidad y las reacciones de su pregunta.

Se puede votar, cambiar el voto cuando esté permitido, responder preguntas e inscribirse o
salir de salas desde las tarjetas. Se reutilizan permisos, restricciones y acciones de sus
módulos; los envíos simultáneos se bloquean y los errores conservan el borrador. La salida
de una sala pide confirmación. La lectura ampliada sigue disponible en el recurso original.

Los recursos nuevos no amplían la lista de objetivos de reacciones. Los comentarios siguen
perteneciendo a las publicaciones libres; las observaciones de código y las soluciones de
retos son aportes independientes, con enlace al elemento y versión correspondientes.

### Exámenes compartidos

`listExams` acepta `sharedOnly: true`. Servidor y demo devuelven solo exámenes compartidos,
aprobados y no archivados, proyectando la versión aprobada incluso para su autor. Los datos
del borrador, intentos y resultados no se incluyen. La petición normal del catálogo mantiene
su comportamiento.

El feed consulta estos resúmenes al abrirse, recuperar el foco y cada 15 segundos mientras
la página esté visible. Las lecturas se coordinan por cuenta; cambiar de sesión, perder acceso
o retirar fuentes invalida la información anterior. Un fallo de consulta permite reintentar
sin bloquear las demás publicaciones. No se generan preguntas ni se llama a Gemini.

Para publicar esta actualización, desplegar primero el módulo compatible con `sharedOnly`
conservando los datos y después los clientes. Este registro describe la implementación
local; no acredita una nueva publicación en producción.

La entrada de diseño admite `design-preview.html?feed-review=1#/m/inicio?ver=todo` para
revisar tipos nuevos con ejemplos ficticios. Esta entrada no forma parte del build normal.

Validación local: 119 pruebas aprobadas de interfaz, catálogo y Exámenes; comprobación
global de tipos y compilaciones de web/PWA y extensión correctas. Se revisaron capturas
del feed a 1440 y 360 píxeles. No se utilizaron cuentas ni publicaciones reales.

## Pendiente

- Publicar el módulo actualizado en SpacetimeDB (`npm run spacetime:publish`) y comprobarlo
  con varias cuentas.
- Avisos por comentarios o reacciones a tus publicaciones.
- Reportar publicaciones y adjuntar imágenes.
