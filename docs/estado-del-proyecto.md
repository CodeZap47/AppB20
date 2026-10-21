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

## Módulos base (sección 3)

«Parcial» significa que falta parte del alcance, de la integración o de su validación real.
«Manual local» indica una versión sin Gemini cuya publicación debe comprobarse por separado.

| Sección | Estado del código local | Trabajo pendiente según el alcance | Entrega siguiente |
| --- | --- | --- | --- |
| 3.1 Mensajes y stickers | Parcial: canal, directos, reacciones y herramientas de stickers. | Canales por materia/proyecto, adjuntos con bytes reales, lectura por conversación, menciones, silenciado, bloqueo y reportes. | 2 |
| 3.2 Tareas y Actividades | Parcial con avance privado, estados, revisión y versiones académicas. | Validación completa de permisos, coautorías e historial con archivos reales; cerrar huecos del recorrido del grupo. | 1–2 |
| 3.3 Actividades de clase | Integradas en Tareas; evidencias, comentarios, vínculos y recuperación de adjuntos retirados por su autor. | Verificar archivos reales, versiones y permisos por equipo. La recuperación de adjuntos no implica historial completo del texto. | 1–2 |
| 3.4 Notas de clase | Parcial: notas personales/de grupo, revisiones y comentarios. | Editor con tablas/imágenes, clasificación por sesión y restauración completa; publicación voluntaria. | 2 |
| 3.5 Guías integrales | Manual local: fuentes, cobertura, revisiones y compendio. | Historial recuperable, extracción de archivos, generación BYOK y borradores privados con fuentes versionadas. | 2–3 |
| 3.6 Contribuciones | Desglose calculado con reglas y límites locales. | Validación con el grupo y pruebas contra duplicados, retirada y restauración. | 2 |
| 3.7 Preguntas | Parcial: dudas, respuestas, aceptación, reapertura y similares. | Adjuntos, aclaraciones separadas, señales de utilidad y referencias a materiales. | 2 |
| 3.8 Votaciones | Implementación nominal local con elegibles y reglas de cierre. | Integración de novedades/avisos y validación con datos reales. | 2–3 |
| 3.9 Perfiles | Parcial: identidad y archivo de trabajos compartidos. | Foto real, presentación, intereses, habilidades, portafolio y pestañas de guías/proyectos/contribuciones. | 2 |
| 3.10 Cumpleaños | Parcial: día/mes voluntarios y próximos cumpleaños. | Vista anual y recordatorios efectivos con preferencias y control de duplicados. | 2–3 |
| 3.11 Lenguaje de señales | Pendiente: catálogo etapa 3, sin pantalla propia. | Diccionario/versiones para tres medios, constructor, ejercicios, parejas, historial privado y fichas con fuentes. | 5 |

## Funciones adicionales (sección 7)

| Sección | Estado del código local | Trabajo pendiente según el alcance | Entrega siguiente |
| --- | --- | --- | --- |
| 7.1 ¿Qué me perdí? | Parcial: novedades y última visita. | Votaciones, guías y nuevos tipos; excluir actividad privada y separar lectura de chats. | 2 |
| 7.2 Salas de estudio | Pendiente. | Horario, objetivo, cupo, inscripción, materiales, resultados y temporizador. | 4 |
| 7.3 Ayuda | Manual local: publicaciones y contactos privados con conversación aceptada. | Validación real y conversión en sala cuando exista 7.2. | 4 |
| 7.4 Retos | Pendiente. | Temas, dificultad, pistas, soluciones explicadas y revisión colectiva. | 4 |
| 7.5 Revisión de código | Pendiente. | Fragmentos/versiones, comentarios por línea y resolución de observaciones. | 4 |
| 7.6 Microproyectos | Pendiente. | Propuestas, ingreso, responsabilidades, tablero, demostración y cierre. | 5 |
| 7.7 Museo de bugs | Pendiente; se integrará en Preguntas. | Plantilla, etiquetas y referencias. | 4 |
| 7.8 Aprende enseñando | Manual local: explicación, invitado, preguntas, reflexión privada y publicación de nota. | Validación real; preguntas con IA tras cerrar BYOK. | 3–4 |
| 7.9 Repaso espaciado | Manual local: colecciones, tarjetas, cola e historial privados. | Validación real, borradores Gemini y recordatorios. Mantener intervalos existentes de 1/3/7/14/30/60/120 días. | 3–4 |
| 7.10 Exposiciones | Pendiente. | Ensayos por texto, preguntas, observaciones y siguientes intentos privados. | 5 |
| 7.11 Préstamos | Pendiente. | Catálogo, acuerdo privado, reserva, entrega y devolución sin doble préstamo. | 5 |
| 7.12 Oportunidades | Pendiente. | Fichas manuales, filtros, plazos, fuente, búsqueda de equipo y reportes. | 4 |

## Requisitos compartidos (secciones 2, 4, 5 y 8)

| Área | Estado y criterio de cierre |
| --- | --- |
| Acceso, permisos y membresía | Código de invitaciones, vistas y acciones existente. Verificar tres identidades, bajas, caducidad y lectura/descarga privada en datos reales. |
| Datos académicos y versiones | Preservar referencias y migraciones aditivas; no reiniciar base ni importar ejemplos de la demo. Restaurar sin perder archivos históricos. |
| BYOK y Gemini | Pendiente de entrega 3: claves cifradas por persona en SpacetimeDB, maestra en Cloudflare Secrets, consentimiento, presupuesto y publicación voluntaria. |
| Avisos y programación | Pendiente de entrega 3: bandeja, preferencias, descanso, cola persistente, reintentos y deduplicación; Web Push en PWA. |
| Papelera y conservación | Papelera de 30 días pendiente. La primera entrega limpia subidas pendientes; conserva bytes confirmados y versiones vigentes. |
| Moderación y retiro | Completar según cada módulo, con autor, motivo y permisos; no publicar conversaciones privadas al reportar sin selección de evidencia. |
| PWA, extensión y APK | Compilar y probar autenticación, apertura de contenidos y actualizaciones en dispositivos reales. Push nativo Android cerrado sigue pendiente bajo la restricción de proveedores; no añadir Firebase automáticamente. |
| Operación gratuita | Medir almacenamiento, transferencia y procesamiento; mostrar límites y detener la operación afectada al agotarse. No prometer cuota ilimitada ni activar pagos. |

## Validación automatizada local — 2026-10-21

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

La API Node de desarrollo ya no registra Google Secret Manager; BYOK de producción sigue
pendiente de la entrega 3. El Worker R2 anterior se conserva para compatibilidad, sin crear
recursos nuevos ni activar facturación.

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
