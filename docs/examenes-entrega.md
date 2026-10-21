# Exámenes de estudio: recorrido completo

Alcance confirmado el 21 de octubre de 2026: generación, revisión, práctica, simulacro y resultados privados (EX-2). Las ampliaciones de OCR, respuestas abiertas y evaluación asistida quedan para después. Se mantienen SpacetimeDB, SpacetimeAuth, Cloudflare Pages y el Worker compartido de IA.

## Recorrido y reglas

- Elegir materia, parcial, temario, cantidad, tipos (opción única y verdadero/falso), dificultad, pesos por tema y tiempo opcional. Las notas personales propias y el material sin parcial requieren selección expresa. La selección inicial usa los seis tipos de fuentes ya autorizados por EX-1, incluidos los adjuntos de texto UTF-8 compatibles de hasta 256 KiB que muestra su preparación compartida. Las fuentes adicionales y la extracción de PDF/DOCX de Guías conservan su recorrido separado.
- Preparar y revisar fuentes, fragmentos, omisiones, cobertura, modelo y estimación antes de confirmar una generación. Se reutilizan la clave personal cifrada, consentimiento, reservas y límites de Gemini. No se llama al proveedor al abrir una pantalla ni al resolver un examen guardado.
- Recuperar generaciones propias después de recargar. Un resultado incierto se consulta antes de crear otro envío; repetir su identificador no vuelve a llamar al proveedor. La importación a Exámenes usa el resultado persistido y autorizado, no un solucionario declarado por el navegador.
- Revisar y editar el borrador privado, eliminar preguntas o regenerar una selección con nueva vista previa y confirmación. Aprobar exige revisar las preguntas restantes. El servidor valida opciones, respuesta, explicación, tema y citas; una cita válida acredita procedencia, no garantiza la verdad académica de una respuesta.
- Aprobar fija una versión. Editarla crea un borrador nuevo; los intentos anteriores conservan su versión, orden y corrección. El control de revisión esperada detecta cambios concurrentes.
- Compartir un examen nuevo es una acción distinta de aprobar y se permite únicamente con fuentes de grupo accesibles. Si el examen ya está compartido, aprobar una versión nueva actualiza ese examen: el botón advierte expresamente el efecto. Una versión con una fuente personal queda privada incluso si sustituye una versión compartida; compartirla exige preparar otra versión a partir de copias publicadas voluntariamente.
- En práctica, confirmar una respuesta es irreversible y revela su explicación. En simulacro, las respuestas pueden editarse hasta el cierre y las soluciones se entregan después. El servidor fija el vencimiento y lo conserva al reanudar.
- La corrección da un punto por acierto y cero por error o pregunta sin responder, sin penalización. Se guardan aciertos, total, porcentaje y desglose por tema. Los intentos y resultados son exclusivos de quien resuelve: tampoco los lee el autor del examen ni la administración.
- Retirar una fuente o perder acceso bloquea nuevos intentos y oculta el contenido afectado al consultar intentos históricos. Volver privado un examen también oculta sus preguntas a otros participantes. El resultado numérico privado se conserva. Archivar impide intentos nuevos y conserva los históricos de quienes siguen autorizados. Una edición ordinaria de la fuente muestra desactualización sin recalificar.

Ninguna generación, edición, resolución o resultado de Exámenes añade puntos, clasificaciones ni novedades públicas. Los ejemplos de la simulación permanecen aislados y no se importan al grupo.

## Servicios

`exam_action` concentra las operaciones autenticadas y transaccionales del módulo, con tablas privadas y respuestas según la fase. El Worker expone `POST /ai/exams`, transmite la sesión del alumno y no usa la identidad técnica para leer exámenes o resolver intentos. Estas operaciones funcionan aunque la IA esté desactivada o no haya clave personal. Preparación y generación reutilizan `/ai/preparations` y `/ai/generations`.

