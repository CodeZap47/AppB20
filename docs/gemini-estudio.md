# Gemini BYOK para Aprende enseñando y Repaso

La cuarta entrega amplía el mismo servicio privado de Gemini de la tercera entrega. SpacetimeDB conserva preparaciones, versiones, generaciones y recibos de aceptación; Cloudflare Workers descifra la clave del solicitante para la llamada. No se añade otra base, proveedor o almacenamiento. La configuración de secretos e identidades técnicas sigue en [Gemini BYOK](gemini-byok.md).

## Aprende enseñando, 7.8

Solo el autor de una práctica en curso puede solicitar preguntas clarificadoras desde su explicación **ya guardada**. El servidor elige la revisión completa más reciente; si no existe, utiliza los tres campos de la explicación inicial. Cada combinación concreta recibe una versión privada en `ai_teaching_version`. La preparación conserva los campos, huellas y versiones inmutables; cambiar la explicación exige preparar otra vez.

Se puede seleccionar expresamente una nota o guía adicional de la misma materia. No se leen reflexión, temas personales, respuestas, preguntas del compañero, identidad del revisor, historial, progreso ni mensajes. La vista previa muestra el texto redactado exacto y las omisiones antes del consentimiento por operación. Preparar una vista previa no llama a Gemini.

La respuesta contiene únicamente preguntas y citas de fragmentos existentes; cada pregunta debe citar la explicación guardada. El borrador se guarda privado para el solicitante. Ni un administrador ni el compañero invitado pueden abrirlo. El autor puede editar, seleccionar y confirmar las preguntas: solo entonces se incorporan a `teaching_question`, marcadas como preguntas de Gemini revisadas por él. Después de incorporarlas se aplica la visibilidad habitual de la práctica, por lo que su compañero actualmente invitado puede consultarlas. La incorporación no publica una nota, cambia la explicación ni completa la práctica.

## Repaso espaciado, 7.9

El detalle de una colección permite elegir una nota o guía accesible de la misma materia. El servidor captura su versión y extrae únicamente material autorizado mediante el mismo preparador de la tercera entrega. La IA no recibe respuestas, avances ni historial de revisiones.

Cada tarjeta propuesta contiene pregunta, explicación, pista y citas. La validación rechaza referencias inventadas, duplicados, tamaños excesivos y tarjetas que mezclen fuentes/versiones: cada tarjeta mantiene una referencia concreta. El alumno edita y selecciona los elementos antes de confirmar su incorporación. Una colección del grupo solo admite borradores basados en fuentes del grupo; las notas personales permanecen en colecciones personales. El servidor comprueba nuevamente fuente, permisos, materia, estado y versión de la colección al aceptar.

Las tarjetas aceptadas conservan versión de origen y referencias de fragmento/campo/líneas en su explicación. No se crean revisiones o avances. Se mantienen los intervalos manuales **1, 3, 7, 14, 30, 60 y 120 días**, la opción con pista de **1 día** y el reinicio de **10 minutos**. Los recordatorios usan el mecanismo privado de la tercera entrega.

## Privacidad, consentimiento y reintentos

Se reutilizan AES-GCM con claves maestras versionadas de Cloudflare Secrets, consentimiento individual, política de habilitación, cuota por hora/día y presupuesto estimado. Cada envío requiere revisar y confirmar el texto exacto y el posible consumo de la clave propia. La versión del consentimiento `2026-10-21.2` se actualiza para incluir estas finalidades. La generación permanece desactivada por defecto.

Una generación usa un UUID estable: reintentar no vuelve a invocar al proveedor. Una respuesta incierta conserva el presupuesto y exige reconocer el riesgo antes de otra solicitud. Los borradores se recuperan desde SpacetimeDB al volver a la pantalla; un recibo recuperado identifica también la selección ya incorporada para no volver a ofrecer su inserción.

