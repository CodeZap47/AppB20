# Laboratorio visual

El acceso directo del sidebar abre `/m/laboratorio-visual`, sin submenús. El catálogo organiza proyectos de contenido **3D**, **diseño gráfico**, **simulación** o **mixtos**. El catálogo está publicado; la siguiente etapa de [editor 3D, etiquetas, vistas y pasos](./laboratorio-visual-editor-3d.md) está implementada localmente y pendiente de publicación. La narración con IA y las simulaciones físicas son ampliaciones posteriores.

## Uso

- **Proyectos:** galería de dos columnas en escritorio y una en móvil, con búsqueda y filtros combinables conservados en la URL. Se ordena por actualización reciente.
- **Recorrido educativo:** Crear y Explorar llevan a las acciones disponibles del catálogo; Comprender y Practicar presentan las explicaciones por pasos, voz y ejercicios previstos para después. Las tarjetas y fichas indican «Ficha en preparación», independientemente del tipo de contenido o su privacidad.
- **Filtros visibles:** las selecciones activas se muestran como etiquetas que se pueden quitar por separado. Cambiar materia limpia el parcial y cualquier recurso incompatible; los filtros inexistentes de un enlace se normalizan cuando terminan de cargar los datos.
- **Nueva ficha:** título y tipo obligatorios; descripción, objetivo, tema, etiquetas, materias, parcial, recursos académicos y enlaces externos opcionales.
- **Portada:** diseño predeterminado por tipo o imagen PNG, JPEG o WebP de hasta 5 MiB. La imagen usa archivos nativos privados; no se sube a un servicio externo.
- **Recursos relacionados:** tareas, actividades de clase, notas y guías se seleccionan por su identificador real. Al partir de una tarea o actividad se precarga su materia y parcial. Las páginas académicas muestran los proyectos que la persona puede consultar.
- **Proveedores:** directorio de Adafruit, SnapMagic/SnapEDA, Ultra Librarian, TraceParts, GrabCAD, 3D ContentCentral, Sketchfab y Poly Haven. Los enlaces abren los sitios oficiales; la app no descarga ni redistribuye automáticamente modelos.
- **Guardar una referencia:** cada proveedor separa el catálogo de la información de uso y permite añadir una referencia a un proyecto propio no archivado o preparar uno nuevo. Se precargan proveedor, URL del catálogo y nombre de la biblioteca; autor, formato y licencia del modelo se completan cuando se conoce el activo. Guardar requiere confirmación, controla versiones y evita duplicar URL equivalentes. Al crear una ficha nueva, la referencia se guarda solo al enviar su formulario.

## Datos y permisos

`VisualProject` contiene la ficha, autor, clasificación, visibilidad, estado de archivo, versión y fechas. `VisualProjectLink` identifica relaciones con `assignment`, `activity`, `note` o `guide`. Las URL de recursos conservan nombre, proveedor, autor, formato y licencia cuando se conocen; se valida HTTPS sin credenciales en cliente y servidor.

Los proyectos empiezan **personales**. Solo su autor puede editar, compartir con el grupo, volver a privado, archivar o restaurar. Archivar conserva el registro para el autor y lo oculta al grupo. Publicar no cambia los permisos de sus fuentes: todas las relaciones deben ser compartibles al publicarse. Cada consulta vuelve a resolver el acceso a las relaciones, para no revelar fuentes que se hayan retirado o vuelto privadas.

Si una fuente deja de estar disponible, su relación permanece guardada. Solo el autor recibe `unavailableLinks`, marcadores con tipo e identificador previamente registrados, sin títulos, contenido ni enlaces a la fuente. Puede quitar cada relación expresamente o reemplazarla con una fuente autorizada. Los demás integrantes, incluidos otros administradores, no reciben marcadores ni identificadores inaccesibles.

`VisualProjectInput.removedLinks` expresa las retiradas deliberadas dentro del JSON de guardado existente; no forma parte de la ficha persistida. Al editar se conservan referencias anteriores inaccesibles o que dejaron de ser compartibles, aunque un cliente antiguo las omita o la fuente desaparezca con el formulario abierto. Se validan las nuevas referencias; publicar vuelve a comprobar el conjunto completo. Si una fuente se restaura, su referencia conservada se resuelve de nuevo. No se reconstruyen relaciones que hubieran sido eliminadas antes de esta mejora.

La tabla interna `visual_project` es privada. La vista `visual_projects` proyecta únicamente fichas accesibles y relaciones autorizadas. Sus portadas usan el destino nativo `visual_project`; subir, consultar metadatos y descargar bytes comprueban el acceso vigente al proyecto. La versión esperada evita sobrescrituras; un identificador de solicitud permite recuperar una creación cuya confirmación se perdió.

