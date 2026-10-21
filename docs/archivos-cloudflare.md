# Archivos privados: Cloudflare Workers y R2 (compatibilidad anterior)

> **Guía anterior.** Las subidas nuevas usan [SpacetimeDB por fragmentos](archivos-spacetime.md).
> R2 y este Worker solo se conservan para recuperar objetos existentes hasta verificar una
> migración que preserve IDs, versiones e integridad. No son requisitos de una instalación
> nueva; las instrucciones siguientes describen la operación de esa ruta anterior.

La API desplegable es `apps/api/src/worker.ts`. Usa Hono, SpacetimeAuth y un binding R2
privado. No monta `/ai`, no inicia el almacén BYOK y no necesita Google Cloud, claves de
Gemini ni credenciales S3. `src/server.ts`, Dockerfile y las rutas de IA se conservan como
código anterior; los scripts normales de `@b20/api` compilan y ejecutan el Worker.

## Configuración y activación

Se requiere Node.js 22 o superior. `apps/api/wrangler.jsonc` define el Worker
`app-b20-api`, el bucket `app-b20-files` mediante el binding `FILES`, los orígenes de la
web y los datos públicos de SpacetimeAuth/Maincloud. El bucket debe permanecer privado:
no habilitar `r2.dev` ni un dominio público para sus objetos.

Los orígenes locales de Capacitor `capacitor://localhost` y `https://localhost` están
incluidos. Para la extensión, agregar únicamente su origen `chrome-extension://<id>`
definitivo y el client ID autorizado al distribuirla; no usar comodines.

Antes de activar la web con datos reales:

1. Publicar el módulo actualizado sin borrar datos y ejecutar su migración académica
   aditiva. Las versiones iniciales se forman con el estado existente; no se inventa
   historial anterior.
2. Crear una identidad técnica dedicada en el mismo servidor SpacetimeDB mediante
   `POST /v1/identity`. Guardar su token directamente como secreto, sin imprimirlo,
   incorporarlo al repositorio ni utilizar el token del propietario de la base.
3. El propietario configura la identidad pública con `set_file_service`. Como
   alternativa de configuración inicial, el módulo admite `B20_FILE_SERVICE_IDENTITY`.
   Esta identidad solo confirma archivos y consulta su registro: no es un alumno ni
   debe recibir permisos de administración.
4. Guardar el token en el Worker mediante el diálogo de
   `npm exec -w @b20/api -- wrangler secret put FILE_SERVICE_TOKEN`.
5. Revisar emisor, client IDs y base en el archivo de configuración. Crear o vincular el
   bucket y publicar la API. Establecer `VITE_API_URL` en Pages a la URL HTTPS del Worker,
   y habilitar `VITE_DATA_MODE=spacetime` una vez comprobadas invitaciones y membresía.

El secreto se declara en `secrets.required`; su valor no está en el archivo. Los tipos
de bindings y del runtime se generan con `npm run types -w @b20/api` y se conservan en
`worker-configuration.d.ts`. Deben regenerarse al cambiar la configuración.

## Transferencia y permisos

El cliente envía el ID token vigente como `Authorization: Bearer …`. El Worker valida
firma RS256, emisor, audiencia, caducidad y correo verificado; después comprueba la
membresía activa con el mismo token en SpacetimeDB. CORS permite solo los orígenes
configurados y no sustituye esta autorización.

El identificador OIDC `sub` no es el identificador del alumno en las tablas. El
procedimiento `authorize_file_upload` obtiene la identidad real con `ctx.sender`, exige
permiso sobre el destino y registra un intento privado de 30 minutos. Solo después el
Worker acepta los bytes.

El cuerpo se transmite directamente a R2, con conteo de bytes y `FixedLengthStream`.
Se aceptan de 1 a **52,428,800 bytes** por archivo, equivalentes a los 50 MB usados por
la interfaz. Se rechazan el tamaño anunciado excesivo, los cuerpos truncados y los
cuerpos cuyo tamaño difiera del anunciado. El Worker no convierte la subida completa
a texto, JSON, Base64 ni un buffer.

El Worker determina la clave R2 a partir de la identidad autorizada y el UUID del
intento. Una escritura condicional impide sobrescribirla. Los metadatos guardan actor,
destino, versión, nombre y tamaño; los reintentos deben coincidir con esos datos.