La aceptación utiliza el procedimiento existente `ai_publish_generation`, con `reviewed: true` y una selección explícita. Las inserciones y el recibo privado `ai_study_acceptance` se guardan en la misma transacción. Un reintento idéntico devuelve el recibo; otro contenido con el mismo borrador se rechaza. La interfaz conserva la misma selección si se pierde la confirmación. Las fuentes se revalidan también al leer el historial y al repetir una aceptación: retirar una fuente o cambiar la explicación impide recuperar el borrador anterior.

No se guardan textos, claves o respuestas de IA en almacenamiento del navegador. Cambiar de cuenta cancela peticiones y desmonta los borradores en memoria. La demo explica el límite y permite seguir con los ejercicios manuales; no pide claves ni envía contenido de estudio a la red.

## Comprobaciones locales

Pruebas enfocadas cubren estructura y citas, selección revisada, idempotencia, privacidad del revisor, cambio de explicación, fuentes personales, progreso intacto y el Worker real bajo Miniflare con proveedor simulado.

```sh
npm test -w @b20/core -- --run src/aiStudyModules.test.ts src/ai.test.ts
npm test -w @b20/spacetime-module -- --run src/ai.test.ts
npm test -w @b20/api -- --run src/ai/worker.test.ts src/ai/provider.test.ts
npm test -w @b20/app -- --run src/components/AiStudyModulePanel.test.tsx src/pages/TeachingPage.test.tsx src/pages/SpacedPage.test.tsx
node scripts/smoke-spacetime-ai-study.mjs
```

El smoke crea un servidor y una base SpacetimeDB locales aislados, identidades y una clave sintéticas, prueba el reinicio y elimina sus datos al aprobar. Usa el puerto 3357, configurable mediante `B20_SMOKE_AI_STUDY_PORT`. El proveedor de prueba devuelve JSON local; **no se envía ninguna llamada a Gemini real**. La validación de Gemini y push con credenciales reales queda para el entorno configurado.

## Versiones manuales de Aprende enseñando

El historial manual es independiente de `ai_teaching_version`. Esta última identifica el texto de una explicación preparado para Gemini; no representa cada guardado ni contiene reflexiones. Las nuevas tablas privadas `teaching_head`, `teaching_revision` y `teaching_intent` conservan las explicaciones inicial y revisada, reflexión, temas de repaso, estado y fecha de cada versión manual. La cabecera y sus revisiones se inicializan de forma perezosa desde la fila existente, antes de sustituirla: no se elimina ni recrea ninguna práctica.

El guardado V2 exige la versión con la que se abrió el formulario y un UUID estable. Dos pestañas que abrieron la misma versión no pueden sobrescribirse: la segunda recibe un conflicto y conserva lo escrito, con una opción explícita para cargar el contenido actual. Un reintento idéntico devuelve su recibo original; reutilizar el UUID para otros textos se rechaza. Guardar el mismo contenido no crea otra versión. Comenzar, completar y reabrir también versionan el estado para invalidar ediciones abiertas; recibir preguntas o cambiar de compañero conserva la versión del texto.

Solo el autor puede solicitar el historial y sus reflexiones: ni su compañero ni un administrador lo reciben. La vista reactiva entrega exclusivamente una cabecera numérica al autor; los cuerpos históricos se consultan bajo demanda. La interfaz muestra las últimas 30 revisiones, también al completar la práctica. El reducer de guardado antiguo rechaza todas las escrituras para impedir que un cliente antiguo eluda el control de concurrencia.

La publicación voluntaria conserva su comportamiento: crea una nota del grupo con la explicación revisada, sin reflexión ni conversación privada. Repetirla abre la misma nota y las ediciones privadas posteriores no la modifican.

El recorrido `node scripts/smoke-spacetime-teaching-versions.mjs` usa un servidor SpacetimeDB real aislado en el puerto 3358. Comprueba dos conexiones del mismo autor, rechazo de versiones antiguas, recibos tras reiniciar, historial exclusivo, SQL privado y revocación por baja. No necesita Gemini ni credenciales reales.
