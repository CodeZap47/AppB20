# Despliegue

Cómo subir App B20 a internet. Nada de esto crea cuentas ni cobra por sí solo: cada paso
que necesita una cuenta lo hace una persona del grupo.

## Qué va a dónde

| Pieza | Dónde | Requisito de esta entrega |
| --- | --- | --- |
| Datos y archivos (`packages/spacetime-module`) | **SpacetimeDB Maincloud** | Tablas privadas, fragmentos de 1 MiB, permisos y operaciones del grupo. |
| Autenticación | **Supabase Auth** (`casdrecords`) | Solo cuentas, código, contraseña y sesión; la membresía vive en SpacetimeDB. La identidad de CLI no es la del alumno. |
| Web/PWA (`apps/web`) | **Cloudflare Pages** | Compilación estática con HTTPS en `*.pages.dev`. |
| IA, Exámenes y recordatorios (`app-b20-ai`, `apps/api/wrangler.ai.jsonc`) | **Cloudflare Workers** | Gemini BYOK, Guías, operaciones privadas de Exámenes y cron de avisos; sin R2. |
| Archivos anteriores (`app-b20-api`) | **Cloudflare Workers** y su R2 existente | Compatibilidad conservada; los archivos nuevos siguen en SpacetimeDB. |
| Extensión (`apps/extension`) | Paquete local/controlado | Panel lateral y vista completa; publicación en tienda fuera del presupuesto inicial. |
| Android (`apps/android`) | APK firmado, descarga controlada | Sin Firebase como requisito nuevo; push nativo con la app cerrada permanece pendiente. |

La instalación nueva usa SpacetimeDB y Cloudflare, y Supabase únicamente para Auth; sin D1, R2,
Cloud Run ni Secret Manager como dependencias. No se habilitan planes de pago automáticamente. OpenMAIC y
sus instrucciones antiguas no forman parte de esta entrega ni justifican añadir otro proveedor.

## Base de datos elegida

Los comandos de Maincloud de esta guía apuntan a **`app-b20-34245`**, la base indicada para
B20. Su identidad indicada es `c2006d3bbe49dc8cabbfa144282ee0af8edb84292d74f2e48128a0e0f4f626ba`. El nombre e
identidad de base son distintos al proyecto de Supabase Auth (`tgtvvbqlmlljuufrutbk`).

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

### 1. Supabase Auth

B20 usa únicamente Supabase Auth, en el proyecto `casdrecords`. Nadie se registra por su cuenta:
invitar a alguien en B20 activa su cuenta, y el primer acceso pide un código enviado al correo
y una contraseña. La configuración completa (hook `email_verified`, `b20_account_state`,
plantilla del código, SMTP y secreto del Worker) está en [`supabase-auth.md`](supabase-auth.md).

### 2. SpacetimeDB en Maincloud: preparado para la fase de datos reales

```sh
npm run spacetime:publish:maincloud
npm run spacetime:generate

# Ejecutar con la misma identidad de CLI que publicó la base:
spacetime call -s maincloud app-b20-34245 set_auth_config \
  '"https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1"' '["authenticated"]'
spacetime call -s maincloud app-b20-34245 invite_member '"tu-correo@gmail.com"' true
```

El script de Maincloud usa `--delete-data=never`; el script `spacetime:publish` sigue apuntando
a la base local `app-b20`. El módulo, `auth_config` y la primera invitación ya están preparados:
los comandos con placeholders se conservan como referencia para otra instalación. El caso de
adopción de una base vacía existente usa `B20_BOOTSTRAP_OWNER_IDENTITY` al publicar; la identidad
propietaria de CLI es distinta a la identidad de base y a las cuentas de Supabase.

Estos pasos no son necesarios para entrar a la simulación actual. Al activar
`VITE_DATA_MODE=spacetime`, la audiencia es `authenticated` y la persona debe unirse con su
correo invitado. Las demás invitaciones se administran desde Ajustes. La identidad de la sesión
de Supabase no es la identidad de la CLI que administra la base.

Variables del cliente: `VITE_SPACETIME_URI=wss://maincloud.spacetimedb.com` y
`VITE_SPACETIME_DB=app-b20-34245`. Las audiencias del módulo deben coincidir con `OIDC_AUDIENCE` del
backend. No se aceptan sesiones de otros proyectos de Supabase ni de otros proveedores.

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

### 3.1. Worker de IA y recordatorios

El servicio actual se llama **`app-b20-ai`** y se configura con
`apps/api/wrangler.ai.jsonc`, con entrada `src/guideWorker.ts`. Está separado del Worker
heredado `app-b20-api` y no requiere un bucket R2. Usa la misma base Maincloud y el mismo
cliente de autenticación que Pages. `VITE_AI_API_URL=https://app-b20-ai.aguaseero.workers.dev`
selecciona este servicio; `VITE_API_URL` conserva las descargas anteriores.

