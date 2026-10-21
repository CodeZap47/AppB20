# Despliegue

Cómo subir App B20 a internet. Nada de esto crea cuentas ni cobra por sí solo: cada paso
que necesita una cuenta lo hace una persona del grupo.

## Qué va a dónde

| Pieza | Dónde | Requisito de esta entrega |
| --- | --- | --- |
| Datos y archivos (`packages/spacetime-module`) | **SpacetimeDB Maincloud** | Tablas privadas, fragmentos de 1 MiB, permisos y operaciones del grupo. |
| Autenticación | **SpacetimeAuth** | Cliente OIDC e invitaciones; la identidad de CLI no es la del alumno. |
| Web/PWA (`apps/web`) | **Cloudflare Pages** | Compilación estática con HTTPS en `*.pages.dev`. |
| Integraciones (`apps/api`) | **Cloudflare Workers** | Gemini BYOK compartido por Guías y Exámenes; operaciones privadas de Exámenes. El servicio de archivos R2 anterior permanece separado. No se necesita para subir archivos nuevos. |
| Extensión (`apps/extension`) | Paquete local/controlado | Panel lateral y vista completa; publicación en tienda fuera del presupuesto inicial. |
| Android (`apps/android`) | APK firmado, descarga controlada | Sin Firebase como requisito nuevo; push nativo con la app cerrada permanece pendiente. |

La instalación nueva usa solo SpacetimeDB y Cloudflare, sin Supabase, D1, R2, Cloud Run ni
Secret Manager como dependencias. No se habilitan planes de pago automáticamente. OpenMAIC y
sus instrucciones antiguas no forman parte de esta entrega ni justifican añadir otro proveedor.

## Base de datos elegida

Los comandos de Maincloud de esta guía apuntan a **`app-b20-34245`**, la base indicada para
B20. Su identidad indicada es `c2006d3bbe49dc8cabbfa144282ee0af8edb84292d74f2e48128a0e0f4f626ba`. El nombre e
identidad de base son distintos al Client ID del cliente de SpacetimeAuth; este último se
obtiene en **SpacetimeAuth → Clients**.

En desarrollo local se puede conservar `app-b20` con el servidor `http://localhost:3000`.
No ejecutes una creación con `--template chat-react-ts` en este repositorio: la aplicación y el
módulo ya existen. El registro del despliegue anterior indica el módulo en esa base, con
`auth_config` para `client_034jL0AHYYQ1bps8SupHU0` y la primera invitación de administrador. La variable temporal
para adoptar la base vacía ya se retiró. La web del registro anterior es
https://app-b20.pages.dev. También existe una referencia histórica al Worker R2
https://app-b20-api.sucanasta1.workers.dev. Estas direcciones no prueban que los cambios locales
de esta entrega ya estén publicados o comprobados.

## Datos reales y archivos privados

La configuración del cliente apunta a `VITE_DATA_MODE=spacetime`, con invitaciones y datos en
Maincloud. Los archivos nuevos se transfieren directamente a SpacetimeDB y no requieren
`VITE_API_URL`. La simulación sigue disponible para desarrollo, sin importar sus ejemplos.

Consulta [archivos-spacetime.md](archivos-spacetime.md) para tamaño, fragmentación, reintentos,
conservación y compatibilidad con archivos anteriores. Antes de dar por terminada la entrega
debe registrarse publicación, persistencia y aislamiento con tres cuentas. Extensión y APK
conservan sus validaciones propias. La [matriz de estado](estado-del-proyecto.md) separa los
requisitos implementados de las comprobaciones pendientes.

## Pasos

### 0. Cuentas (una sola vez)

- Cuenta en Cloudflare para publicar la web.
- CLI de SpacetimeDB instalada y `spacetime login`; verificar compatibilidad con SDK y módulo
  antes de publicar. Cliente y módulo usan el SDK fijado en `2.12.0`; los bindings se generan
  con esa misma versión.

### 1. Proyecto SpacetimeAuth

