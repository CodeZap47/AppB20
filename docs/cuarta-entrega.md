# Cuarta entrega: colaboración y estudio

Implementación local sobre `5650d87`, posterior a la tercera entrega integrada en `main`.
El alcance procede del plan y de las secciones 7.2–7.9 y 7.12 de la
[definición del proyecto](definicion-del-proyecto.md). Los datos, permisos, versiones,
archivos y estados persistentes permanecen en SpacetimeDB 2.12.0. Cloudflare Pages sirve
la interfaz y el Worker de IA dedicado realiza la integración autorizada con Gemini BYOK.
No se incorpora otro servicio ni se despliega infraestructura durante esta implementación.

## Funciones

| Área | Resultado |
| --- | --- |
| Salas 7.2 | Se conserva la implementación: coordinación, invitación/inscripción, cupo, conversación, materiales, temporizador y resumen con publicación voluntaria. |
| Ayuda 7.3 | Ofertas, solicitudes, filtros y contactos privados con aceptación expresa; conversión de encuentros en salas. Se añaden control de versión, recibos idempotentes y un historial propio. |
| Retos 7.4 | Problemas por materia, tema y dificultad, ejemplos, pistas progresivas privadas, soluciones explicadas, comentarios y cierre colectivo documentado. |
| Revisión de código 7.5 | Código pegado o enlace HTTPS, versiones inmutables, observaciones generales o por líneas de una versión concreta, y resolución por el autor con explicación. |
| Museo 7.7 | Plantilla y versiones asociadas a una Pregunta real: intención, síntoma, causa o hipótesis, corrección y aprendizaje. Reutiliza su discusión, referencias y papelera. |
| Aprende enseñando 7.8 | Explicaciones/reflexiones con versiones y control de concurrencia, historial exclusivo del autor y preguntas Gemini con borrador privado, selección y aceptación expresa. |
| Repaso 7.9 | Tarjetas propuestas por Gemini desde notas o guías versionadas, corregibles antes de incorporarlas expresamente a una colección. |
| Oportunidades 7.12 | Fichas manuales, filtros, vencimientos, fuente original, interés privado, contacto voluntario para buscar equipo y correcciones/reportes resolubles. |

Los módulos nuevos aparecen en la navegación de las tres presentaciones. Las pantallas
comparten los contratos `Snapshot` y `Actions`, el adaptador real y el modo demo. No se
ejecuta código de usuarios, se descargan repositorios ni se recopilan oportunidades de
servicios externos. Las publicaciones nuevas tampoco cambian automáticamente las reglas
de puntos del leaderboard.

Detalles: [Retos y revisión](retos-revision.md), [Museo y oportunidades](museo-oportunidades.md),
[Gemini para estudio](gemini-estudio.md) y [Salas](salas-de-estudio.md).

## Ayuda: ediciones sin sobrescritura

Las tablas nuevas `help_version`, `help_revision` y `help_intent` complementan las filas
anteriores sin modificar su esquema ni eliminar datos. Las publicaciones anteriores parten
de la versión 1. Su primera edición moderna conserva una copia de ese estado y crea la
versión 2; las siguientes comprueban la versión esperada antes de guardar. Los cambios de
estado también quedan versionados. El formulario conserva la versión con la que se abrió,
aunque reciba actualizaciones mientras el autor escribe.

Crear o editar mediante `help_mutate` requiere una intención estable. Un reintento idéntico
devuelve su recibo y no vuelve a modificar el contenido; reutilizarla con otro contenido se
rechaza. Cerrar mantiene los contactos ya aceptados y cierra solamente los pendientes.
La retirada de contenido ajeno requiere administración y motivo.

El autor puede consultar las últimas 30 versiones mediante `help_read_history`; no se
suscribe el historial privado ni lo recibe otro integrante o administrador. No se puede
recuperar una edición histórica anterior a instalar esta actualización si no se había
registrado. Las operaciones antiguas permiten crear para compatibilidad y rechazan editar,
cerrar o retirar: deben actualizarse los clientes para impedir que eludan el control de versión.

