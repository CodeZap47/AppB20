# Estado del proyecto y matriz de requisitos

Fuente de alcance: [definicion-del-proyecto.md](definicion-del-proyecto.md). Esta matriz
separa el código local del cierre de una entrega con datos reales; no declara publicado ni
validado un cambio por tener pantalla, bindings o pruebas. La incorporación de Ayuda,
Aprende enseñando y Repaso se conserva como trabajo existente.

## Primera entrega

| Requisito | Implementación de la entrega | Evidencia necesaria para cerrarlo |
| --- | --- | --- |
| Backend solo SpacetimeDB y Cloudflare | SpacetimeAuth, tablas/reducers/vistas/procedures y archivos en SpacetimeDB; Pages para web. Worker solo como complemento. | Tipos, pruebas, compilación y configuración sin proveedor adicional obligatorio. |
| Archivos reales | Manifiesto privado, fragmentos de 1 MiB, máximo 50 MiB, hash, reanudación, cancelación y descarga bajo demanda. | Pruebas de módulo/transporte; límites y recorrido con cuentas reales. |
| Reservas y limpieza | 256 MiB iniciales; propietario hasta 512 MiB; tres pendientes por persona y 24 h de vida. | Rechazo por cuota, reserva concurrente, liberación por cancelación/caducidad; conservar confirmados. |
| Compatibilidad | Mantener IDs, versiones y referencias; ruta R2 previa solo si hay objetos existentes. | Descarga de archivo y revisión anteriores. No se ejecuta migración remota automática. |
| SDK y CLI | SDK de cliente y módulo fijado en `2.12.0`; bindings regenerados con esa versión. | Registrar versión de CLI, prueba del runtime y resultados al finalizar la verificación. |
| Módulo 3.11 | Incluido en catálogo de etapa 3 como `senales`, sin marcarlo disponible; alcance original conservado. | Pantalla y pruebas corresponden a entrega 5, no a esta entrega. |
| Piloto | Configuración de producción apunta a SpacetimeDB; la demo sigue aislada. | Publicación sin borrar datos y recorridos con autor, compañero autorizado y tercero. Pendientes hasta registrarlos. |

## Tercera entrega: implementación local

El [índice de la tercera entrega](tercera-entrega.md) reúne IA, notificaciones y conservación.
El código incorpora Gemini BYOK cifrado, preparación de texto y adjuntos UTF8 compatibles,
borradores privados de guías/explicaciones y publicación expresa; bandeja privada,
preferencias, recordatorios y Web Push configurable; y papelera con plazo de 30 días,
restauración y purga de datos dependientes. Los servicios externos comienzan desactivados.

Las comprobaciones locales con servidor real aislado usan identidades y claves sintéticas.
No se han publicado estos cambios en Maincloud o Cloudflare ni se ha activado facturación.
Los formatos binarios no admitidos para IA permanecen como omisiones explícitas. Las tarjetas
de Repaso con Gemini, Exámenes y otras integraciones de IA siguen para entregas posteriores;
el módulo 3.11 conserva su entrega 5 y el push nativo del APK permanece pendiente.

## Módulos base (sección 3)

La segunda entrega tiene un [registro de alcance y pruebas](segunda-entrega.md). El
recorrido del servidor real aislado terminó correctamente el 21 de octubre de 2026 con
tres identidades sintéticas y un reinicio: notas personales y su publicación explícita,
adjuntos privados en directos, reportes selectivos, canales y lectura, perfiles con foto,
aclaraciones, guías y retirada/restauración sin duplicar puntos. Esto no constituye una
publicación en Maincloud ni una prueba de aceptación con el grupo.

«Parcial» significa que falta parte del alcance, de la integración o de su validación real.
«Manual local» indica una versión sin Gemini cuya publicación debe comprobarse por separado.

