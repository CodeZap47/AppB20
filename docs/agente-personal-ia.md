# Agente personal de escritura (NOMBRE_BOT): alcance y plan

Estado: **AG-1, AG-2 y AG-3 implementados localmente (interfaz, lógica en `@b20/core` y datos en SpacetimeDB; sin publicar en Maincloud)**; AG-4 y AG-5 pendientes. Fecha de planeación: 21 de octubre de 2026.
Se propone como función adicional **7.13** de la [definición del proyecto](definicion-del-proyecto.md)
y aplica sin excepciones las reglas de BYOK, consentimiento, costos y revisión de la sección 4
y de [Gemini con clave personal](gemini-byok.md).

Los hitos **AG-1 a AG-5** pertenecen únicamente a este módulo; no renumeran las entregas
globales.

## Idea y criterio de diseño

Cada miembro activo tiene un agente de IA propio que aprende cómo escribe a partir de los
textos que esa persona entregó como tareas, actividades, trabajos y evidencias. El agente
le ayuda a hacer la tarea con su propia voz: explica la consigna, propone un enfoque, arma
un esquema, revisa el borrador que la persona escribe y señala cuando su texto se parece
demasiado al de un compañero.

El criterio que ordena el módulo es el mismo que la sección 4 fija para Tareas y Actividades:
*explicar instrucciones, planear un enfoque, dar pistas y revisar razonamientos*. La app
complementa las indicaciones docentes y las entregas oficiales siguen en los sistemas de la
universidad. Por eso el agente **escribe con la persona, no en lugar de ella**, y la
comparación con los demás agentes sirve para que cada quien produzca un trabajo propio, no
para ocultar que dos trabajos salieron del mismo lugar.

### Nombre automático

El agente se llama `NOMBRE_BOT`, donde `NOMBRE` es el nombre que la persona registró en su
cuenta (`member`). Regla propuesta, implementada como función pura en `@b20/core`:

1. Tomar el nombre visible del miembro y quedarse con la primera palabra.
2. Quitar espacios sobrantes y caracteres que no sean letras, números o guion bajo,
   conservando acentos y ñ.
3. Añadir el sufijo `_BOT`: «Luis Flores» → `Luis_BOT`.
4. Si otro miembro activo produce el mismo nombre, añadir las iniciales del resto del nombre
   (`Luis_F_BOT`; en la simulación, «Alumno de prueba 1» → `Alumno_DP1_BOT`). Si aún
   coinciden, se numeran por orden de llegada (`Luis_F1_BOT`, `Luis_F2_BOT`). El nombre se
   recalcula cuando cambia el del miembro.

Decisión abierta: permitir o no que cada persona lo renombre.

## Premisas del agente (texto literal)

Estas premisas se muestran **textualmente** en la pantalla del agente, en el consentimiento
y antes de cada generación, como recordatorio de lo que hace y no hace. El mismo texto
forma parte de las instrucciones de sistema que el Worker envía a Gemini; ambos salen de una
sola constante versionada (`AGENT_PREMISES` en `@b20/core`) para que nunca diverjan.

> **Lo que hace NOMBRE_BOT**
>
> 1. Soy NOMBRE_BOT, el agente personal de NOMBRE. Solo trabajo para la persona dueña de esta cuenta y solo con su clave de Gemini.
> 2. Aprendo cómo escribe NOMBRE únicamente a partir de los textos que NOMBRE entregó como tareas, actividades, trabajos o evidencias, y que eligió usar para entrenarme.
> 3. Escribo con el estilo de NOMBRE: su vocabulario, el largo de sus frases, su forma de explicar y su nivel técnico. No invento experiencias, datos ni fuentes que NOMBRE no haya aportado.
> 4. Explico la consigna, propongo un enfoque, armo esquemas y doy pistas para que NOMBRE haga la tarea.
> 5. Reviso lo que NOMBRE escribe y sugiero cambios que NOMBRE acepta o rechaza uno por uno.
> 6. Comparo el resultado con el trabajo que ya publicaron los agentes y los compañeros del grupo. Si se parece demasiado, lo señalo con el fragmento parecido para que NOMBRE lo reescriba con sus propias ideas.
> 7. Todo lo que produzco nace como borrador privado marcado como «generado con NOMBRE_BOT» y muestra las fuentes que usé.
>
> **Lo que no hace NOMBRE_BOT**
>
> 8. No entrego, publico ni subo tareas por mi cuenta. Publicar o entregar siempre es una acción expresa de NOMBRE.
> 9. No me hago pasar por NOMBRE ante compañeros, docentes ni otros sistemas: no envío mensajes, comentarios ni respuestas en su nombre.
> 10. No reescribo un texto solo para que parezca distinto del de otra persona. Señalo el parecido; la versión propia la decide y escribe NOMBRE.
> 11. No uso textos de otras personas para imitar su estilo ni para entrenarme, y no leo borradores privados, mensajes 1 a 1, perfiles ni cumpleaños.
> 12. No sustituyo las indicaciones del docente ni las entregas oficiales de la universidad.
> 13. No uso la clave de otra persona ni genero sin que NOMBRE confirme el envío y su posible consumo.