Los secretos `AI_SERVICE_TOKEN` y `AI_MASTER_KEYS_JSON` pertenecen al servicio IA y deben
conservarse al publicar. Los avisos añaden `NOTIFICATION_SERVICE_TOKEN` y
`VAPID_PRIVATE_KEY`. El propietario registra una identidad técnica exclusiva mediante
`set_notification_service`; esa identidad no se invita ni se incorpora al grupo como alumno.
El navegador nunca recibe las credenciales técnicas ni las claves privadas.

La configuración pública de esta instalación conserva `AI_ENABLED=true` y el modelo
`gemini-3.8-flash`, que ya se utilizaban para Guías. La generación sigue exigiendo la clave
personal, el consentimiento y la confirmación de cada envío. Los recordatorios se habilitan
con `NOTIFICATIONS_ENABLED=true` y un cron por minuto. La clave `VAPID_PUBLIC_KEY` del Worker
debe coincidir con `VITE_VAPID_PUBLIC_KEY` de Pages; el titular decide si concede permiso y
activa su dispositivo. La bandeja funciona sin ese permiso. Para otra instalación, mantener
los servicios externos desactivados hasta completar su configuración y habilitación expresa.

Publicar primero el módulo compatible, después el Worker y por último Pages. Conservar
las variables remotas y los secretos existentes; comprobar especialmente los flags de IA y
avisos, porque las variables explícitas de Wrangler pueden sustituir los valores del panel.
La configuración y una compilación correcta no acreditan por sí solas una publicación ni
la recepción de un aviso. Registrar los resultados en [tercera-entrega.md](tercera-entrega.md).
Los detalles de las credenciales y permisos están en [gemini-byok.md](gemini-byok.md) y
[avisos-recordatorios.md](avisos-recordatorios.md).

La retención conserva el programador interno de SpacetimeDB a 30 días. El respaldo de
Cloudflare permanece inactivo mientras no se configure `MAINTENANCE_SERVICE_TOKEN`; no es
necesario ejecutar una purga ni adelantar el vencimiento para desplegar la entrega.

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
- `VITE_AI_API_URL` selecciona el Worker dedicado de IA. `VITE_VAPID_PUBLIC_KEY` contiene
  únicamente la clave pública del envío push, igual a la configurada en el Worker. Ningún
  token técnico ni clave privada se incluye en las variables de Pages.
- `VITE_WEB_ORIGIN=https://app-b20.pages.dev` fija el dominio estable en modo `pages`; las
  nuevas compilaciones llevan los alias allí antes del login. El acceso con código y contraseña
  no necesita direcciones de retorno registradas. Los despliegues anteriores son
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

La corrección se registró en `main` y en la rama de producción sin adelantar entonces la
tercera entrega que llegó durante la revisión. Su integración y publicación posteriores se
documentan por separado en [tercera-entrega.md](tercera-entrega.md); no requieren reactivar
los builds de `appb20`.

La publicación de Pages compila el monorepo y sirve `apps/web/dist`; `app-b20` continúa
actualizándose mediante Git. El ZIP local queda como alternativa para otro proyecto de
subida directa. La guía de Pages también registra el fallo inicial por variables ausentes.

### 4.1. Publicación comprobada de la tercera entrega

El 21 de octubre de 2026 se publicó la revisión operativa `e75edfbe`, integrada con Guías y
los cambios posteriores de `main`, en el orden Maincloud → Worker dedicado → Pages. Las dos
ramas remotas estaban sincronizadas en esa revisión. Maincloud conserva las 98 tablas y
291 registros anteriores y añade 14 tablas; el programa remoto coincide con el bundle validado.
No se ejecutaron purgas de producción ni se configuró el mantenimiento de respaldo.

El Worker `app-b20-ai` quedó en `a9d81832-b113-419f-b9c7-75bf0e502cdd`, con cron real de
avisos observado a las 19:41 UTC. Pages aprobó el despliegue
`4440d39a-fb92-4e0f-86fb-0f38a8d71215`; coinciden los 16 archivos públicos de ejecución y
ocho rutas respondieron HTTP 200. Se comprobaron preferencias, lectura de un aviso,
retirada/restauración y preparación privada de IA con la cuenta titular. No se llamó a
Gemini ni se enviaron avisos push a dispositivos.

El [registro común de la tercera entrega](tercera-entrega.md#publicación-verificada-del-21-de-octubre-de-2026)
recoge las 1 225 pruebas aprobadas, compilaciones, huellas, recorridos reales y límites de
aceptación con una sola cuenta. La recepción push y el consumo real de Gemini siguen
requiriendo las acciones y credenciales de sus titulares.

### 5. Dominio (opcional)

El subdominio gratuito `*.pages.dev` sirve la web sin comprar dominio. Si más adelante se usa
un dominio propio, conectarlo a Pages, actualizar `VITE_WEB_ORIGIN` y la Site URL de Supabase
Auth. Un Worker opcional puede usar su propio subdominio de Cloudflare;
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
