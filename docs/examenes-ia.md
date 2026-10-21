# Exámenes con IA (BYOK): alcance y tareas

Estado: **EX-1 implementado y verificado localmente; EX-2 y EX-3 pendientes**. Corresponde al módulo
**3.12**, de la **etapa 2: colaboración y estudio**, según la
[definición del proyecto](definicion-del-proyecto.md). La evidencia de EX-1 se registra al final de su entrega; la prueba con Gemini real y la
publicación permanecen pendientes. Fecha de implementación local: 21 de octubre de 2026.

Los hitos **EX-1, EX-2 y EX-3** pertenecen únicamente a Exámenes; no renumeran las entregas
globales. EX-1 comparte la base BYOK de la entrega global 3 y consume los contenidos y
permisos académicos de las entregas globales 1–2 (módulos 3.2–3.5). El avance y la evidencia se
registrarán en [estado-del-proyecto.md](estado-del-proyecto.md).

## Resultado esperado y recorrido inicial

Crear autoevaluaciones y simulacros de una materia y parcial a partir de materiales
seleccionados. Cada pregunta conserva una respuesta explicada y referencias verificables.
El primer recorrido completo es: seleccionar notas y actividades → definir temario y
distribución → generar borrador → revisar → resolver → consultar resultados privados y
volver a las fuentes. El examen generado nace privado; compartir requiere otra acción.

EX-2 incluye texto ya disponible en la app, opción múltiple con una respuesta correcta y
verdadero/falso. Puede mostrar código como texto, sin ejecutarlo. Práctica revela la
explicación después de confirmar la respuesta; simulacro la revela al finalizar. Resolver,
reanudar y corregir estos tipos no requiere una nueva llamada a Gemini ni configurar clave.
No incluye evaluaciones oficiales de docentes, vigilancia ni clasificación por puntaje.

## Candidatos para extraer información

| Fuente | Contenido aprovechable y selección | Hito |
| --- | --- | --- |
| Notas de clase (3.4) | Conceptos, fórmulas, ejemplos y código; notas de grupo y personales propias seleccionadas expresamente. | EX-1/EX-2 |
| Actividades de clase (3.3, dentro de Tareas) | Objetivos, instrucciones y ejercicios; las evidencias se identifican por separado. | EX-1/EX-2 |
| Tareas y consignas (3.2) | Objetivos y problemas; incluir tipos existentes `tarea`, `actividad`, `exposicion` y `examen` cuando corresponda. | EX-1/EX-2 |
| Trabajos y evidencias (3.2/3.3) | Procedimientos y soluciones documentadas; preferir finales o revisados y conservar ese estado como contexto. | EX-1/EX-2 |
| Guías integrales (3.5) | Temario, secciones, ejercicios y fuentes originales; conservar procedencia y detectar duplicados. | EX-1/EX-2 |
| Preguntas y respuestas (3.7) | Dudas y explicaciones; señalar aceptación y revisión, sin tratar esos estados como garantía de verdad. | EX-3A |
| Repaso espaciado (7.9) | Colecciones, tarjetas y explicaciones accesibles; jamás extraer el progreso de otra persona. | EX-3A |
| Aprende enseñando (7.8) | Notas publicadas y explicación propia seleccionada; excluir reflexión y respuestas del compañero. | EX-3A |
| Adjuntos de las fuentes | PDF con texto, documentos y, posteriormente, imágenes con OCR; extracción con ubicación y estado explícitos. | EX-3B |
| Retos, revisión de código y museo de bugs (7.4/7.5/7.7) | Problemas, comentarios y diagnósticos publicados con contexto y revisiones. | Futuro condicionado a que existan |

Materia, parcial y temario organizan el alcance; no son evidencia de una respuesta. El
material sin parcial aparece como «Sin parcial: incluir manualmente» y nunca se asigna
silenciosamente. El peso de cada tema lo elige el usuario, no el número de documentos.
Una consigna o un trabajo revisado puede orientar una pregunta sin demostrar su solución.

Se excluyen chats y mensajes directos, perfiles, cumpleaños, invitaciones, claves, tokens,
resultados privados ajenos y cualquier material inaccesible. Una lectura autorizada para un
compañero en Aprende enseñando no implica permiso de usar su contenido como fuente de IA.

## Base técnica propuesta