Las respuestas de dominio se traducen después de terminar o revertir la transacción. Un
error no confirma un cambio local ni conserva una captura histórica parcial. Las pruebas
reales verifican también este caso con una publicación anterior sin metadata de versión.

## Versiones manuales de Aprende enseñando

Las cabeceras, revisiones y recibos de guardado se almacenan en tablas privadas nuevas sin
cambiar el esquema de las prácticas existentes. El guardado moderno comprueba la versión
que abrió el formulario y el identificador del intento. Una pestaña antigua conserva lo
escrito y recibe un conflicto; puede cargar la versión actual antes de intentarlo de nuevo.
Las transiciones de estado también invalidan los editores anteriores.

El historial conserva explicación inicial y revisada, reflexión y temas personales; sólo el
autor lo consulta. Ni el compañero invitado ni administración reciben ese historial o las
reflexiones. Los guardados de clientes antiguos se rechazan para evitar eludir la versión,
incluso en una práctica anterior que todavía no tenga metadata. La publicación voluntaria
sigue creando una copia independiente sin trasladar la reflexión ni toda la sesión.

## IA privada y publicación voluntaria

Se mantiene la clave personal cifrada de la tercera entrega, las identidades técnicas
separadas y la clave maestra en Cloudflare Secrets. El consentimiento `2026-10-21.2` añade
las finalidades de preguntas y tarjetas: las personas con un consentimiento anterior deben
aceptarlo de nuevo antes de generar. Cada operación muestra el texto autorizado exacto y
el consumo de la clave del solicitante.

En Aprende enseñando se usa una explicación guardada del autor. No se envían reflexión,
historial de repaso, respuestas, identidades del revisor ni mensajes. En Repaso se conservan
la fuente, su versión y las citas; una fuente personal no puede producir tarjetas para una
colección del grupo. La aceptación es atómica, explícita e idempotente. Los errores inciertos
conservan el mismo envío para resolver su confirmación sin crear duplicados.

La aceptación de tarjetas valida el lote completo, incluido el tamaño final de sus citas,
antes de insertar. Una tarjeta inválida deja cero tarjetas y cero recibos, también al
reintentar; no se confirma una selección parcial.

Los intervalos de repaso siguen siendo 1/3/7/14/30/60/120 días, pista a un día y reinicio a
diez minutos. Los recordatorios usan el sistema de la tercera entrega. La simulación no
solicita claves reales ni llama al proveedor; permite continuar las prácticas manuales.

## Conservación y permisos

El Museo reutiliza el ID y los permisos de Preguntas. Retirar el origen oculta su ficha y sus
versiones; restaurarlo dentro de plazo recupera su acceso. La purga programada elimina
también la metadata y el historial del Museo. Retos y revisiones se cierran conservando su
discusión; Oportunidades permite retirar/restaurar la ficha preservando sus revisiones.
Estas acciones no se presentan como borrados físicos de esas publicaciones nuevas.

Las pistas desbloqueadas y los intereses no compartidos pertenecen a cada persona. Buscar
equipo y autorizar contacto son decisiones independientes y reversibles; no envían mensajes
automáticamente. Los reportes se resuelven por el autor o administración. Una baja revoca
las operaciones y vistas privadas, también al volver a conectar.

## Comprobación local

```sh
npm run typecheck
npm run test --workspaces --if-present -- --maxWorkers=2 --testTimeout=20000
npm run build
npm run build:pages # con las variables públicas de SpacetimeDB y Cloudflare
npm run test:spacetime:delivery4
npm run test:spacetime:community4
npm run test:spacetime:ai-study
npm run test:spacetime:teaching-versions
npm run test:spacetime:rooms
```

