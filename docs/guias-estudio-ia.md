# Guías de estudio: entrega con Gemini

Fecha: 21 de octubre de 2026. Se conserva el módulo manual y su compendio.

## Recorrido implementado

1. Seleccionar hasta 30 fuentes compartidas de la misma materia y parcial: consignas, trabajos, actividades, evidencias elegidas, notas y preguntas con respuestas públicas. El material sin parcial requiere selección expresa. Las notas personales quedan excluidas de Guías.
2. Preparar adjuntos en el navegador. Se admiten PDF textual, DOCX, TXT, Markdown y código como texto. No se ejecuta código, se siguen enlaces ni se envían originales a Gemini. Páginas, párrafos y líneas se conservan como localizadores. Se explican omisiones y errores.
3. Revisar y guardar la transcripción privada, ligada al archivo, su SHA-256 verificado y la versión del destino. El servidor acredita el vínculo y acceso, no que una transcripción editada sea idéntica al original: se identifica como texto preparado por el alumno.
4. Revisar materia, temario, texto, omisiones, modelo, propietario de la clave y consumo estimado. La preparación no llama al proveedor. La generación usa la clave personal configurada en Ajustes y exige confirmación expresa.
5. Generar un borrador privado. Una selección pequeña usa una llamada directa; las mayores usan lotes de hasta 10 fuentes y 40 000 caracteres y después una síntesis. La guía admite hasta 120 000 caracteres. Los resúmenes solo conservan citas originales válidas.
6. Actualizar la preparación conservando el texto guardado, sin consumo de Gemini, y volver a revisar sus citas antes de publicar. Consultar y retomar los pasos persistidos después de recargar; editar las ocho secciones y sus citas. Cada paso requiere una acción. Un resultado incierto nunca se reenvía automáticamente. Cancelar detiene pasos pendientes y conserva cualquier consumo ya enviado.
7. Publicar explícitamente una guía nueva o una versión de una guía existente. Se comprueban fuentes, clasificación, versión esperada e identificador de publicación en la misma transacción. Un reintento no duplica la guía ni sus puntos.
8. Revisar la versión leída mediante otro compañero, con comentario. Una edición nueva requiere revisión nueva. Restaurar crea una versión y conserva contenido, archivos y procedencia. Las ediciones posteriores a la generación muestran aviso sobre las citas originales.

Los cambios posteriores de una fuente se muestran como desactualización de su versión citada. Una fuente retirada, convertida en personal o inaccesible deja de contar como cobertura disponible. Las guías e historial continúan disponibles según sus permisos; la consulta de procedencia no revela texto retirado.

## Límites

- Almacenamiento: 50 MiB por archivo, sin cambios.
- Extracción: 10 MiB por documento, 200 páginas PDF y 32 MiB de expansión DOCX. Se verifican CRC, expansión real y límites, y se rechazan entidades XML externas y documentos protegidos o incompatibles. No hay recortes silenciosos.
- Gemini: modelo configurado en servidor, inicialmente [`gemini-3.8-flash`](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), sin sustitución automática. Salida por llamada elegida entre 256 y 8 000 tokens; la prueba de cierre usará 1 500. El consumo real puede incluir razonamiento.
- Cuota compartida con EX-1: una llamada simultánea por persona, cinco por hora, diez por día y 100 000 tokens estimados diarios inicialmente. Cada llamada cuenta. Las reservas inciertas se conservan; el avance no se pierde por falta de cuota.

## Datos y servicios

Se reutilizan las tablas privadas, AES-256-GCM, consentimiento y reservas de EX-1. Las maestras versionadas y el token técnico exclusivo de IA se configuran como secretos de Cloudflare. Ninguna suscripción entrega claves, cifrados, transcripciones ni contenido de borradores. Las listas privadas solo devuelven resúmenes; consultar contenido revalida acceso.

Tablas aditivas: `guide_ai_transcription`, `guide_ai_draft`, `guide_ai_provenance`. Vista derivada pública autorizada: `guide_ai_source_availability`, solo metadatos de cobertura. Identificadores actuales de guías y materiales conservados.

`guide_ai` contiene operaciones autenticadas de preparación, borrador, pasos y publicación. El servicio restringido solo puede reclamar/finalizar un envío autorizado; los alumnos no pueden obtener claves cifradas ni registrar resultados del proveedor.

El Worker Hono comparte autenticación y contratos de EX-1. Las rutas `/ai/study-guides` son independientes de `/files`. `apps/api/wrangler.ai.jsonc` permite publicar el servicio IA sin R2 en la cuenta propietaria de Pages; el Worker heredado de archivos conserva su configuración. `VITE_AI_API_URL` selecciona el servicio IA y `VITE_API_URL` mantiene la compatibilidad con archivos anteriores. No se añade otra base ni almacenamiento de documentos.

## Validación reproducible

Usar Node 22 y SpacetimeDB 2.12.

- Tipos, pruebas y compilaciones de las presentaciones afectadas.
- Pruebas del proveedor y de Hono con Gemini simulado; recorrido real del runtime Cloudflare sin R2.
- Extracción con bytes PDF y DOCX, texto vacío, escaneos, protección, corrupción, límites, CRC, ZIP expansivo, entidades XML, localizadores y cancelación.
- Reglas de tres identidades: claves/borradores privados, bajas, fuentes retiradas, versiones, revisiones, publicaciones duplicadas y consumo compartido.
- `npm run test:spacetime:guides`: servidor aislado persistente, reinicio entre pasos, archivos nativos y revisión/restauración. Variable opcional `B20_SMOKE_GUIDES_BASELINE` apunta a un bundle previamente publicado para ensayar la actualización con `--delete-data=never` conservando una nota y una guía manual anteriores.

## Registro de cierre

| Comprobación | Estado |
|---|---|
| Implementación y validación local | Completada: 1 078 pruebas, tipos y compilaciones con Node 22; migración aditiva y reinicio persistente aprobados |
| Despliegue SpacetimeDB → Worker → Pages | Módulo y Worker publicados; Pages en preparación |
| Prueba real Gemini, dos fuentes ≤10 000 caracteres, salida ≤1 500 tokens, una llamada | Pendiente de clave en Ajustes y confirmación de la vista previa |
| Aceptación con cuentas del grupo después de recargar | Pendiente de participación de sus titulares |

No se ha realizado ninguna llamada real a Gemini durante las pruebas automáticas. La simulación no se importa como contenido del grupo. EX-2, EX-3 y los demás módulos quedan fuera de esta entrega.

Integración final sobre `cda8030` (versión publicada de Salas y Exposiciones), en la rama aislada `codex/guias-estudio`. Las pruebas globales aprobaron 572 casos de la app, 112 de contratos, 254 del módulo, 95 de la API y 45 de la web. El ensayo persistente aprobó diez grupos de comprobaciones y siete pasos simulados, con cero llamadas reales a Gemini.

Despliegue del módulo: `--delete-data=never`, base `app-b20-34245`. Se compararon las 88 tablas previas y sus 290 registros: no cambió ni faltó ninguno. Servicio IA: https://app-b20-ai.aguaseero.workers.dev, comprobado saludable y con rechazo 401 sin sesión. Las credenciales técnicas temporales se eliminaron después de confirmar su almacenamiento en Cloudflare Secrets.

Para activar el servicio del grupo adulto confirmado se publica con `wrangler deploy --config apps/api/wrangler.ai.jsonc --var AI_ENABLED:true`; el archivo conserva el valor predeterminado desactivado para instalaciones nuevas. El servicio de archivos anterior continúa separado.