Se conserva [la arquitectura vigente](arquitectura.md): React compartido entre web/PWA,
extensión y Android; SpacetimeDB para datos, permisos y persistencia; SpacetimeAuth para
identidad; Cloudflare Worker para integración externa. Las claves personales se guardarán
cifradas en tablas privadas de SpacetimeDB; la maestra se protege en Cloudflare Secrets.
No se añade Supabase, D1 ni Google Cloud Secret Manager.

`apps/api/src/routes/ai.ts` y `apps/api/src/lib/secrets.ts` conservan la ruta de desarrollo
heredada. EX-1 integra las rutas persistentes en `apps/api/src/ai/` y en el Worker. La
configuración mantiene `AI_ENABLED=false` y el modelo vacío; implementar las rutas no
habilita Gemini real. Ver [configuración y operación de EX-1](examenes-ia-operacion.md).

El Worker valida token SpacetimeAuth, emisor, audiencia y membresía activa. Usa el contexto
del usuario para autorizar cada fuente en SpacetimeDB; no acepta texto y permisos declarados
por el cliente como prueba suficiente. El actor técnico del Worker accede únicamente al
cifrado y a las operaciones de generación necesarias mediante un canal autenticado y
acotado: una vista o reducer invocable por un alumno no puede recuperar cifrados, suplantar
al Worker ni finalizar generaciones ajenas. No se usa una credencial de propietario.

Gemini será el proveedor inicial. Modelo configurable, elegibilidad, consentimiento y
límites se resolverán con la base BYOK común. Antes de enviar se muestran fuentes,
omisiones, modelo y estimación de consumo; esa estimación no promete un cargo exacto ni
modifica la facturación del proyecto de Google asociado a la clave.

### Fuentes normalizadas y trazabilidad

Una fuente preparada conserva tipo, ID, materia/parcial, visibilidad, propietario cuando
aplique, versión, fragmentos con ubicación, huella del texto extraído, temas y estado.
Los estados distinguen preparado, pendiente, fallido, desactualizado y no autorizado, con
razón legible. Si el origen no tiene historial versionado suficiente, se fija una instantánea
y su huella; no se inventa un número de versión histórico.
En evidencias, conservar el texto extraído porque su versión no implica un historial completo
del texto. En Preguntas y respuestas, fijar el conjunto pregunta/respuesta aceptada con huella;
la referencia nominal a la versión 1 de Guías no basta para detectar todos sus cambios.
El permiso de lectura no basta: excluir expresamente material retirado, aunque su autor o
un administrador puedan consultarlo para recuperarlo o moderarlo.

Una guía y sus materiales originales se relacionan para no contar dos veces el mismo texto;
la pregunta puede citar la guía y la evidencia original. Una falla o truncamiento de
extracción aparece en cobertura y vista previa. El usuario reduce el alcance o excluye la
fuente expresamente antes de generar; no se simula cobertura con material no procesado.

El contenido recuperado es material de estudio, nunca instrucciones de sistema. La salida
estructurada del modelo se valida en el servidor: tipos, cantidades, opciones, respuesta,
explicación, tema y citas pertenecientes a los fragmentos enviados. Una cita válida prueba
procedencia; no garantiza la verdad de la respuesta. Contradicciones, evidencia insuficiente
y preguntas ambiguas impiden aprobar el borrador hasta corregirlas o retirarlas.
Las marcas del modelo y de los revisores ayudan a encontrarlas; no se promete detectar
automáticamente todos los errores académicos.

### Modelo de datos y separación de EX-1/EX-2

| Entidad propuesta | Responsabilidad y acceso |
| --- | --- |
| `ai_key` | Cifrado por persona y versión de clave maestra; sin lectura del secreto por clientes. |
| `ai_generation` | Solicitante, clave idempotente, parámetros, huella de fuentes, estado, consumo disponible y error depurado; privada. |
| `exam` | Dueño, título, materia/parcial, versión vigente, visibilidad privada/grupo y archivo. |
| `exam_version` | Configuración, temario, cobertura y versión de prompt/modelo; inmutable al quedar lista para intentos. |
| `exam_question` | Enunciado, opciones ordenadas, tipo, tema y referencias; separar campos que revelen la solución. |
| `exam_solution` | Respuesta correcta, explicación y evidencia; privada, disponible al autor al revisar y al participante según la fase. |
| `exam_source` | Procedencia, versión/instantánea, fragmentos y huella con acceso limitado por el origen. |
| `exam_attempt` | Persona, versión fija, modalidad, inicio, vencimiento opcional, estado y resultado; solo su dueño. |
| `exam_answer` | Respuesta, orden del intento, confirmación y corrección; solo su dueño, con escritura validada por el servidor. |

