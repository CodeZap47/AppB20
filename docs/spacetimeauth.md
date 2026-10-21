# SpacetimeAuth y acceso por invitación

App B20 usa SpacetimeAuth como emisor OIDC. El cliente actual ofrece acceso por correo;
Google puede habilitarse como proveedor opcional. Una cuenta
creada en SpacetimeAuth no concede acceso al salón: `join_group` exige un correo verificado
incluido en `invitation`, y las vistas y acciones requieren membresía activa. Los permisos de
creador pertenecen al módulo, no a un rol que la persona pueda elegir en la pantalla de acceso.

El flujo web usa Authorization Code con PKCE y los scopes `openid profile email`. El ID token
se entrega a SpacetimeDB y al backend. El servidor comprueba emisor y audiencia; el backend
comprueba también la firma y la membresía en la base. El client ID es público. Ningún client
secret de SpacetimeAuth o Google debe ponerse en una variable `VITE_*`.

## Estado actual

Al 20 de octubre de 2026, el módulo B20 está publicado en Maincloud como `app-b20-34245`,
con la identidad de base original. Ya se guardaron el emisor de SpacetimeAuth, el cliente
público `client_034jL0AHYYQ1bps8SupHU0` y la primera invitación de administrador. El propietario
quedó persistido en `app_config` y la variable temporal de adopción ya se retiró.

Los callbacks locales ya están guardados y el formulario de acceso por correo abre sin el
error `invalid_redirect_uri`. El acceso completo con una cuenta invitada, la renovación y las
pruebas con dos cuentas siguen pendientes. La web está preparada para Cloudflare Pages, pero
la preparación local no reserva un nombre ni publica el sitio. La API aún no está desplegada.

Al crear el proyecto Pages, registra sus callbacks HTTPS de entrada y salida sin quitar los
locales. Para `app-b20.pages.dev`, si ese nombre queda disponible y asignado, serían
`https://app-b20.pages.dev/auth/callback` y `https://app-b20.pages.dev/auth/logout`.
Consulta la [guía de Cloudflare Pages](cloudflare-pages.md).

## 1. Panel de SpacetimeDB

Para los comandos de esta guía necesitas Node.js 22 o posterior y una CLI de SpacetimeDB
compatible con el módulo (2.11 o posterior). Los bindings incluidos se generaron con 2.12.

La base elegida de Maincloud es **`app-b20-34245`**. Abre su panel y entra a
**SpacetimeAuth**. El proyecto y el cliente ya existen; en una base nueva se habilitan con
**Use SpacetimeAuth**. El módulo B20 se actualiza desde este repositorio siguiendo el paso 4.
El proyecto de autenticación y la base son piezas distintas; comprueba que configuras B20.

En **Clients**, edita el cliente `client_034jL0AHYYQ1bps8SupHU0` y copia su **Client ID**.
Para otra instalación crea su propio cliente. Configura estas direcciones
exactas, incluidas las rutas y los puertos:

| Campo | Desarrollo | Producción |
| --- | --- | --- |
| Redirect URIs | `http://localhost:5173/auth/callback` | `https://<tu-web>/auth/callback` |
| Post Logout Redirect URIs | `http://localhost:5173/auth/logout` | `https://<tu-web>/auth/logout` |

No uses direcciones con `#` para el callback OIDC, aunque la navegación de la app use rutas
hash. El hosting debe servir `index.html` al abrir directamente `/auth/callback` y
`/auth/logout`; `apps/web/public/_redirects` incluye reglas explícitas para esas dos rutas.
No registres vistas previas de terceros ni comodines para resolver errores de redirección; registra cada
dirección de prueba que realmente controles.

Para extensión y Android, registra también los callbacks de cada presentación. Puedes usar
clientes distintos del mismo proyecto para separar su configuración; deben compartir los
usuarios de B20.

| Presentación | Redirect URI | Post Logout Redirect URI |
| --- | --- | --- |
| Chrome | `https://<extension-id>.chromiumapp.org/auth/callback` | `https://<extension-id>.chromiumapp.org/auth/logout` |
| Android | `mx.b20.app://auth/callback` | `mx.b20.app://auth/logout` |

Sustituye `<extension-id>` por el ID real de la extensión que se cargará o publicará; una
instalación descomprimida puede tener otro ID. Si cambias el identificador de Android, cambia
juntos el esquema de retorno del código nativo y su registro en SpacetimeAuth.

El formulario actual permite entrar por correo mediante un enlace de acceso. Conserva ese
método para el piloto; no hace falta habilitar Google. El correo del token debe estar
verificado y coincidir con la invitación de B20. Si se desea Google, configúralo como proveedor
opcional con el siguiente paso. El acceso anónimo no concede membresía del grupo.

## 2. Google Cloud: proveedor opcional

Solo si deseas ofrecer entrada con Google, configura la pantalla de consentimiento OAuth y
crea un cliente de tipo **Aplicación web**.
En sus **URI de redirección autorizados** registra:

