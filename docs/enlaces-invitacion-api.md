# Servicio de enlaces de invitación

Los enlaces reutilizables se guardan en SpacetimeDB como una huella SHA-256 y un sobre AES-256-GCM. El Worker es el único componente con las claves para volver a copiar el secreto. Las invitaciones individuales por correo conservan su funcionamiento.

## Configuración

| Valor | Tipo | Uso |
| --- | --- | --- |
| `APP_URL` | Variable | Dirección base de la aplicación, sin parámetros ni fragmento. HTTPS en producción; HTTP solo para localhost. |
| `INVITATION_MASTER_VERSION` | Variable | Versión utilizada para cifrar enlaces nuevos; predeterminada en la configuración: `v1`. |
| `INVITATION_MASTER_KEYS_JSON` | Secreto de Cloudflare | Objeto JSON de versiones a claves aleatorias independientes de 32 bytes en base64. No reutilizar las claves de IA. |
| `SPACETIMEDB_URI`, `SPACETIMEDB_MODULE` | Variables existentes | Base de datos que valida las sesiones y los permisos. |
| `VITE_INVITATION_API_URL` | Variable pública de compilación del cliente | URL del Worker de enlaces. Vacía utiliza `VITE_AI_API_URL` y después `VITE_API_URL`. No contiene claves. |

Las rutas de invitaciones se montan en el Worker de la API, junto con las integraciones de IA. `VITE_API_URL` puede permanecer vacío cuando no existen descargas heredadas de R2: esa variable no es necesaria para administrar enlaces. El secreto de cifrado debe configurarse en el Worker elegido por `VITE_INVITATION_API_URL` o por esta cadena de alternativas.

El secreto de invitaciones es opcional para arrancar el servicio existente. Sin él, crear, copiar o reemplazar un enlace falla de forma cerrada con `503`. Configurarlo en el Worker al que apunte el cliente antes de habilitar estos controles. Mantenerlo fuera del repositorio y de variables publicadas por la web. Utilizar secretos administrados por Cloudflare o archivos locales ignorados; nunca incluir valores en comandos, registros ni capturas. [Documentación de secretos de Cloudflare](https://developers.cloudflare.com/workers/configuration/secrets/).

Para rotar, añadir la clave nueva al objeto conservando las versiones anteriores y cambiar `INVITATION_MASTER_VERSION`. Los enlaces antiguos siguen copiándose con su propia versión. Retirar una clave antigua impide recuperarlos; mantenerla mientras existan enlaces que puedan seguir usándose o reintentándose. El cifrado autentica el propósito `invitation-link`, el módulo y el identificador del enlace como datos adicionales, con IV aleatorio de 12 bytes. [API Web Crypto de Workers](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).

## Contrato HTTP

Las tres operaciones son `POST` con `Authorization: Bearer <sesión>` y respuesta `Cache-Control: private, no-store`. No admiten claves del servicio de archivos ni identidades técnicas. El JWT del solicitante pasa directamente a SpacetimeDB, que valida ambos proveedores admitidos y exige que su membresía siga siendo administrativa en la transacción.

| Ruta | Cuerpo |
| --- | --- |
| `/admin/invitation-links` | `{ requestId, name, expiresAt?, maxUses? }` |
| `/admin/invitation-links/:id/copy` | Sin cuerpo. |
| `/admin/invitation-links/:id/replace` | `{ requestId, name, expiresAt?, maxUses? }` con un identificador nuevo. |

`requestId` es un UUID v4 estable generado por el cliente para ese intento. `name` admite de 1 a 120 caracteres. `expiresAt` es una fecha en milisegundos desde Unix: ausente utiliza 7 días, `null` no tiene vencimiento. `maxUses` es un entero de 1 a 1 000 000; ausente o `null` no tiene cupo. SpacetimeDB decide el estado definitivo y la validez de la configuración.

La respuesta contiene `{ id, name, status, createdAt, expiresAt, maxUses, usedCount, version, url }`. La URL tiene la forma `https://app.example/#/invitacion?token=<secreto>`. El secreto de 32 bytes se codifica en base64url sin relleno. Solo aparece en el fragmento, nunca como ruta o parámetro HTTP. No se devuelven la huella ni el sobre cifrado. Copiar un enlace inactivo, vencido o sin cupo falla con `409`.

El cliente debe conservar el mismo `requestId` cuando se agote el tiempo o se pierda la respuesta, y repetir exactamente la misma intención. Crear y reemplazar son idempotentes por ese identificador; el Worker descifra el sobre que devuelve la base de datos, incluido el original en un reintento. Una respuesta perdida nunca justifica crear automáticamente otro intento. Reemplazar invalida el enlace anterior y crea el nuevo en una transacción, sin modificar las membresías incorporadas.

Los errores exponen únicamente un código acotado y un mensaje público. No registrar cuerpos de estas solicitudes o respuestas, ni el fragmento capturado por la aplicación. Las trazas de Workers están habilitadas y las peticiones a SpacetimeDB no llevan el secreto en su URL. [Trazas de Workers](https://developers.cloudflare.com/workers/observability/traces/).

## Verificación antes de habilitar

Usar un módulo de SpacetimeDB y claves independientes en un entorno aislado. Validar creación, copia desde otra sesión administrativa, reemplazo, caducidad, cupo, reintento después de confirmación perdida y rechazo de integrantes o sesiones dadas de baja. El Worker tiene pruebas con Miniflare y pruebas de cifrado para AAD, alteraciones y rotación. La compilación local en seco no valida los permisos o secretos de un despliegue remoto.
