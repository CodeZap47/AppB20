# Archivos privados en SpacetimeDB

La primera entrega utiliza SpacetimeDB para metadatos y bytes de los archivos académicos.
Cloudflare Pages sirve la interfaz; no hace falta un bucket, un Worker de archivos, una
identidad técnica ni `VITE_API_URL` para una instalación nueva. Gemini permanece deshabilitado.

Esta guía describe la implementación local. Publicación en Maincloud y pruebas con autor,
compañero autorizado y tercero deben registrarse por separado en
[estado-del-proyecto.md](estado-del-proyecto.md). No usar la demo como prueba de persistencia.

## Formato, límites y cuotas

- Tamaño válido: de 1 a **52,428,800 bytes (50 MiB)**, en cliente y módulo.
- Fragmentos de **1,048,576 bytes (1 MiB)**; el último puede ser menor. Nunca enviar el archivo
  completo como un mensaje WebSocket ni incluir sus bytes en una suscripción comunitaria.
- El manifiesto conserva identidad del solicitante, destino, versión esperada, nombre, tipo,
  tamaño, SHA-256 del archivo completo, número de fragmentos y estado.
- Un fragmento conserva índice, bytes y SHA-256. Confirmar comprueba todos los fragmentos,
  tamaños, hashes e integridad del archivo completo antes de adjuntarlo atómicamente.
- Reserva global inicial: **256 MiB** para archivos nativos, contando listos y pendientes.
  El propietario puede ajustarla hasta **512 MiB**. No representa una cuota garantizada del
  proveedor: hay que medir el uso de otros datos, transferencia y procesamiento.
- Máximo de **tres intentos pendientes por persona** y caducidad de **24 horas**.
  Cancelar o limpiar un intento libera su reserva y elimina sus fragmentos pendientes.

La cuota es una protección operativa para conservar espacio del plan gratuito. No activa
facturación ni añade almacenamiento de pago si se alcanza. La app debe mostrar el motivo de
rechazo y permitir reintentar cuando haya espacio.

## Operaciones y autorización

| Operación | Responsabilidad |
| --- | --- |
| `begin_resource_upload` | Validar identidad, permiso de edición, destino, versión, metadatos, hash y reserva; iniciar o recuperar el intento. |
| `put_resource_chunk` | Aceptar un fragmento privado de tamaño e índice válidos; comprobar su hash y permitir repetir exactamente el mismo envío. |
| `get_resource_upload_status` | Devolver el estado del intento al solicitante, sin exponerlo a otros integrantes. |
| `finalize_resource_upload` | Comprobar integridad, permiso y versión actuales; adjuntar una sola vez y conservar la referencia de almacenamiento. |
| `cancel_resource_upload` | Cancelar un pendiente propio y liberar bytes y reserva; no borrar un archivo ya confirmado. |
| `get_resource_manifest` | Comprobar acceso actual al archivo y devolver metadatos de descarga, con `storageKind: spacetime` o `legacy`. |
| `read_resource_chunk` | Entregar un fragmento binario autorizado, bajo demanda y sin suscribir su tabla. |

Los intentos y fragmentos son tablas privadas. Una cuenta administradora no recibe acceso a
bytes o intentos ajenos por consultar una tabla general. Las operaciones comprueban membresía
activa; la autorización de descarga se deriva del recurso, incluidas versiones recuperables.
La identidad del alumno procede del token verificado por SpacetimeDB, no de un ID elegido
por el navegador.

`targetKind` admite `assignment`, `activity`, `work` y `evidence`. Los identificadores u64 se
conservan como cadenas decimales en el cliente; no se convierten a `Number`. La versión esperada
impide que una subida sobrescriba silenciosamente los cambios de otra persona.

Los reducers anteriores de confirmación R2 quedan como compatibilidad restringida. El camino
nativo no permite registrar una clave de almacenamiento elegida por el cliente; `stdb:<id>`
es una referencia generada por el módulo, no una URL pública.