Los cuatro recorridos nuevos han pasado con bases reales locales, identidades sintéticas y
reinicios. El de comunidad comprueba la purga con cuatro segundos únicamente en una copia
temporal: la producción mantiene 30 días. IA utiliza tres respuestas simuladas y cero
llamadas reales a Gemini.

Validación final del 21 de octubre de 2026:

| Comprobación | Resultado |
| --- | --- |
| Tipos de todos los workspaces | Correctos. |
| Interfaz compartida | 615 pruebas en 79 archivos. |
| Dominio compartido | 131 pruebas en 20 archivos. |
| Módulo SpacetimeDB | 306 pruebas en 20 archivos. |
| API/Worker y runtime local Cloudflare | 107 pruebas en 16 archivos. |
| Web/PWA | 51 pruebas en 3 archivos. |
| Total | **1.210 pruebas aprobadas en 138 archivos.** |
| Compilaciones | Web/PWA, extensión, Pages en modo SpacetimeDB y Worker con `--dry-run`: correctas. |
| SpacetimeDB real local | Retos/Revisión/Ayuda, Museo/Oportunidades, IA de estudio y versiones manuales: aprobados con reinicio y permisos. |
| Regresión de Salas | Aprobada: Ayuda → Sala, cupo simultáneo, materiales, temporizador, publicación voluntaria y revocación. |

La ejecución conjunta usa dos procesos y veinte segundos por prueba para los recorridos
largos de navegación bajo carga. Los intentos anteriores detectaron tiempos agotados y una
regresión al reabrir una práctica; esta última se corrigió y su recorrido completo volvió a
pasar antes de la ejecución final. No se ampliaron los tiempos en el código de las pruebas.
Las compilaciones conservan el aviso informativo del empaquetador sobre el tamaño del
paquete principal; no impide producir los artefactos.

Esta entrega no activa Gemini, push, secretos, facturación ni publicaciones remotas.
La recepción en dispositivos y el uso del modelo con una clave real se verifican durante
la activación. Microproyectos, préstamos y el módulo 3.11 mantienen la entrega 5; no se
declaran implementados por incorporarse estos módulos de estudio.

## Integración con `main`

El commit de funciones `eee025a` se integra con `00f761d`, que incorpora las Guías IA,
la navegación Slim y el despliegue previo de la tercera entrega. Se conservan ambas
implementaciones, se regeneran los bindings desde el esquema combinado y los paneles de
estudio utilizan `VITE_AI_API_URL`, igual que el resto de la integración con Gemini.
El Worker de archivos mantiene su dirección independiente.

La integración no ejecuta comandos de despliegue. Publicar los nuevos módulos y clientes
corresponde a un paso separado. La navegación Slim incluye también Retos, Revisión de
código, Museo y Oportunidades; el recorrido real de la aplicación comprueba todos los
destinos disponibles.

Comprobaciones sobre el conjunto integrado del 21 de octubre de 2026:

- **1.339 pruebas aprobadas en 149 archivos:** interfaz 682, dominio 146, módulo 333,
  API/Workers 127 y web 51. Tras añadir los destinos al menú se repitió la suite completa
  de interfaz, incluidas las pruebas de navegación de ambos padres.
- Tipos de todos los workspaces correctos y comprobación final adicional de la interfaz.
- Compilaciones de web/PWA, extensión y los dos Workers con `--dry-run`; Pages en modo
  SpacetimeDB con direcciones independientes para archivos e IA.
- Cinco recorridos reales locales aprobados: Retos/Revisión/Ayuda, Museo/Oportunidades,
  IA de estudio, versiones manuales de Aprende enseñando y regresión de Guías IA.
- Regresiones nuevas de los dos paneles de estudio con dominios de archivos e IA distintos:
  estado e historial privados consultan exclusivamente el Worker de IA configurado.

Las llamadas de generación siguen simuladas durante estas comprobaciones; no se usan claves
personales reales ni se modifica la base de producción.