En pantalla, `NOMBRE` y `NOMBRE_BOT` se sustituyen por los valores reales de la cuenta.

## Fuentes del estilo

| Fuente | Condición | Hito |
| --- | --- | --- |
| Trabajos (`work`) | Solo los que la persona firma como único autor; los coautorados aparecen como «Coautorado: incluir manualmente» y nunca se suman en silencio. | AG-3 |
| Evidencias (`evidence`) | Solo las que publicó la persona. | AG-3 |
| Notas personales y del grupo | Solo las propias, seleccionadas expresamente. | AG-3 |
| Consignas (`assignment`) | Nunca como estilo (son páginas tipo wiki editadas por el grupo); sí como contexto de la tarea a resolver. | AG-4 |
| Adjuntos | Mismas reglas de UTF8 y 256 KiB de Gemini BYOK; PDF y DOCX quedan como omisiones explícitas hasta que exista extracción. | AG-4 |

Se excluyen mensajes, chats 1 a 1, perfiles, cumpleaños, comentarios ajenos y cualquier
material retirado o inaccesible. Cambiar una fuente deja el perfil de estilo desactualizado.

## Plan gradual

### AG-1. Interfaz visual (sin backend ni Gemini)

**Implementado localmente el 21 de octubre de 2026.** `agentName`, `agentOwnerName` y
`renderAgentPremises` viven en `packages/core/src/agent.ts`; la simulación en
`packages/app/src/data/agentDemo.ts`; la pantalla en `packages/app/src/pages/AgentPage.tsx`
(ruta `/m/agente`, módulo `agente` del catálogo) y el enlace «Pedir ayuda a NOMBRE_BOT» en
la página de cada tarea. El estado del agente vive solo en la pestaña: se reinicia al
recargar o cambiar de integrante. Lo que no se hizo en AG-1: persistencia, Gemini y
comparación definitiva, que corresponden a AG-2 a AG-4.

Objetivo: recorrer toda la experiencia con la simulación de datos existente.

- Página `packages/app/src/pages/AgentPage.tsx`, ruta `/m/agente`, dentro del grupo
  «Estudio» de `navigation.ts`, con iconos de Untitled UI como el resto de la navegación.
- Encabezado con avatar del miembro, nombre `NOMBRE_BOT` y estado (sin configurar,
  aprendiendo, listo, desactualizado).
- Panel «Premisas» con el texto literal y un enlace persistente desde cada pantalla.
- **Entrenar estilo:** selector de fuentes reutilizando `AiSourceSelector` y la vista previa
  de `AiSourcePreview` (fragmentos, omisiones, coautorías).
- **Perfil de estilo:** tarjetas legibles (tono, longitud media de frase, vocabulario frecuente,
  estructura habitual, nivel técnico) con fragmentos de ejemplo y fecha de actualización.
- **Ayudar con una tarea:** se abre desde una tarea o actividad («Pedir ayuda a NOMBRE_BOT»);
  pestañas Entender consigna → Enfoque → Esquema → Revisar mi borrador.
- Editor de borrador con sugerencias aceptables una por una (estilo control de cambios).
- **Alerta de originalidad:** porcentaje de parecido por compañero publicado, con el
  fragmento propio y el ajeno lado a lado, y el botón «Reescribiré esta parte»; no hay botón
  de reescritura automática.
- Botón deshabilitado «Subir tarea (plug-in, pendiente)».
- Estados vacíos, carga, error y recorrido sin clave, con componentes de `ai.css` y los
  `Empty`/`useAction` existentes. Pruebas de componentes en Vitest.

### AG-2. Lógica de dominio (`@b20/core`, funciones puras)