| Sección | Estado del código local | Trabajo pendiente según el alcance | Entrega siguiente |
| --- | --- | --- | --- |
| 3.1 Mensajes y stickers | Canales, directos con archivos privados, menciones, lectura, silencio, bloqueo y reportes selectivos; stickers nativos. Avisos privados de mensajes/menciones y Web Push configurable incorporados localmente. | Validación con el grupo y recepción real en dispositivos compatibles. | 2–3: validación |
| 3.2 Tareas y Actividades | Parcial con avance privado, estados, revisión y versiones académicas. | Validación completa de permisos, coautorías e historial con archivos reales; cerrar huecos del recorrido del grupo. | 1–2 |
| 3.3 Actividades de clase | Integradas en Tareas; evidencias, comentarios, vínculos y recuperación de adjuntos retirados por su autor. | Verificar archivos reales, versiones y permisos por equipo. La recuperación de adjuntos no implica historial completo del texto. | 1–2 |
| 3.4 Notas de clase | Editor estructurado con listas/tablas/código e imágenes privadas bajo demanda, sesión/parcial, vínculos y versiones completas. Publicar una nota personal crea una copia independiente. | Recorrido de aceptación con el grupo. | 2: validación |
| 3.5 Guías integrales | Guías manuales y preparación local de archivos, generación BYOK, borradores privados, fuentes versionadas, cobertura, revisiones, compendio e historial. [Entrega publicada](guias-estudio-ia.md). | Prueba real de Gemini y aceptación con cuentas del grupo, pendientes por separado. | Validación humana |
| 3.6 Contribuciones | Desglose verificable; excluye borradores y retirados, copias idénticas del mismo autor/contexto y registros repetidos. Conserva el primer crédito y su fecha aunque el original esté retirado; mantiene límites entre periodos y recupera puntos al restaurar. | Ajustar los puntos mediante una prueba con el grupo; registrar la validación real. | 2: validación |
| 3.7 Preguntas | Adjuntos privados, aclaraciones separadas, utilidad por integrante y referencias a notas/guías compartidas; aceptación y reapertura preservadas. | Recorrido de aceptación con el grupo. | 2: validación |
| 3.8 Votaciones | Nominales con elegibles y cierre; las abiertas aparecen en novedades. Recordatorios por cierre integrados localmente. | Activación de recordatorios y validación con datos reales. | 3: validación |
| 3.9 Perfiles | Presentación voluntaria, foto privada en SpacetimeDB bajo demanda, intereses, conocimientos, portafolio HTTPS, materias, guías, equipo y contribuciones. Archivo con filtros por parcial, tema, fecha y tipo. | Recorrido con nombres, fotos y trabajos aportados por cada alumno; microproyectos cuando exista 7.6. | 2: validación; 5: microproyectos |
| 3.10 Cumpleaños | Día/mes voluntarios, calendario mensual/anual y 29 de febrero. Recordatorios con zona, preferencias, descanso, cursor persistente y deduplicación integrados localmente. | Activar el planificador y validar la recepción real con el grupo. | 3: validación |
| 3.11 Lenguaje de señales | Pendiente: catálogo etapa 3, sin pantalla propia. | Diccionario/versiones para tres medios, constructor, ejercicios, parejas, historial privado y fichas con fuentes. | 5 |
| 3.12 Exámenes de estudio | EX-2: configuración, generación BYOK y borradores privados, revisión, versiones, práctica/simulacro, tiempo del servidor y resultados privados. [Registro de cierre](examenes-entrega.md). | Prueba real de Gemini y aceptación con titulares de cuentas/dispositivos; OCR y respuestas abiertas pertenecen a EX-3 y quedan fuera del alcance confirmado. | EX-2: publicación y aceptación; EX-3: ampliaciones |

## Funciones adicionales (sección 7)

