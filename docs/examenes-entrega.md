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
| Implementación y pruebas de EX-2 | Completada sobre `ff98cc8`: 1 115 pruebas, tipos y compilaciones con Node 22. Integración con cambios publicados posteriores en curso |
| Recorrido persistente con tres identidades sintéticas y reinicio | Aprobado: once grupos, cinco generaciones simuladas y cero llamadas reales |
| Migración aditiva conservando datos | Ensayo desde `ff98cc8` aprobado con `--delete-data=never`; comprobación de producción pendiente |
| Publicación módulo → Worker → Pages | Pendiente de validación y publicación |
| Prueba real de Gemini | No ejecutada; se mantiene pendiente por decisión del usuario |
| Aceptación con cuentas del grupo y dispositivos | Pendiente de participación de sus titulares |

Las pruebas sintéticas no acreditan una llamada real a Gemini ni la aceptación humana. Las evidencias locales se guardan en `artifacts/examenes/`, fuera de Git y sin claves o tokens reales.
