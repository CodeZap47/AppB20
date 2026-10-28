# Lenguaje de señales: implementación y publicación

26 de octubre de 2026. Módulo 3.11, entrega 5.
**Publicado junto con las mejoras de Mensajes el 26 de octubre de 2026; aceptación con el grupo y dispositivos pendiente.** [Recibo de publicación y conservación de datos](mensajes-mejoras.md#recibo-de-publicación-del-26-de-octubre-de-2026).
Alcance: [definición funcional](definicion-del-proyecto.md#311-lenguaje-de-señales-y-recursos-para-intercambiar-respuestas)
y [plan SE-1 a SE-6](lenguaje-senales.md).

## Recorrido disponible

`/m/senales` aparece en Estudio y en el catálogo. Cinco apartados comparten interfaz en
web/PWA, extensión y Android:

- **Diccionario:** crear con convenciones de ejemplo de lápices/plumas, zapateadas y
  nudillos; editar señales con campos y secuencias, revisar diferencias, publicar versiones
  inmutables, consultar versiones anteriores, proponer una copia y aceptar su versión
  publicada. Archivar impide usos nuevos y conserva el historial.
- **Constructor:** referencia de uno a tres dígitos, respuesta definida por el diccionario,
  repetición opcional, confirmación y final. La representación visual incluye texto
  accesible. Solo la acción de guardar conserva un mensaje privado.
- **Practicar:** consulta de tarjetas, reconocimiento e interpretación inversa, respuesta
  o abandono, solución posterior, historial propio, aciertos y confusiones. Cada intento
  conserva diccionario, versión y medio, sin recalcular resultados al editar convenciones.
- **En pareja:** invitaciones internas, aceptación/rechazo, comienzo, alternancia de emisor
  y receptor, comparación tras responder, cierre/cancelación y recuperación tras reconectar.
  El receptor no recibe el mensaje objetivo antes de responder.
- **Fichas:** anotaciones privadas, materia/tema, referencia, contexto/unidades, soporte,
  fuente de Notas o trabajos y ubicación; revisiones y fecha de edición. Se revalida acceso
  al origen y se oculta su referencia cuando deja de estar disponible, conservando la
  anotación escrita por su autor y la procedencia interna.

Los materiales propios tienen papelera dentro de su apartado y restauración durante
30 días. La invitación pendiente caduca a los siete días. No se graba el salón ni se usan
sensores o proveedores de IA.

## Decisiones aplicadas

El autor edita y publica su diccionario; otro integrante propone cambios en una copia.
Publicar esa copia la hace revisable por el autor del original; aceptarla crea otra versión
del original. Solo un administrador elige el diccionario recomendado por materia/tema.
Ese permiso no concede lectura de prácticas, fichas o sesiones privadas.

Los significados de referencia son dígitos; las respuestas pueden personalizarse. Para
publicar, cada medio ofrecido necesita diez dígitos, respuestas y los cuatro controles.
Se rechazan colisiones y prefijos ambiguos. Los ejemplos iniciales usan bloques de cinco
elementos de igual longitud y se identifican como convenciones editables.

Los intentos y mensajes son privados de su autor. Las sesiones tienen exactamente dos
participantes: una invitación pendiente entrega solo su ficha; el historial de turnos se
comparte únicamente entre quienes aceptaron. Una baja revoca lectura y escritura. No se
envían mensajes directos ni se publican resultados en perfiles, novedades o contribuciones.

La papelera de una sesión pertenece a cada participante. Borrarla cancela nuevos turnos;
el otro conserva su historial. La purga completa de sesión y turnos requiere que ambos
la hayan eliminado y vencido sus 30 días. Los recibos de operaciones purgadas quedan como
marcas compactas para impedir que un reintento tardío recree el contenido eliminado.

Límites: 200 señales/versión, patrones de hasta 16 elementos, referencia de hasta tres
dígitos, 30 turnos/sesión, 100 diccionarios y 100 versiones/diccionario, 500 mensajes,
intentos y fichas por titular, 100 revisiones/ficha, 200 sesiones por participante y
20 invitaciones salientes pendientes. Los límites de texto y de operaciones se validan
en el motor compartido; superar una cuota conserva el borrador del cliente.

El presupuesto normal es de 2 MiB por titular y 20 MiB por grupo, incluyendo recibos e
historial. Hay hasta 5.000 operaciones ordinarias por titular. Retirar contenido puede
usar una reserva exclusiva y acotada de metadatos: 1 MiB personal, 2 MiB grupales y
2.000 recibos adicionales. Solo esa limpieza usa huellas SHA-256 en lugar de conservar
el comando; datos extra de una petición no llenan la reserva. Crear, editar y restaurar
siguen sujetos a las cuotas normales. El historial de una sesión conservado únicamente
por el compañero deja de consumir cupo y presupuesto personal al vencer el retiro propio.

## Persistencia e integración

`packages/core/src/signals.ts` contiene contratos, validación, codificación, corrección,
proyección autorizada y transiciones atómicas. Demo y servidor ejecutan el mismo motor.
La demo comparte estado únicamente entre sesiones de su propio grupo simulado; una sesión
sin acceso recibe un módulo vacío.

SpacetimeDB añade dos tablas privadas: `signal_record`, con una fila por entidad y su
colección, y `signal_expiry`, con la próxima caducidad/purga programada. La vista
`signal_snapshot` entrega la proyección filtrada del usuario; `signal_action` acepta
comandos con identificador de petición. No se exponen las tablas ni recibos con cuerpos
de comandos. Los clientes solo reciben sus identificadores de confirmación.

Se conserva un reloj persistido para que la vista sea determinista. Las acciones y el
programador actualizan caducidades; no se depende de que un cliente mantenga la app abierta.
Las fuentes se validan con las reglas existentes de visibilidad y retiro de Notas/trabajos.
Los cambios no requieren rutas nuevas en el Worker de IA.

El transporte espera confirmación del reducer y recupera el resultado desde su recibo.
Reutilizar el identificador con otro contenido se rechaza. Los cambios comprueban versión
esperada; errores y conflictos conservan el formulario. Cambiar de cuenta o perder acceso
desmonta los formularios y descarta la proyección privada del cliente.

## Validación local

El módulo añade **56 pruebas**: 31 del núcleo, siete de handlers, cinco de transporte,
cuatro de integración demo y nueve de interfaz. Se comprobó la suite existente de todos
los paquetes; tras las correcciones finales se repitieron el núcleo completo (236 casos),
los 18 casos específicos de aplicación y el ensayo persistente.

| Comprobación | Resultado |
| --- | --- |
| Aplicación | 1.139 pruebas aprobadas; 18 específicas de Señales repetidas tras los últimos ajustes. |
| Núcleo | 236 pruebas aprobadas, incluidas las 31 nuevas. |
| Módulo de servidor | 501 pruebas aprobadas, incluidas las siete nuevas de handlers. |
| API / web | 237 / 64 pruebas aprobadas. |
| Tipos | Comprobaciones de los paquetes correctas. |
| Compilaciones | Web/PWA, extensión, Worker en seco, cliente Capacitor y Pages correctos. |
| Servidor real aislado | Ocho grupos de comprobaciones aprobados, con reinicio y purga programada. |
| Navegador local | Creación/publicación y guardado voluntario comprobados; presentación de escritorio y a 390 píxeles revisada. |

Pages se compiló con las variables públicas de `.env.pages.example` inyectadas únicamente
en ese proceso. No se creó `.env.pages` ni se cambió configuración persistente. Para
repetir esa compilación se necesita aportar esas variables públicas. Compilar el cliente
Capacitor no sincroniza, firma ni distribuye un APK.

La revisión adicional detectó y corrigió una carrera entre reintento y purga, la cuota que
seguía contando copias de sesiones retiradas, y la imposibilidad de retirar material con
la cuota llena. Sus regresiones forman parte de las pruebas del núcleo.

```sh
npm run typecheck
npm test
npm run test:spacetime:signals
npm run build
npm run build:pages
npm run build -w @b20/web -- --mode capacitor
```

El ensayo persistente usa SpacetimeDB local, identidades sintéticas y datos temporales.
Cubre tablas privadas inaccesibles por SQL, versiones y tres medios, idempotencia,
soluciones ocultas, ficha con nota personal, aceptación y respuestas concurrentes,
reinicio con turno pendiente, baja y purga programada real. Solo su copia temporal acelera
el plazo para ensayar la retención; el código normal conserva 30 días.

## Publicación y aceptación pendientes

Publicar primero el módulo compatible con `--delete-data=never`, comparar esquema y
conservación de datos, y después actualizar clientes. El catálogo local ya ofrece el
módulo; no publicar esos clientes contra un servidor que todavía carezca de
`signal_snapshot` y `signal_action`.

La comprobación en navegador local no acredita instalación de PWA/extensión/APK,
recepción en segundo plano ni aceptación con compañeros. Esos recorridos siguen abiertos.