Después de completar R2, el Worker envía tamaño y ETag reales a
`finalize_file_upload` usando exclusivamente `FILE_SERVICE_TOKEN`. El módulo vuelve a
comprobar autor, membresía, destino, intento y versión. Una llamada directa del cliente
no puede registrar una clave de almacenamiento inventada. La confirmación actualiza la
versión del recurso en una sola transacción y conserva las referencias de versiones
anteriores; un archivo confirmado no cambia de bytes.

Si se interrumpe la respuesta de confirmación, el Worker consulta el registro por
`uploadId`. Un archivo confirmado se devuelve sin publicarlo de nuevo. Un resultado
incierto conserva los bytes para el siguiente intento. Solo un rechazo definitivo
acompañado de una consulta que confirme ausencia permite la limpieza inmediata.

## Contrato HTTP

| Petición | Contenido y resultado |
| --- | --- |
| `GET /health` | Público; indica que el Worker está activo, usa R2 y no habilita IA. |
| `PUT /files/uploads/:uploadId?targetKind=…&targetId=…&expectedVersion=…` | Cuerpo binario `File`, token Bearer, `X-File-Name` codificado con `encodeURIComponent`, `X-File-Size` decimal y `Content-Type`. Devuelve `201 {fileId}` o `200 {fileId}` al recuperar un intento confirmado. |
| `GET /files/uploads/:uploadId?targetKind=…&targetId=…&expectedVersion=…` | Consulta autenticada de recuperación; devuelve `{fileId: string \| null}` tras comprobar acceso y destino. |
| `GET /files/:fileId` | Descarga autenticada por identificador; nunca acepta una clave R2 elegida por el cliente. |

`targetKind` admite `assignment`, `activity`, `work` y `evidence`. `targetId` es un u64
decimal sin conversión a `Number`; `expectedVersion` es un entero positivo u32.
`uploadId` es un UUID v4 creado una sola vez por intento y conservado para reintentos.
El nombre admite hasta 200 caracteres y no admite rutas ni caracteres de control.
Los identificadores de archivo nuevos son UUID; `legacy:<u64>` permite descargar
adjuntos anteriores cuando su almacenamiento siga disponible.

La descarga pide primero permiso a `get_file_download_access`, recupera exactamente el
objeto y ETag de esa versión y transmite su cuerpo. Responde con `attachment`,
`application/octet-stream`, `nosniff` y `Cache-Control: private, no-store`. La interfaz
usa una petición con Bearer y un enlace temporal local al resultado; una etiqueta de
enlace común no enviaría el token. No se entregan credenciales R2 ni URLs públicas.

Respuestas esperadas: `400` para datos o cuerpo inválidos, `401` para sesión inválida,
`403` para falta de membresía, `404` para un archivo no disponible, `409` si cambiaron
permisos o versión y `413` si se excede el límite. Los fallos de conexión o de
configuración devuelven `503` y permiten reintentar.

## Limpieza y conservación

El evento diario revisa una página acotada de 20 objetos y conserva un cursor privado
en R2 para continuar en la siguiente ejecución. Solo elimina objetos con más de 24
horas que carezcan de registro confirmado. Si no puede comprobar el estado en la base,
conserva los objetos y el cursor para reintentar. Los archivos confirmados de versiones
históricas se conservan; retirar un archivo de la versión actual no autoriza borrarlo
de R2.

## Comprobaciones

```sh
npm run types -w @b20/api
npm run typecheck -w @b20/api
npm test -w @b20/api
npm run build -w @b20/api
```

`build` realiza un dry run y genera `apps/api/dist`; no publica recursos. Las pruebas
ejecutan el Worker y R2 local mediante Miniflare/Workerd, incluyendo el límite exacto de
50 MiB, autenticación, bajas, autorización por recurso, reintentos concurrentes,
confirmación incierta, integridad de descargas y limpieza conservadora. La comprobación
final en producción debe usar dos cuentas invitadas para subir y descargar un archivo,
revocar una cuenta y verificar que ya no puede leerlo. No usar datos de la simulación
como evidencia de persistencia compartida.

Referencias: [R2 desde Workers](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[FixedLengthStream](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/),
[procedimientos SpacetimeDB](https://spacetimedb.com/docs/functions/procedures/) y
[HTTP de SpacetimeDB](https://spacetimedb.com/docs/http/database/).