EX-1 implementa claves, consentimiento, intenciones, preparaciones, generaciones y reservas
en tablas privadas. Las entidades `exam*` siguen siendo propuestas de EX-2. No se mezclan
solucionarios o resultados con vistas del catálogo. El esquema es aditivo; no se reinicia la
base ni se importan ejemplos de la simulación.

### Reglas de privacidad, versiones y operación

- Generar o regenerar consume la clave de quien solicita la acción. El autor del material
  y quien resuelve un examen guardado no aportan automáticamente su clave.
- Una fuente personal propia solo produce un examen privado. Para compartir, publicar
  voluntariamente una copia de la fuente y preparar una nueva versión usando únicamente
  fuentes de grupo; cambiar la visibilidad del examen no sanea texto privado ya generado.
  Reutilizar el patrón existente `publish_note_version`: copia independiente con procedencia,
  sin abrir la nota personal ni sus versiones futuras.
- Compartir preguntas no comparte intentos, respuestas, calificaciones ni temas fallados.
  Ni la administración del grupo ni el autor del examen leen intentos ajenos.
- El servidor entrega únicamente preguntas durante un intento. En práctica revela solución
  después de confirmar una respuesta irreversible; en simulacro, después del cierre. El
  solucionario no llega anticipadamente en suscripciones, caché o archivos de la app.
- Una versión usada por un intento conserva preguntas y corrección. Editar, regenerar o
  cambiar las fuentes crea otra versión; no cambia la puntuación histórica.
- Revalidar acceso al generar, publicar, iniciar, reanudar y servir contenido. Retirar una fuente o perder
  acceso a ella bloquea nuevos intentos y oculta el contenido afectado a quien ya no puede
  leerlo, incluso en resultados históricos. Una instantánea no concede acceso perpetuo.
  Los cambios ordinarios del origen se señalan sin recalificar intentos anteriores.
- Límites de solicitudes, tokens, tiempo, concurrencia y reintentos se comprueban antes de
  llamar al proveedor. Registrar estados persistentes y claves idempotentes; un resultado
  incierto tras timeout se consulta antes de reintentar. No prometer ejecución única del
  proveedor si su API no la garantiza; evitar reenvíos automáticos que puedan duplicar consumo.
  Antes de un nuevo envío tras resultado incierto, advertir el posible consumo adicional.
- Clave inválida, cuota, rechazo del proveedor, timeout y salida mal formada conservan el
  borrador recuperable y muestran un motivo útil. Los registros excluyen claves, tokens,
  texto completo de fuentes y datos personales innecesarios; los errores se depuran.
- Las preguntas y los resultados no generan puntos de Contribuciones ni rankings. Las
  acciones privadas no se añaden a novedades ni al historial público del grupo.

## EX-1 — Base común BYOK y preparación de fuentes

Depende de completar los permisos y versiones de los contenidos que se conecten. El trabajo
BYOK se coordina con la entrega global 3 para tener una sola implementación compartida por
Guías, Exámenes, Repaso y Aprende enseñando. Las siguientes tareas están completadas con
validación local; la activación real se mantiene separada.

- [x] **EX1-01 — Definir contratos y límites comunes.**
  Componente: `packages/core/src/ai.ts` y `exam.ts` nuevos, exportados desde `index.ts`.
  Resultado/aceptación: tipos de fuentes, configuración, generación y preguntas; límites
  explícitos y estados/error recuperable; acordar esquema de salida y reglas de cobertura.
  Dependencias: alcance 3.12 y decisiones BYOK de la entrega global 3.

- [x] **EX1-02 — Diseñar esquema aditivo y autorización del Worker.**
  Componente: `packages/spacetime-module/src/index.ts`; nuevos handlers de IA/exámenes.
  Resultado/aceptación: tablas privadas, vistas filtradas y operaciones con matriz de acceso;
  probar que un cliente no lee cifrados ni invoca operaciones reservadas al Worker.
  Dependencias: EX1-01; identidad/membresía de la base existente.