El modelo sigue configurado en el servidor; no hay sustitución automática. La distribución por tema se incorpora al mensaje y se valida al recibir la respuesta. Las estimaciones incluyen el contenido serializado enviado, además de la salida prevista. Una llamada incierta no se reintenta automáticamente.

La interfaz revalida el acceso al abrir o reanudar, al recuperar el foco y cada 15 segundos mientras está visible. Los cambios de fuentes y membresía recibidos por la suscripción ocultan inmediatamente el contenido afectado. Las selecciones sin guardar se conservan al guardar otra respuesta y al consultar; si cambió una revisión remota, se exige recargar antes de sobrescribir. Cada operación vuelve a comprobar permisos y fase en el servidor.

## Registro de cierre

| Comprobación | Estado |
| --- | --- |
| Implementación y pruebas de EX-2 | Completada e integrada sobre producción `00f761d`: 1 266 pruebas, tipos y compilaciones con Node 22 (web/PWA, Pages, extensión y ambos Workers) |
| Recorrido persistente con tres identidades sintéticas y reinicio | Aprobado sobre `00f761d`: once grupos, cinco generaciones simuladas y cero llamadas reales; también pasó el recorrido persistente de retención |
| Migración aditiva conservando datos | Ensayo desde `00f761d` y producción aprobados con `--delete-data=never`: 112 → 117 tablas, cinco nuevas privadas; los 310 registros de las 112 tablas anteriores permanecieron idénticos |
| Publicación módulo → Worker → Pages | Publicado el 21 de octubre de 2026; `/health` correcto, acceso anónimo rechazado y 16 archivos públicos idénticos a la compilación |
| Prueba real de Gemini | No ejecutada; se mantiene pendiente por decisión del usuario |
| Aceptación con cuentas del grupo y dispositivos | Pendiente de participación de sus titulares |

Las pruebas sintéticas no acreditan una llamada real a Gemini ni la aceptación humana. Las evidencias locales se guardan en `artifacts/examenes/`, fuera de Git y sin claves o tokens reales.


## Recibo de publicación

- Revisión publicada: `03876936aa17a3461c460d938fee192821c3af15`, ramas `codex/examenes` y `codex/pages-spacetimeauth` en GitHub. La integración parte de `00f761d`, conserva Guías, navegación Slim, avisos y retención. No incorpora ni modifica los trabajos independientes todavía no publicados en otras ramas.
- Módulo `app-b20-34245`: SHA-256 del bundle `fb74d8dcbb182351d959d6eea3baa2c8deac352f9eb1da3a554b658564015368`. Migración aditiva sin tablas eliminadas ni sustitución de IDs existentes.
- Worker `app-b20-ai`: versión `df550c84-398b-4d9f-9624-9af77aadbc18`, conserva la configuración, secretos y programación de avisos existentes. El Worker heredado de R2 permanece independiente.
- Pages: despliegue de producción `0f7b8620-554f-4c11-96a1-e0c78ef3733f`, dominio [Exámenes](https://app-b20.pages.dev/#/m/examenes). Comprobadas las huellas de sus 16 archivos públicos, incluido el HTML y el service worker.
- Web real: acceso renovado con la sesión titular, catálogo privado consultado después de recargar, acceso desde navegación verificado y formulario de preparación visible; confirma `gemini-3.8-flash` y clave personal sin configurar. Guías y Avisos siguieron disponibles con la sesión real. No se crearon exámenes ni ejemplos en el grupo, ni se enviaron fuentes a Gemini.
- Pruebas finales: app 641, core 130, módulo 311, API 133 y web 51 (1 266 en total); tipos y compilaciones con Node 22. Ensayo persistente de Exámenes desde producción, once grupos con tres identidades sintéticas y reinicio; ensayo persistente de retención aprobado. Cero llamadas reales de Gemini.

El uso con varios compañeros y dispositivos sigue siendo aceptación humana pendiente; no se confunde con las pruebas automatizadas ni con la comprobación de una sesión titular.
