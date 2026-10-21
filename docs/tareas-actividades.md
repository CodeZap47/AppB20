# Tareas y Actividades

Esta entrega usa SpacetimeDB para datos y archivos nuevos. Cloudflare Pages sirve la web;
Workers/R2 se conserva únicamente para descargar archivos heredados. Gemini no se habilita.

- **Mi avance:** Sin empezar, En proceso o Terminado; solo su dueño puede leerlo o modificarlo. No determina quién publicó.
- **Trabajos:** Borrador compartido o Final, visibles al grupo. Revisado deriva de la aprobación con comentario de un compañero ajeno a la autoría, sobre la versión concreta.
- **Historial:** guardar texto, estado, clasificación o archivos crea versión. Restaurar crea otra versión, conserva los archivos anteriores y requiere nueva revisión del trabajo.
- **Concurrencia:** los formularios conservan la versión con la que se abrieron. Un cambio simultáneo requiere actualizar antes de guardar; los reintentos de archivos conservan su intento original.
- **Recursos:** consignas y actividades son editables por el grupo; trabajos solo por sus autores/coautores; archivos de evidencias solo por quien la publicó. Descargas autenticadas, máximo 50 MiB por archivo.
- **Transferencias:** los archivos nuevos viajan en fragmentos privados de 1 MiB, con comprobación de integridad, progreso, cancelación y reanudación. Si falta espacio, la operación muestra el rechazo sin activar almacenamiento de pago. Los adjuntos retirados de evidencias se pueden descargar; su autor puede restaurarlos sin duplicar sus bytes.
- **Comentarios y relaciones:** cualquier miembro comenta trabajos y evidencias. Las actividades pueden vincularse explícitamente con tareas y notas compartidas de la misma materia.
- **Guías:** cambios materiales del trabajo o de las evidencias de una actividad dejan desactualizada su fuente. Restaurar la consigna conserva las evidencias de todos los equipos.
- **Consulta:** las dos vistas conservan filtros por materia, parcial, autor, tipo exacto, tema, fechas, estado y avance propio.

Los registros anteriores sin estado se consideran borradores compartidos. El primer historial conservado es una instantánea del contenido disponible; no se inventan versiones ni revisores antiguos.

## Validación y operación

Las pruebas cubren handlers reales de reducers, paridad de la simulación, adaptadores,
componentes y compatibilidad del Worker con R2 local. La prueba de archivos nativos usa
un servidor SpacetimeDB persistente aislado, tres identidades sintéticas, reinicios,
restauración de evidencias y transferencias de hasta 50 MiB. La migración se ensayó
publicando el esquema anterior con datos y actualizando sin borrarlos, con backfill repetido.

Validación del 21 de octubre de 2026: el módulo de la revisión `e64bfc4` se publicó en
Maincloud con `--delete-data=never`, incluyendo archivos nativos y `restore_resource_file`.
Se compararon las filas de 22 tablas con el respaldo previo y se conservaron todos los
registros. La adaptación pasó 622 pruebas, tipos, compilaciones con Node 22 y la prueba
con servidor persistente y tres identidades sintéticas, incluido el archivo de 50 MiB.

Pages se actualiza por la integración Git existente en `codex/pages-spacetimeauth`, después
del módulo. Confirmar la revisión y el estado **Success** en Deployments y los assets del
dominio estable; un push por sí solo no acredita publicación. La validación humana sigue
pendiente; consultar [estado-del-proyecto.md](estado-del-proyecto.md).
La activación real conserva las cuentas de SpacetimeAuth y exige invitación. Los ejemplos de la simulación no se importan. La primera cuenta invitada debe unirse; los creadores pueden importar las materias desde Ajustes y administrar invitaciones.

La comprobación humana con cuentas reales, recarga y cambios de membresía sigue pendiente.
El recorrido académico empieza con dos cuentas invitadas y necesita una tercera identidad
para comprobar accesos no autorizados y la revisión de trabajos con dos coautores. Las
pruebas automatizadas de identidad, permisos, persistencia de servidor y aislamiento no
sustituyen esa comprobación.

### Comprobación con dos cuentas invitadas

Usar perfiles de navegador separados para A y B. Ambos deben unirse con invitación activa; crear una tarea y una actividad de prueba en una materia real.

1. A cambia su avance a En proceso. Recargar ambos perfiles: A conserva su avance y B conserva el suyo en Sin empezar.
2. A publica un borrador con archivo y B lo consulta. B puede comentar, pero no editarlo ni marcarlo Revisado mientras siga en borrador.
3. A cambia el trabajo a Final. B lo revisa con comentario; tras recargar, ambos ven nombre, fecha y comentario de esa versión. A modifica el contenido o un archivo y la versión nueva vuelve a requerir revisión.
4. Abrir el mismo trabajo en dos pestañas de A. Guardar en una y después intentar guardar en la otra: debe solicitar actualizar antes de sobrescribir.
5. Restaurar una versión anterior con archivo. Se crea otra versión y se puede descargar tanto el adjunto restaurado como el del historial; no aumenta el puntaje de publicación.
6. Vincular la actividad con la tarea y una nota, adjuntar un recurso a la consigna, publicar una evidencia con archivo y comentarla desde B. Recargar y comprobar relaciones, recursos, comentarios y filtros combinados.
7. Añadir B como coautor y comprobar su edición. Un autor o coautor no puede revisar su propio trabajo; para ensayar revisión de un trabajo con dos coautores se requiere una tercera cuenta ajena al equipo.
8. Desde Ajustes, un creador da de baja a B. B ya no puede descargar el archivo ni comentar después de recargar. Conservar los adjuntos históricos y retirar o identificar claramente el contenido de prueba al terminar.

Con el almacenamiento nativo también se debe interrumpir y reanudar una subida, cancelar
otra y comprobar que no quedan adjuntos duplicados. Repetir tras recargar y volver a
seleccionar el mismo archivo; comprobar el límite de 50 MiB y el rechazo cuando no hay
reserva disponible. El recorrido completo está en la guía de archivos.

Ver [archivos nativos y despliegue](archivos-spacetime.md) y
[compatibilidad con archivos R2 anteriores](archivos-cloudflare.md). Los respaldos y
credenciales operativas se guardan fuera de Git; nunca se incluyen en documentación ni
salidas de comandos.