SpacetimeDB es el almacenamiento persistente del grupo. El modo demostración usa datos sintéticos y el estado de esa demostración; no acredita por sí solo persistencia del servidor. La prueba local aislada verifica la conservación de fichas y portadas al reiniciar SpacetimeDB.

## Validación

```sh
npm run typecheck
npm run test:spacetime:visual-projects
npm run build:web
npm run build:extension
```

La prueba de integración usa un servidor temporal y cuentas sintéticas, nunca producción. Comprueba creación sin duplicados, privacidad incluso ante otro administrador, control de versiones, publicación y cambio de acceso de las fuentes, subida binaria de portada, archivo/restauración, revocación de descargas y persistencia tras reiniciar el servidor.

Validación inicial local del 26 de octubre de 2026: comprobación de tipos de todos los paquetes, 246 pruebas de core, 538 de servidor y 1275 de la app aprobadas; la comprobación final específica del laboratorio y navegación aprobó 58 pruebas. La prueba aislada con el SDK real, descarga de portadas y reinicio de SpacetimeDB pasó. Las compilaciones de web/PWA y extensión finalizaron correctamente. En navegador se revisaron el acceso directo, galería de dos columnas, creación de una ficha privada, proveedores y escritura rápida de la búsqueda.

Verificación de las mejoras de integridad, proveedores y presentación: 251 pruebas de core y 545 de servidor aprobadas; comprobación de tipos de todos los paquetes y compilaciones de web/PWA y extensión correctas. La ejecución final de 11 archivos de interfaz, datos e integración aprobó 125 pruebas, incluidos los 26 casos de interfaz del laboratorio y los 32 de datos. La primera corrida general coincidió con cambios de Mensajes y carga concurrente: los archivos que fallaron se repitieron sobre el código actualizado con dos procesos de prueba y aprobaron junto con el laboratorio.

La prueba con el SDK real verificó conservación de fuentes retiradas en guardados de clientes anteriores, retirada durante la edición, marcadores exclusivos del autor, recuperación automática al restaurar una fuente, reemplazo atómico y persistencia después de reiniciar SpacetimeDB. En navegador se comprobaron las cuatro etapas, incorporación a una ficha existente, deduplicación, contexto del proyecto, precarga de una referencia editada en una ficha nueva y limpieza del recurso incompatible al cambiar materia.

La entrada de desarrollo `design-preview.html?visual-review=1#/m/laboratorio-visual` carga seis ejemplos identificados, sin modificar datos del grupo. Esa entrada está excluida de la compilación normal de producción.

## Publicación

Publicado en [b20.mx](https://b20.mx/#/m/laboratorio-visual) el 26 de octubre de 2026, después de las mejoras de Mensajes publicadas ese mismo día. Se actualizó primero SpacetimeDB con `--delete-data=never` y después la web/PWA. Se conservaron los 513 registros existentes; la extensión también compiló, sin publicar una nueva versión en tiendas. La nueva tabla privada es independiente de los registros académicos anteriores. Véase el [registro de publicación](./laboratorio-visual-publicacion-2026-10-26.md).

Las mejoras de integridad mantienen las tablas y firmas de reducers existentes. El servidor actualizado debe publicarse antes que los clientes que muestran marcadores y envían retiradas expresas.

## Evolución prevista

1. **Exploración y edición visual:** importar modelos optimizados, identificar piezas, guardar vistas, añadir etiquetas y construir pasos. Los archivos CAD pueden requerir conversión a formatos web; una malla fusionada no permite desmontar piezas automáticamente.
2. **IA y audio:** proponer guiones revisables y acciones permitidas por escena, sincronizar cámara, resaltado y movimientos con narración, pausa, repetición y transcripción.
3. **Simulación y estudio compartido:** definir parámetros y reglas por dominio, incorporar ejercicios, conectar guías y salas y registrar avance.

Ejemplos: recorrer CPU → RAM → almacenamiento; seguir paquetes por una red; cambiar entradas de compuertas lógicas; combinar modelos con infografías; visualizar algoritmos; explorar mecanismos; identificar componentes como ejercicio; presentar una explicación interactiva ligada a una tarea.

La geometría descargada no aporta por sí sola comportamiento eléctrico, térmico o físico. Cada simulación necesitará reglas específicas, nombres semánticos de componentes y una preparación verificable de los recursos. Las condiciones de uso y atribución se revisan por activo.