- [x] **EX1-03 — Persistir y administrar la clave cifrada.**
  Componente: `apps/api/src/lib/secrets.ts`, `workerApp.ts`, configuración y tablas de EX1-02.
  Resultado/aceptación: alta, sustitución, estado y eliminación inmediata por su dueño;
  cifrado autenticado compatible con Worker, maestra en Cloudflare Secrets y sin eco de claves.
  Dependencias: EX1-02; tarea BYOK equivalente de la entrega global 3, implementada una vez.

- [x] **EX1-04 — Conectar ajustes, consentimiento y límites.**
  Componente: `packages/app/src/pages/SettingsPage.tsx`; cliente IA nuevo en `lib/`.
  Resultado/aceptación: configurar/sustituir/eliminar, estado sin revelar clave, elegibilidad
  verificada antes de habilitar y límites visibles; demo aislada sin guardar una clave real.
  Dependencias: EX1-03; validación de edad/acceso pendiente del proyecto.

- [x] **EX1-05 — Resolver fuentes de texto autorizadas.**
  Componente: handlers del módulo, `knowledgeHandlers.ts`, `delivery2Handlers.ts` y adaptador IA.
  Resultado/aceptación: resolver notas, tareas, actividades, trabajos, evidencias y guías por
  ID en servidor; fijar versión/instantánea y huella; rechazar baja, retiro o fuente ajena.
  Dependencias: EX1-01/02; permisos/versiones de los módulos 3.2–3.5.

- [x] **EX1-06 — Preparar fragmentos, procedencia y cobertura.**
  Componente: `packages/core/src/ai.ts` nuevo; reutilizar reglas de `guides.ts`.
  Resultado/aceptación: fragmentos ubicables, deduplicación guía/original, temas cubiertos y
  faltantes, marcas de contradicción revisables y fallas/truncamientos explícitos; sin parcial manual.
  Dependencias: EX1-05.

- [x] **EX1-07 — Construir selector y vista previa reutilizables.**
  Componente: componentes nuevos bajo `packages/app/src/components/`; `data/types.ts`.
  Resultado/aceptación: filtros materia/parcial/tema, selección y exclusión manual, estado
  de cada fuente y vista del material exacto que se enviará con estimación de consumo.
  Dependencias: EX1-04/06; reutilizar patrones de `GuidesPage.tsx`.

- [x] **EX1-08 — Orquestar Gemini con solicitudes persistentes.**
  Componente: `apps/api/src/routes/ai.ts`, integración en `workerApp.ts` y `ai_generation`.
  Resultado/aceptación: usuario y fuentes autorizados de nuevo al enviar; modelo configurable,
  límites, idempotencia, estado consultable y errores depurados; contrato estructurado validado.
  Dependencias: EX1-03/06; consentimiento de EX1-04 y canal técnico de EX1-02.

- [x] **EX1-09 — Verificar la base y preparar evidencia de integración.**
  Componente: pruebas de `apps/api`, core y módulo; guía de operación en `docs/`.
  Resultado/aceptación: casos de clave inválida, cuota, timeout, concurrencia, fuentes ajenas,
  retirada, reintento y acceso técnico; reinicio conserva estados sin exponer secretos.
  Dependencias: EX1-07/08. No habilita ni despliega automáticamente la integración.

**Cierre de EX-1:** clave persistente administrable y flujo autorizado de preparación/generación
verificados en entorno aislado; evidencia sin secretos y limitaciones registradas. Todavía no
se considera terminado el recorrido de exámenes de EX-2.

**Evidencia local — 2026-10-21:** contratos, handlers, API/Miniflare e interfaz con pruebas
automatizadas; tipos y compilaciones aprobados antes de cambios concurrentes posteriores.
La revalidación global final tiene errores ajenos a EX-1 en mensajería, salas y guías,
registrados en la matriz; ese trabajo se conserva. Las últimas ejecuciones suman 885 pruebas
aprobadas entre app (473), core (83), módulo (205), API (79) y web (45), incluido el trabajo
local existente. `npm run test:spacetime:ai` aprobó el
recorrido con servidor persistente y tres identidades: clave cifrada, nota personal,
preparación redactada, UUID concurrente con una sola llamada simulada, reinicio, retiro,
eliminación y política desactivada. **Cero llamadas reales a Gemini.** El detalle operativo
está en [examenes-ia-operacion.md](examenes-ia-operacion.md).

