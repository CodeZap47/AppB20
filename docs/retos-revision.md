# Retos y revisión de código

La cuarta entrega implementa Retos (7.4) y Revisión de código (7.5). Las tablas, permisos, versiones y progreso residen en SpacetimeDB 2.12.0. La interfaz compartida funciona en la web/PWA, extensión y Android con la infraestructura Cloudflare existente. Estos módulos no invocan Gemini ni requieren otro proveedor.

## Retos

Ruta: `/m/retos`. Cualquier integrante activo puede crear un reto por materia, tema y dificultad básica/intermedia/avanzada. Debe incluir objetivo, instrucciones y ejemplos; puede añadir hasta ocho pistas ordenadas. El enunciado inicial y las pistas son estables, para que la discusión conserve su contexto.

La ficha no contiene las pistas. `challenge_hints` entrega únicamente las descubiertas por el solicitante; el autor puede leer las que escribió. `my_challenge_progress` entrega sólo el progreso personal. Cada desbloqueo exige el número anterior y un reintento del mismo paso no desbloquea otro. Las pistas bloqueadas no llegan al cliente.

Cada integrante comparte una solución con explicación del razonamiento y sus límites. Sólo puede modificar su propia solución, con control de versión. Hay comentarios generales y comentarios sobre una solución específica. El autor cierra el reto con una conclusión; el contenido queda consultable y se detienen nuevos comentarios y soluciones.

## Revisión de código

Ruta: `/m/revision-codigo`. El autor indica materia, título, lenguaje y contexto; pega código o añade un enlace HTTPS al repositorio. El servidor guarda la referencia como texto y no consulta el repositorio, ejecuta código ni realiza operaciones Git. La copia pegada es la base fiable de comentarios por línea; un enlace externo puede cambiar y sólo admite comentarios generales si no hay código pegado.

Cada nueva versión conserva el código, enlace y contexto anteriores. El código conserva la sangría y espacios; se normalizan CRLF/CR a LF. Los comentarios se anclan al número de versión y a un rango de líneas existente, o 0–0 para un comentario general. Crear una versión más corta no mueve los comentarios anteriores. Los tipos disponibles son error, sugerencia y pregunta.

Los comentarios comienzan pendientes. Sólo el autor de la revisión puede marcarlos aplicados o descartados, indicando una explicación; también puede devolverlos a pendientes. El autor puede cerrar la revisión, conservando todo el historial e impidiendo nuevas versiones, comentarios y decisiones.

## Persistencia y permisos

Las ocho tablas son privadas. Las ocho vistas verifican membresía activa; cada mutación vuelve a comprobar la sesión y membresía vigentes. Una baja pierde lectura y escritura. Las soluciones, comentarios y revisiones son compartidos con los integrantes activos; el progreso de pistas es personal. No se agrega una excepción de escritura para administradores.

Las mutaciones que crean contenido usan identificadores de envío estables. Repetir un envío igual no crea duplicados; reutilizarlo con datos diferentes se rechaza. Las ediciones de soluciones, nuevas versiones y decisiones exigen la versión esperada. La interfaz conserva los borradores ante rechazo y reutiliza el identificador al reintentar los mismos datos; cambiar el contenido inicia otro envío.

La demo comparte registros entre fuentes que usan el mismo estado y aplica las mismas reglas de lectura, autoría, cierre, concurrencia e idempotencia. Los snapshots son copias: modificarlos no altera el almacenamiento. Estos dos tipos no se añaden a la papelera de los seis tipos previos; su cierre conserva el historial.

## Verificación

Las 28 pruebas de estos módulos pasan: contratos en `packages/core/src/practice.test.ts`, permisos y persistencia de handlers en `packages/spacetime-module/src/practice.test.ts`, sesiones demo en `packages/app/src/data/practice.test.ts`, e interacción React en `packages/app/src/pages/practice.test.tsx`. Cubren pistas privadas, bajas, autores, reintentos, conflictos, líneas de versiones antiguas y renderizado de código como texto.

`node scripts/smoke-spacetime-delivery4.mjs` pasó contra SpacetimeDB 2.12.0 real en el puerto local 3364, con tres integrantes y un intruso ficticios. Cubre el recorrido completo de ambos módulos, once tablas privadas inaccesibles por SQL, reinicio persistente y baja. Incluye Ayuda V2 con el contrato JSON final, edición concurrente, reintentos, historial privado, contacto aceptado y bloqueo de ediciones legacy incluso en publicaciones todavía sin versión. Una edición V2 rechazada también revierte la captura histórica inicial, comprobando el límite transaccional. El runner crea y elimina su propio servidor, claves y datos temporales; no usa Gemini, Maincloud ni servicios externos.