**Implementado localmente el 21 de octubre de 2026** en `packages/core/src/agentStyle.ts`, con
pruebas en `agentStyle.test.ts`. La pantalla ya usa estas funciones; la ayuda por etapas y las
sugerencias siguen simuladas hasta AG-4.

| Función | Comportamiento |
| --- | --- |
| `styleFeatures` / `describeStyle` | Palabras, oraciones, largo medio, vocabulario con acentos, proporción en primera persona, listas, preguntas y líneas de código. El código no cuenta para el largo de frase. |
| `similarity` | Grupos de 5 palabras normalizadas (sin mayúsculas, acentos ni puntuación). `score` = porcentaje del texto propio presente en el otro; `jaccard` sobre la unión. Empareja oraciones cuando al menos la mitad de la propia aparece en una ajena. |
| `compareWithPublished` | Devuelve solo lo que merece alerta, ordenado por nivel y porcentaje. |
| `originalityThresholds` | Por omisión: aviso 25 %, alto 60 %, mínimo 25 palabras, grupos de 5. Valida 1 ≤ aviso < alto ≤ 100 y grupos de 3 a 8 palabras. |

Casos difíciles resueltos:

- **Código:** bloques con triple acento grave, código en línea y líneas con forma de código se
  separan de la prosa y no cuentan como parecido. La prosa que termina en punto y coma no se
  confunde con código.
- **Citas de la consigna:** el título y las instrucciones de la tarea se pasan como `ignore`;
  sus grupos de palabras se descartan en ambos textos. Las citas entre «», “” o "" tampoco cuentan.
- **Textos muy cortos:** con menos de 25 palabras de prosa no se da porcentaje (`too_short`),
  pero una oración copiada completa sí genera aviso. Sin grupos comparables el resultado es
  `nothing_to_compare`.
- Una oración copiada completa avisa aunque el porcentaje total quede bajo el umbral.

Plan original:

- `agentName(member, members)`: regla del nombre y desempate.
- `AGENT_PREMISES` y `renderPremises(name, owner)`: texto versionado.
- `styleFeatures(texts)`: métricas deterministas sin IA (longitud de frase, signos, conectores,
  muletillas, proporción de listas y código) que alimentan el perfil y sirven de base cuando
  no hay clave.
- `similarity(a, b)`: huellas por *shingles* de 5 palabras normalizadas y Jaccard, más
  coincidencia de oraciones; devuelve los pares de fragmentos y no requiere Gemini.
- Umbrales configurables (`ORIGINALITY_WARN`, `ORIGINALITY_BLOCK_PUBLISH`), con pruebas
  unitarias y casos de borde (código, citas textuales de la consigna, textos muy cortos).
- La simulación (`community4Demo` o un `agentDemo.ts` nuevo) usa estas funciones para AG-1.

### AG-3. Backend y base de datos (SpacetimeDB)

**Implementado localmente el 21 de octubre de 2026** en `packages/spacetime-module/src/agentTables.ts`
y `agentHandlers.ts`, con pruebas en `agent.test.ts` y la prueba con servidor persistente
`npm run test:spacetime:agent` (`scripts/smoke-spacetime-agent.mjs`, requiere Node 22). Falta
publicar el módulo en Maincloud con `--delete-data=never`; las tablas son aditivas.

| Tabla (privada) | Contenido |
| --- | --- |
| `agent_profile` | Una fila por miembro: versión de premisas aceptada, fecha de consentimiento y versión del estilo. |
| `agent_style_source` | Fuentes elegidas con la versión de cada una al entrenar. |
| `agent_style_snapshot` | `styleFeatures` + `describeStyle`, ejemplos y fuentes; se conservan los 5 más recientes. |
| `agent_session` | Una ayuda sobre una tarea: etapa, borrador, versión del borrador y generación para vencimiento. |
| `agent_suggestion` | Sugerencias propuestas, aceptadas o rechazadas, ligadas a la versión del borrador. |
| `agent_originality_check` | Coincidencias calculadas en el servidor y marcas «reescribiré esta parte»; 10 por sesión. |
| `agent_expiry` | Tabla programada interna: vence sesiones sin uso tras 180 días. |

- **Vistas** `my_agent_profile`, `my_agent_sources`, `my_agent_style_snapshots`, `my_agent_sessions`,
  `my_agent_suggestions` y `my_agent_originality_checks`: solo filas de quien consulta y solo con
  membresía activa. Las tablas no se pueden suscribir directamente.
