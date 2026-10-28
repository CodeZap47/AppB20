# Lenguaje de señales: plan del módulo 3.11

Fecha: 26 de octubre de 2026. Estado: **implementado localmente; publicación y aceptación
con compañeros pendientes**. Pertenece a la entrega 5.
El [registro de implementación y comprobaciones](lenguaje-senales-entrega.md) distingue
el código local, las decisiones aplicadas y la publicación futura.

## Base documental y estado comprobado

El alcance ya existe en la [sección 3.11 de la definición](definicion-del-proyecto.md#311-lenguaje-de-señales-y-recursos-para-intercambiar-respuestas):
diccionario versionado para lápices/plumas, zapateadas y nudillos; constructor de mensajes;
entrenamiento individual y en parejas; historial personal; fichas de anotaciones con fuentes.

El catálogo contiene `senales`, con el título «Lenguaje de señales», etapa 3 y
funcionamiento sin IA. La implementación local activa `ready: true` y la ruta
`/m/senales`, con demo y persistencia privada. La [matriz de estado](estado-del-proyecto.md)
mantiene pendiente su publicación y aceptación. La etapa del catálogo y el número de
entrega son clasificaciones distintas.

Los requisitos de esa sección se conservan. El resto de este documento conserva el plan
original; las propuestas resueltas durante la implementación se concretan en el registro
de entrega. No se presentan esas decisiones técnicas como acuerdos nuevos del grupo.

## Resultado esperado de la primera versión

Un integrante podrá consultar una versión del diccionario, construir un mensaje con
referencia de pregunta, respuesta y confirmación, practicar su interpretación, invitar a
otro compañero y revisar sus propias confusiones. También podrá preparar fichas breves
desde materiales a los que tiene acceso, conservando su procedencia.

Los tres medios se representarán con botones, dibujos y secuencias en pantalla. No habrá
captura de micrófono, cámara o sensores, reconocimiento físico automático ni necesidad de
Gemini. La primera versión no añade otros métodos a los descritos en la definición.
Se conserva el aviso de uso de la sección 3.11; el módulo no determina qué materiales
están autorizados en una evaluación.

## Pantallas y recorridos propuestos

Entrada en `/m/senales`, con cinco apartados:

| Apartado | Recorrido principal |
| --- | --- |
| Diccionario | Filtrar por materia, tema y medio; consultar significado y ejemplo; crear un borrador, revisar diferencias y publicar una versión. Mostrar siempre la versión consultada. |
| Constructor | Seleccionar diccionario y versión, medio, referencia y respuesta; mostrar la secuencia con separadores y confirmación; advertir elementos ausentes o ambiguos. Guardar solo por acción expresa. |
| Practicar | Aprender con tarjetas; reconocer señales; construir la secuencia inversa; revisar errores y repetir las convenciones que causan confusión. |
| En pareja | Invitar a un compañero activo; aceptar o rechazar; fijar versión y medio; alternar emisor/receptor por turnos; terminar y consultar el resultado permitido. |
| Fichas | Crear una anotación con materia, tema, pregunta/referencia, contenido breve, soporte previsto, fuente y fecha de revisión; editar y consultar versiones propias. |

Los resultados personales estarán dentro de Practicar, sin clasificaciones públicas.
Se propondrán rutas de detalle para diccionario, práctica, sesión y ficha bajo esa entrada.
En móvil habrá controles táctiles amplios y ninguna interacción que dependa solo del color,
del sonido, del movimiento o de pasar el cursor. Las animaciones respetarán movimiento
reducido y tendrán una representación estática equivalente.

## Reglas funcionales

### Diccionario y versiones

- Admitir varios diccionarios por materia/tema y señalar cuál se está consultando; no
  mezclar convenciones de diccionarios distintos en un mismo mensaje.
- SE-1 fijará cómo se elige el diccionario común recomendado por materia/tema y quién
  puede cambiar esa selección. Los diccionarios alternativos no sustituirán ese acuerdo.
  Propuesta para incorporar cambios: otro integrante envía una copia revisable y el autor
  del original la acepta mediante una nueva versión, sin sobrescribir la publicada.
- Cada señal tendrá identidad estable, nombre, significado, medio, representación
  estructurada y ejemplo. Las secuencias rítmicas distinguirán eventos y separadores;
  las representaciones visuales usarán posiciones/movimientos definidos.
- Publicar creará una versión inmutable. Cambiar una señal requerirá otra versión;
  prácticas y mensajes anteriores conservarán la versión que utilizaron.
- Rechazar secuencias idénticas con significados distintos dentro del mismo medio y
  versión. Detectar también prefijos ambiguos cuando el formato no los desambigüe con
  separadores. Publicar exigirá resolver esos conflictos.
- Antes de publicar, comprobar que cada medio ofrecido en el constructor tenga las
  convenciones necesarias para referencia, respuesta, separación, repetición,
  confirmación y final; no ofrecer ejercicios que el diccionario no pueda representar.
- Antes de publicar, mostrar diferencias, autor y fecha. Un cambio ajeno no sobrescribirá
  un borrador abierto: se comprobará su versión y se conservará el texto local del usuario.

### Constructor y práctica individual

- Representar mensajes como elementos estructurados: referencia → respuesta → confirmación,
  con controles para separar, repetir y finalizar según el diccionario elegido.
- No interpretar automáticamente una secuencia ambigua o incompleta. Mostrar el punto
  del conflicto y permitir corregirla.
- Guardar el mensaje por elección del autor, separado del diccionario compartido.
- Fijar versión, medio, ejercicio y respuesta esperada al iniciar cada intento. Resolver
  y guardar el resultado en el servidor; reintentar el envío no creará otro intento.
- Revelar la solución del ejercicio después de responder o abandonar. Evaluar la
  correspondencia con el diccionario; una interpretación acertada no demuestra que la
  respuesta académica transmitida sea correcta.
- El historial propio distinguirá medio, versión, tipo de ejercicio, aciertos y confusiones.
  Aprender otra versión no recalculará los resultados anteriores.

### Parejas

- Estados propuestos: invitación pendiente → aceptada → en curso → finalizada; con rechazo,
  cancelación y caducidad. El invitado verá antes de aceptar quién invita, versión y medio.
- Habrá exactamente dos participantes. El servidor decidirá el turno vigente, quién
  puede enviar y quién puede responder; cada turno aceptará una única resolución.
- El receptor verá la secuencia y el contexto del ejercicio, pero no el mensaje objetivo
  antes de responder. Después, ambos podrán revisar ese turno; el historial individual y
  las demás prácticas de cada persona seguirán privados.
- Reconectar recuperará el mismo turno y versión. Rechazar/cancelar una invitación o salir
  de una sesión activa impedirá nuevos turnos; una baja revocará el acceso inmediatamente.
- Una invitación pendiente mostrará solo su ficha. No dará acceso a turnos, respuestas ni
  resultados. No se abrirán conversaciones directas ni se enviarán mensajes por el usuario.

### Fichas y procedencia

- Propuesta inicial: fichas privadas de su autor, con revisiones; compartir una ficha se
  dejará para una acción explícita con permisos propios, sin ampliar esta primera versión.
- Admitir fuentes de Notas y trabajos accesibles. Conservar tipo, identificador, versión
  y ubicación cuando exista; registrar autor y fecha de revisión de la ficha.
- Si no hay fuente, identificarla como anotación propia. No inventar citas ni presentar una
  abreviatura como explicación completa; permitir añadir condiciones, unidades y contexto.
- Volver a comprobar el acceso al abrir una fuente. Su retirada no habilitará descargarla
  ni ver fragmentos guardados para eludir sus permisos. El texto escrito por el autor en
  su ficha y la disponibilidad actual de la fuente se mostrarán por separado.
- El soporte previsto, incluido «borrador», será un dato descriptivo. La app no lo marcará
  como material permitido por haber creado la ficha.

## Datos y permisos propuestos

Todas las tablas nuevas serán privadas; las vistas filtrarán membresía, autoría y
participación en el servidor. Tener un identificador o una ruta no concederá lectura.

| Entidad lógica | Información principal | Lectura y cambios |
| --- | --- | --- |
| Diccionario | Grupo, materia, tema, título, autor, versión publicada y archivo | Lectura de publicados por miembros activos; propuesta: cualquier miembro crea, el autor edita su borrador, los demás proponen cambios en una copia. |
| Versión y señales | Número, autor, fecha, significados y representaciones por medio | Versiones publicadas consultables por el grupo e inmutables; el autor publica su borrador validado. |
| Mensaje guardado | Autor, versión, medio y elementos del mensaje | Solo su autor; no aparece automáticamente en el diccionario. |
| Práctica e intento | Autor, versión, ejercicio fijado, respuesta, solución y resultado | Solo su autor; las vistas no entregan soluciones de intentos pendientes. |
| Sesión y turno | Dos participantes, invitación, estado, versión, roles y respuestas | Ficha mínima para el invitado; turnos solo para participantes que aceptaron, según su fase. |
| Ficha, revisión y fuente | Autor, materia, tema, referencia, anotación, soporte y procedencia | Solo su autor en la primera versión, con acceso a la fuente comprobado por separado. |

Administrar el grupo no concederá lectura general de prácticas, mensajes guardados,
sesiones o fichas privadas. Las operaciones administrativas existentes no se ampliarán
por el mero hecho de añadir las tablas.

Archivar un diccionario lo retirará de nuevas prácticas, conservando las versiones usadas
en el historial autorizado. Propuesta para material propio: papelera de 30 días mediante
la infraestructura existente. Antes de programar la purga se resolverán dependencias de
versiones y sesiones compartidas: no borrar el historial del compañero al eliminar el propio
ni conservar indefinidamente datos que deban purgarse. La política final y sus casos de prueba
forman parte de la fase SE-1.

Los cambios usarán versión esperada. Las creaciones, publicaciones, invitaciones, turnos e
intentos usarán identificador de petición y comprobarán su contenido al reintentar.
Los límites se validarán en cliente y servidor; propuesta inicial: títulos de 160 caracteres,
significados de 500, ejemplos de 2.000, fichas de 4.000, hasta 200 señales por versión,
64 elementos por mensaje y 30 turnos por sesión. Son límites técnicos a verificar en SE-1.

## Integración en el proyecto

- **Núcleo:** añadir contratos y funciones puras en `packages/core/src/signals.ts` para
  secuencias, ambigüedad, mensajes, estados y corrección de ejercicios.
- **Persistencia:** tablas y handlers específicos en `packages/spacetime-module/src`,
  registrados en `index.ts`; reutilizar membresía, identidad, materias, versiones y
  transacciones existentes. No crear otro servicio de autenticación ni de datos.
- **Cliente y demo:** contrato `SignalsActions`/`SignalsSnapshot`, adaptadores persistente
  y simulado con las mismas reglas. La demo usará identidades y materiales sintéticos.
- **Interfaz compartida:** pantallas en `packages/app/src/pages`, rutas específicas antes
  de `m/:moduleId` y navegación desde el catálogo. Activar `ready` cuando el recorrido
  implementado sea utilizable; no activarlo solo por añadir pantallas vacías.
- **Referencias:** reutilizar acceso a Notas, trabajos, materias y perfiles para fuentes
  y elección de pareja, sin copiar contenido privado a otros módulos.
- **Avisos:** invitaciones internas con contenido mínimo y apertura sujeta a permisos.
  Push y recordatorios posteriores no son requisito de esta versión.
- **Contribuciones y novedades:** no sumar puntos por mensajes o ejercicios ni publicar
  desempeño privado en perfiles, ranking o feed. Añadir un tipo al catálogo no debe
  incluirlo automáticamente en esas fuentes.

## Entregas de implementación

| Hito | Trabajo | Criterio para cerrarlo |
| --- | --- | --- |
| SE-1: contratos y decisiones | Fijar representaciones para los tres medios, reglas de ambigüedad, permisos de edición/publicación, estados, límites y conservación; ejemplos sintéticos y matriz de acceso. | Casos claros de secuencia válida, inválida y ambigua; reglas de purga y visibilidad por fase escritas; contratos coherentes en demo y servidor. |
| SE-2: diccionario y constructor | Persistencia y vistas; editor, versiones, comparación, consulta y construcción/guardado de mensajes. | Dos cuentas consultan la misma versión; una edición concurrente no sobrescribe; actualizar o archivar no rompe un mensaje previo. |
| SE-3: práctica individual | Tarjetas, reconocimiento, ejercicio inverso, corrección e historial propio para los tres medios. | Un intento conserva su versión, se corrige una sola vez y permanece privado tras recargar y reconectar. |
| SE-4: parejas | Invitación, aceptación, turnos alternos, corrección, cancelación, salida y reconexión. | Dos participantes completan un ejercicio; un tercero y un administrador ajeno no lo leen; no se revela el objetivo anticipadamente; turnos simultáneos se resuelven sin duplicados. |
| SE-5: fichas e integración | Fichas y revisiones, referencias autorizadas, filtros por materia/tema y avisos internos. | Se conserva la procedencia y su versión; una fuente retirada no se filtra; fichas y resultados no aparecen en novedades, perfiles ni ranking. |
| SE-6: validación y preparación de publicación | Pruebas integradas, accesibilidad, recorridos por plataforma, migración aditiva y documentación de operación. | Evidencia local reproducible; checklist de publicación y piloto separado; ningún estado se marca publicado por una compilación. |

Orden: SE-1 → SE-2 → SE-3 → SE-4 → SE-5 → SE-6. Tras fijar los contratos de SE-1,
las fichas de SE-5 pueden desarrollarse en paralelo a las prácticas. La primera entrega
interna revisable será SE-2; el alcance completo de 3.11 requiere cerrar los seis hitos.
No se asignan fechas sin estimar estos hitos sobre el estado de código que se integrará.

## Comprobaciones necesarias

1. Pruebas del núcleo para versiones, codificación/interpretación, separadores,
   secuencias ambiguas, límites y transiciones de estados.
2. Pruebas de persistencia y equivalencia con demo: autor, pareja, tercero, administrador
   ajeno y miembro dado de baja; soluciones ocultas, reintentos y conflictos de versión.
3. Pruebas de interfaz: tres medios, errores que conservan el borrador, invitaciones,
   alternancia, fuentes inaccesibles y vaciado de contenido privado al perder acceso.
4. Ensayo con SpacetimeDB local aislado e identidades sintéticas: reinicio persistente,
   suscripciones sin acceso directo a tablas, bajas, turnos concurrentes y retención.
5. Tipos y compilaciones de las presentaciones compartidas. Validación visual móvil y
   escritorio, teclado, lector de pantalla y movimiento reducido. Instalación y uso en
   PWA, extensión y APK se comprobarán aparte en dispositivos reales.

Una futura publicación requerirá generar bindings compatibles, publicar primero el
módulo aditivo con `--delete-data=never`, comprobar conservación de datos y después
actualizar los clientes. No se necesita ampliar el Worker de IA para este módulo.
El recibo de publicación y la aceptación con compañeros se registrarán por separado.

## Próximo paso

Revisar el módulo local y preparar la publicación aditiva descrita en el registro de
entrega. Las pruebas con cuentas y dispositivos reales siguen pendientes.
