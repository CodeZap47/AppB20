# Crear desde los módulos del feed

Entrega local del 26 de octubre de 2026, integrada sobre la versión actual de `main` el 28 de octubre para preparar su publicación. Amplía el compositor de Inicio a catorce accesos visibles. Conserva Tarea, Apunte y Pregunta al principio, seguidos por las demás creaciones según el catálogo de módulos.

## Catálogo y módulos futuros

`ModuleInfo.feedCreateActions` declara las acciones de cada módulo con `id`, `label` y `path`. Admite varias acciones, como tarea y actividad. `availableFeedCreateActions()` filtra la disponibilidad con la misma regla que la navegación y añade `moduleId` para resolver el icono. Las prioridades 0, 1 y 2 mantienen los tres accesos originales; las incorporaciones normales no necesitan prioridad.

Para incluir un módulo futuro, habilitarlo en el catálogo y declarar allí su creación compatible con el feed. No hace falta editar el compositor. Los iconos se comparten con la navegación y existe un icono genérico para módulos nuevos. Esto añade un acceso a su formulario; la incorporación de un tipo de publicación al feed sigue siendo responsabilidad del módulo correspondiente.

Los módulos personales, de consulta y con avisos derivados no declaran accesos de creación del feed. Tampoco se ofrecen respuestas, soluciones o entregas que necesiten escoger primero otro recurso.

## Formularios y privacidad

- Los accesos a notas y colecciones incluyen `visibilidad=grupo`: solo preseleccionan Grupo al crear. La persona puede elegir Personal antes de guardar. Los accesos habituales y los valores desconocidos conservan Personal; editar siempre respeta la visibilidad existente.
- Museo y Oportunidades aceptan `crear=1` para abrir sus editores. Guardar correctamente o cancelar elimina solo ese parámetro; los errores conservan formulario y borrador.
- Preparar un examen mantiene el flujo privado y su publicación explícita posterior.
- Los accesos no envían el formulario de texto. Permanecen bloqueados durante su guardado o cuando no hay conexión y membresía activa.

La interfaz usa tres columnas en escritorio y dos en tablet, móvil y extensión compacta. Las etiquetas se ajustan sin truncamiento, los objetivos tienen al menos 48 px de alto y el foco de teclado permanece visible. Los colores se asocian al módulo, no a su posición.

## Verificación de la entrega original

Cobertura del catálogo, de un módulo futuro, de los catorce destinos, permisos y bloqueo durante el envío. Pruebas de visibilidad y de apertura/cierre de los editores con errores recuperables. Revisión en navegador a 360, 768 y 1280 px y en vista compacta; capturas en `artifacts/feed-creation-actions/`.

Resultado: 1210 pruebas de app, 212 de core, 517 de servidor, 265 de API y 64 de web aprobadas. Tras el ajuste final de los enlaces bloqueados, las 19 pruebas del compositor y los tipos de app volvieron a pasar. Comprobación de tipos del proyecto, compilaciones web y extensión correctas. En navegador se verificaron los catorce accesos, foco visible, etiquetas sin recortes, selección de Grupo y apertura/cancelación de Museo y Oportunidades.

Esta integración mantiene las funciones actuales de Mensajes, Lenguaje de señales y Laboratorio visual. No requiere cambios de base de datos, API ni credenciales.

La validación del 28 de octubre de 2026 comprende 69 pruebas enfocadas y 2704 pruebas del proyecto: 1514 de app, 280 de core, 575 de servidor, 271 de API y 64 de web. Las 180 suites de app pasaron con dos procesos; una prueba de lectura de PDF había agotado su plazo en la primera ejecución simultánea con las compilaciones. La comprobación de tipos de todos los paquetes y la compilación de Pages terminaron correctamente.

La publicación del cliente utiliza la integración Git de Cloudflare Pages: un push a `main` del proyecto `app-b20` actualiza `https://b20.mx`. El resultado se comprueba en el despliegue de producción y comparando los archivos públicos con su URL inmutable.