**Pendiente operativo:** elegibilidad real del grupo, modelo y secretos del entorno,
publicación aditiva y prueba con una clave real. Estas comprobaciones no se marcan como
completadas por las pruebas sintéticas.

## EX-2 — Primera versión completa con texto

- [ ] **EX2-01 — Registrar navegación y contrato de datos del módulo.**
  Componente: `packages/core/src/modules.ts`, `packages/app/src/App.tsx`, tipos de `data/`.
  Resultado/aceptación: entrada `examenes`, sección 3.12, etapa 2; catálogo y ruta de
  detalle con estados de carga, sin clave y sin materiales; no marcar disponible antes de integrar.
  Dependencias: EX1-01/02.

- [ ] **EX2-02 — Implementar configuración y plano del examen.**
  Componente: `packages/app/src/pages/ExamsPage.tsx` nuevo y funciones de core.
  Resultado/aceptación: materia, parcial, temario, cantidad, dificultad, tipos, pesos por
  tema y tiempo opcional; cantidades consistentes y bloqueo por cobertura insuficiente.
  Dependencias: EX2-01, EX1-07.

- [ ] **EX2-03 — Generar y guardar borradores privados.**
  Componente: ruta IA especializada, handlers y entidades `exam`/`exam_version`/`exam_question`.
  Resultado/aceptación: opción única y V/F con respuesta, explicación y citas; conservar
  parámetros/procedencia; no aprobar preguntas inválidas, sin evidencia o fuera del temario.
  Dependencias: EX2-02, EX1-08/09.

- [ ] **EX2-04 — Revisar, editar y regenerar preguntas.**
  Componente: editor nuevo en `packages/app/src/components/`; handlers de exámenes.
  Resultado/aceptación: editar/eliminar y regenerar selección con consumo previo visible;
  conflicto de versión detectado, validación repetida y acción explícita de aprobar borrador.
  Dependencias: EX2-03; reutilizar `StructuredText.tsx` para texto y código.

- [ ] **EX2-05 — Fijar versiones y compartir con fuentes de grupo.**
  Componente: handlers y vistas filtradas en `packages/spacetime-module/src/`.
  Resultado/aceptación: versión lista inmutable; edición crea otra; solo dueño publica/archiva;
  fuente privada bloquea publicación y guía a crear nueva versión desde copias publicadas.
  Dependencias: EX2-04, EX1-05. Revalidar acceso y retiro al publicar.

- [ ] **EX2-06 — Iniciar intentos y proteger el solucionario.**
  Componente: entidades de intento/respuesta/solución; vistas y reducers de exámenes.
  Resultado/aceptación: versión y orden fijos, modalidad y vencimiento decididos en servidor;
  participante solo recibe soluciones según fase; autor revisa su propio borrador completo.
  Dependencias: EX2-05. Sin acceso al examen/fuentes no se inicia un intento.

- [ ] **EX2-07 — Resolver en práctica y simulacro con reanudación.**
  Componente: pantalla de intento nueva, `data/spacetimeActions.ts` y adaptadores.
  Resultado/aceptación: guardado idempotente, recarga y continuidad en otra presentación;
  confirmar en práctica revela explicación y fija respuesta; simulacro conserva respuestas
  editables hasta cierre, incluso al recuperar conexión, conservando el vencimiento original
  del servidor al reanudar; el tiempo opcional no se reinicia al recargar.
  Dependencias: EX2-06. Revalidar acceso al reanudar y mostrar pérdida de acceso sin filtrar texto.

- [ ] **EX2-08 — Corregir y mostrar resultados privados.**
  Componente: función pura nueva en core, handlers y pantalla de resultados.
  Resultado/aceptación: corrección determinista en servidor, cierre idempotente, puntaje y
  desempeño por tema con explicaciones/enlaces; sin llamada IA, ranking ni lectura ajena.
  Primera versión: cada pregunta vale un punto, sin penalización; sin responder cuenta como
  incorrecta. Mostrar aciertos/total y porcentaje; evaluar usando IDs estables de opciones.
  Dependencias: EX2-06/07. Los cambios posteriores del origen no recalifican el intento.