```text
https://auth.spacetimedb.com/interactions/federated/callback/google
```

Copia el client ID y el client secret de Google al proveedor Google de **SpacetimeAuth →
Identity Providers**. Son credenciales distintas al client ID de SpacetimeAuth usado por B20.
El callback de Google apunta a SpacetimeAuth; el callback de SpacetimeAuth apunta a B20.
Si el consentimiento de Google sigue en modo de prueba, incluye las cuentas que probarán el
piloto entre sus usuarios de prueba.

## 3. Variables de la app y del backend

Copia `.env.example` y completa los valores de tu entorno. Vite lee las variables de la raíz
del repositorio al iniciar o compilar; el backend necesita las suyas en su entorno de ejecución.

```dotenv
VITE_SPACETIMEAUTH_AUTHORITY=https://auth.spacetimedb.com/oidc
VITE_SPACETIMEAUTH_CLIENT_ID=<client-id-web-de-SpacetimeAuth>
# Opcionales si las tres presentaciones comparten cliente y callbacks registrados:
VITE_SPACETIMEAUTH_EXTENSION_CLIENT_ID=<client-id-extension>
VITE_SPACETIMEAUTH_ANDROID_CLIENT_ID=<client-id-android>
VITE_SPACETIMEAUTH_REDIRECT_URI=http://localhost:5173/auth/callback
VITE_SPACETIMEAUTH_POST_LOGOUT_REDIRECT_URI=http://localhost:5173/auth/logout
VITE_SPACETIME_URI=ws://localhost:3000
VITE_SPACETIME_DB=app-b20
VITE_API_URL=http://localhost:8787

OIDC_ISSUER=https://auth.spacetimedb.com/oidc
OIDC_AUDIENCE=<client-id-web>,<client-id-extension>,<client-id-android>
SPACETIMEDB_URI=http://localhost:3000
SPACETIMEDB_MODULE=app-b20
```

El bloque anterior es local (`app-b20`). Para conectar a la base elegida de Maincloud usa:

```dotenv
VITE_SPACETIME_URI=wss://maincloud.spacetimedb.com
VITE_SPACETIME_DB=app-b20-34245
SPACETIMEDB_URI=https://maincloud.spacetimedb.com
SPACETIMEDB_MODULE=app-b20-34245
```

En Cloudflare Pages usa `.env.pages.example` como base y deja ambas variables de callback
vacías: la app usa el origen actual más `/auth/callback` o `/auth/logout`. Registra esas URLs
HTTPS exactas en el panel cuando conozcas la dirección asignada. Las variables Vite se fijan
al compilar, no al servir el ZIP. Detalles en [Cloudflare Pages](cloudflare-pages.md). La identidad de
base indicada es `c2006d3bbe49dc8cabbfa144282ee0af8edb84292d74f2e48128a0e0f4f626ba`. Esta identidad y el nombre
`app-b20-34245` identifican la base de datos; **ninguno es el Client ID de SpacetimeAuth**.
El Client ID actual es `client_034jL0AHYYQ1bps8SupHU0`; se consulta en **Clients**. Úsalo en
`VITE_SPACETIMEAUTH_*`, `OIDC_AUDIENCE` y `set_auth_config` donde corresponda. El Client ID es
público; el client secret se conserva únicamente en el servicio que lo necesita.
`OIDC_AUDIENCE` admite varios client IDs separados por comas. `OIDC_JWKS_URI` es opcional: por
defecto el backend obtiene las claves públicas de `https://auth.spacetimedb.com/oidc/jwks`. No requiere un secreto de
SpacetimeAuth. Las variables de callback son solo para web; extensión usa `chrome.identity` y
Android abre el navegador del sistema y recibe el enlace de retorno. Reinicia desarrollo o
vuelve a compilar la web al cambiar sus variables.

## 4. Configurar la confianza e invitar al primer creador

La identidad que publicó la base conserva la facultad de configurar la autenticación y
preparar el primer acceso. La cuenta autenticada en el navegador no es la identidad de la CLI.

```sh
spacetime login
npm run spacetime:publish:maincloud
spacetime call -s maincloud app-b20-34245 set_auth_config \
  '"https://auth.spacetimedb.com/oidc"' '["<client-id-web>","<client-id-extension>","<client-id-android>"]'
spacetime call -s maincloud app-b20-34245 invite_member '"tu-correo@gmail.com"' true
```

El script de Maincloud incluye `--delete-data=never` y conserva los datos existentes. El módulo,
la configuración y la invitación inicial ya están preparados en esta base; los comandos con
placeholders sirven de referencia para futuras instalaciones. No inicialices una plantilla
`chat-react-ts` dentro de este repositorio: ya contiene la app y el módulo. Para una base local usa `-s http://localhost:3000`
y el nombre `app-b20` en lugar del servidor y nombre de producción. El emisor y la lista de audiencias
del módulo deben coincidir con los del backend; una lista vacía impide la entrada. En particular,
el emisor de SpacetimeAuth es común a distintos proyectos: comprobar solo su dominio no limita
el acceso al proyecto B20.

