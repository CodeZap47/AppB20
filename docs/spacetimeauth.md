# SpacetimeAuth y modos de datos

App B20 usa **SpacetimeAuth real por enlace al correo** y, temporalmente, **datos simulados**.
Cualquier correo verificado puede iniciar sesión y entrar a la interfaz sin invitación.
`VITE_DATA_MODE=demo` es el valor predeterminado y el configurado para Pages. Google puede
habilitarse como proveedor opcional.

`AuthProvider` se monta siempre, incluso con `?demo`. Si falta su configuración se muestra el
error correspondiente; no se abre una demo anónima. El flujo web usa Authorization Code con
PKCE y los scopes `openid profile email`; la app requiere una sesión con correo verificado.

Abre el enlace del correo en el mismo navegador y perfil desde el que solicitaste el acceso.
Puede abrirse en otra pestaña: el estado temporal PKCE se comparte mediante `localStorage`,
se consume al completar el retorno y se limpia cuando caduca. La sesión del usuario se mantiene
en `sessionStorage`; los datos de la simulación solo viven en memoria. Un navegador o dispositivo
distinto no dispone del verificador PKCE original y debe iniciar su propio acceso.

## Estado actual

La web está publicada en **https://app-b20.pages.dev**, con integración Git desde la rama
`codex/pages-spacetimeauth`. El 20 de octubre de 2026 el usuario confirmó que completó el
acceso por enlace al correo y ve la app con datos de prueba. Se comprobó también en el
navegador que Ajustes muestra la cuenta real separada de los perfiles simulados. Esa cuenta
ya tenía una invitación guardada: quedan pendientes las pruebas humanas con un correo sin
invitación, renovación esperando la expiración y cambio a otra cuenta; esos casos tienen
pruebas automatizadas. Los callbacks locales y de producción ya están guardados; también se conservó el
enlace anterior `af0dd1ec.app-b20.pages.dev`. El error previo `invalid_redirect_uri` se debió
a que únicamente estaban registrados los retornos locales; esa configuración ya se corrigió.

La compilación de Pages usa `VITE_WEB_ORIGIN=https://app-b20.pages.dev` para llevar los alias al
dominio estable antes del login. No traslada `code` ni `state` desde callbacks de otro origen.
Los despliegues anteriores son inmutables; no registres cada hash futuro ni comodines.
Consulta la [guía de Cloudflare Pages](cloudflare-pages.md).

## Cómo se conservan los datos temporales

Tras autenticarse, la app crea `DemoDataSource` con los ejemplos actuales para el `subject`
de esa cuenta. Una renovación del token de la misma identidad conserva los cambios en memoria.
Cerrar sesión, cambiar de identidad o recargar reinicia la simulación. No se guardan datos
simulados en `localStorage`, no se comparten entre cuentas y no hay conexión ni escrituras a
Maincloud. El selector de perfiles y roles ficticios indica que son simulación; **Ajustes**
muestra separadamente la cuenta real que inició sesión.

`VITE_DATA_MODE=spacetime` conserva el flujo de datos reales con `SpacetimeProvider` y
`MembershipGate`: ahí sí se exigen invitación y membresía activa. Ese modo está desactivado en
la configuración actual de Pages. Al activarlo se reutilizarán las cuentas de SpacetimeAuth;
los cambios de la simulación no se importarán automáticamente.

La base `app-b20-34245` ya está publicada en Maincloud, con emisor, cliente
`client_034jL0AHYYQ1bps8SupHU0` e invitación inicial de administrador guardados. El propietario
está persistido en `app_config`. Esa base permanece preparada para el modo `spacetime`; la
simulación no envía allí el token ni datos. La API aún no está desplegada.

## 1. Panel de SpacetimeDB

Para los comandos de esta guía necesitas Node.js 22 o posterior y una CLI de SpacetimeDB
compatible con el módulo (2.11 o posterior). Los bindings incluidos se generaron con 2.12.

La base elegida de Maincloud es **`app-b20-34245`**. Abre su panel y entra a
**SpacetimeAuth**. El proyecto y el cliente ya existen; en una base nueva se habilitan con
**Use SpacetimeAuth**. El módulo B20 se actualiza desde este repositorio siguiendo el paso 4.
El proyecto de autenticación y la base son piezas distintas; comprueba que configuras B20.

En **Clients**, edita el cliente `client_034jL0AHYYQ1bps8SupHU0` y copia su **Client ID**.
Para otra instalación crea su propio cliente. En B20 ya están guardadas estas direcciones
exactas, incluidas las rutas y los puertos:

| Entorno | Redirect URI | Post Logout Redirect URI |
| --- | --- | --- |
| Local | `http://localhost:5173/auth/callback` | `http://localhost:5173/auth/logout` |
| Producción recomendada | `https://app-b20.pages.dev/auth/callback` | `https://app-b20.pages.dev/auth/logout` |
| Enlace anterior conservado | `https://af0dd1ec.app-b20.pages.dev/auth/callback` | `https://af0dd1ec.app-b20.pages.dev/auth/logout` |

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
verificado. La fase `demo` no consulta invitaciones; la fase `spacetime` sí exige que el
correo coincida con la invitación. Si se desea Google, configúralo como proveedor opcional con
el siguiente paso. El acceso anónimo no abre la simulación ni concede membresía del grupo.

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
VITE_DATA_MODE=demo
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

El bloque anterior configura autenticación y valores locales; con `demo` no se usan la base ni
la API. Para activar posteriormente el modo real con la base elegida de Maincloud, usa:

```dotenv
VITE_DATA_MODE=spacetime
VITE_SPACETIME_URI=wss://maincloud.spacetimedb.com
VITE_SPACETIME_DB=app-b20-34245
SPACETIMEDB_URI=https://maincloud.spacetimedb.com
SPACETIMEDB_MODULE=app-b20-34245
```

En Cloudflare Pages los valores públicos se configuran en `wrangler.jsonc → vars`; las
variables `VITE_*` del panel no sustituyen ese archivo. Para compilar localmente usa
`.env.pages.example` como base de `.env.pages`. Mantén `VITE_DATA_MODE=demo` durante esta fase.
`VITE_WEB_ORIGIN=https://app-b20.pages.dev`
fija el origen estable en modo `pages`; deja ambos callbacks vacíos y la app añade
`/auth/callback` o `/auth/logout`. Esas URLs HTTPS exactas ya están registradas en el cliente.
Las variables Vite se fijan al compilar. Detalles en
[Cloudflare Pages](cloudflare-pages.md). La identidad de
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

## 4. Modo futuro `spacetime`: confianza e invitación inicial

Esta sección corresponde al modo de datos reales. No es un requisito de acceso para la
simulación actual. La identidad que publicó la base conserva la facultad de configurar la autenticación y
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

## 5. Comprobaciones de la fase temporal

- El acceso humano por enlace al correo y la visualización de la app con datos de prueba se
  confirmaron el 20 de octubre de 2026. La cuenta utilizada ya tenía una invitación guardada:
  falta la prueba humana con un correo verificado sin invitación, cubierta automáticamente.
- Una sesión ausente o un correo no verificado no deben abrir la simulación, incluso con
  `?demo`; una configuración de autenticación ausente muestra el error correspondiente.
- Se comprobó en el navegador que Ajustes muestra la cuenta real separada de los perfiles y
  roles ficticios de prueba.
- Renovar el token conserva los cambios simulados de la misma identidad; recargar, cerrar
  sesión o cambiar de cuenta los reinicia. No hay datos simulados en `localStorage`. La
  renovación esperando la expiración y el cambio a otra cuenta tienen pruebas automatizadas,
  pero siguen pendientes de prueba humana.
- No se abre conexión ni se realizan lecturas o escrituras a Maincloud en modo `demo`.
- El cierre de sesión y un nuevo acceso funcionan desde el dominio estable.

Antes de activar `VITE_DATA_MODE=spacetime`, comprobar con dos cuentas invitadas persistencia,
privacidad de mensajes, rechazo de no invitados, bajas y cierre de sesión. La invitación inicial
está preparada, pero el modo real está desactivado ahora. La migración conserva las cuentas de
SpacetimeAuth y necesita preparar los datos reales; la simulación no los crea automáticamente.

La API requiere su propio despliegue y conectar la interfaz de IA/BYOK. Extensión y Android
necesitan sus callbacks y validación en sus entornos reales antes de distribuirse. El retorno
de Android usa el esquema indicado, no `capacitor://localhost`. Android usa un refresh token
si el proveedor lo entrega; si no, al vencer el ID token pide entrar de nuevo. La renovación no
abre el navegador sin una acción de la persona.

Si otra instalación contiene usuarios con identidad de Google directo, una migración del
emisor debe tratar sus identidades aparte; el mismo correo puede recibir otra identidad de
SpacetimeDB y esta implementación no fusiona cuentas automáticamente. B20 conserva aquí sus
cuentas de SpacetimeAuth al cambiar únicamente el modo de datos.

## Fuentes oficiales

Consultadas el 20 de octubre de 2026. La documentación específica todavía marca SpacetimeAuth
como beta.

- [Crear el proyecto](https://spacetimedb.com/docs/core-concepts/authentication/spacetimeauth/creating-a-project/).
- [Clientes, proveedores y callbacks](https://spacetimedb.com/docs/core-concepts/authentication/spacetimeauth/configuring-a-project/).
- [Metadatos OIDC y claves públicas](https://auth.spacetimedb.com/oidc/.well-known/openid-configuration).
- [Integración OIDC con React](https://spacetimedb.com/docs/core-concepts/authentication/spacetimeauth/react-integration/).
- [Descripción y estado de SpacetimeAuth](https://spacetimedb.com/docs/core-concepts/authentication/spacetimeauth/).
