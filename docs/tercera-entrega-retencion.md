# Tercera entrega: papelera de 30 días

Esta entrega implementa la recuperación de apuntes, preguntas, respuestas, guías, trabajos y evidencias retirados. Los datos y los archivos siguen almacenándose en SpacetimeDB; Cloudflare ejecuta el mantenimiento de respaldo con una identidad de servicio dedicada.

## Plazo y permisos

- El retiro conserva el mismo registro, versiones, contexto y adjuntos durante **30 días de 24 horas** desde la marca del servidor. No depende de la zona horaria ni del reloj del dispositivo.
- La restauración está permitida antes de la fecha límite. En la fecha límite exacta, o después, el servidor la rechaza aunque el mantenimiento aún no haya procesado el registro.
- El autor o los coautores de un trabajo pueden restaurar una retirada propia. Cuando un administrador retira contenido grupal ajeno, debe indicar un motivo; solamente un administrador puede restaurar esa retirada. Un administrador no obtiene acceso a apuntes personales ajenos.
- La restauración respeta la versión esperada y crea la siguiente versión. Conserva la fecha y el crédito originales del aporte; volver a retirarlo abre un nuevo plazo para esa nueva retirada.
- Los integrantes revocados no pueden consultar ni restaurar la papelera.
- La interfaz consulta `get_trash_clock` e interpola ese reloj mientras está abierta. Si no puede comprobarlo, deshabilita la restauración. La comprobación definitiva siempre se realiza en SpacetimeDB.

Los retiros anteriores a esta entrega conservan su fecha original. El mantenimiento crea sus entradas de retención de forma aditiva, sin reiniciar los 30 días.

## Expiración y purga

Cada retirada crea un evento programado en SpacetimeDB con una generación. Una restauración o una nueva retirada invalida los eventos anteriores. Al vencer, el evento elimina el contenido y sus datos dependientes en una transacción. Los estados `purging` y `purged` bloquean la lectura; las descargas verifican también el límite temporal del servidor.

`purge_due({ batchSize })` ofrece un respaldo operativo. Acepta lotes de 1 a 20 publicaciones raíz, devuelve `{ processed, remaining }` y se puede reintentar. Cada publicación se elimina atómicamente con sus datos dependientes; el límite cuenta publicaciones raíz, no filas históricas ni fragmentos binarios. Una pregunta elimina sus respuestas dependientes, comentarios y votos. Una respuesta aceptada eliminada reabre su pregunta si esta todavía existe.

La purga elimina las versiones, comentarios, revisiones, motivos y registros de cambios asociados al contenido. Retira referencias a las fuentes en guías, versiones de guías, materiales de salas, vínculos y páginas. Las tarjetas de repaso conservan los identificadores de avance pero se archivan y pierden el texto derivado de la fuente eliminada. Los contenidos publicados como copias independientes conservan sus propios datos y dejan de apuntar al original eliminado.

La auditoría de retención conserva únicamente la referencia técnica, generación, acción, rol y fecha. No conserva el motivo, el texto, el correo ni la identidad del participante.

## Integridad de archivos

Antes de eliminar una referencia de archivo, se comprueban los adjuntos de versiones y páginas, referencias de cuerpos vigentes y las copias publicadas. Las referencias históricas que todavía existen mantienen los bytes. La metadata residual de un archivo cuyo origen ya fue purgado se reduce a una identificación técnica y un nombre genérico.

Una carga nativa puede alimentar varios alias de archivo, incluidos los alias `published-*`. Sus fragmentos de SpacetimeDB y la reserva de capacidad se liberan solamente cuando desaparece la última referencia que necesita esos bytes. Reintentar la purga no vuelve a descontar la reserva. Las cargas que se mantienen por una copia independiente pierden el nombre y la identidad del cargador original.

No se integra otro almacenamiento para esta función. La simulación local aplica el mismo plazo y retira sus blobs y URLs locales cuando deja de existir la última referencia.

## Contribuciones tras eliminar el original

Antes de purgar un aporte grupal, el servidor conserva una firma SHA256 privada de su clave exacta de igualdad y el identificador y fecha canónicos. La firma incluye el autor y contexto en su entrada, pero no almacena esos valores ni el contenido en claro. Nunca se expone en una suscripción.

Una copia exacta posterior del mismo autor y contexto conserva el crédito original y no vuelve a sumar puntos aunque el registro original ya haya sido eliminado. Los apuntes personales y los trabajos en borrador quedan fuera de ese cálculo. El contenido de otro autor no se mezcla. La comparación normaliza solamente saltos de línea y espacios exteriores; no hay IA ni similitud aproximada.

## Configuración del mantenimiento

El propietario configura una identidad dedicada mediante `set_maintenance_service`; también se admite `B20_MAINTENANCE_IDENTITY`. La identidad no puede pertenecer a ningún integrante y debe ser distinta de los servicios de archivos, IA y notificaciones. Solo esa identidad o el programador interno del módulo pueden invocar la purga. El navegador no recibe la credencial de mantenimiento.

Cloudflare usa esa identidad para llamar a `purge_due` como tarea periódica de respaldo. La programación interna de SpacetimeDB sigue siendo el mecanismo de vencimiento de cada retirada. Esta implementación no despliega ni elimina datos de producción.

## Verificación

Las pruebas usan datos sintéticos y un reloj controlado. Cubren la frontera exacta de los 30 días, restauración antes de vencer, eventos antiguos, permisos de autor/coautor/administrador/tercero/revocado, privacidad personal, moderación, lotes y reintentos, conservación y liberación de bytes compartidos, y crédito canónico después de purgar el original.

Validación local de este bloque:

- `trash.test.ts`: 8 pruebas del servidor aprobadas.
- `demoTrash.test.ts`, `demoDelivery2.test.ts` y `ContentWithdrawal.test.tsx`: 12 pruebas aprobadas.
- Typecheck del módulo de SpacetimeDB aprobado.
- `scripts/smoke-spacetime-retention.mjs`: aprobado contra un servidor real aislado en el puerto 3355. El harness copia el módulo y el core a una carpeta temporal y **solo en esa copia** acelera el plazo a cuatro segundos. Verifica restauración previa, descarte de eventos antiguos, ejecución real del programador, rechazo de descargas tras vencer, conservación del alias publicado, eliminación de la última referencia, mantenimiento idempotente y crédito de clones tras purgar el original. El helper de producción conserva los 30 días y las pruebas unitarias comprueban ese límite exacto.

Este documento describe la implementación y pruebas locales; no implica un despliegue de producción. La validación global de la entrega se registra por separado.