- [ ] **EX2-09 — Implementar historial y vigencia de fuentes.**
  Componente: catálogo/detalle de exámenes y vistas de intentos y fuentes.
  Resultado/aceptación: historial propio, fecha/versión, fuentes desactualizadas y archivo;
  retiro o revocación bloquea nuevos intentos y oculta contenido afectado también en históricos,
  conservando el resultado privado ya calculado y sin otorgar acceso por la instantánea.
  Dependencias: EX2-05/08, EX1-05.

- [ ] **EX2-10 — Integrar accesos desde materiales y paridad demo.**
  Componente: `NotesPage.tsx`, `ActivitiesPage.tsx`, `WorksPage.tsx`, `GuidesPage.tsx`;
  `data/demo.ts`, `spacetime.ts`, `spacetimeSnapshot.ts` y bindings regenerados.
  Resultado/aceptación: «Crear examen con este material» conserva selección; simulación
  reproduce reglas con datos ficticios y sin llamadas Gemini ni importación a la base real.
  Dependencias: EX2-01/09. Generar bindings desde esquema, sin editarlos manualmente.

- [ ] **EX2-11 — Verificar permisos, concurrencia y recorrido persistente.**
  Componente: pruebas de core, módulo, API y app; prueba de servidor aislado en `scripts/`.
  Resultado/aceptación: autor A, miembro B y tercero C; nota personal inaccesible, publicación,
  solucionario por fase, intento ajeno, baja, retiro, reinicio, reanudación y timeout cubiertos;
  confirmar que demo, logs, caché y novedades no filtran datos ni soluciones anticipadas.
  Dependencias: EX2-10. Usar identidades sintéticas; no copiar tokens/cuentas reales a fixtures.

- [ ] **EX2-12 — Preparar cierre y validación de publicación.**
  Componente: `docs/estado-del-proyecto.md`, `docs/despliegue.md` y este documento.
  Resultado/aceptación: registrar pruebas, tipos, compilaciones y migración aditiva; preparar
  recorrido humano web/PWA, extensión y Android con tres identidades y datos identificados.
  Dependencias: EX2-11. Publicación y recorrido real tienen evidencia separada y quedan
  pendientes hasta ejecutarse dentro de una autorización de implementación/despliegue.

**Cierre de EX-2:** el recorrido inicial funciona de extremo a extremo con datos persistentes,
permisos y soluciones protegidos, sin nuevas llamadas al resolver. Las comprobaciones locales
y la activación publicada se registran por separado; compartir nunca expone resultados.

## EX-3 — Ampliaciones en subhitos independientes

Cada subhito puede priorizarse después de EX-2. Completar uno no acredita los demás.

- [ ] **EX3-01 — EX-3A: conectar Preguntas y respuestas.**
  Componente: normalizador de fuentes y `knowledgeHandlers.ts`.
  Resultado/aceptación: pregunta/respuesta/aceptación identificadas por separado, instantánea
  y huella cuando falte versión; contradicción o respuesta no respaldada requiere revisión.
  Dependencias: EX2-11; permisos y material disponible del módulo 3.7.

- [ ] **EX3-02 — EX-3A: conectar Repaso y Aprende enseñando.**
  Componente: adaptadores, `spaced.ts`, `teaching.ts`, `SpacedPage.tsx` y `TeachingPage.tsx`.
  Resultado/aceptación: selección autorizada de tarjetas/explicaciones y notas publicadas;
  reflexión, progreso y contenido ajeno excluidos; enviar errores a Repaso solo por elección,
  creando tarjetas privadas sin duplicados y sin modificar intervalos de tarjetas existentes.
  Dependencias: EX2-11; acceso real validado de 7.8/7.9.

- [ ] **EX3-03 — EX-3B: extraer PDF con texto y documentos.**
  Componente: nuevo extractor en API, protocolo de archivos y normalizador de fuentes.
  Resultado/aceptación: límites propios de páginas/bytes/tiempo, hash/versión, citas por
  página/sección y estado por archivo; formato no soportado, vacío o protegido se informa.
  Dependencias: EX2-11; descarga autorizada de archivos nativos y compatibilidad heredada.

