# Enlaces, integrantes y correos en Administración

Esta entrega añade controles independientes para la validez de un enlace, el acceso de cada integrante y el destino de sus aportes. Está publicada en producción desde el 24 de octubre de 2026; el [recibo de despliegue](administracion-produccion-2026-10-24.md) detalla versiones, conservación de datos y límites de la verificación.

## Recorrido

Administración permite crear varios enlaces con nombre, caducidad de siete días predeterminada y cupo opcional. Es posible elegir otra fecha o quitar el vencimiento. Un correo verificado puede entrar con rol de integrante mientras el enlace tenga vigencia y cupo. Los administradores se incorporan por invitación individual.

El pop-up **Revocar** comienza en **Desactivar solo este enlace**. Las alternativas son reemplazarlo por otro o seleccionar a quienes perderán acceso. La selección empieza vacía; seleccionar todos excluye administradores y la cuenta actual. El servidor también protege al propietario y al último administrador activo. Antes de ejecutar, se revisan los accesos y los aportes seleccionados.

Los enlaces del sistema anterior aparecen en **Enlaces anteriores**, con identificador, estado, creación, vencimiento y usos. Como solo se guardaba su huella, no se ofrece recuperar ni copiar su secreto. **Desactivar** pide confirmación y conserva a los integrantes y sus aportes; el reintento es idempotente. Para compartir otro enlace se puede crear uno nuevo con el modelo actual. Las incorporaciones antiguas sin una relación comprobable conservan «Origen desconocido».

Los filtros distinguen activos, invitaciones pendientes, bajas y correos bloqueados. Cancelar una invitación no impide entrar mediante otro enlace válido. Una baja exige una invitación individual nueva; un bloqueo exige desbloquear primero. Desbloquear todos los correos conocidos de la misma membresía no reactiva el acceso. La reinvitación conserva identidad, autoría e historial y no restaura salas privadas ni contenido moderado.

«Gestionar aportes» permanece disponible para integrantes activos, dados de baja y bloqueados. Permite revisar y retirar contenido compartido con motivo y confirmación, sin volver a modificar ni reactivar su acceso.

La baja retira permisos de salas y cancela las salas activas organizadas por esa persona. Los datos privados del agente se conservan, aunque la membresía inactiva no puede utilizarlos. La gestión de aportes se describe en [Control de contenido](control-contenido-administracion.md).

## Identidad e historial

Las asociaciones correo–membresía se guardan únicamente después de verificar una sesión. No se publican en perfiles ni listas del grupo. Otra identidad de acceso con el mismo correo necesita vinculación explícita por el propietario; no se fusionan membresías. Es posible vincular una identidad nueva a una membresía dada de baja sin reactivarla, para aceptar después una invitación individual válida.

Cada reincorporación registra origen y generación. Una acción sobre una generación antigua se omite y conserva cualquier acceso posterior. Las membresías históricas sin evidencia conservan «Origen desconocido» y «Correo pendiente de vincular»; no se deducen datos de nombres ni fechas.

El historial registra incorporaciones, bajas, bloqueos y otras decisiones administrativas. El bloqueo por correo de Administración es independiente del bloqueo personal de mensajería.

## Reintentos y recuperación

Cada decisión de acceso o contenido tiene identificadores estables y resultado persistente en el servidor. La interfaz conserva el seguimiento de una operación interrumpida durante 24 horas en la sesión de esa pestaña, ligado a la cuenta administradora y al entorno. Guarda identificadores, generaciones, motivo y cantidades de impacto; no guarda secretos de enlaces, títulos de aportes ni correos. «Retomar operación pendiente» conserva los mismos identificadores y la vista previa de impacto. Una dependencia nueva exige volver a revisar.

«Descartar seguimiento» solo elimina el seguimiento local; no deshace los cambios confirmados. «Reintentar pendientes» repite la misma decisión; «Revisar pendientes» permite actualizar versiones/impacto e iniciar una decisión nueva para lo pendiente. Un error al retirar contenido no revierte una baja confirmada. El seguimiento no se comparte entre dispositivos y desaparece al cerrar definitivamente la sesión de la pestaña; el historial y los resultados del servidor se conservan.

El token del enlace se captura antes de la autenticación y se retira de la dirección. El retorno OAuth contiene un identificador de flujo, sin el token. La copia temporal dura una hora y se limpia al aceptar, cancelar o cerrar sesión. La extensión usa almacenamiento de sesión de Chrome; la web admite el retorno por correo en otra pestaña del mismo navegador.

## Habilitación y validación

1. Publicar primero el módulo con las tablas y operaciones nuevas mediante una actualización que conserve datos. No reiniciar ni importar los fixtures de simulación.
2. Configurar y publicar el Worker de enlaces según [Configuración de la API](enlaces-invitacion-api.md), incluida la clave dedicada versionada. Sin esa clave las operaciones de creación/copia/reemplazo fallan de forma cerrada.
3. Publicar los clientes con sus bindings actualizados. La simulación reproduce las reglas sin enviar correos ni escribir en la base real.
4. Comprobar permisos con sesiones de administrador, integrante, dado de baja y bloqueado. Verificar por separado la configuración y claves del entorno remoto antes de habilitarlo para el grupo.

Pruebas locales: `npm test`, `npm run typecheck` y `npm run build`. Los recorridos reales aislados son `npm run test:spacetime:membership` y `npm run test:spacetime:retention`, con Node.js 22 o superior. Generan servidores, usuarios y claves sintéticos; no utilizan Maincloud ni cuentas reales. La retención acelera el plazo exclusivamente en una copia temporal y mantiene 30 días en producción.