| Sección | Estado del código local | Trabajo pendiente según el alcance | Entrega siguiente |
| --- | --- | --- | --- |
| 7.1 ¿Qué me perdí? | Novedades de guías, votaciones abiertas, ayuda y colecciones grupales; excluye retirados y contenido personal. Lectura de conversaciones separada del inicio. | Validación con el grupo; el resumen BYOK opcional de novedades sigue pendiente. La IA actual genera guías y explicaciones. | Posterior: resumen opcional |
| 7.2 Salas de estudio | [Implementado sin IA](salas-de-estudio.md): salas abiertas/privadas, agenda, cupo, invitaciones, materiales, chat, temporizador compartido y resumen con publicación voluntaria. Demo y SpacetimeDB preparados y probados localmente. | Validación con el grupo y activación real fuera de esta entrega; videollamadas y editor en vivo fuera de alcance. | 4: validación |
| 7.3 Ayuda | Manual local: publicaciones y contactos privados con conversación aceptada; «Organizar sesión» integrado con Salas. | Validación con el grupo y activación real. | 4: validación |
| 7.4 Retos | Pendiente. | Temas, dificultad, pistas, soluciones explicadas y revisión colectiva. | 4 |
| 7.5 Revisión de código | Pendiente. | Fragmentos/versiones, comentarios por línea y resolución de observaciones. | 4 |
| 7.6 Microproyectos | Pendiente. | Propuestas, ingreso, responsabilidades, tablero, demostración y cierre. | 5 |
| 7.7 Museo de bugs | Pendiente; se integrará en Preguntas. | Plantilla, etiquetas y referencias. | 4 |
| 7.8 Aprende enseñando | Manual local: explicación, invitado, preguntas, reflexión privada y publicación de nota. | Validación real; preguntas con IA todavía pendientes de su integración específica. | 4 |
| 7.9 Repaso espaciado | Manual local: colecciones, tarjetas, cola e historial privados; recordatorios integrados en la tercera entrega. | Validación real y borradores de tarjetas con Gemini en una entrega posterior. Mantener intervalos de 1/3/7/14/30/60/120 días. | 4 |
| 7.10 Exposiciones | Texto manual: ensayos versionados, preguntas, observaciones privadas y revisor voluntario; ver [reglas](exposiciones.md). | Audio y generación con Gemini quedan para sus integraciones. La publicación se verifica por separado. | 5 |
| 7.11 Préstamos | Pendiente. | Catálogo, acuerdo privado, reserva, entrega y devolución sin doble préstamo. | 5 |
| 7.12 Oportunidades | Pendiente. | Fichas manuales, filtros, plazos, fuente, búsqueda de equipo y reportes. | 4 |

## Requisitos compartidos (secciones 2, 4, 5 y 8)

| Área | Estado y criterio de cierre |
| --- | --- |
| Acceso, permisos y membresía | Código de invitaciones, vistas y acciones existente. Verificar tres identidades, bajas, caducidad y lectura/descarga privada en datos reales. |
| Datos académicos y versiones | Preservar referencias y migraciones aditivas; no reiniciar base ni importar ejemplos de la demo. Restaurar sin perder archivos históricos. |
| BYOK y Gemini | Base común publicada con Guías y reutilizada por Exámenes: claves cifradas por persona en SpacetimeDB, maestras en Cloudflare Secrets, consentimiento y presupuesto compartidos. Prueba real de Gemini pendiente por decisión del usuario. |
| Avisos y programación | [Implementación local](avisos-recordatorios.md): bandeja y preferencias privadas, descanso, cola persistente, reintentos, deduplicación y Web Push. Falta configurar secretos/VAPID y comprobar entrega real en dispositivos. |
| Papelera y conservación | [Implementación local](tercera-entrega-retencion.md): recuperación antes de 30 días, vencimiento según reloj del servidor, purga programada y mantenimiento de respaldo. Limpia dependencias y copias privadas de IA; conserva publicaciones independientes y bytes aún referenciados. |
| Moderación y retiro | Completar según cada módulo, con autor, motivo y permisos; no publicar conversaciones privadas al reportar sin selección de evidencia. |
| PWA, extensión y APK | Compilar y probar autenticación, apertura de contenidos y actualizaciones en dispositivos reales. Push nativo Android cerrado sigue pendiente bajo la restricción de proveedores; no añadir Firebase automáticamente. |
| Operación gratuita | Medir almacenamiento, transferencia y procesamiento; mostrar límites y detener la operación afectada al agotarse. No prometer cuota ilimitada ni activar pagos. |

## Validación automatizada local de la primera entrega — 2026-10-21

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
