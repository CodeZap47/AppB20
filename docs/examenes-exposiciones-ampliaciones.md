# Exámenes EX-3 y Exposiciones con Gemini y audio

Implementación local del **26 de octubre de 2026**. Esta entrega prepara código,
contratos y compilaciones para revisión. **No se ha desplegado en producción ni se han
realizado llamadas reales a Gemini.** Las pruebas usan datos e identidades sintéticos.

## Exámenes

- EX-3A incorpora preguntas con respuestas elegidas expresamente, tarjetas de Repaso y
  explicaciones propias guardadas de Aprende enseñando. Se excluyen reflexión, progreso,
  mensajes y contenido privado ajeno. Las respuestas aceptadas no se tratan como garantía
  de exactitud; las citas conservan sus dependencias individuales.
- «Enviar esta pregunta a Repaso» permite revisar pregunta, explicación y pista desde un
  intento propio cerrado. Crea una tarjeta personal con origen en examen/versión/pregunta.
  Repetir la operación conserva la tarjeta y no modifica su progreso o intervalos.
- EX-3B reutiliza el extractor de Guías para PDF textual, DOCX, texto y código. Los
  documentos admiten hasta 10 MiB, 200 páginas PDF, 32 MiB DOCX descomprimido y 120.000
  caracteres preparados; la selección de cada generación de examen conserva 40.000
  caracteres como máximo. No se recorta texto automáticamente.
- El OCR opcional envía solo las páginas seleccionadas del PDF o la imagen original,
  hasta cinco páginas por lote, con vista previa y confirmación. Es necesario revisar
  el texto y sus localizadores antes de usarlo. Las huellas de archivos heredados se
  acreditan descargando el original autorizado en el Worker.
- EX-3C añade un banco privado con publicación voluntaria, versiones y copias a borradores
  independientes. El catálogo no incluye soluciones. Las variantes respetan temario,
  dificultad, tipos y pesos; usan una semilla reproducible, evitan duplicados y muestran
  el déficit si no alcanzan las preguntas. La regeneración con Gemini sigue siendo expresa.
- EX-3D admite respuestas abiertas, referencia y rúbrica versionadas. El solucionario
  abierto se revela al cerrar el intento. La evaluación manual corresponde a su dueño;
  una sugerencia de Gemini se consulta, revisa y acepta o ajusta expresamente. El resultado
  abierto queda separado del de preguntas cerradas y los pendientes no cuentan como cero.

Las versiones e intentos EX-2 existentes conservan su corrección. Retirar una fuente o
perder acceso oculta su contenido derivado sin recalcular los resultados ya guardados.

## Exposiciones

Gemini prepara esquemas editables, preguntas, comentarios orientativos y transcripciones
con marcas de tiempo. La preparación muestra contexto y consumo; no envía automáticamente
el ensayo. Las autoobservaciones y los siguientes pasos quedan fuera del envío. Sin
material académico, el esquema se identifica como orientativo.

Cada intento admite una grabación de hasta **20 minutos y 10 MiB**: grabar, detener,
escuchar, descartar o subir un archivo. Los formatos iniciales son WebM/Opus, MP4/M4A,
MP3, OGG y WAV compatibles. El Worker comprueba contenedor, duración y huella del audio;
el nombre y el tipo declarado por el cliente no acreditan su validez. WebM/Opus se verifica desde sus bloques y paquetes incluso cuando la grabación de Chrome no incluye duración en la cabecera. Si no se puede
grabar en un dispositivo, permanece disponible subir un archivo. Android declara los permisos de micrófono que Capacitor solicita al grabar y no exige disponer de ese hardware para instalar la app.

El audio usa tablas privadas y bloques de 1 MiB, compartiendo el espacio reservado de
archivos existente. No genera puntos, novedades ni registros públicos. Se puede concluir
un intento con texto o audio confirmado sin configurar Gemini. Al concluir, el conjunto
de audio queda fijo y el siguiente intento no copia las grabaciones.

