# Estado del proyecto y matriz de requisitos

Fuente de alcance: [definicion-del-proyecto.md](definicion-del-proyecto.md).
Actualizado tras la publicación conjunta del **21 de octubre de 2026**. Este documento
separa implementación, publicación y aceptación con personas y dispositivos reales.

## Ampliaciones locales del 26 de octubre de 2026

Exámenes EX-3A/B/C/D y Exposiciones con Gemini y audio están implementados localmente. Incluyen nuevas fuentes, documentos/OCR, banco/variantes, respuestas abiertas y evaluación asistida; esquemas, preguntas, comentarios, transcripción y audio privado. [Alcance y preparación de publicación](examenes-exposiciones-ampliaciones.md). La publicación y la aceptación humana siguen pendientes; las tablas inferiores describen la versión publicada y las ampliaciones que todavía falta llevar a producción.

## Publicación comprobada

La [web de B20](https://app-b20.pages.dev/) sirve la cuarta entrega, Guías, Exámenes EX-2,
Exposiciones, la navegación Slim y la mensajería de Untitled UI. La revisión comprobada
al cierre de la sincronización fue `f16e8f5`, en `main` y `codex/pages-spacetimeauth`.
El [registro de sincronización](sincronizacion-2026-10-21.md) conserva las evidencias.

- **SpacetimeDB y SpacetimeAuth:** datos, archivos privados y membresía en Maincloud.
  La publicación pasó de 117 a 139 tablas y conservó exactamente los 310 registros
  existentes; las 22 tablas añadidas estaban vacías al comprobar la actualización.
- **Cloudflare Pages y Worker de IA:** publicados y comprobados. El servicio BYOK,
  los secretos y VAPID están configurados; el programador de avisos está operativo.
  La generación requiere consentimiento, clave personal y confirmación de cada envío.
- **Comprobaciones de código:** 1.401 pruebas aprobadas en 156 archivos, tipos y
  compilaciones correctos y cinco recorridos con SpacetimeDB local aislado.
- **Comprobaciones de publicación:** programa remoto idéntico al compilado, conservación
  de datos, salud/autenticación/CORS y 16 archivos web idénticos a la compilación.

**Publicado** indica una implementación desplegada y comprobada; **pendiente** indica
funciones aún no implementadas. Una **ampliación posterior** añade alcance a una versión
existente. La **validación pendiente** requiere personas, claves o dispositivos reales y
no implica por sí sola que falte publicar el código.

## Módulos completos pendientes: entrega 5

Estos son los tres módulos del catálogo que todavía no tienen una implementación disponible.

| Sección | Módulo | Trabajo por implementar |
| --- | --- | --- |
| 3.11 | Lenguaje de señales | Diccionario versionado para los tres medios definidos, constructor, ejercicios individuales y en parejas, historial privado y fichas con fuentes. |
| 7.6 | Microproyectos | Propuestas, participación, integrantes y responsabilidades, tablero propio, vínculos a materiales y código, demostración y cierre con contribuciones. |
| 7.11 | Préstamo de materiales | Catálogo con propietario y disponibilidad, solicitud y acuerdo privado, reserva, entrega y devolución; impedir dos préstamos activos del mismo objeto. |

Exposiciones ya tiene una versión por texto publicada; sus ampliaciones se enumeran abajo.
Las actividades de clase se incluyen en Tareas y Actividades y no requieren otro módulo.

## Ampliaciones posteriores de módulos existentes

| Módulo | Ampliación pendiente | Alcance de la versión publicada |
| --- | --- | --- |
| ¿Qué me perdí? (7.1) | Resumen opcional de novedades con Gemini, solicitado por el usuario y limitado a contenido autorizado. | Listado de novedades y enlaces sin IA. |
| Revisión de código (7.5) | Revisión opcional con IA, con decisión final del autor. | Fragmentos/enlaces, versiones y observaciones por líneas entre compañeros. |
| Exposiciones (7.10) | Generación con Gemini y evaluación posterior de audio con consentimiento y reglas de conservación. | Ensayos por texto, preguntas locales, versiones y revisor voluntario. |
| Exámenes EX-3A | Fuentes de Preguntas y respuestas, Repaso y Aprende enseñando; envío voluntario de errores a tarjetas privadas. | EX-2: preparación, generación, revisión, versiones, práctica/simulacro y resultados privados. |
| Exámenes EX-3B | Extracción propia de PDF con texto/documentos e imágenes o escaneos con OCR, límites y citas por ubicación. | Exámenes admite los adjuntos UTF-8 compatibles de su preparación compartida. Guías ya extrae PDF textual y DOCX en su recorrido independiente. |
| Exámenes EX-3C | Banco reutilizable de preguntas y variantes con procedencia, versiones y permisos. | Exámenes guardados y versionados; no equivale a un banco reutilizable entre exámenes. |
| Exámenes EX-3D | Respuestas abiertas con rúbrica y revisión manual; evaluación asistida por IA opcional. | Opción única y verdadero/falso con corrección determinista. |

Los subhitos de [EX-3](examenes-ia.md#ex-3--ampliaciones-en-subhitos-independientes)
quedan fuera del alcance confirmado de EX-2 y se priorizan por separado.
Videollamadas y editor de código en vivo en Salas, ejecución de código de usuarios en Retos
e integración automática con Git no forman parte de las primeras versiones publicadas.
No se cuentan como módulos completos pendientes ni como requisitos para cerrar esas versiones.

## Módulos base (sección 3)

| Sección | Implementación publicada o planificada | Trabajo pendiente | Próximo paso |
| --- | --- | --- | --- |
| 3.1 Mensajes y stickers | Publicados: canales, directos con archivos privados, menciones, lectura, silencio, bloqueo, reportes selectivos y stickers nativos; nueva interfaz Untitled UI. Avisos y Web Push configurados. | Aceptación con el grupo y recepción real en dispositivos compatibles. | Validación humana y de dispositivos. |
| 3.2 Tareas y Actividades | Parcial publicado: consignas compartidas, trabajos por alumno/equipo, avance privado, estados, revisiones e historial de trabajos. | Cerrar la validación de permisos, coautorías, historial y archivos con el grupo y resolver los huecos que identifique ese recorrido. | Validación y cierre del recorrido. |
| 3.3 Actividades de clase | Publicadas dentro de Tareas: evidencias, comentarios, vínculos y recuperación de adjuntos retirados por su autor. | Verificar archivos, versiones y permisos por equipo. La recuperación de adjuntos no implica historial completo del texto. | Validación del recorrido. |
| 3.4 Notas de clase | Publicadas: editor estructurado, imágenes privadas bajo demanda, sesión/parcial, vínculos y versiones; publicar una nota personal crea una copia independiente. | Aceptación con el grupo. | Validación humana. |
| 3.5 Guías integrales | Publicadas: guías manuales, compendio e historial; preparación local de PDF textual, DOCX y texto/código; Gemini BYOK, borradores privados, cobertura y fuentes versionadas. [Detalle](guias-estudio-ia.md). | Prueba real de Gemini y aceptación con cuentas del grupo. Los archivos incompatibles siguen como omisiones explícitas. | Validación humana y de Gemini. |
| 3.6 Contribuciones | Publicadas: desglose verificable, exclusión de borradores/retirados/duplicados, límites por periodo y recuperación del crédito al restaurar. | Acordar y ajustar la puntuación mediante una prueba con el grupo. | Validación de reglas y utilidad. |
| 3.7 Preguntas | Publicadas: adjuntos privados, aclaraciones, utilidad por integrante y referencias; aceptación y reapertura. | Aceptación con el grupo. | Validación humana. |
| 3.8 Votaciones | Publicadas: nominales con elegibles y cierre, novedades y recordatorios; planificador configurado. | Validar recordatorios y recepción con datos y dispositivos reales. | Validación de extremo a extremo. |
| 3.9 Perfiles | Publicados: presentación voluntaria, foto privada, intereses, conocimientos, portafolio HTTPS, materias, equipo, archivo académico y contribuciones. | Aceptación con materiales de cada alumno; integración de microproyectos cuando exista 7.6. | Validación humana; entrega 5 para microproyectos. |
| 3.10 Cumpleaños | Publicados: día/mes voluntarios, calendario mensual/anual, 29 de febrero, zona, preferencias y deduplicación; planificador configurado. | Validar preferencias y recepción real con el grupo. | Validación humana y de dispositivos. |
| 3.11 Lenguaje de señales | Pendiente: presente en catálogo, sin pantalla propia. | Implementar el módulo descrito en la tabla de entrega 5. | Entrega 5. |
| 3.12 Exámenes de estudio | EX-2 publicado: configuración, Gemini BYOK, borradores/revisión/versiones, práctica/simulacro, reloj del servidor y resultados privados. [Registro](examenes-entrega.md). | Prueba real de Gemini y aceptación con titulares de cuentas/dispositivos. EX-3 es una ampliación posterior separada. | Aceptación de EX-2; priorización de EX-3. |

## Funciones adicionales (sección 7)

| Sección | Implementación publicada o planificada | Trabajo pendiente | Próximo paso |
| --- | --- | --- | --- |
| 7.1 ¿Qué me perdí? | Publicado: novedades de materiales, guías, votaciones, ayuda y colecciones grupales; excluye retirados y contenido personal. Lectura de chats separada. | Aceptación con el grupo y resumen opcional con Gemini. | Validación; ampliación IA posterior. |
| 7.2 Salas de estudio | [Publicadas sin IA](salas-de-estudio.md): abiertas/privadas, agenda, cupo, invitaciones, materiales, chat, temporizador y resumen publicable. | Aceptación con varias cuentas reales. Videollamadas y editor en vivo fuera del alcance de esta versión. | Validación humana. |
| 7.3 Ayuda | Publicada: ofertas/solicitudes, filtros, contactos privados y conversión a Salas; edición con versión, reintentos idempotentes e historial propio. | Validación con cuentas reales del grupo. | Validación humana. |
| 7.4 Retos | [Publicados](retos-revision.md): temas/dificultad, ejemplos, pistas progresivas privadas, soluciones explicadas, comentarios y cierre colectivo. | Recorrido con el grupo. No ejecuta código. | Validación humana. |
| 7.5 Revisión de código | [Publicada](retos-revision.md): código/enlaces HTTPS, versiones inmutables, observaciones por líneas y resolución por el autor. | Recorrido con el grupo; revisión opcional con IA posterior. | Validación; ampliación IA posterior. |
| 7.6 Microproyectos | Pendiente. | Implementar el módulo descrito en la tabla de entrega 5. | Entrega 5. |
| 7.7 Museo de bugs | [Publicado](museo-oportunidades.md): plantilla y versiones sobre Preguntas, etiquetas, referencias y discusión; retiro y purga del origen. | Recorrido con casos aportados por el grupo. | Validación humana. |
| 7.8 Aprende enseñando | Publicado: práctica manual privada, control de concurrencia e historial; preguntas Gemini BYOK desde explicación guardada/versionada, borrador y aceptación expresa; publicación voluntaria de una nota. | Prueba real de Gemini y validación con participantes. | Validación humana y de Gemini. |
| 7.9 Repaso espaciado | Publicado: colecciones, tarjetas, cola/historial privados, recordatorios y borradores Gemini con fuente/versiones y aceptación atómica; intervalos 1/3/7/14/30/60/120. | Validar generación real y recordatorios en dispositivos. La conexión adicional con Exámenes corresponde a EX-3A. | Validación; integración EX-3A posterior. |
| 7.10 Exposiciones | [Publicadas por texto](exposiciones.md): ensayos versionados, preguntas locales, observaciones privadas y revisor voluntario. | Audio y generación con Gemini posteriores; aceptación con compañeros. | Validación; ampliaciones posteriores. |
| 7.11 Préstamos | Pendiente. | Implementar el módulo descrito en la tabla de entrega 5. | Entrega 5. |
| 7.12 Oportunidades | [Publicadas](museo-oportunidades.md): fichas manuales con fuente, filtros/plazos, interés privado, contacto explícito, correcciones y reportes resolubles. | Recorrido con el grupo; enlace a microproyectos cuando exista 7.6. | Validación humana; integración con entrega 5. |

## Validaciones y requisitos compartidos pendientes

| Área | Estado publicado y comprobaciones que faltan |
| --- | --- |
| Acceso, permisos y membresía | Autenticación real e invitaciones publicadas. Las pruebas aisladas cubren varias identidades; falta aceptación con autor, compañero y tercero reales, bajas/caducidad y acceso privado. |
| Datos académicos y archivos | Archivos nativos privados de hasta 50 MiB, fragmentos de 1 MiB, reservas, cuotas, reanudación y cancelación publicados. Conservación durante actualización comprobada. Falta cerrar el recorrido del grupo con coautorías, versiones y archivos reales; conservar la compatibilidad R2 mientras existan objetos heredados. |
| BYOK y Gemini | Servicio común publicado y configurado, con claves personales cifradas, consentimiento y presupuestos compartidos. La prueba real de Gemini sigue pendiente por decisión del usuario; no se necesita desplegar otra vez para hacerla. |
| Avisos y programación | Bandeja, preferencias, cola, deduplicación y Web Push publicados; secretos/VAPID configurados y cron de avisos observado. Falta registrar instalaciones con autorización de sus titulares y comprobar la entrega real. |
| Papelera y conservación | Publicadas: recuperación durante 30 días y purga programada en SpacetimeDB, con limpieza de dependencias y referencias. El respaldo opcional de mantenimiento del Worker no está activado; esto no desactiva el programador interno. Falta aceptación humana del recorrido de recuperación. |
| Moderación y retiro | Reportes selectivos y retiro/restauración según cada módulo publicados y probados con identidades sintéticas. Validar criterios y permisos con el grupo sin exponer conversaciones privadas. |
| PWA, extensión y APK | Código compartido y compilaciones comprobados. Faltan aceptación en dispositivos, autenticación/callbacks por presentación y preparación, firma y distribución del APK. El push nativo con el APK Android cerrado sigue pendiente de una solución compatible con los proveedores permitidos. |
| Puntuación y operación | Reglas de puntos y controles de cuotas implementados. Falta acordar ponderación con el grupo y medir uso real de almacenamiento, transferencia y procesamiento. No se ha autorizado activar facturación automáticamente. |

## Historial de validación

Los registros siguientes corresponden a comprobaciones anteriores de cada entrega.
Sus frases sobre código local, publicación o activación pendiente describen aquel momento;
el estado vigente y los pendientes reales se encuentran en las tablas anteriores.

### Primera entrega — validación automatizada local, 2026-10-21

- Node.js `24.15.0`; CLI y SDK SpacetimeDB `2.12.0`; bindings regenerados desde el módulo.
- `npm test`: **606 pruebas aprobadas** (app 336, core 63, módulo 112, API 50, web 45).
- `npm run typecheck`, `npm run build` y `npm run build:pages`: correctos. Se compilaron
  web/PWA y extensión; el Worker heredado se comprobó con `wrangler deploy --dry-run`.
- `npm run test:spacetime:files` pasó con un servidor SpacetimeDB real, datos persistentes
  aislados y tres identidades sintéticas. No usa cuentas ni tokens de producción.
- Se comprobó la transferencia binaria de dos bloques, reintentos y hashes, rechazo de
  suscripciones a tablas privadas, aislamiento de intentos y denegación a un tercero.
- Un reinicio conservó una subida pendiente y permitió reanudarla; otro conservó los bytes
  confirmados. Una baja revocó la lectura inmediatamente.
- Se comprobaron cancelación y liberación de reserva, conflicto de versión, historial de
  trabajos y recuperación de adjuntos retirados de evidencias con permisos del autor.
- Se cargaron y confirmaron **52,428,800 bytes (50 MiB)** por el protocolo binario real,
  incluida la comprobación SHA-256 del servidor. El tiempo local no estima el de Maincloud.

En la primera entrega, la API Node dejó de registrar Google Secret Manager y BYOK quedó
pendiente. La tercera entrega implementa el cifrado con Cloudflare Secrets y los datos en
SpacetimeDB, manteniendo la generación desactivada hasta su configuración. El Worker R2
anterior se conserva por compatibilidad, sin activar facturación.

### Segunda entrega y coordinación con Salas — 2026-10-21

- La suite conjunta terminó con **814 pruebas aprobadas**: app 463, core 72,
  módulo SpacetimeDB 184, API 50 y web 45. Incluye las regresiones que impiden
  usar fuentes retiradas en Aprende enseñando, tanto en la demo como en la interfaz.
- Bindings regenerados con CLI/SDK `2.12.0`; comprobación global de tipos correcta.
- Compilaciones finales de web/PWA, extensión y Cloudflare Pages correctas; el Worker
  heredado pasó `wrangler deploy --dry-run`. `git diff --check` terminó sin errores.
- El recorrido real aislado de la segunda entrega pasó con tres identidades y un
  reinicio: publicación explícita y privada de archivos, canales, lectura, bloqueos,
  reportes selectivos, perfiles, preguntas, historial y retirada/restauración.
- La importación nativa de stickers comprobó reintentos idempotentes y aislamiento de
  los bytes de un directo. Las copias idénticas de aportes no sumaron puntos aunque
  el original estuviera retirado; restaurarlo recuperó solo su crédito original.
- El recorrido de archivos volvió a confirmar 50 MiB y SHA-256, reanudación, reserva,
  persistencia y revocación. Salas pasó su recorrido real aislado con invitaciones,
  cupo concurrente, temporizador compartido, publicación única y revocación.
- Se conserva la separación entre implementación local y despliegue: estas pruebas
  no publican la segunda entrega ni Salas en Maincloud o Cloudflare Pages.


### Tercera entrega — recorridos locales aislados previos a integrar Exposiciones

- Suite global: **999 pruebas aprobadas** (app 504, core 94, módulo 246, API 104 y web 51).
- Tipos globales y bindings CLI/SDK 2.12.0 correctos. Compilaciones de web/PWA, extensión,
  Worker en modo `--dry-run` y Pages con configuración pública aprobadas.
- Regresiones reales de segunda entrega, Salas y archivos de 50 MiB con SHA-256 aprobadas;
  la retención volvió a comprobarse después de cerrar la limpieza de dependencias.
- `git diff --check` correcto; no hubo despliegue, llamadas reales a Gemini ni envíos push.
- `scripts/smoke-spacetime-ai.mjs` pasó con adjunto UTF8 real, versiones, redacción,
  explicación privada, guía de ocho secciones y publicación idempotente. El reinicio
  conservó claves y borradores; el retiro revocó el acceso. Dos respuestas simuladas,
  ninguna llamada real a Gemini ni uso de claves personales.
- `scripts/smoke-spacetime-notifications.mjs` pasó con tres miembros, una identidad
  técnica e intruso: vistas privadas, mensajes/menciones sin push configurado, registro
  de dispositivo, leases, lectura/bloqueo, backoff, cursor diario, reinicio y baja.
  Ningún envío Web Push real.
- `scripts/smoke-spacetime-retention.mjs` pasó con vencimiento acelerado únicamente en
  una copia temporal. El código de producción conserva los 30 días; las pruebas de
  reloj controlado comprueban su frontera exacta. Véase el [registro de retención](tercera-entrega-retencion.md).
- El [registro de la tercera entrega](tercera-entrega.md) reúne el alcance y la
  configuración operativa; estos recorridos no acreditan un despliegue.

### Integración de la tercera entrega con `main` — 2026-10-21

Se conservaron los cambios de Exposiciones y los registros de Tareas/Salas ya incorporados
en `cda8030`. La suite conjunta pasó con **1,098 pruebas**: app 562, core 110, módulo 271,
API 104 y web 51. Los bindings se regeneraron desde el esquema combinado y el recorrido
real aislado de Exposiciones volvió a pasar, con persistencia, privacidad y revocación.
Los tipos globales y las compilaciones de web/PWA, extensión y Worker (`--dry-run`)
terminaron correctamente; `git diff --check` no encontró errores.
Estas comprobaciones locales no despliegan la tercera entrega ni activan Gemini o push.

## Registro de validación en producción

La lectura previa a esta adaptación, el 21 de octubre de 2026, confirmó
que el despliegue conserva una versión anterior: Maincloud incluye Ayuda, pero no las
operaciones de archivos nativos ni `restore_resource_file`; Pages tampoco incorpora la
pantalla de Ayuda. El código, los bindings y GitHub se verifican por separado de esa
publicación. Un push a `main` no se registra como un despliegue completado.

El registro siguiente actualiza la publicación del módulo. Los recorridos con tres cuentas reales siguen pendientes.
Al realizarlos, registrar fecha, versión publicada, presentación, escenario, resultado y
referencia de evidencia sin tokens ni datos personales. Los resultados automatizados y de
compilación se adjuntan al cierre de implementación, separados de la validación humana.


### Adaptación de Tareas y Actividades — 2026-10-21

- Módulo `e64bfc4` publicado en Maincloud `app-b20-34245` con `--delete-data=never`.
  Se verificaron las tablas privadas nativas y la conservación íntegra de las filas de 22 tablas
  académicas/configuración, incluidas invitaciones. No se importaron datos de la simulación.
- Node `22.23.3`, CLI/SDK `2.12.0`: **622 pruebas aprobadas** (app 348, core 63,
  módulo 116, API 50, web 45), tipos y compilaciones web/PWA, extensión y Worker heredado.
- Prueba con servidor persistente y tres identidades sintéticas aprobada: archivo de 50 MiB,
  interrupción/reanudación, dos reinicios, historial, cancelación, integridad y baja inmediata.
  La prueba espera la actualización de la segunda sesión antes de comprobar su caché.
- Se corrigieron reintentos de lotes con confirmación incierta, aislamiento de formularios entre
  tareas y respuestas tardías al abandonar una pantalla. Las operaciones antiguas sin versión
  conservan su firma y piden actualizar antes de editar o retirar adjuntos.
- Pages usa la integración Git existente de `codex/pages-spacetimeauth`. Verificar su revisión
  y resultado en Deployments; la compilación local o el push no acreditan por sí solos éxito.
- La base aún no tiene miembros incorporados ni publicaciones académicas. La primera persona
  invitada debe unirse; permanecen pendientes los recorridos humanos con cuentas reales y la
  medición de transferencias grandes en dispositivos del grupo.