- [ ] **EX3-04 — EX-3B: añadir imágenes y documentos escaneados con OCR.**
  Componente: extractor y vista previa de fragmentos nuevos.
  Resultado/aceptación: mostrar texto reconocido y ubicación para revisión antes de generar;
  advertir fórmulas/código dudosos, rechazar archivos fuera de límites y medir consumo;
  elegir solución compatible con SpacetimeDB/Cloudflare y BYOK, sin activar pagos automáticamente.
  Dependencias: EX3-03; viabilidad y límites del procesamiento confirmados.

- [ ] **EX3-05 — EX-3C: banco reutilizable y variantes.**
  Componente: esquema/adaptadores de exámenes, catálogo y funciones de selección en core.
  Resultado/aceptación: reutilizar preguntas con procedencia, versión y permisos; variantes
  equivalentes según temario/dificultad, orden reproducible por intento y sin duplicados;
  retirar una fuente aplica también a preguntas reutilizadas y variantes futuras.
  Dependencias: EX2-11; no requiere completar OCR ni respuestas abiertas.

- [ ] **EX3-06 — EX-3D: respuestas abiertas con rúbrica y revisión manual.**
  Componente: tipos de core, solucionario, handlers y editor/corrección de intento.
  Resultado/aceptación: rúbrica y criterios versionados; estados sin evaluar/evaluado claros,
  evidencia y revisión por el dueño; separar puntaje cerrado determinista del abierto.
  Dependencias: EX2-11; acuerdo del flujo de revisión sin exponer respuestas ajenas.

- [ ] **EX3-07 — EX-3D: evaluación asistida por IA opcional.**
  Componente: ruta IA de evaluación y resultados del intento.
  Resultado/aceptación: consentimiento, clave del solicitante y consumo previo; rúbrica,
  explicación y estado de evaluación guardados; permitir revisión y corregir valoración,
  sin presentar la estimación del modelo como calificación oficial ni reenviar en cada visita.
  Dependencias: EX3-06, EX1-08; respuestas propias enviadas solo tras elección expresa.

- [ ] **EX3-08 — Verificar y documentar cada ampliación antes de activarla.**
  Componente: pruebas de extractores/permisos/IA, app y `docs/estado-del-proyecto.md`.
  Resultado/aceptación: matriz por subhito con casos válidos, fallidos, revocación, cuotas y
  persistencia; evidencia local y publicada separadas; conservar compatibilidad de EX-2.
  Dependencias: las tareas del subhito que se pretenda cerrar; no bloquea otros subhitos.

**Cierre de EX-3:** se declara por subhito A/B/C/D con evidencia de sus tareas y EX3-08.
Las fuentes de retos, revisión de código y museo de bugs requieren antes implementar y
validar sus módulos. Ejecutar código de preguntas o respuestas exige otro diseño, aislamiento
y tarea específica; no forma parte de mostrar código ni de evaluar texto con una rúbrica.

## Orden de implementación y evidencia

Secuencia de dependencias: contratos y permisos → claves persistentes (EX1-02/03/04) y
fuentes (EX1-05/06) → selector y orquestación (EX1-07/08) → verificación EX1-09 →
configuración y borrador (EX2-01/02/03) → revisión y publicación (EX2-04/05) → intentos,
corrección e historial (EX2-06/07/08/09) → integración y validación (EX2-10/11/12).
Claves y fuentes pueden avanzar en paralelo después de acordar contratos. EX2-01 puede
prepararse con esos contratos, sin anunciar disponibilidad antes de completar la integración.
Esta secuencia no estima plazos; las dependencias específicas de cada tarea son las que
determinan cuándo puede comenzar.

Para cerrar una tarea se adjuntará referencia de cambios, prueba o recorrido pertinente,
fecha y limitaciones. Pruebas significativas de privacidad, generación e intentos preceden
las verificaciones generales del repositorio (`npm test`, `npm run typecheck`, compilaciones
de las presentaciones afectadas); no se registran como aprobadas antes de ejecutarlas.

La validación publicada registrará versión del módulo y de cada presentación, tres
identidades, escenario y resultado sin secretos ni datos personales. Una compilación, push
o publicación del backend por sí sola no acredita el recorrido humano. **EX-1 está implementado y verificado localmente;
Gemini real y la publicación permanecen pendientes. EX-2 y EX-3 aún no están implementados.**