- **Reducers:** `enable_agent` (exige la versión vigente de las premisas), `train_agent` (solo
  trabajos con autoría propia, evidencias propias y notas propias de estudiante, no retiradas),
  `start_agent_session` (idempotente por `requestId`), `save_agent_draft`, `propose_agent_suggestions`,
  `resolve_agent_suggestion` (la aceptación se aplica en el servidor y sube la versión),
  `check_agent_originality`, `acknowledge_agent_match`, `delete_agent_session` y `disable_agent`.
  Todos verifican membresía activa, dueño y versión esperada.
- **Comparación en el servidor** con `compareWithPublished` contra trabajos y evidencias no
  retirados de otras personas (se excluyen los propios, los coautorados y las evidencias donde
  la persona participa), ignorando el título y las instrucciones de la tarea. Los borradores de
  otros agentes son privados y no se comparan.
- **Retención y purga:** desactivar el agente o dar de baja al miembro borra todo lo suyo; la
  purga de contenido retirado (`trashHandlers`) lo quita de las fuentes y de las comparaciones
  guardadas; las sesiones sin uso vencen a los 180 días.
- **Cliente:** `agentTypes.ts`, `agentActions.ts`, `agentSnapshot.ts` y la simulación
  `agentStore.ts` con las mismas reglas. La pantalla pide aceptar las premisas, guarda borrador,
  etapa, sugerencias y comparaciones, y conserva todo al recargar.
- Pendiente de decidir: confirmar la alerta al publicar un trabajo con parecido alto.

### AG-4. Sincronización gradual con Gemini BYOK

Reutiliza claves cifradas, presupuesto, reservas e idempotencia de `apps/api/src/ai/`.
Nuevas rutas en `agentRoutes.ts` y proveedor en `agentProvider.ts`, siempre con salida JSON
estructurada y `AGENT_PREMISES` como instrucción de sistema.

1. **AG-4a Perfil de estilo:** Gemini resume el estilo a partir de fragmentos propios y las
   métricas de AG-2. No hay *fine-tuning*: el «entrenamiento» es un perfil versionado más
   ejemplos breves elegidos (pocos *shots*) guardados en `agent_style_snapshot`.
2. **AG-4b Entender y planear:** explicación de consigna, enfoque y esquema con citas a la
   consigna y a las notas seleccionadas.
3. **AG-4c Revisión del borrador:** sugerencias puntuales sobre el texto que escribió la
   persona, con el estilo del perfil; se limita la proporción de texto nuevo por sugerencia.
4. **AG-4d Originalidad asistida:** sobre la comparación determinista de AG-2, Gemini explica
   *por qué* dos fragmentos coinciden (misma fuente, misma estructura) y pregunta qué idea
   propia podría desarrollar la persona. No devuelve una versión parafraseada.

Cada paso entra apagado tras su propio flag (`AGENT_AI_STEP`), con pruebas en Miniflare con
el proveedor interceptado, y se habilita uno a la vez después de validarlo con una clave
personal real por acción expresa de su titular.

### AG-5. Plug-in para subir tareas — **PENDIENTE**

Idea registrada: el agente funcionaría como plug-in capaz de subir las tareas. Queda
pendiente y sin diseño técnico. Condiciones antes de diseñarlo:

- Subir solo un trabajo que la persona marcó como Final, revisó y confirmó en ese momento
  (premisa 8): el plug-in ejecuta la subida, la decisión sigue siendo humana.
- Definir el destino: el archivo de Trabajos de la app (viable con los reducers existentes)
  o un sistema de la universidad, que exige revisar sus términos y no guardar credenciales
  universitarias en la app.
- Encaje con la extensión Manifest V3 (`apps/extension`) y registro de cada subida en el
  historial.

## Pendientes y decisiones abiertas

- [ ] Confirmar el número 7.13 y la etapa en la definición del proyecto.
- [ ] ¿Renombrar NOMBRE_BOT libremente o solo el derivado?
- [ ] Umbrales de originalidad y si bloquean publicar o solo avisan.
- [ ] Incluir o no notas del grupo editadas por varias personas como fuente de estilo.
- [ ] **AG-5 plug-in de subida de tareas (pendiente).**
- [ ] Validación humana con dos o tres cuentas invitadas, como en Tareas y Exámenes.