Abre B20, entra con la cuenta invitada y completa tu nombre para unirte. Esa invitación con
`true` crea tu membresía de creador. Después invita a los demás desde **Ajustes** con sus correos
exactos. Una baja de membresía bloquea los datos y las rutas de IA aunque siga existiendo una
sesión de SpacetimeAuth. No basta con borrar una cuenta en el panel de autenticación para
administrar la membresía del grupo.

### Actualizar una base vacía que ya existía

SpacetimeDB ejecuta `init` al crear la base, pero no al actualizar su módulo. Si una base creada
con otro módulo vacío no tiene la fila `app_config`, no existe todavía el propietario que usa
B20 para configurar el acceso. Esta situación se resolvió en `app-b20-34245`; **no repitas el
bootstrap en ella**.

Para otra base en esa situación, quien tiene permiso de publicación puede fijar temporalmente
su propia identidad de CLI y ejecutar `set_auth_config`. Consulta la identidad sin mostrar el
token de acceso:

```sh
spacetime login show
```

La identidad de tu cuenta CLI, la identidad de la base y el Client ID de SpacetimeAuth son tres
valores distintos. Usa exclusivamente la identidad de la cuenta CLI como propietario; no copies
la identidad `c2006d…` de la base ni el identificador `client_…` del cliente de autenticación.

```sh
# Solo para una base existente sin app_config, con la identidad obtenida arriba:
B20_BOOTSTRAP_OWNER_IDENTITY='<identidad-de-tu-CLI>' npm run spacetime:publish:maincloud
spacetime call -s maincloud app-b20-34245 set_auth_config \
  '"https://auth.spacetimedb.com/oidc"' '["<client-id-web>"]'

# Una vez persistido el propietario, retirar inmediatamente el valor temporal:
spacetime publish -s maincloud --env-only --unset-env B20_BOOTSTRAP_OWNER_IDENTITY \
  --yes=remote,skip-login app-b20-34245
```

Estos ejemplos apuntan a la base elegida: si preparas otra base, cambia también el destino del
script y de las llamadas. La variable se pasa como entorno del proceso; `--env` de la CLI es
un perfil de configuración y no sustituye este paso. `--env-only` no se combina con
`--module-path`. Una vez que `app_config` tiene propietario, el entorno no puede reemplazarlo.
Solo la identidad fijada por quien publica puede completar la fila faltante; nunca se concede
control al primer visitante.

## 5. Comprobaciones del piloto

- Una cuenta invitada entra y conserva sus cambios después de recargar.
- Otra cuenta sin invitación puede autenticarse, pero no unirse ni consultar datos del grupo.
- Dos cuentas invitadas ven los mismos mensajes y solo los participantes ven sus mensajes 1 a 1.
- Una cuenta dada de baja pierde el acceso al grupo y al backend.
- El cierre de sesión y un nuevo acceso funcionan desde el dominio público, PWA instalada,
  extensión con su ID definitivo y APK firmado.
- En Android se ha ejecutado `npm run build:android` para sincronizar los plugins nativos de
  navegador y retorno a la app antes de compilar el APK.

El módulo remoto, la invitación inicial y los callbacks locales ya están preparados. Falta
publicar la web, guardar sus callbacks HTTPS y completar el acceso y las pruebas con las cuentas
del piloto. El backend requiere su propio despliegue y conectar la interfaz de IA/BYOK. Los flujos de extensión y Android requieren sus callbacks y validación en sus entornos reales
antes de distribuirse. El retorno de Android usa el esquema anterior, no `capacitor://localhost`.
Android usa un refresh token si el proveedor lo entrega; si no, al vencer el ID token pide
entrar de nuevo. La renovación no abre el navegador sin una acción de la persona.

Si la base ya contiene usuarios con identidad de Google directo, respalda los datos y prepara
una migración de identidades antes de cambiar el emisor. El mismo correo puede recibir una
identidad de SpacetimeDB distinta; esta implementación no fusiona cuentas automáticamente.

## Fuentes oficiales

Consultadas el 20 de octubre de 2026. La documentación específica todavía marca SpacetimeAuth
como beta.

- [Crear el proyecto](https://spacetimedb.com/docs/core-concepts/authentication/spacetimeauth/creating-a-project/).
- [Clientes, proveedores y callbacks](https://spacetimedb.com/docs/core-concepts/authentication/spacetimeauth/configuring-a-project/).
- [Metadatos OIDC y claves públicas](https://auth.spacetimedb.com/oidc/.well-known/openid-configuration).
- [Integración OIDC con React](https://spacetimedb.com/docs/core-concepts/authentication/spacetimeauth/react-integration/).
- [Descripción y estado de SpacetimeAuth](https://spacetimedb.com/docs/core-concepts/authentication/spacetimeauth/).
