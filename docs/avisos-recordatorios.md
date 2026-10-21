# Avisos y recordatorios

La bandeja `/m/avisos` persiste en SpacetimeDB y funciona sin permiso del navegador, sin VAPID y sin activar el Worker. Los eventos de la aplicación materializan los primeros 100 destinatarios inmediatamente. Un cursor privado conserva el resto para el cron. Las preferencias son privadas, tienen versión y permiten elegir categorías, zona IANA, hora del recordatorio y descanso. Descanso con inicio y fin iguales significa desactivado.

Los recordatorios de calendario requieren activar el cron de Cloudflare. Web Push añade la entrega al dispositivo; sus endpoints son transporte estándar de los navegadores. No se usa el SDK de Firebase ni se almacenan eventos, claves o colas en otro servicio. Las suscripciones y la cola viven en tablas privadas de SpacetimeDB. El cliente sólo recibe el nombre y estado de sus instalaciones, nunca endpoints ni claves del resto de miembros.

## Activación por el propietario

1. Publicar el módulo actualizado conservando los datos. Crear una identidad técnica dedicada de SpacetimeDB y guardar su token directamente como secreto. Su identidad pública debe ser distinta de la del propietario, de todos los miembros y de los servicios de archivos, IA y mantenimiento.
2. Desde la identidad propietaria, llamar `set_notification_service` con la identidad técnica y `enabled: true`. El servicio no tiene permisos de alumno ni administración general.
3. Guardar `NOTIFICATION_SERVICE_TOKEN` mediante `npm exec -w @b20/api -- wrangler secret put NOTIFICATION_SERVICE_TOKEN`. Configurar `SPACETIMEDB_URI` y `SPACETIMEDB_MODULE` para la misma base. Cambiar `NOTIFICATIONS_ENABLED` a `true` en la configuración del Worker y publicarlo sólo cuando se haya autorizado el despliegue.
4. Para entregar al dispositivo, generar un par VAPID P-256. `VAPID_PUBLIC_KEY` es la clave pública sin comprimir de 65 bytes; `VAPID_PRIVATE_KEY` es el escalar privado de 32 bytes. Ambos usan base64url sin relleno. Configurar `VAPID_SUBJECT` como contacto `mailto:` o URL HTTPS. Guardar la privada con `wrangler secret put VAPID_PRIVATE_KEY`; no incluirla en Pages, el repositorio ni el cliente. Configurar las otras dos variables en el Worker. Nunca rotar el par sin volver a registrar las suscripciones de los dispositivos.
5. Configurar **la misma clave pública** como `VITE_VAPID_PUBLIC_KEY` en el cliente y reconstruirlo. Cada persona activa el envío push en sus preferencias y luego pulsa «Activar en este dispositivo». El navegador solicita permiso mediante ese gesto. La cuenta puede mantener hasta cinco instalaciones activas.
6. Usar el aviso de prueba para revisar la bandeja y una suscripción autorizada. Para retirar un dispositivo, eliminarlo desde las preferencias; esto deshabilita la instalación y borra sus credenciales de transporte del servidor.

El Worker ejecuta el planificador cada minuto. Con token configurado y sin claves VAPID completas, procesa los eventos y los recordatorios de la bandeja y devuelve `pushConfigured: false`; no reclama trabajos push. `NOTIFICATIONS_ENABLED=false` desactiva todo el cron de avisos. Ninguna de estas variables cambia los permisos de las vistas privadas.

## Horarios y recuperación

La conversión de zona IANA se hace en Cloudflare con `Intl`. El módulo valida los nombres con una lista estática de TZDB, porque su runtime no ofrece `Intl` ni `URL`. Los límites de día y el descanso usan el calendario local y respetan días de 23 y 25 horas. Un cumpleaños del 29 de febrero se recuerda el 28 de febrero en años no bisiestos; no se almacena el año de nacimiento.

Se recuerdan tareas y actividades de hoy y mañana que no estén terminadas, cumpleaños compartidos con recordatorio activo, repasos inscritos con tarjetas pendientes, sesiones programadas propias o con participación y votaciones por cerrar. La primera activación comienza en el día actual después de la hora elegida. Desde entonces, un cursor por miembro conserva el último día completamente materializado. Los reinicios no saltan días: el planificador retoma los días contiguos pendientes en ejecuciones posteriores. Los días históricos recuperados entran en la bandeja sin provocar una ráfaga de push atrasado.

Cada cron planifica cuatro miembros en turno rotatorio, hasta dos días por miembro y 50 recordatorios por día. Si queda parte de un día, su cursor no avanza. El fanout procesa como máximo 100 destinatarios y el envío reclama hasta ocho trabajos por ejecución. Estos límites evitan ejecuciones sin cota y dejan el resto en SpacetimeDB.

## Privacidad y entrega

Los mensajes y menciones generan títulos genéricos: el payload push no incluye texto del chat, nombres, adjuntos ni claves de otros servicios. El servidor vuelve a comprobar membresía, acceso al recurso, bloqueo en ambos sentidos, silencio, puntero de lectura, categoría y suscripción antes de reclamar y antes de enviar. Un aviso de invitación a una sala privada está disponible al invitado; no abre la sala a otros miembros.

Los trabajos usan deduplicación por evento, destinatario e instalación, leases de cinco minutos y un máximo de cinco intentos. Un lease vencido puede recuperarse. Los errores de red, 408, 429 y 5xx se reintentan con espera exponencial y `Retry-After`, con tope de ocho horas. 404 y 410 desactivan la suscripción; una respuesta tardía no elimina una suscripción renovada durante el envío. El descanso difiere el trabajo sin consumir intentos. Los destinos están restringidos a endpoints HTTPS de servicios Web Push compatibles; no se siguen redirecciones y los cuerpos y tiempos HTTP están acotados.

La confirmación del navegador y la base de datos no forman una transacción distribuida: un fallo entre el envío y su confirmación puede repetir una entrega. La misma notificación conserva su etiqueta para sustituir la anterior en el dispositivo. El servicio tampoco puede garantizar entrega si el sistema operativo revoca permisos, limita actividad en segundo plano o expira la suscripción.

## Validación y límites de la entrega

Las pruebas cubren permisos privados, lectura/silencio/bloqueo, deduplicación, leases y renovación, límites de instalaciones, catch-up, DST y año bisiesto. El cifrado se verifica con el vector publicado de RFC 8291, descifrado del receptor y firma VAPID. Una prueba con Miniflare ejecuta HKDF, ECDH, AES-GCM y VAPID en workerd.

No se han creado secretos reales, enviado avisos a dispositivos personales ni desplegado el Worker durante esta implementación. La entrega efectiva requiere HTTPS, service worker activo, soporte de Push API y permiso concedido. En iOS depende de una PWA instalada y del soporte de la versión del sistema; en la extensión y el APK se usa Web Push sólo si el contenedor expone esas APIs. La bandeja privada sigue disponible en las tres superficies.

Referencias: [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291), [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292), [Web Crypto en Cloudflare Workers](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).