El autor conserva el audio hasta eliminarlo. Compartirlo exige autorizar al revisor actual
y solo funciona sobre un intento concluido; cambiar o retirar al revisor, o archivar la
práctica, revoca la autorización. Los administradores no tienen acceso excepcional.
Eliminar audio libera sus bytes y permisos, deja un marcador histórico y conserva las
transcripciones y comentarios ya aceptados. Una respuesta tardía no reconstruye el audio.
Al purgar una fuente académica también se elimina el texto original guardado en los
borradores de Exposiciones, se cancelan resultados pendientes y se impide que una
respuesta tardía vuelva a guardarlos. El trabajo ya aceptado se conserva como copia
independiente del autor.

## Contratos y migración preparados

- Procedimientos nuevos: `document_preparation`, `exam_evaluation_ai`, `presentation_ai`
  y `presentation_media`; nuevas acciones en `exam_action` para banco, variantes,
  evaluación abierta y tarjetas de Repaso.
- Rutas autenticadas: `/ai/documents`, `/ai/exam-evaluations` y `/ai/presentations`.
  Los contratos TypeScript del cliente se generan desde el módulo.
- Tablas nuevas privadas: tres documentales, dos de banco, una de evaluación abierta,
  una de procedencia de Repaso y cuatro de audio/IA de Exposiciones. No se sustituyen
  tablas existentes ni se requieren reinicios o importaciones de fixtures.
- Se reutilizan los secretos y el modelo Gemini vigentes, la clave personal cifrada,
  el consentimiento, las cuotas por persona y el control de una llamada simultánea.
  Un resultado incierto no se reenvía automáticamente ni libera el consumo reservado.
- Dependencias fijadas: `music-metadata` 12.3.2 para contenedores de audio y `pdf-lib`
  1.17.1 para extraer las páginas PDF seleccionadas antes del OCR.
- El Worker de IA incorpora el binding `FILES` del bucket existente `app-b20-files`
  para comprobar documentos heredados. Los documentos nativos siguen en SpacetimeDB.
  Este cambio de configuración no crea un bucket ni despliega servicios.

La comparación local con el esquema guardado de la publicación del 24 de octubre
confirma **168 → 179 tablas: 11 añadidas, ninguna retirada y ninguna modificada**.
Se resolvieron las referencias de tipos antes de comparar columnas, índices, claves,
restricciones, secuencias, accesos y valores predeterminados. Las tablas nuevas son
privadas. Esta evidencia prepara la actualización aditiva; no equivale a ensayar una
migración de los datos de producción.

Orden para una publicación posterior: conservar e integrar el estado local completo;
comparar esquema y huellas de datos; publicar el módulo con `--delete-data=never`;
publicar el Worker con la configuración de IA revisada; publicar la web y verificar el
dominio principal. Comparar los datos anteriores después de actualizar. No reconstruir
la versión desde un commit que omita los cambios locales ya publicados el 24 de octubre.

## Verificación y aceptación

Las pruebas cubren fuentes privadas y retiradas, respuestas seleccionadas, procedencia
de documentos, OCR revisable, permisos del banco, variantes, soluciones por fase,
evaluación privada, cuotas compartidas, idempotencia, archivos corruptos, límites,
revocación del revisor y eliminación de audio.

Los recorridos de Exámenes y Exposiciones usan servidores SpacetimeDB 2.12 aislados y
reinicios reales. Incluyen documentos/OCR, banco, abiertas, transcripciones y audio
persistentes; ninguna comprobación usa datos de producción ni una clave Gemini real.
Los comandos de validación son los del proyecto: pruebas, tipos, compilaciones,
`test:spacetime:exams` y `test:spacetime:presentations`.

Resultado final local con **Node.js 22.23.3 y SpacetimeDB 2.12.0**:

| Comprobación | Evidencia |
| --- | --- |
| Suite completa | 2.059 pruebas aprobadas en 230 archivos: aplicación 1.095, núcleo 205, módulo 484, API 211 y web 64. |
| Tipos | `npm run typecheck` completo, sin errores. |
| Web/PWA, extensión y Workers | `npm run build` correcto; Workers preparados mediante compilación sin despliegue. |
| Android/Capacitor | `npm run build:android` correcto: compilación web específica y sincronización del proyecto nativo. |
| Android nativo | `assembleDebug` correcto: APK de prueba de 7,3 MiB, JDK 21, Gradle 8.14.3; inspección confirma permisos de micrófono y Android mínimo 24/objetivo 36. Sin instalación ni distribución. |
| Cloudflare Pages | `npm run build:pages` correcto con configuración pública de producción y acceso de desarrollo desactivado. |
| Exámenes persistentes | 14 comprobaciones, siete respuestas sintéticas del proveedor, cero llamadas reales a Gemini. |
| Exposiciones persistentes | Nueve comprobaciones con audio, transcripción, reinicio, revocación y eliminación. |

Las compilaciones finales de web, extensión y Android utilizan la configuración pública
de publicación, con `VITE_DEV_AUTH_BYPASS=false`, sin modificar `.env.local`.

Evidencia por subhito:

| Subhito | Pruebas principales |
| --- | --- |
| EX-3A y procedencia privada | `packages/spacetime-module/src/exam.test.ts`, `packages/app/src/data/demoExams.test.ts` y `packages/app/src/lib/examSourceSelection.test.ts`. Incluyen retirada de una respuesta seleccionada sin invalidar sus fuentes hermanas y tarjetas sin alterar intervalos. |
| EX-3B, extracción y OCR | `packages/spacetime-module/src/document.test.ts`, `apps/api/src/ai/documentRoutes.test.ts`, `apps/api/src/ai/documentProvider.test.ts`, `packages/app/src/data/demoDocuments.test.ts` y `packages/app/src/lib/documentExtraction.test.ts`. |
| EX-3C/D, banco y abiertas | `packages/core/src/exams.test.ts`, `packages/spacetime-module/src/exam.test.ts` y `apps/api/src/ai/examEvaluationRoutes.test.ts`; recorrido persistente `scripts/smoke-spacetime-exams.client.ts`. |
| IA y audio de Exposiciones | `packages/spacetime-module/src/presentationFeatures.test.ts`, `packages/app/src/data/presentation.demo.test.ts`, `packages/app/src/components/PresentationFeatures.test.tsx`, `apps/api/src/ai/presentationRoutes.test.ts`, `apps/api/src/ai/presentationProvider.test.ts` y `apps/api/src/ai/webmAudioDuration.test.ts`. |

La entrega local se conserva en `artifacts/examenes-exposiciones-2026-10-26/`, con
resultados, huellas de compilaciones y un archivo del código completo, incluidos los
cambios locales anteriores. El archivo excluye dependencias, datos y secretos de entorno;
se reconstruye instalando `package-lock.json` con Node.js 22. Los registros detallados
permiten distinguir las comprobaciones automáticas de la aceptación humana pendiente.

Quedan separadas la publicación, la prueba real de Gemini por su titular y la aceptación
en web/PWA, extensión y Android, especialmente permisos de micrófono, formatos grabados
en dispositivos reales y reproducción. El APK debug generado permite pruebas; la
preparación y distribución de una versión firmada de publicación siguen pendientes.

| Prueba real pendiente | Participación necesaria |
| --- | --- |
| Extracción/OCR, variantes y sugerencia de evaluación con Gemini; revisar consumo y aceptar el borrador | Titular de la clave BYOK y documentos que pueda enviar. |
| Esquema, preguntas, transcripción y comentarios orales con referencias temporales | Titular de la clave BYOK y autor de un ensayo propio. |
| Micrófono concedido/denegado, grabación, reproducción y carga en web/PWA, extensión y Android | Titular de cada dispositivo; incluir los formatos que graba cada navegador. |
| Autorización expresa, cambio de revisor y borrado del audio conservando la transcripción aceptada | Autor y revisor con cuentas reales. |

Ninguna de estas pruebas se marca como realizada por compilar el código o usar un
proveedor sintético. La publicación futura debe registrar su propio recibo de
conservación de datos y comprobación del dominio principal.