El proyecto y el cliente `client_034jL0AHYYQ1bps8SupHU0` ya existen. Ya están guardados los
retornos locales, `https://app-b20.pages.dev/auth/callback` y
`https://app-b20.pages.dev/auth/logout`, más los del enlace anterior `af0dd1ec.app-b20.pages.dev`
para conservar su acceso. Usa la URL estable; no registres cada hash nuevo ni comodines. El
correo debe estar verificado para la fase `demo`; la invitación solo se exige al activar
`spacetime`. Google es opcional para este piloto.

Sigue los detalles de [`spacetimeauth.md`](spacetimeauth.md). Si vas a distribuir la extensión o
Android, registra también sus retornos y client IDs correspondientes.

### 2. SpacetimeDB en Maincloud: preparado para la fase de datos reales

```sh
npm run spacetime:publish:maincloud
npm run spacetime:generate

# Ejecutar con la misma identidad de CLI que publicó la base:
spacetime call -s maincloud app-b20-34245 set_auth_config \
  '"https://auth.spacetimedb.com/oidc"' '["<client-id-web>","<client-id-extension>","<client-id-android>"]'
spacetime call -s maincloud app-b20-34245 invite_member '"tu-correo@gmail.com"' true
```

El script de Maincloud usa `--delete-data=never`; el script `spacetime:publish` sigue apuntando
a la base local `app-b20`. El módulo, `auth_config` y la primera invitación ya están preparados:
los comandos con placeholders se conservan como referencia para otra instalación. El caso de
adopción de una base vacía existente se explica en [SpacetimeAuth](spacetimeauth.md#actualizar-una-base-vacía-que-ya-existía);
la identidad propietaria de CLI es distinta a la identidad de base y al Client ID de auth.

Estos pasos no son necesarios para entrar a la simulación actual. Al activar
`VITE_DATA_MODE=spacetime`, la lista debe contener los client IDs usados y la persona debe
unirse con su correo invitado. Las demás invitaciones se administrarán desde Ajustes. La
identidad OIDC no es la identidad de la CLI que administra la base.

Variables del cliente: `VITE_SPACETIME_URI=wss://maincloud.spacetimedb.com` y
`VITE_SPACETIME_DB=app-b20-34245`. Las audiencias del módulo deben coincidir con `OIDC_AUDIENCE` del
backend. No se aceptan sesiones de otros proyectos aunque compartan el emisor de SpacetimeAuth.

### 3. Archivos directos y compatibilidad opcional

La ruta normal de archivos no requiere publicar un Worker. Publicar primero el módulo que
soporta fragmentos y generar los bindings antes de compilar el cliente. Conservar
`--delete-data=never`; una incompatibilidad de esquema debe resolverse con una migración
aditiva, nunca borrando la base. Ver [la guía de archivos](archivos-spacetime.md).

Si existen objetos R2 anteriores, mantener el Worker histórico y su configuración mientras se
comprueba la migración. En ese caso `VITE_API_URL` sirve únicamente para esas descargas; no se
usa como depósito de archivos nuevos. No retirar credenciales o buckets hasta comprobar todos
los IDs y versiones. La guía anterior de [Workers/R2](archivos-cloudflare.md) se conserva para
operación de esa compatibilidad, no como requisito de una instalación nueva.

### 4. Web en Cloudflare Pages

Guías y Exámenes reutilizan el servicio `app-b20-ai` con `VITE_AI_API_URL=https://app-b20-ai.aguaseero.workers.dev`. Las claves cifradas y el consentimiento permanecen en SpacetimeDB; las maestras y el token técnico exclusivo permanecen en Cloudflare Secrets. La entrega de Exámenes no crea credenciales nuevas ni sustituye el Worker de archivos anteriores. Primero se publica el módulo aditivo con `--delete-data=never`, después `apps/api/wrangler.ai.jsonc` conservando los secretos y la política vigente, y por último Pages. Resolver exámenes guardados usa `/ai/exams` autenticado y funciona sin clave ni llamadas al proveedor. Consultar el [registro de Exámenes](examenes-entrega.md) para separar pruebas locales, publicación y aceptación humana.

El registro anterior de Pages apunta a **https://app-b20.pages.dev** con integración Git:
el commit `59d17a7` terminó en **Success** y se comprobó entonces la pantalla de acceso.
Esto no acredita la publicación de esta entrega; verificar configuración y registrar el nuevo
resultado. Los detalles previos están en [`cloudflare-pages.md`](cloudflare-pages.md).

- Repositorio `CodeZap47/AppB20`, rama de producción **`codex/pages-spacetimeauth`**.
  Integrar únicamente la revisión validada para publicar; `main` puede contener entregas
  aún no activadas y las ramas no se fusionan automáticamente.
- Raíz `/`, comando `npm run build:pages`, salida `apps/web/dist`, preset **None**.
- Node.js `22` en `.nvmrc`.
- Variables públicas en **`wrangler.jsonc → vars`**, incluyendo `VITE_DATA_MODE=spacetime`.
  `VITE_API_URL` puede permanecer vacío para archivos nuevos; configurar solo si se necesitan
  descargas R2 anteriores.
  Edita ese archivo y envía el commit; las variables `VITE_*` del panel no sustituyen el archivo.
- `VITE_WEB_ORIGIN=https://app-b20.pages.dev` fija el dominio estable en modo `pages`; las
  nuevas compilaciones llevan los alias allí antes del login. Los callbacks permanecen vacíos
  y sus URLs exactas ya están guardadas en SpacetimeAuth. Los despliegues anteriores son
  inmutables. El acceso al almacenamiento directo no depende de `VITE_API_URL`.
- Para compilar localmente, `.env.pages` se crea desde `.env.pages.example`; está ignorado por
  Git y no llega a Cloudflare.

El Worker `appb20` creado desde el flujo inicial no es el proyecto Pages ni el Worker de
archivos `app-b20-api`. Su integración ejecutaba `npx wrangler deploy` sin build desde la
raíz del workspace y fallaba al detectar el proyecto. Sus builds automáticos quedaron
deshabilitados tanto en producción como en vistas previas; ambos controles se guardaron
y comprobaron tras recargar el panel. Se conservan el servicio, la conexión Git y su
historial. Consultar el [registro de corrección](worker-heredado.md) antes de reactivarlo.
No requiere desplegar código, migrar datos ni modificar R2 o Maincloud.

Esta corrección se registra en `main` y en la rama de producción sin adelantar la tercera
entrega que llegó a `main` durante la revisión. El código de esa entrega y su activación
requieren su propio proceso de validación y publicación.

La publicación de Pages compila el monorepo y sirve `apps/web/dist`; `app-b20` continúa
actualizándose mediante Git. El ZIP local queda como alternativa para otro proyecto de
subida directa. La guía de Pages también registra el fallo inicial por variables ausentes.

### 5. Dominio (opcional)

El subdominio gratuito `*.pages.dev` sirve la web sin comprar dominio. Si más adelante se usa
un dominio propio, conectarlo a Pages, actualizar `VITE_WEB_ORIGIN` y registrar sus retornos
exactos en SpacetimeAuth. Un Worker opcional puede usar su propio subdominio de Cloudflare;
no necesita Cloud Run ni otro proveedor.

### 6. Verificación antes de cerrar la entrega

1. Registrar la versión de CLI, SDK y módulo y publicar sin borrar datos.
2. Confirmar que los IDs, versiones y archivos anteriores continúan disponibles.
3. Con autor y compañero autorizado: publicar, adjuntar, recargar, descargar y comprobar los
   mismos datos desde otra sesión. Interrumpir y reanudar una subida con el mismo archivo.
4. Con un tercero sin permiso: intentar consultar y descargar por ID. Dar de baja una cuenta
   y comprobar el rechazo también después de haber abierto la sesión.
5. Verificar límite exacto de 50 MiB, cancelación y conflicto de versión.
6. Registrar evidencia en la matriz de estado. Las pruebas automatizadas no sustituyen los
   recorridos humanos ni confirman que el despliegue remoto ya se realizó.
