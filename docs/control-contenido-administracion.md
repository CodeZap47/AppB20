# Control de aportes desde Administración

La baja, el bloqueo de un correo y la desactivación de un enlace no retiran aportes por sí mismos. La retirada de contenido es una decisión adicional, con selección explícita y motivo obligatorio. El feed mantiene publicaciones y comentarios de integrantes inactivos.

## Contenido administrable

`admin_content_entries` solo devuelve información a administradores activos. Incluye notas compartidas, preguntas, respuestas, guías, trabajos, evidencias, publicaciones y comentarios del feed y mensajes del chat general y canales. Excluye apuntes personales, conversaciones directas y datos del agente.

Cada entrada identifica `kind`, `targetId`, `owners`, `title`, `version`, `withdrawn`, `collaborative`, `foreignDependencies`, `sharedFiles`, `reportReferences` y `safeForBulk`. La selección masiva debe limitarse a `safeForBulk`; los demás elementos necesitan revisión individual y aceptación de impacto. La atribución usa autores y coautores del aporte, nunca únicamente quien subió un archivo.

## Operaciones reanudables

`moderate_content_item` procesa un elemento por transacción con `operationId`, `kind`, `targetId`, `expectedVersion`, `withdrawn`, `reason`, `acknowledgeImpact` y `expectedImpact` opcional. Para una retirada con impacto, `expectedImpact` debe coincidir con la firma de la vista previa: `Number(collaborative):foreignDependencies:sharedFiles:reportReferences`. Cambios de versión o impacto requieren actualizar y volver a revisar.

`admin_content_result` devuelve como JSON el resultado de un elemento, o `null`; `admin_content_results` permite consultar los resultados propios del administrador. Los estados son `completed` y `failed`, con `error` legible en fallos. Repetir la misma decisión con la misma clave no vuelve a retirar contenido; otra decisión requiere un `operationId` nuevo. Los clientes deben consultar el resultado después del reducer y tratar `failed` como un error. Las bajas anteriores no dependen del éxito de estas llamadas.

## Papelera, archivos y privacidad

La retirada conserva el aporte durante 30 días según el reloj del servidor. Restaurar no crea notificaciones. Las publicaciones del feed retiradas ocultan todos sus comentarios; la restauración mantiene retirados o eliminados los que tengan una decisión independiente. Los mensajes se distribuyen como marcadores sin texto ni adjuntos y conservan sus respuestas y posiciones de lectura. Al purgar se elimina su texto original y se conserva un marcador mínimo.

Un aporte retirado no permite nuevas interacciones, subidas ni descargas, incluso a administradores. Hay dos autorizaciones independientes: evidencia compartida explícitamente en un reporte y referencias de adjuntos tipadas que el servidor guardó en versiones de otro aporte todavía visible. Los alias publicados conservan sus permisos propios. Escribir libremente `(resource:id)` en una nota o guía **no concede acceso** a archivos privados o retirados; esas referencias pueden conservar bytes sin ampliar permisos. Los archivos se liberan cuando desaparecen sus últimas referencias conservadas.

El borrado explícito anterior sigue siendo definitivo. La papelera no reconstruye texto eliminado, ni una reinvitación restaura contenido moderado. Los autores pueden recuperar retiradas voluntarias; una retirada de moderación necesita revisión administrativa. Una membresía inactiva no puede consultar la papelera ni descargar archivos.

## Verificación

Las pruebas del módulo cubren restauración y purga, comentarios independientes, marcadores de ambos chats, conservación de respuestas, versiones concurrentes, aceptación de impacto obsoleta, idempotencia y descargas con referencias autorizadas. La simulación tiene los mismos controles y comparte el estado de canales y moderación entre sesiones del mismo grupo.

El smoke de retención (`npm run test:spacetime:retention`) publica una copia aislada y comprueba feed, chat general, canales, permisos y purga programada. Su publicación no debe apuntar a la base de producción.
