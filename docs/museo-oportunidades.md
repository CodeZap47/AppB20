# Museo de bugs y Radar de oportunidades — cuarta entrega

Los dos módulos guardan sus datos en tablas privadas de SpacetimeDB 2.12.0. La aplicación
compartida funciona en web/PWA, extensión y APK. No se añaden proveedores, bases de datos,
scraping, pagos ni mensajes externos. Estos flujos son manuales y no llaman a Gemini;
la configuración de Gemini con clave propia del resto de la aplicación se conserva.

## Museo de bugs (7.7)

`/m/museo-bugs` es una colección y una plantilla de **Preguntas**, con una ficha por
`questionId`. Puedes convertir una pregunta propia existente o crear una pregunta normal
al guardar la plantilla. Se reutilizan su discusión, respuestas, aclaraciones, correcciones,
archivos y retirada: no hay un foro adicional ni una segunda clase de comentarios.

La plantilla registra intención, síntoma, causa o hipótesis, corrección cuando se conoce,
aprendizaje, código mínimo, evidencia, lenguaje, tema, tipo de error y referencias a
notas compartidas y otras preguntas legibles. Los filtros cubren materia, lenguaje, tipo
y texto del tema o síntoma. El autor edita con `expectedVersion`; otras personas proponen
correcciones en Preguntas. La ficha conserva versiones y la persona que editó cada una.
El enunciado original de la pregunta permanece como contexto de la discusión; la ficha
corregida y su historial se consultan en el museo, enlazado desde la pregunta.

La metadata (`museum_entry`) y su historial (`museum_revision`) tienen la misma visibilidad
que la pregunta activa. Retirar el origen oculta ficha e historial, restaurarlo dentro de
los 30 días recupera los mismos registros y la purga elimina ambos. Las referencias sólo
se admiten al crearlas si son legibles y compartidas; la interfaz no abre referencias
retiradas. No se copian textos de notas personales a la ficha.

La creación deduplica por autor y solicitud, incluso si la ficha ya se editó. Una edición
repetida con la última solicitud no crea otra versión. Una solicitud obsoleta diferente
falla por versión; el cliente debe recargar y revisar antes de volver a guardar.

## Radar de oportunidades (7.12)

`/m/oportunidades` permite publicar y editar fichas manuales con:

- Tipo (concurso, curso, beca, evento, prácticas u otra), título y tema.
- Modalidad, fuente HTTPS sin credenciales, organizador y requisitos.
- Fecha límite conocida o explícitamente no conocida.
- Costo conocido con moneda o «Gratis», o costo explícitamente no conocido.
- Una Sala abierta vigente opcional. Visitarla no inscribe automáticamente a nadie.

Hay filtros por tipo, modalidad, búsqueda y estado: vigentes, vencidas, todas las
consultables o propias. El autor conserva la autoría y edita con versión esperada; no
se hace ninguna inscripción ante el organizador de la convocatoria.

«Me interesa» es voluntario y **privado**, también ante el autor de la ficha y los
administradores. Para aparecer ante el grupo deben coincidir las tres elecciones:
interés activo, buscar equipo y autorización expresa para mostrar nombre y enlace de
perfil/contacto. Cancelar el interés revoca la búsqueda y el contacto compartido. No se
crean conversaciones ni se envía un mensaje automáticamente. Una baja de membresía
revoca el acceso y oculta las participaciones de esa persona. Una ficha vencida o retirada
no acepta nuevas altas; cancelar un interés anterior sigue permitido.

Cualquier integrante activo puede proponer una corrección o reportar enlace roto o
información desactualizada. Los reportes conservan autoría y estado. El autor de la ficha
o un administrador resuelve con explicación y versión esperada; el reporte sigue visible
para que se pueda comprobar la respuesta. Corregir la ficha y resolver el aviso son actos
explícitos separados.

El autor o un administrador puede retirar una ficha. La retirada conserva historial,
reportes e intereses propios; la ficha deja de estar disponible para el resto del grupo.
Una retirada voluntaria la restaura su autor, y una retirada moderada requiere un
administrador. El Radar usa este archivo reversible y no añade una nueva política de
borrado definitivo ni una purga global.

## Contratos y seguridad

Las tablas de ficha, historial, interés y reportes no se suscriben directamente. Las seis
vistas `museum_entries`, `museum_revisions`, `opportunities`, `opportunity_revisions`,
`opportunity_interests` y `opportunity_feedback` aplican membresía y permisos actuales.
El adaptador del cliente vuelve a filtrar los registros durante cambios de cuenta,
retirada o propagación de una caché anterior, sin convertir los identificadores u64 a
números JavaScript.

La demo conserva las fichas en un `WeakMap` asociado al estado compartido, con los mismos
validadores de texto, vínculos, fuente HTTPS, costo y fechas. Intereses y permisos se
filtran para el integrante que consulta. El limpiador de retención recibe el origen real
purgado; nunca infiere una purga porque un integrante no pueda verlo.

## Validación local

Las pruebas específicas cubren validación de plantillas, versiones, autoría, deduplicación,
referencias personales rechazadas, retirada/restauración/purga del origen, interés privado
incluso ante administradores, autorización y revocación de contacto, vencimiento,
correcciones y reportes. Las pruebas de interfaz recorren guardar/editar una ficha sobre
una pregunta existente, publicar una oportunidad, las tres decisiones de interés y el
filtro de vencidas. Las pruebas del adaptador incluyen cambio de cuenta, baja y u64 máximo.

El recorrido `node scripts/smoke-spacetime-community4.mjs` usa un servidor local aislado,
identidades sintéticas y una copia temporal del módulo. Sólo esa copia acelera la retención
a cuatro segundos para comprobar la expiración programada real; el plazo del código de
producto sigue siendo de 30 días. No conecta a Maincloud ni a servicios de Cloudflare o
Gemini, y no prueba el envío de correo, mensajes externos ni inscripciones ante terceros.


Los reintentos de creación y edición comparan su contenido con la intención original.
Reutilizar una clave con otros campos o un reporte distinto produce un rechazo; una
confirmación perdida no se presenta como una edición nueva guardada. La simulación entrega
copias de sus snapshots para que una edición en otra sesión no cambie la versión que tenía
abierta un formulario.