## Subida, reintento y cancelación

1. El cliente valida tamaño y nombre, calcula el hash y solicita un intento para el recurso
   y su versión. El servidor vuelve a comprobar todos los límites y reserva el tamaño total.
2. Consulta el estado y transmite solo los fragmentos pendientes, sin replicar bytes completos
   en cada reintento. Cada envío se puede repetir sin crear una segunda copia.
3. Si se corta la conexión, el intento conserva los fragmentos durante su plazo de validez.
   Reanudar exige el mismo archivo, destino, versión y contenido. Una sesión nueva requiere
   reautenticación y volver a seleccionar el archivo cuando ya no esté disponible en memoria.
4. Confirmar comprueba los bytes y vuelve a validar permisos y versión. Si la respuesta se
   pierde, consultar el estado permite reconocer el archivo ya confirmado sin adjuntarlo otra vez.
5. Cancelar elimina únicamente el intento pendiente. Una confirmación previa no se deshace
   por una cancelación tardía; retirar un adjunto confirmado usa las reglas del recurso.

Un cambio de permisos, baja, archivo distinto o versión obsoleta detiene la operación y debe
mostrar un error recuperable. No sustituir automáticamente la versión esperada por la nueva
ni reiniciar una subida silenciosamente. Los intentos caducados pueden limpiarse mediante la
programación de SpacetimeDB sin eliminar archivos confirmados.

## Descarga y conservación

Las listas y snapshots reciben los metadatos existentes de `resource_files`, no los bytes.
Al pulsar descargar, el cliente pide un manifiesto autorizado, lee sus fragmentos, verifica
integridad y genera un `Blob` local. El enlace temporal local se libera después de usarlo.
No se entregan URLs públicas ni credenciales de almacenamiento.

Los IDs de archivos y las referencias de versiones existentes se conservan. Retirar un archivo
de la versión actual no borra los bytes si una revisión recuperable todavía los referencia.
La papelera de 30 días es una entrega posterior; esta entrega no ejecuta una purga de archivos
confirmados ni presenta esa política como ya implementada.

### Archivos R2 anteriores

Un manifiesto `legacy` conserva su ID, clave y referencias anteriores; el cliente puede recurrir
al Worker autenticado previamente configurado para su descarga. Mantener `VITE_API_URL` solo
cuando existan esos objetos; una instalación vacía puede dejarlo sin configurar.

La guía [archivos-cloudflare.md](archivos-cloudflare.md) describe esa ruta anterior. No retirar
el bucket, su credencial o los metadatos por desplegar el módulo nuevo. Antes de una migración
remota: inventariar IDs/versiones y tamaños; copiar sin sobrescribir referencias; comprobar
hashes y permisos; verificar descarga de versiones antiguas; conservar las copias previas
hasta documentar el resultado. Esta entrega no ejecuta una migración R2 remota automática.

## Activación y comprobaciones

1. Revisar CLI, SDK y bindings compatibles; publicar el módulo actualizado con
   `npm run spacetime:publish:maincloud` y `--delete-data=never`. Si el esquema no admite la
   actualización, resolverlo mediante migración aditiva en lugar de eliminar datos.
2. Generar bindings y compilar el cliente; publicar Pages después del módulo compatible.
   Conservar el nombre de base, `auth_config`, invitaciones, IDs y versiones.
3. Ejecutar las pruebas de tipos, módulo y transporte, además de compilar web y extensión.
4. En Maincloud, con tres cuentas: subir y recargar; descargar desde otra cuenta autorizada;
   rechazar acceso del tercero y después de una baja; interrumpir/reanudar; cancelar;
   comprobar límite exacto, cuotas y conflicto de versión.
5. Registrar versión publicada y evidencia de esos recorridos en la matriz de estado.

La comprobación local y la compilación no acreditan el despliegue ni la validación humana de
producción. Tampoco sustituyen las pruebas de memoria y transferencia en dispositivos reales
para un archivo de 50 MiB.
