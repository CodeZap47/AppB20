# Verificación de push en iPhone y Android

**23 de octubre de 2026, America/Tijuana.** Alcance: la app web instalada (PWA) de
[b20.mx](https://b20.mx/) en ambos teléfonos. El APK Android no forma parte de esta prueba.

**Resultado: comprobaciones técnicas aprobadas; recepción real pendiente.** No hay teléfonos
disponibles para conceder permisos y observar avisos. No se ha enviado ningún push real en
esta verificación. Las pruebas automatizadas, la bandeja y la salud del servicio no sustituyen
la recepción visible del sistema.

## Evidencia comprobada

Se trabajó sobre la revisión publicada `7d509d7b560e0dc7d742c0103d37d17286f063fe`,
en una copia aislada; la carpeta original estaba en otra rama, con configuración anterior.
No se modificaron producción, claves, permisos de cuentas ni suscripciones reales.

| Comprobación | Evidencia y resultado |
| --- | --- |
| Web publicada | Pages `app-b20`, despliegue `b84d4e04-9feb-4907-a27b-55d909fe81f1`, revisión `7d509d7`, HTTP 200. |
| Instalación y recepción web | Manifiesto HTTP 200, `display: standalone`, ámbito e inicio `./`; `/sw.js` HTTP 200 con tipo JavaScript y manejador de `push`. Esto no acredita que esté instalado/activo en un teléfono. |
| Servicio actual | `b20-api`, `https://api.b20.mx/health`, HTTP 200 y `ok: true`. |
| Versión del servicio | `75ee719f-09df-41a1-b686-7ca538b39a14`, con el 100 % del tráfico. |
| Configuración de avisos | `NOTIFICATIONS_ENABLED=true`; clave pública VAPID idéntica en el servicio activo y el archivo público de la web; contacto `https://b20.mx`. |
| Secretos de transporte | `NOTIFICATION_SERVICE_TOKEN` y `VAPID_PRIVATE_KEY` presentes por nombre; sus valores no se consultaron. Esto no demuestra por sí solo la validez de las credenciales. |
| Programación real | Una ejecución observada con `cron: "* * * * *"`, resultado `ok`, cero excepciones y registro `{"event":"scheduled_maintenance","task":"notifications","ok":true}`. |
| Pruebas focalizadas | **80 aprobadas**: app 9, web 6, API 23, reglas compartidas 11 y módulo de datos 31. |
| Base de datos aislada | Prueba con tres cuentas sintéticas y una identidad técnica aprobada: seis grupos de comprobaciones, reinicio real y `realWebPushCalls: 0`. |
| Revisión de tipos | `@b20/app` aprobada, incluidos los nuevos casos de permiso. |
| Teléfonos físicos | Ningún Android conectado ni iPhone físico en el inventario de Xcode; los simuladores no acreditan esta aceptación. |

El evento programado se observó el **23 de octubre a las 23:16:35.321 en Tijuana**
(`2026-10-24T06:16:35.321Z`). La consulta pública se realizó a las **23:17:30**
(`2026-10-24T06:17:30.008Z`). La escucha de registros terminó y se cerró correctamente.

La web servía `/assets/index-C8pM_vgY.js`, SHA-256
`358acac75fe0e190a0f6835a9a80a044b267deca040d046648df30230bda1f59`.
La huella SHA-256 del texto base64url de la clave **pública** VAPID era
`10fd0043cd206065661c5e25d26c130d5d45b7bca7069b4ef7178b0a5cd3f276`.
Estas referencias identifican la configuración observada; deben revisarse de nuevo si cambia
el despliegue antes de probar los teléfonos.

`ok: true` del programador significa que la ejecución terminó sin excepción. No acredita
que hubiera trabajos, que Apple/Google aceptaran un envío ni que un teléfono lo mostrara.
El registro actual no expone los contadores `pushConfigured`/`sent` del planificador.

## Permisos y límites actuales

La entrega necesita tres condiciones independientes: preferencia de envío guardada,
permiso del navegador/sistema concedido y suscripción del dispositivo registrada.
Una membresía activa es necesaria para registrar la instalación. El servidor comprueba
propiedad, acceso al contenido, lectura, categorías, silencios y bloqueos antes de enviar.

Las pruebas cubren autorización y privacidad, cifrado Web Push/VAPID en el runtime del
servicio, cola, reintentos y destinos al tocar avisos. Se añadieron casos de permiso inicial
`default` que se resuelve en `granted` o `denied`: mientras se espera la decisión no se
suscribe, registra ni persiste el dispositivo. Un permiso ya concedido no se vuelve a pedir.

La regresión de las correcciones locales aprobó **28 pruebas de la app**, incluidas 19
pruebas específicas del nuevo indicador: revocación y recuperación, regreso a B20,
suscripción ausente, consultas fallidas, respuestas fuera de orden y separación de
dispositivos/cuentas. También se comprobó la compilación de la web y su service worker.
Estos resultados se añaden a la auditoría inicial de 80 pruebas; no son una prueba física.

Las dos limitaciones observadas en la revisión publicada se corrigen en el **código local**;
estos cambios no se han desplegado ni acreditan recepción física:

- `/instalar` incluye iPhone y Android, la dirección HTTPS, los nombres actuales de los
  botones y el orden de guardar preferencias, activar el dispositivo y conceder permiso.
  También explica cómo rehabilitar permisos bloqueados.
- El estado del dispositivo local consulta permiso y suscripción sin solicitar autorización.
  Se actualiza al volver a la pantalla y, cuando el navegador lo permite, al cambiar el permiso.
  «Activo» exige permiso concedido, suscripción local, registro habilitado y preferencia de
  envío guardada. Los demás dispositivos se muestran como «Registrado» cuando el servidor
  conserva su registro habilitado; no se atribuyen permisos remotos.

El permiso consultado es el que expone el navegador. «Activo» no confirma que el sistema
muestre un aviso: Concentración/No molestar, los ajustes del sistema y la entrega de red
siguen requiriendo las rondas en teléfonos reales. Un estado pendiente, bloqueado, sin
registro o no comprobable no debe interpretarse como recepción aprobada.

## Protocolo para los teléfonos disponibles posteriormente

### Instalar y autorizar

1. **iPhone:** con iOS 16.4 o posterior, abrir `https://b20.mx` en Safari, tocar Compartir
   y Añadir/Agregar a pantalla de inicio. Mantener «Abrir como app web» si aparece y abrir
   B20 desde su icono. WebKit requiere instalación y una acción directa para solicitar
   permiso: [Web Push en iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
2. **Android:** abrir `https://b20.mx` en Chrome, usar el menú de instalación
   («Instalar y crear acceso directo» → «Instalar», según versión) y abrir desde el icono:
   [instrucciones de Google](https://support.google.com/chrome/answer/9658361?hl=es&co=GENIE.Platform%3DAndroid).
   Un acceso directo que solo abre una pestaña no basta para acreditar esta ronda de PWA.
3. Para la ronda conjunta, iniciar sesión con **la misma cuenta activa del grupo** en ambos
   teléfonos y en una computadora, desde la que se solicitarán las pruebas con los teléfonos
   ya cerrados. Si se usan cuentas distintas, realizar y registrar cada ronda por separado.
4. Abrir [Ajustes → Avisos](https://b20.mx/#/ajustes?pestana=avisos). Anotar las preferencias
   anteriores; seleccionar «Aviso de prueba de App B20» y «Enviar también a mis dispositivos
   registrados». Revisar zona horaria y poner temporalmente inicio y fin del descanso iguales
   (por ejemplo, `00:00`). Pulsar **Guardar preferencias**.
5. En cada teléfono, pulsar **Activar en este dispositivo** y aceptar el permiso del sistema.
   Comprobar el permiso en sus ajustes y que el registro persiste al recargar. Para esta ronda
   positiva, desactivar temporalmente Concentración/No molestar y permitir avisos en la
   pantalla bloqueada. Conservar las claves VAPID actuales.

### Comprobar recepción y apertura

Preparar el estado del teléfono **antes** de solicitar el aviso. Desde otra sesión de la
misma cuenta, pulsar **Probar mis avisos**. Repetir por separado con B20 en segundo plano,
cerrada desde las aplicaciones recientes y con la pantalla bloqueada. Cerrar B20 no significa
detener Chrome forzosamente desde los ajustes de Android.

Cada solicitud se dirige a **todas las instalaciones activas de la cuenta**, incluidas las
antiguas. No hay selector por teléfono y las etiquetas pueden ser iguales («Web/PWA»).
Separar rondas por **más de 60 segundos**: la prueba se deduplica por cuenta y minuto.
No pulsar el título del aviso ni marcarlo como leído hasta recibirlo en ambos teléfonos;
la lectura compartida puede cancelar el envío aún pendiente al otro dispositivo.
Abrir la bandeja por sí solo no marca el aviso como leído.

Registrar el aviso visible del sistema y su hora en cada ronda. Después, tocarlo y confirmar
que abre la bandeja de B20 en el mismo origen, conserva la sesión válida o solicita acceso
si corresponde. Registrar el destino observado. Si no llega, anotar hasta qué hora se
esperó y revisar primero permiso, conexión, descanso, categoría, suscripción y registros
del servicio. Unos segundos sin aviso no bastan para declarar un fallo: el cron, las colas,
los reintentos y los ajustes del sistema afectan al tiempo de entrega.

### Denegar, revocar y rehabilitar

En cada plataforma, probar una instalación con permiso inicial sin decidir: rechazar la
solicitud y comprobar que no se registra una suscripción nueva y la bandeja sigue disponible.
Para repetir una decisión inicial, usar una instalación de prueba o restablecer previamente
su permiso; no asumir que el sistema volverá a mostrar el diálogo después de rechazarlo.

Después de una ronda positiva, revocar el permiso del teléfono/sitio y solicitar otra prueba
desde la computadora. Registrar la ausencia de aviso durante esa ronda en ese teléfono.
Conservar la preferencia global de envío: desmarcarla afectaría a todos los dispositivos.
Al volver a B20 con la versión local corregida, el estado debe reflejar el permiso bloqueado
y dejar de mostrar «Activo» para ese dispositivo. Si el sistema impide las notificaciones
sin cambiar el permiso que expone el navegador, registrar ambos estados por separado.
Las otras instalaciones mantienen «Registrado»; sus permisos no se consultan a distancia.

Rehabilitar el permiso en Ajustes → Notificaciones → B20 en iPhone; en Android revisar los
permisos de la PWA/Chrome en el sistema y el permiso de notificaciones de `b20.mx`:
[gestionar permisos del sitio en Chrome](https://support.google.com/chrome/answer/3220216?hl=es&co=GENIE.Platform%3DAndroid).
Abrir B20, pulsar **Activar en este dispositivo** y repetir una ronda positiva. Al terminar,
restaurar horarios, categorías y ajustes de concentración anotados antes de la prueba.

### Registro de aceptación

Por cada ronda, conservar: plataforma, modelo, versión del sistema y navegador, fecha y
zona horaria, permiso inicial/final, registro/suscripción comprobados, estado de B20,
hora de solicitud, hora de recepción (o fin de espera), aviso visible, destino al tocar
y resultado. No adjuntar endpoints, tokens ni claves de suscripción.

| Escenario | iPhone | Android |
| --- | --- | --- |
| Permiso inicial concedido y registro persistente | Pendiente | Pendiente |
| Aviso visible con B20 en segundo plano | Pendiente | Pendiente |
| Aviso visible con B20 cerrada | Pendiente | Pendiente |
| Aviso visible con pantalla bloqueada | Pendiente | Pendiente |
| Apertura correcta al tocar el aviso | Pendiente | Pendiente |
| Denegación inicial sin registro nuevo | Pendiente | Pendiente |
| Revocación del permiso y rehabilitación | Pendiente | Pendiente |

**Cierre:** aprobar cada plataforma únicamente después de observar las rondas de recepción
del sistema y registrar sus resultados. Las casillas siguen pendientes hasta realizar las
pruebas en teléfonos reales.

## Repetir las comprobaciones locales

Desde la raíz de esta revisión, con las dependencias instaladas y Node 22 o posterior:

```sh
npm run test -w @b20/app -- src/lib/browserPush.test.ts src/components/NotificationSettings.test.tsx src/components/NotificationSettings.push.test.tsx
npm run test -w @b20/web -- src/sw.test.ts src/pushRoute.test.ts
npm run test -w @b20/api -- src/notifications src/guideWorker.test.ts
npm run test -w @b20/core -- src/notifications.test.ts
npm run test -w @b20/spacetime-module -- src/notifications.test.ts
npm run test:spacetime:notifications
npm run typecheck -w @b20/app
```

La prueba de base de datos requiere la CLI de SpacetimeDB compatible con el proyecto.
Crea y retira su propio servidor temporal; no debe sustituirse por una base publicada.
Estas comprobaciones no solicitan permisos a teléfonos ni envían Web Push real.
